// Formulaire d'inscription configurable (lot 2, D-42) : réglage par l'établissement (rubrique de la configuration)
// et saisie des champs, bloc par bloc, sur l'écran d'inscription.
import { useState } from 'react';
import { api } from '../core/api.ts';
import { choisirFichier } from '../core/documents.ts';
import { versIso } from '../core/format.ts';
import { agir, Bouton, CaseACocher, Champ, Chargement, Doux, Erreur, Icone, Liste, Note, ouvrirFormulaire, Panneau, Pastille, PiedFenetre, signaler, TitrePanneau, useDonnees, useRaccourci } from '../core/ui.tsx';

export type TypeChamp = 'texte' | 'choix_unique' | 'choix_multiple' | 'photo' | 'date' | 'nombre';
export interface ChampF { code: string; bloc: string; libelle: string; type: TypeChamp; options: string[]; obligatoire: boolean; actif: boolean; ordre: number; modele: string | null }
export interface Formulaire { regle: boolean; champs: ChampF[]; blocs: { code: string; libelle: string }[]; types: { code: TypeChamp; libelle: string }[]; bibliotheque: ChampF[] }

const PHOTO_MAX = 5 * 1024 * 1024;
/** Champs de base, toujours demandés, rappelés dans leur bloc. */
const DE_BASE: Record<string, string> = {
  identite: 'Nom, prénoms, sexe, date et lieu de naissance, photo de l’élève : toujours demandés.',
  famille: 'Responsables (nom, lien, téléphone, langue des messages, payeur) : toujours demandés.',
};

// ---------------------------------------------------------------- réglage du formulaire

function FenetreQuestion({ f, bloc, presents, champ, fermer }: { f: Formulaire; bloc: string; presents: Set<string>; champ: ChampF | null; fermer: (c?: ChampF) => void }) {
  const pretes = f.bibliotheque.filter((q) => q.bloc === bloc && !presents.has(q.code));
  const [source, setSource] = useState<string>(champ ? (champ.modele ?? 'perso') : (pretes[0]?.code ?? 'perso'));
  const base = champ ?? f.bibliotheque.find((q) => q.code === source) ?? null;
  const [libelle, setLibelle] = useState(base?.libelle ?? '');
  const [type, setType] = useState<TypeChamp>(base?.type ?? 'texte');
  const [options, setOptions] = useState((base?.options ?? []).join('\n'));
  const [obligatoire, setObligatoire] = useState(base?.obligatoire ?? false);
  const [erreur, setErreur] = useState<string | null>(null);
  const choisirSource = (s: string) => {
    setSource(s);
    const q = f.bibliotheque.find((x) => x.code === s);
    setLibelle(q?.libelle ?? ''); setType(q?.type ?? 'texte'); setOptions((q?.options ?? []).join('\n')); setObligatoire(q?.obligatoire ?? false);
  };
  const avecChoix = type === 'choix_unique' || type === 'choix_multiple';
  const valider = () => {
    const opts = options.split('\n').map((x) => x.trim()).filter(Boolean);
    if (libelle.trim().length < 2) return setErreur('Libellé de la question requis.');
    if (avecChoix && opts.length < 2) return setErreur('Au moins deux choix, un par ligne.');
    const code = champ?.code ?? (source !== 'perso' ? source : `perso_${Date.now().toString(36)}`);
    fermer({ code, bloc, libelle: libelle.trim(), type, options: avecChoix ? [...new Set(opts)] : [], obligatoire, actif: champ?.actif ?? true,
      ordre: champ?.ordre ?? 999, modele: champ ? champ.modele : source !== 'perso' ? source : null });
  };
  return (
    <>
      {!champ && (
        <Liste libelle="Question" value={source} onChange={choisirSource}
          options={[...pretes.map((q): [string, string] => [q.code, `${q.libelle} · question prête`]), ['perso', 'Question personnalisée…']]} />
      )}
      <Champ libelle="Libellé affiché" value={libelle} onChange={setLibelle} autoFocus={source === 'perso'} />
      <Liste libelle="Type de réponse" value={type} onChange={(x) => setType(x)} options={f.types.map((t): [TypeChamp, string] => [t.code, t.libelle])} />
      {avecChoix && <Champ libelle="Choix proposés (un par ligne)" value={options} onChange={setOptions} lignes={5} />}
      <CaseACocher libelle="Réponse obligatoire" valeur={obligatoire} onChange={setObligatoire} />
      {erreur && <div role="alert"><Note ton="danger">{erreur}</Note></div>}
      <PiedFenetre fermer={() => fermer()} action={champ ? 'Appliquer' : 'Ajouter la question'} onAction={valider} />
    </>
  );
}

/** Rubrique « Formulaire d'inscription » de la configuration : blocs, questions prêtes ou personnalisées, obligatoires ou facultatives. */
export function PanneauFormulaire({ modifiable }: { modifiable: boolean }) {
  const st = useDonnees(() => api.get<Formulaire>('/scolarite/formulaire'));
  const [champs, setChamps] = useState<ChampF[] | null>(null);
  const [charge, setCharge] = useState(false);
  const f = st.d;
  const liste = champs ?? f?.champs ?? [];
  const modifie = champs !== null;
  const changer = (l: ChampF[]) => setChamps(l.map((c, i) => ({ ...c, ordre: i + 1 })));
  const enregistrer = async () => {
    if (!modifie || charge) return;
    setCharge(true);
    if (await agir(() => api.put('/scolarite/formulaire', { champs: liste }), 'Formulaire d’inscription enregistré')) { setChamps(null); await st.recharger(); }
    setCharge(false);
  };
  useRaccourci('ctrl+s', () => { void enregistrer(); }, modifiable && modifie);
  if (st.erreur && !f) return <Erreur message={st.erreur} recharger={st.recharger} />;
  if (!f) return <Panneau><Chargement /></Panneau>;
  const presents = new Set(liste.map((c) => c.code));
  const ajouter = async (bloc: string) => {
    const c = await ouvrirFormulaire<ChampF>('Ajouter une question', ({ fermer }) => <FenetreQuestion f={f} bloc={bloc} presents={presents} champ={null} fermer={fermer} />, 520);
    if (c) { const dernier = liste.reduce((k, x, i) => (x.bloc === bloc ? i : k), -1); const l = [...liste]; l.splice(dernier + 1 || l.length, 0, c); changer(l); }
  };
  const modifier = async (c: ChampF) => {
    const n = await ouvrirFormulaire<ChampF>(`Modifier · ${c.libelle}`, ({ fermer }) => <FenetreQuestion f={f} bloc={c.bloc} presents={presents} champ={c} fermer={fermer} />, 520);
    if (n) changer(liste.map((x) => (x.code === c.code ? n : x)));
  };
  const deplacer = (c: ChampF, sens: -1 | 1) => {
    const duBloc = liste.filter((x) => x.bloc === c.bloc);
    const i = duBloc.indexOf(c), j = i + sens;
    if (j < 0 || j >= duBloc.length) return;
    const autre = duBloc[j]!;
    changer(liste.map((x) => (x === c ? autre : x === autre ? c : x)));
  };
  const maj = (c: ChampF, p: Partial<ChampF>) => changer(liste.map((x) => (x.code === c.code ? { ...x, ...p } : x)));
  const TYPE = Object.fromEntries(f.types.map((t) => [t.code, t.libelle.replace(' (5 Mo au plus)', '')]));
  return (
    <>
      <Panneau>
        <TitrePanneau titre="Formulaire d’inscription" sous={modifie ? 'Modifications non enregistrées' : f.regle ? 'Réglé par l’établissement' : 'Formulaire proposé : à adapter'}
          action={modifiable && <span style={{ display: 'inline-flex', gap: 8 }}>
            {modifie && <Bouton onClick={() => setChamps(null)}>Annuler</Bouton>}
            <Bouton variante="principal" touches={['Ctrl', 'S']} disabled={!modifie} charge={charge} onClick={enregistrer}>Enregistrer le formulaire</Bouton>
          </span>} />
        <Doux>Choisissez les informations demandées à l’inscription : questions prêtes ou personnalisées, obligatoires ou facultatives, rangées par bloc.
          Aucune information de paiement : les frais suivent la grille de la classe. Une question retirée n’efface pas les réponses déjà données.</Doux>
      </Panneau>
      {f.blocs.map((b) => {
        const duBloc = liste.filter((c) => c.bloc === b.code);
        return (
          <Panneau key={b.code}>
            <TitrePanneau titre={b.libelle} sous={`${duBloc.filter((c) => c.actif).length} question${duBloc.filter((c) => c.actif).length > 1 ? 's' : ''} demandée${duBloc.filter((c) => c.actif).length > 1 ? 's' : ''}`}
              action={modifiable && <Bouton variante="lien" icone="ajouter" onClick={() => ajouter(b.code)}>Ajouter une question</Bouton>} />
            {DE_BASE[b.code] && <Doux>{DE_BASE[b.code]}</Doux>}
            {duBloc.length === 0 && !DE_BASE[b.code] && <Doux>Aucune question dans ce bloc.</Doux>}
            <div className="questions">
              {duBloc.map((c, i) => (
                <div key={c.code} className={`question${c.actif ? '' : ' inactive'}`}>
                  {modifiable && (
                    <span className="question-ordre">
                      <button type="button" aria-label={`Monter ${c.libelle}`} disabled={i === 0} onClick={() => deplacer(c, -1)}><Icone nom="chevron" taille={16} style={{ transform: 'rotate(-90deg)' }} /></button>
                      <button type="button" aria-label={`Descendre ${c.libelle}`} disabled={i === duBloc.length - 1} onClick={() => deplacer(c, 1)}><Icone nom="chevron" taille={16} style={{ transform: 'rotate(90deg)' }} /></button>
                    </span>
                  )}
                  <span className="question-texte">
                    <span className="gras">{c.libelle}</span>
                    <span className="doux petit">{TYPE[c.type]}{c.options.length ? ` · ${c.options.join(', ')}` : ''}{c.modele ? '' : ' · question de l’école'}</span>
                  </span>
                  <span className="question-reglages">
                    <CaseACocher libelle="Demandée" valeur={c.actif} disabled={!modifiable} onChange={(v) => maj(c, { actif: v })} />
                    <CaseACocher libelle="Obligatoire" valeur={c.obligatoire} disabled={!modifiable || !c.actif} onChange={(v) => maj(c, { obligatoire: v })} />
                    {c.obligatoire && c.actif && <Pastille ton="accent">Obligatoire</Pastille>}
                    {modifiable && <Bouton petit onClick={() => modifier(c)}>Modifier</Bouton>}
                    {modifiable && <Bouton petit variante="lien" onClick={() => changer(liste.filter((x) => x.code !== c.code))}>Retirer</Bouton>}
                  </span>
                </div>
              ))}
            </div>
          </Panneau>
        );
      })}
    </>
  );
}

// ---------------------------------------------------------------- saisie à l'inscription

export type Valeurs = Record<string, unknown>;

/** Valeurs prêtes à envoyer : dates JJ/MM/AAAA converties, réponses vides retirées. */
export function valeursAEnvoyer(champs: ChampF[], v: Valeurs): Valeurs {
  const r: Valeurs = {};
  for (const c of champs) {
    const x = v[c.code];
    if (x === undefined || x === null || x === '' || (Array.isArray(x) && !x.length)) continue;
    r[c.code] = c.type === 'date' ? versIso(String(x)) : x;
  }
  return r;
}

/** Contrôle côté écran (le serveur refait le contrôle) : champs obligatoires, dates, nombres. */
export function erreursFormulaire(champs: ChampF[], v: Valeurs): Record<string, string> {
  const e: Record<string, string> = {};
  for (const c of champs) {
    const x = v[c.code];
    const vide = x === undefined || x === null || x === '' || (Array.isArray(x) && !x.length);
    if (vide) { if (c.obligatoire) e[c.code] = 'Obligatoire'; continue; }
    if (c.type === 'date' && !versIso(String(x))) e[c.code] = 'Date au format JJ/MM/AAAA';
    if (c.type === 'nombre' && !Number.isFinite(Number(String(x).replace(',', '.')))) e[c.code] = 'Nombre attendu';
  }
  return e;
}

/** Champs d'un bloc, rendus selon leur type. */
export function ChampsDuBloc({ champs, valeurs, maj, erreurs }: { champs: ChampF[]; valeurs: Valeurs; maj: (code: string, v: unknown) => void; erreurs: Record<string, string> }) {
  if (!champs.length) return null;
  return (
    <div className="grille pile-mobile" style={{ ['--min' as string]: '220px', gap: 14 }}>
      {champs.map((c) => {
        const lib = `${c.libelle}${c.obligatoire ? ' *' : ''}`;
        const v = valeurs[c.code];
        switch (c.type) {
          case 'texte': return <Champ key={c.code} libelle={lib} value={(v as string) ?? ''} onChange={(x) => maj(c.code, x)} erreur={erreurs[c.code]} />;
          case 'nombre': return <Champ key={c.code} libelle={lib} value={(v as string) ?? ''} onChange={(x) => maj(c.code, x)} inputMode="decimal" erreur={erreurs[c.code]} />;
          case 'date': return <Champ key={c.code} libelle={lib} value={(v as string) ?? ''} onChange={(x) => maj(c.code, x)} placeholder="JJ/MM/AAAA" inputMode="numeric" erreur={erreurs[c.code]} />;
          case 'choix_unique':
            return (
              <div key={c.code} className="champ-groupe">
                <Liste libelle={lib} value={(v as string) ?? null} options={[[null, 'Choisir…'], ...c.options.map((o): [string, string] => [o, o])]} onChange={(x) => maj(c.code, x)} />
                {erreurs[c.code] && <span className="erreur-champ">{erreurs[c.code]}</span>}
              </div>
            );
          case 'choix_multiple': {
            const l = (v as string[]) ?? [];
            return (
              <div key={c.code} className="champ-groupe" role="group" aria-label={c.libelle}>
                <span className="libelle">{lib}</span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0 16px' }}>
                  {c.options.map((o) => <CaseACocher key={o} libelle={o} valeur={l.includes(o)} onChange={(x) => maj(c.code, x ? [...l, o] : l.filter((y) => y !== o))} />)}
                </div>
                {erreurs[c.code] && <span className="erreur-champ">{erreurs[c.code]}</span>}
              </div>
            );
          }
          case 'photo': {
            const p = v as { base64: string; nom: string } | undefined;
            const choisir = async () => {
              const fi = await choisirFichier('image/png,image/jpeg,image/webp');
              if (!fi) return;
              if (fi.octets.length > PHOTO_MAX) { signaler(`${c.libelle} : 5 Mo au plus.`, true); return; }
              maj(c.code, { base64: fi.base64, nom: fi.nom });
            };
            return (
              <div key={c.code} className="champ-groupe">
                <span className="libelle">{lib}</span>
                <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <Bouton icone="photo" pleine onClick={choisir} title={p?.nom}>{p ? (p.nom.length > 22 ? `${p.nom.slice(0, 20)}…` : p.nom) : 'Choisir une photo'}</Bouton>
                  {p && <Bouton variante="lien" onClick={() => maj(c.code, null)}>Retirer</Bouton>}
                </span>
                {erreurs[c.code] && <span className="erreur-champ">{erreurs[c.code]}</span>}
              </div>
            );
          }
        }
      })}
    </div>
  );
}
