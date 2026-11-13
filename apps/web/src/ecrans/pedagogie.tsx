// Module Notes et bulletins : maquettes Matieres, Notes, Instituteur-matiere, Fusion, Bulletins, Conseil.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { RouteEcran } from '../App.tsx';
import { api, requete } from '../core/api.ts';
import { Coque } from '../core/coque.tsx';
import { imprimerDocument } from '../core/documents.ts';
import { aujourdhuiIso, decimal, enLettres, heures, jjmmaaaa, note2, pluriel, versDecimal, versEntier, versIso } from '../core/format.ts';
import { useMoi, type Moi } from '../core/session.tsx';
import {
  agir, Avatar, BarreProgression, Bandeau, Bouton, CarteChiffre, Champ, Chargement, Choix, Colonnes, confirmer, Doux, Erreur, Etapes, Etiquette, Filtres,
  Grille, InfoCaps, Liste, LigneListe, Note, ouvrirFormulaire, Panneau, Pastille, PiedFenetre, signaler, Tableau, TitrePanneau, useRaccourci,
  type EtatEtape, type Ton,
} from '../core/ui.tsx';

type Obj = Record<string, any>;
const nb = (x: unknown) => Number(x ?? 0);
/** Nom court s'il est en capitales (EPS), sinon le nom complet, comme sur les maquettes. */
const premierAffiche = (e: Obj) => `${e.matiere}` === `${e.matiere}`.toUpperCase() ? `${e.matiere}` : `${e.libelle ?? e.matiere}`;
const voyelle = (m: string) => /^[aeiouyhéèêëàâäîïôöûü]/i.test(m);
const enPhrase = (m: string) => (m === m.toUpperCase() ? m : m.toLowerCase());
/** « Note d’EPS », « Note de musique » ; « que l’EPS », « que la matière musique ». */
const deMatiere = (m: string) => (voyelle(m) ? `d’${enPhrase(m)}` : `de ${enPhrase(m)}`);
const laMatiere = (m: string) => (voyelle(m) ? `l’${enPhrase(m)}` : `la matière ${enPhrase(m)}`);
const sanctionsEnLettres = (n: number) => (n === 0 ? 'aucune sanction' : n === 1 ? 'une sanction' : `${n} sanctions`);
const majuscule = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);
const heuresOuZero = (minutes: number) => (minutes ? heures(minutes) : '0 h');
const libellePublication = (n: number) => (n === 1 ? 'Publier le bulletin' : `Publier les ${n} bulletins`);

/** Largeur de l'écran : téléphone (≤ 640 px) et tactile (≤ 1024 px, téléphone ou tablette) ; au-dessus, le rendu des maquettes est inchangé. */
function useLargeurMax(px: number) {
  const [v, setV] = useState(() => typeof window !== 'undefined' && window.matchMedia(`(max-width: ${px}px)`).matches);
  useEffect(() => {
    const m = window.matchMedia(`(max-width: ${px}px)`);
    const f = () => setV(m.matches);
    f();
    m.addEventListener('change', f);
    return () => m.removeEventListener('change', f);
  }, [px]);
  return v;
}
const useEcran = () => { const telephone = useLargeurMax(640); const tactile = useLargeurMax(1024); return { telephone, tactile }; };

/** Styles propres aux écrans du module, en complément du contrat commun (styles.css) : pied collé en bas sur téléphone, cartes de saisie. */
const STYLES_PEDAGOGIE = `
.carte-saisie { display: flex; flex-direction: column; gap: 8px; padding: 12px 0; border-bottom: 1px solid var(--bord); }
.carte-saisie:last-child { border-bottom: 0; }
.carte-saisie .ligne-note { display: flex; gap: 10px; align-items: stretch; }
.carte-saisie .ligne-note > * { flex: 1 1 0; min-width: 0; }
.carte-saisie input.champ.note { height: 48px; font-size: 18px; font-weight: 600; }
.ligne-bouton { background: none; border-top: 0; border-left: 0; border-right: 0; width: 100%; text-align: left; font: inherit; color: inherit; cursor: pointer; border-radius: 0; }
.ligne-bouton:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.ligne-matiere { display: flex; flex-direction: column; gap: 4px; padding: 10px 0; border-bottom: 1px solid var(--bord); }
.ligne-matiere > .haut { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
@media (max-width: 640px) {
  .pied-colle { position: sticky; bottom: 0; z-index: 2; margin: 0 -14px -14px; padding: 10px 14px calc(12px + env(safe-area-inset-bottom)); background: var(--panneau); border-top: 1px solid var(--bord); border-radius: 0 0 12px 12px; display: flex; flex-direction: column; gap: 8px; align-items: stretch; }
  .pied-colle .bouton { width: 100%; flex: none; }
}
.choix-defilants { display: flex; gap: 8px; overflow-x: auto; padding-bottom: 4px; scrollbar-width: thin; }
.choix-defilants > .choix { width: auto; flex: none; border-color: var(--bord-fort); white-space: nowrap; }
`;
const StylesPedagogie = () => <style>{STYLES_PEDAGOGIE}</style>;

/** Propositions de l'assistant encore à décider, d'un type donné : aucune tant que le service n'en a pas produit. */
function usePropositions(moi: Moi, type: 'IA-05' | 'IA-06') {
  const [liste, setListe] = useState<Obj[]>([]);
  const permis = moi.a('assistant.question.poser');
  useEffect(() => {
    if (!permis) return;
    api.get('/assistant').then((r) => setListe(((r.propositions ?? []) as Obj[]).filter((p) => p.type === type))).catch(() => setListe([]));
  }, [permis, type]);
  return { liste, ecarter: (id: string) => setListe((l) => l.filter((p) => p.id !== id)) };
}

/** Classes lisibles et périodes de l'année, communes à la fusion, aux bulletins et au conseil. */
async function chargerChoix(): Promise<{ classes: Obj[]; periodes: Obj[] }> {
  const [o, p] = await Promise.all([api.get('/pedagogie/saisie/options'), api.get('/pedagogie/periodes')]);
  return { classes: o.classes as Obj[], periodes: p as Obj[] };
}
function periodeCourante(periodes: Obj[]): string | null {
  const auj = aujourdhuiIso();
  return (periodes.find((p) => `${p.dateDebut}` <= auj && `${p.dateFin}` >= auj) ?? periodes[0])?.id ?? null;
}

// ===================================================================== matières (préfet)

function EcranMatieres() {
  const moi = useMoi();
  const modif = moi.a('pedagogie.programme.modifier');
  const affecter = moi.a('pedagogie.affectation.gerer');
  const { telephone, tactile } = useEcran();
  const [niveau, setNiveau] = useState<string | null>(null);
  const [d, setD] = useState<Obj | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [saisies, setSaisies] = useState<Record<string, { coef: string; bareme: string }>>({});

  const charger = async (n: string | null = niveau) => {
    try {
      const r = await api.get(`/pedagogie/parametrage${requete({ niveauId: n })}`);
      setD(r);
      setNiveau(r.niveauId);
      setSaisies(Object.fromEntries((r.matieres as Obj[]).map((m) => [m.matiereId, { coef: decimal(m.coefficient), bareme: String(m.bareme) }])));
      setErreur(null);
    } catch (e) { setErreur(e instanceof Error ? e.message : String(e)); }
  };
  useEffect(() => { void charger(null); }, []);

  const enregistrer = async () => {
    if (!d || !niveau || !modif) return;
    const lignes: Obj[] = [];
    for (const m of d.matieres as Obj[]) {
      const coefficient = versDecimal(saisies[m.matiereId]?.coef ?? '');
      const bareme = versEntier(saisies[m.matiereId]?.bareme ?? '');
      if (coefficient === null || coefficient <= 0 || coefficient > 20) { signaler(`Coefficient de ${m.libelleFr} : un nombre entre 0 et 20.`, true); return; }
      if (bareme === null || bareme < 1 || bareme > 100) { signaler(`Barème de ${m.libelleFr} : un entier entre 1 et 100.`, true); return; }
      lignes.push({ matiereId: m.matiereId, coefficient, bareme, ordre: Number(m.ordre) });
    }
    const r = await agir(() => api.put('/pedagogie/parametrage', { niveauId: niveau, modeEvaluation: d.modeEvaluation, filiere: d.filiere, lignes }), 'Matières enregistrées.');
    if (r) await charger();
  };
  useRaccourci('ctrl+s', () => void enregistrer(), modif);

  const ajouterMatiere = () => {
    const groupes = (d?.groupes ?? []) as Obj[];
    void ouvrirFormulaire('Ajouter une matière', ({ fermer }) => {
      const [f, setF] = useState({ fr: '', en: '', abFr: '', abEn: '', groupe: (groupes[0]?.id ?? null) as string | null, coef: '1', bareme: '20' });
      const [charge, setCharge] = useState(false);
      return (
        <>
          <div className="rangee"><div style={{ flex: 1 }}><Champ libelle="Matière" value={f.fr} onChange={(v) => setF({ ...f, fr: v })} autoFocus /></div>
            <div style={{ flex: 1 }}><Champ libelle="Subject" value={f.en} onChange={(v) => setF({ ...f, en: v })} /></div></div>
          <div className="rangee"><div style={{ flex: 1 }}><Champ libelle="Abrégé" value={f.abFr} onChange={(v) => setF({ ...f, abFr: v })} placeholder="EPS" /></div>
            <div style={{ flex: 1 }}><Champ libelle="Abrégé en anglais" value={f.abEn} onChange={(v) => setF({ ...f, abEn: v })} placeholder="PE" /></div></div>
          <div className="rangee">
            <div style={{ flex: 1 }}><Liste libelle="Groupe" value={f.groupe} options={groupes.map((g) => [g.id as string, `${g.libelleFr}`])} onChange={(v) => setF({ ...f, groupe: v })} /></div>
            <Champ libelle="Coef." value={f.coef} onChange={(v) => setF({ ...f, coef: v })} droite largeur={90} />
            <Champ libelle="Barème" value={f.bareme} onChange={(v) => setF({ ...f, bareme: v })} droite largeur={90} />
          </div>
          <PiedFenetre fermer={() => fermer()} action="Ajouter" charge={charge} onAction={async () => {
            setCharge(true);
            const r = await agir(() => api.post('/pedagogie/matieres', { libelleFr: f.fr.trim(), libelleEn: f.en.trim(), abregeFr: f.abFr.trim() || null, abregeEn: f.abEn.trim() || null,
              groupeId: f.groupe, niveauId: niveau, coefficient: versDecimal(f.coef) ?? 1, bareme: versEntier(f.bareme) ?? 20 }), 'Matière ajoutée.');
            setCharge(false);
            if (r) { fermer(); void charger(); }
          }} />
        </>
      );
    });
  };

  const affecterInstituteur = (classeId?: string, matiereId?: string, personnelId?: string) => {
    if (!d) return;
    const equipes = d.equipes as Obj[];
    const matieres = d.matieres as Obj[];
    const instituteurs = d.instituteurs as Obj[];
    void ouvrirFormulaire('Affecter un instituteur', ({ fermer }) => {
      const [classe, setClasse] = useState<string | null>(classeId ?? equipes[0]?.classeId ?? null);
      const [matiere, setMatiere] = useState<string>(matiereId ?? '');
      const [perso, setPerso] = useState<string | null>(personnelId ?? null);
      return (
        <>
          <Liste libelle="Classe" value={classe} options={equipes.map((e) => [e.classeId as string, `${e.classe}`])} onChange={setClasse} />
          <Liste libelle="Matière" value={matiere} options={[['', 'Toutes les matières : instituteur principal'], ...matieres.map((m): [string, string] => [m.matiereId, `${m.libelleFr}`])]} onChange={setMatiere} />
          <Liste libelle="Instituteur" value={perso} options={instituteurs.map((i) => [i.id as string, `${i.nom}`])} onChange={setPerso} />
          <Note>Un seul instituteur principal par classe ; une matière confiée à un instituteur de matière lui revient en propre.</Note>
          <PiedFenetre fermer={() => fermer()} action="Enregistrer" disabled={!classe || !perso} onAction={async () => {
            const r = await agir(() => api.put('/pedagogie/affectations', { classeId: classe, matiereId: matiere || null, personnelId: perso }), 'Affectation enregistrée.');
            if (r) { fermer(); void charger(); }
          }} />
        </>
      );
    });
  };

  const gererGroupes = () => {
    const groupes = (d?.groupes ?? []) as Obj[];
    void ouvrirFormulaire('Groupes de matières', ({ fermer }) => {
      const [fr, setFr] = useState('');
      const [en, setEn] = useState('');
      return (
        <>
          <div className="rangee centre" style={{ gap: 8 }}>{groupes.map((g) => <Pastille key={g.id}>{g.libelleFr}</Pastille>)}</div>
          <div className="rangee"><div style={{ flex: 1 }}><Champ libelle="Nouveau groupe" value={fr} onChange={setFr} autoFocus /></div>
            <div style={{ flex: 1 }}><Champ libelle="Group" value={en} onChange={setEn} /></div></div>
          <PiedFenetre fermer={() => fermer()} action="Ajouter" onAction={async () => {
            const r = await agir(() => api.post('/pedagogie/groupes', { libelleFr: fr.trim(), libelleEn: en.trim() }), 'Groupe ajouté.');
            if (r) { fermer(); void charger(); }
          }} />
        </>
      );
    }, 460);
  };

  const niveaux = (d?.niveaux ?? []) as Obj[];
  const courant = niveaux.find((n) => n.id === niveau);
  const primaire = courant ? courant.ordre_enseignement !== 'secondaire' : true;
  const totalCoef = Object.values(saisies).reduce((s, x) => s + (versDecimal(x.coef) ?? 0), 0);

  return (
    <Coque module="notes">
      <StylesPedagogie />
      <Filtres
        champs={<>
          <Liste libelle="Niveau" value={niveau} largeur={160} options={niveaux.map((n) => [n.id as string, `${n.code}`])} onChange={(v) => void charger(v)} />
          <Liste libelle="Filière ou série" value="aucune" largeur={230} options={[['aucune', primaire ? 'Sans objet au primaire' : 'Aucune']]} />
          <Liste libelle="Mode d'évaluation" value={`${d?.modeEvaluation ?? 'notes_sur_20'}`} largeur={230}
            options={[['notes_sur_20', 'Notes sur 20'], ['competences', 'Par compétences (APC)']]}
            onChange={(v) => { if (v === 'competences') signaler('L’établissement évalue par des notes sur 20 : l’évaluation par compétences n’est pas en vigueur.', true); }} />
        </>}
        actions={modif ? <Bouton variante="principal" touches={['Ctrl', 'S']} onClick={() => void enregistrer()}>Enregistrer</Bouton> : undefined}
      />
      <Bandeau icone="eleves">Un seul instituteur principal par classe ; il reçoit d’office toutes les matières de sa classe. Le préfet affecte les instituteurs de matière (EPS, anglais, informatique et matières déclarées par l’école).</Bandeau>
      {erreur ? <Erreur message={erreur} recharger={() => void charger()} /> : !d ? <Chargement /> : (
        <Colonnes colonnes={[
          { flex: 5, min: 640, enfants: (
            <Panneau>
              <TitrePanneau titre={`Matières du niveau ${courant?.code ?? ''}`}
                action={modif ? <Bouton variante="lien" icone="ajouter" onClick={ajouterMatiere}>Ajouter une matière</Bouton> : undefined} />
              <Tableau serre
                colonnes={[{ titre: 'Ordre', mobile: 'cachee' }, { titre: 'Matière · Subject', mobile: 'entete' }, { titre: 'Groupe' }, { titre: 'Coef.' }, { titre: 'Barème' }, { titre: 'Instituteur' }]}
                vide="Aucune matière pour ce niveau"
                cles={(d.matieres as Obj[]).map((m) => m.matiereId)}
                lignes={(d.matieres as Obj[]).map((m) => [
                  <span className="doux">{m.ordre}</span>,
                  <div style={{ display: 'flex', flexDirection: 'column' }}><span className="gras">{m.libelleFr}</span><span className="doux">{m.libelleEn}</span></div>,
                  m.groupe ? <Pastille>{m.groupe}</Pastille> : <span className="doux">–</span>,
                  <Champ petit={!tactile} droite largeur={tactile ? 84 : 64} inputMode="decimal" value={saisies[m.matiereId]?.coef ?? ''} readOnly={!modif} ariaLabel={`Coefficient de ${m.libelleFr}`}
                    onChange={(v) => setSaisies((s) => ({ ...s, [m.matiereId]: { ...s[m.matiereId]!, coef: v } }))} />,
                  <Champ petit={!tactile} droite largeur={tactile ? 84 : 64} inputMode="numeric" value={saisies[m.matiereId]?.bareme ?? ''} readOnly={!modif} ariaLabel={`Barème de ${m.libelleFr}`}
                    onChange={(v) => setSaisies((s) => ({ ...s, [m.matiereId]: { ...s[m.matiereId]!, bareme: v } }))} />,
                  m.instituteur ? <span>{m.instituteur}</span> : <span className="doux">–</span>,
                ])}
                total={telephone ? undefined : ['', 'Total', '', decimal(totalCoef), '', '']}
              />
              {telephone && <span className="gras">Total des coefficients : {decimal(totalCoef)}</span>}
              <Doux>L’ordre est celui du bulletin. Coefficients et barèmes valent pour l’année {moi.annee ?? ''}.</Doux>
            </Panneau>
          ) },
          { flex: 2, min: 300, enfants: <>
            <Panneau ecart={0}>
              <TitrePanneau titre="Équipe de la classe" sous="L’instituteur principal et les instituteurs de matière"
                action={affecter ? <Bouton variante="lien" icone="ajouter" onClick={() => affecterInstituteur()}>Affecter</Bouton> : undefined} />
              <div style={{ height: 6 }} />
              {(d.equipes as Obj[]).map((e) => (
                <div key={e.classeId}>
                  <LigneListe>
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 1 }}>
                      <span className="gras">{e.classe}</span>
                      <span className="doux" style={{ fontSize: 13 }}>{e.principal ? `Instituteur principal : ${e.principal.nom}${e.couverture ? ` · ${e.couverture}` : ''}` : 'Aucun instituteur principal'}</span>
                    </div>
                    {affecter ? (
                      <button type="button" className="lien-texte" style={{ display: 'inline-flex', alignItems: 'center', minHeight: 44 }}
                        aria-label={`${e.principal ? 'Changer' : 'Désigner'} l’instituteur principal de ${e.classe}`}
                        onClick={() => affecterInstituteur(e.classeId, '', e.principal?.personnelId)}>
                        {e.principal ? <Pastille ton="succes" icone="coche">Principal désigné</Pastille> : <Pastille ton="attention">À désigner</Pastille>}
                      </button>
                    ) : (e.principal ? <Pastille ton="succes" icone="coche">Principal désigné</Pastille> : <Pastille ton="attention">À désigner</Pastille>)}
                  </LigneListe>
                  {(e.exceptions as Obj[]).map((x) => (
                    <LigneListe key={x.affectationId}>
                      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 1 }}>
                        <span className="gras">{x.matiere}</span>
                        <span className="doux" style={{ fontSize: 13 }}>{x.nom} · {x.statut} · {x.classes}</span>
                      </div>
                      {affecter && <Bouton variante="lien" onClick={() => affecterInstituteur(e.classeId, x.matiereId, x.personnelId)}>Modifier</Bouton>}
                    </LigneListe>
                  ))}
                </div>
              ))}
            </Panneau>
            <Panneau>
              <TitrePanneau titre="Groupes de matières" action={modif ? <Bouton variante="lien" icone="parametres" onClick={gererGroupes}>Gérer</Bouton> : undefined} />
              <div className="rangee centre" style={{ gap: 8 }}>{(d.groupes as Obj[]).map((g) => <Pastille key={g.id}>{g.libelleFr}</Pastille>)}</div>
              <Doux>Un groupe donne une moyenne de groupe sur le bulletin.</Doux>
            </Panneau>
          </> },
        ]} />
      )}
    </Coque>
  );
}

// ===================================================================== grille de saisie commune

const STATUTS: [string, string][] = [['present', 'Présent'], ['absent', 'Absent'], ['absent_justifie', 'Absent justifié'], ['dispense', 'Dispensé']];

interface LigneSaisie { inscriptionId: string; nom: string; modifiable: boolean; note: string; statut: string; remarque: string; appreciation: string }
const versLigne = (e: Obj): LigneSaisie => ({
  inscriptionId: e.inscriptionId, nom: `${e.nom}`, modifiable: e.modifiable === true, note: e.valeur === null || e.valeur === undefined ? '' : decimal(e.valeur),
  statut: `${e.statut ?? 'present'}`, remarque: `${e.remarque ?? ''}`, appreciation: `${e.appreciation ?? ''}`,
});

function corpsNotes(lignes: LigneSaisie[], appreciation = false) {
  return lignes.filter((l) => l.modifiable).map((l) => ({
    inscriptionId: l.inscriptionId, valeur: l.statut === 'present' ? versDecimal(l.note) : null, statut: l.statut,
    remarque: l.remarque.trim() || null, ...(appreciation ? { appreciation: l.appreciation.trim() } : {}),
  }));
}

/** Contrôle du barème avant l'enregistrement (RG-23) ; renvoie false et prévient si une note dépasse. */
function notesValides(lignes: LigneSaisie[], bareme: number): boolean {
  for (const l of lignes) {
    if (!l.note) continue;
    const v = versDecimal(l.note);
    if (v === null || v < 0 || v > bareme) { signaler(`Note de ${l.nom} : entre 0 et ${bareme}.`, true); return false; }
  }
  return true;
}

/** Grille de saisie : Entrée → élève suivant ; A, J, D → absent, absent justifié, dispensé. */
function GrilleSaisie({ lignes, setLignes, modifiable, libelleNote, appreciation, ariaNote = 'Note' }: {
  lignes: LigneSaisie[]; setLignes: (f: (l: LigneSaisie[]) => LigneSaisie[]) => void; modifiable: boolean; libelleNote: string; appreciation?: boolean; ariaNote?: string;
}) {
  const champs = useRef<(HTMLInputElement | null)[]>([]);
  const maj = (i: number, p: Partial<LigneSaisie>) => setLignes((ls) => ls.map((l, k) => (k === i ? { ...l, ...p } : l)));
  const saisi = (i: number, v: string) => {
    const k = v.trim().toLowerCase();
    if (k === 'a') return maj(i, { statut: 'absent', note: '' });
    if (k === 'j') return maj(i, { statut: 'absent_justifie', note: '' });
    if (k === 'd') return maj(i, { statut: 'dispense', note: '' });
    if (!/^\d{0,3}([,.]\d{0,2})?$/.test(v)) return;
    maj(i, v ? { note: v, statut: 'present' } : { note: v });
  };
  const affichage = (l: LigneSaisie) => (l.note ? l.note : l.statut === 'present' ? '–' : STATUTS.find((s) => s[0] === l.statut)?.[1] ?? '–');
  const { telephone, tactile } = useEcran();
  const libelleStatut = (l: LigneSaisie) => STATUTS.find((s) => s[0] === l.statut)?.[1] ?? '';

  // Le champ de note : au bureau, les lettres A, J, D posent le statut ; sur téléphone, le clavier décimal s'ouvre et Entrée passe à l'élève suivant.
  const champNote = (l: LigneSaisie, i: number, classe: string) => (
    <input ref={(el) => { champs.current[i] = el; }} className={classe} value={l.note}
      inputMode={appreciation && !telephone ? undefined : 'decimal'} enterKeyHint="next" aria-label={`${ariaNote} de ${l.nom}`}
      placeholder={(appreciation || telephone) && l.statut !== 'present' ? libelleStatut(l) : undefined}
      onChange={(e) => saisi(i, e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); champs.current[i + 1]?.focus(); }
        // Effacer un champ vide rend l'élève présent (sans note).
        if ((e.key === 'Backspace' || e.key === 'Delete') && !l.note && l.statut !== 'present') maj(i, { statut: 'present' });
      }} />
  );
  const listeStatut = (l: LigneSaisie, i: number, ecrit: boolean, largeur?: number) => (
    <Liste petit={!tactile} largeur={largeur} value={l.statut} options={STATUTS} ariaLabel={`Statut de ${l.nom}`}
      onChange={ecrit ? (v) => maj(i, v === 'present' ? { statut: v } : { statut: v, note: '' }) : undefined} />
  );
  const champTexte = (l: LigneSaisie, i: number) => (
    <Champ petit={!tactile} value={appreciation ? l.appreciation : l.remarque} ariaLabel={`${appreciation ? 'Appréciation' : 'Remarque'} pour ${l.nom}`}
      placeholder={telephone ? (appreciation ? 'Appréciation' : 'Remarque') : undefined}
      onChange={(v) => maj(i, appreciation ? { appreciation: v } : { remarque: v })} />
  );

  if (telephone) {
    // Téléphone : une carte par élève, saisissable au pouce ; le statut est un choix explicite (pas de raccourci clavier).
    return (
      <div>
        {lignes.length === 0 && <Doux>Aucun élève dans cette classe</Doux>}
        {lignes.map((l, i) => {
          const ecrit = modifiable && l.modifiable;
          return (
            <div key={l.inscriptionId} className="carte-saisie">
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span className="doux">{i + 1}</span><span className="gras" style={{ flex: 1 }}>{l.nom}</span>
                {!ecrit && <span className="gras">{affichage(l)}</span>}
              </div>
              {ecrit ? (
                <>
                  <div className="ligne-note">
                    <label className="champ-groupe"><span className="libelle">{libelleNote}</span>{champNote(l, i, 'champ droite note')}</label>
                    <div className="champ-groupe"><span className="libelle">Statut</span>{listeStatut(l, i, ecrit)}</div>
                  </div>
                  {champTexte(l, i)}
                </>
              ) : (
                <Doux>{l.statut !== 'present' ? `${libelleStatut(l)} · ` : ''}{appreciation ? l.appreciation : l.remarque}</Doux>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <Tableau serre
      colonnes={[{ titre: 'N°' }, { titre: 'Élève', mobile: 'entete' }, { titre: libelleNote }, ...(appreciation ? [] : [{ titre: 'Statut' }]), { titre: appreciation ? 'Appréciation de la matière' : 'Remarque' }]}
      vide="Aucun élève dans cette classe"
      cles={lignes.map((l) => l.inscriptionId)}
      lignes={lignes.map((l, i) => {
        const ecrit = modifiable && l.modifiable;
        return [
          <span className="doux">{i + 1}</span>,
          <span className="gras">{l.nom}</span>,
          ecrit
            ? <div style={{ width: appreciation ? 130 : tactile ? 96 : 84 }}>{champNote(l, i, `champ ${tactile ? '' : 'petit'} droite`)}</div>
            : <span>{affichage(l)}</span>,
          ...(appreciation ? [] : [listeStatut(l, i, ecrit, 170)]),
          ecrit ? champTexte(l, i) : <span className="doux">{appreciation ? l.appreciation : l.remarque}</span>,
        ];
      })}
    />
  );
}

// ===================================================================== saisie des notes (principal, préfet, directeur)

function EcranNotes() {
  const moi = useMoi();
  // L'instituteur de matière a sa propre vue (maquette Instituteur-matiere), sur la même route.
  if (moi.role('instituteur_matiere') && !moi.role('instituteur_principal')) return <VueMatiere />;
  return <SaisieNotes moi={moi} />;
}

function SaisieNotes({ moi }: { moi: Moi }) {
  const [params] = useSearchParams();
  const { telephone } = useEcran();
  const [classes, setClasses] = useState<Obj[] | null>(null);
  const [periodes, setPeriodes] = useState<Obj[]>([]);
  const [classe, setClasse] = useState<string | null>(null);
  const [matiere, setMatiere] = useState<string | null>(null);
  const [periode, setPeriode] = useState<string | null>(null);
  const [sequence, setSequence] = useState<string | null>(null);
  const [d, setD] = useState<Obj | null>(null);
  const [lignes, setLignes] = useState<LigneSaisie[]>([]);
  const [charge, setCharge] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  const matieresDe = (cs: Obj[] | null, c: string | null) => ((cs ?? []).find((x) => x.id === c)?.matieres ?? []) as Obj[];
  const sequencesDe = (ps: Obj[], p: string | null) => ((ps.find((x) => x.id === p)?.sequences ?? []) as Obj[]);

  const charger = async (c = classe, m = matiere, s = sequence) => {
    if (!c || !m || !s) { setD(null); return; }
    try {
      const r = await api.get(`/pedagogie/saisie${requete({ classeId: c, matiereId: m, sequenceId: s })}`);
      setD(r);
      setLignes((r.eleves as Obj[]).map(versLigne));
      setErreur(null);
    } catch (e) { setErreur(e instanceof Error ? e.message : String(e)); }
  };

  /** Le lien (?classeId&matiereId&sequenceId) ne sert qu'au premier chargement ; ensuite, le choix courant est gardé. */
  const initialiser = async (premier = false) => {
    try {
      const [o, sq, cour] = await Promise.all([api.get('/pedagogie/saisie/options'), api.get('/pedagogie/sequences'), api.get('/pedagogie/sequence-courante')]);
      const cs = o.classes as Obj[];
      const ps = sq as Obj[];
      const lien = (cle: string) => (premier ? params.get(cle) : null);
      const c = lien('classeId') ?? classe ?? cs[0]?.id ?? null;
      const m = lien('matiereId') ?? (matieresDe(cs, c).some((x) => x.id === matiere) ? matiere : matieresDe(cs, c)[0]?.id ?? null);
      const s0 = lien('sequenceId') ?? sequence ?? cour.sequence?.id ?? null;
      const p = ps.find((x) => (x.sequences as Obj[]).some((q) => q.id === s0))?.id ?? ps[0]?.id ?? null;
      const s = s0 ?? sequencesDe(ps, p)[0]?.id ?? null;
      setClasses(cs); setPeriodes(ps); setClasse(c); setMatiere(m); setPeriode(p); setSequence(s);
      await charger(c, m, s);
    } catch (e) { setErreur(e instanceof Error ? e.message : String(e)); }
  };
  useEffect(() => { void initialiser(true); }, []);

  // Le serveur dit si la grille est modifiable (titulaire, saisie ouverte) ; la permission de saisir reste exigée.
  const ecrit = d?.modifiable === true && moi.a('pedagogie.note.saisir');
  const enregistrer = async () => {
    if (!d || !ecrit || charge) return;
    if (!notesValides(lignes, nb(d.bareme))) return;
    setCharge(true);
    const r = await agir(() => api.put('/pedagogie/saisie', { classeId: classe, matiereId: matiere, sequenceId: sequence, notes: corpsNotes(lignes) }), 'Notes enregistrées.');
    setCharge(false);
    if (r) await charger();
  };
  useRaccourci('ctrl+s', () => void enregistrer());

  const nouvelleEvaluation = () => {
    const seqs = sequencesDe(periodes, periode);
    const defaut = seqs.find((s) => s.statut !== 'fermee')?.id ?? sequence;
    void ouvrirFormulaire('Nouvelle évaluation', ({ fermer }) => {
      const [seq, setSeq] = useState<string | null>(defaut ?? null);
      const [date, setDate] = useState(jjmmaaaa(aujourdhuiIso()));
      const [bareme, setBareme] = useState('20');
      return (
        <>
          <Liste libelle="Évaluation" value={seq} options={seqs.map((s) => [s.id as string, `${s.libelle}`])} onChange={setSeq} />
          <div className="rangee">
            <div style={{ flex: 1 }}><Champ libelle="Date du devoir" value={date} onChange={setDate} placeholder="JJ/MM/AAAA" /></div>
            <Champ libelle="Noté sur" value={bareme} onChange={setBareme} droite largeur={120} />
          </div>
          <PiedFenetre fermer={() => fermer()} action="Créer" onAction={async () => {
            const faitLe = versIso(date);
            const sur = versEntier(bareme);
            if (!faitLe) { signaler('Date du devoir : JJ/MM/AAAA.', true); return; }
            if (sur === null || sur < 1 || sur > 100) { signaler('Noté sur : un entier entre 1 et 100.', true); return; }
            const r = await agir(() => api.post('/pedagogie/evaluations', { sequenceId: seq, classeId: classe, matiereId: matiere, faitLe, bareme: sur }),
              'Évaluation créée.');
            if (r) { fermer(); setSequence(seq); void charger(classe, matiere, seq); }
          }} />
        </>
      );
    });
  };

  const changerSaisie = (action: 'ouverture' | 'fermeture' | 'deverrouillage') => {
    if (!sequence) return;
    if (action === 'fermeture') {
      void confirmer('Fermer la saisie', 'Après la fermeture, toute modification demande un déverrouillage, noté au journal d’audit.', 'Fermer la saisie')
        .then((ok) => (ok ? agir(() => api.post(`/pedagogie/sequences/${sequence}/fermeture`, {}), 'Saisie fermée.') : null))
        .then((r) => { if (r) void initialiser(); });
      return;
    }
    const dans10 = new Date(Date.now() + 10 * 86400_000).toISOString().slice(0, 10);
    const deverrouiller = action === 'deverrouillage';
    void ouvrirFormulaire(deverrouiller ? 'Déverrouiller la saisie' : 'Ouvrir la saisie', ({ fermer }) => {
      const [jusqua, setJusqua] = useState(jjmmaaaa(dans10));
      const [motif, setMotif] = useState('');
      return (
        <>
          <Champ libelle="Ouverte jusqu’au" value={jusqua} onChange={setJusqua} placeholder="JJ/MM/AAAA" autoFocus />
          {deverrouiller && <Champ libelle="Motif" value={motif} onChange={setMotif} />}
          {deverrouiller && <Note>Le déverrouillage est noté au journal d’audit, avec son motif.</Note>}
          <PiedFenetre fermer={() => fermer()} action={deverrouiller ? 'Déverrouiller' : 'Ouvrir la saisie'} onAction={async () => {
            const date = versIso(jusqua);
            if (!date) { signaler('Date de fermeture : JJ/MM/AAAA.', true); return; }
            if (deverrouiller && !motif.trim()) { signaler('Un déverrouillage exige un motif.', true); return; }
            const r = await agir(() => api.post(`/pedagogie/sequences/${sequence}/${action}`, { jusqua: date, motif: motif.trim() || null }),
              deverrouiller ? 'Saisie déverrouillée.' : 'Saisie ouverte.');
            if (r) { fermer(); void initialiser(); }
          }} />
        </>
      );
    }, 440);
  };

  const seq = d?.sequence as Obj | undefined;
  const ouverte = seq?.statut === 'ouverte';
  const evaluation = d?.evaluation as Obj | null | undefined;
  const vides = lignes.filter((l) => l.statut === 'present' && !l.note).length;
  const optionsSeq = sequencesDe(periodes, periode).map((s): [string, string] => [s.id, s.type === 'composition' ? `${s.libelle} · sur 20` : `${s.libelle} · devoir · sur 20`]);

  let boutonSaisie: ReactNode = null;
  // Le préfet ouvre et ferme la saisie ; une saisie fermée ne se rouvre que par un déverrouillage motivé.
  if (seq && ouverte && moi.a('pedagogie.periode.ouvrir')) boutonSaisie = <Bouton icone="bouclier" onClick={() => changerSaisie('fermeture')}>Fermer la saisie</Bouton>;
  else if (seq?.statut === 'fermee' && moi.a('pedagogie.periode.deverrouiller')) boutonSaisie = <Bouton icone="bouclier" onClick={() => changerSaisie('deverrouillage')}>Déverrouiller</Bouton>;
  else if (seq?.statut === 'a_venir' && moi.a('pedagogie.periode.ouvrir')) boutonSaisie = <Bouton icone="bouclier" onClick={() => changerSaisie('ouverture')}>Ouvrir la saisie</Bouton>;

  return (
    <Coque module="notes">
      <StylesPedagogie />
      <Filtres
        champs={<>
          <Liste libelle="Classe" value={classe} largeur={140} options={(classes ?? []).map((c) => [c.id as string, `${c.nom}`])}
            onChange={(v) => { const m = matieresDe(classes, v)[0]?.id ?? null; setClasse(v); setMatiere(m); void charger(v, m, sequence); }} />
          <Liste libelle="Matière" value={matiere} largeur={200} options={matieresDe(classes, classe).map((m) => [m.id as string, `${m.libelle}`])}
            onChange={(v) => { setMatiere(v); void charger(classe, v, sequence); }} />
          <Liste libelle="Période" value={periode} largeur={160} options={periodes.map((p) => [p.id as string, `${p.libelleFr}`])}
            onChange={(v) => { const s = sequencesDe(periodes, v)[0]?.id ?? null; setPeriode(v); setSequence(s); void charger(classe, matiere, s); }} />
          <Liste libelle="Évaluation" value={sequence} largeur={260} options={optionsSeq} onChange={(v) => { setSequence(v); void charger(classe, matiere, v); }} />
        </>}
        actions={boutonSaisie ?? undefined}
      />
      {seq && (
        <Bandeau icone="bouclier">
          {ouverte ? `Saisie ouverte jusqu’au ${jjmmaaaa(seq.saisieJusqua)}. Après la fermeture, toute modification demande un déverrouillage, noté au journal d’audit.`
            : seq.statut === 'fermee' ? 'Saisie fermée. Toute modification demande un déverrouillage par le préfet, noté au journal d’audit.'
            : 'Saisie à venir : le préfet ouvre la période de saisie.'}
        </Bandeau>
      )}
      {erreur ? <Erreur message={erreur} recharger={() => void initialiser()} />
        : !classes || (classe && matiere && sequence && !d) ? <Chargement />
        : !d ? <Panneau><Doux>{!classe ? 'Aucune classe à saisir pour l’instant.' : !matiere ? 'Aucune matière à saisir pour cette classe.' : 'Aucune évaluation pour cette période.'}</Doux></Panneau>
        : (
          <Colonnes colonnes={[
            { flex: 5, min: 640, enfants: (
              <Panneau>
                <TitrePanneau titre={`${d.classe} · ${d.matiere} · ${`${seq?.libelle ?? ''}`.toLowerCase()}`}
                  sous={evaluation ? `Devoir du ${jjmmaaaa(evaluation.faitLe)}, noté sur ${evaluation.bareme}` : `Noté sur ${d.bareme} ; la date du devoir s’enregistre avec la première note`} />
                {d.modifiable !== true && d.raison && <Note>{d.raison}</Note>}
                <GrilleSaisie lignes={lignes} setLignes={setLignes} modifiable={ecrit} libelleNote={`Note sur ${d.bareme}`} />
                <div className={`rangee entre centre ${ecrit ? 'pied-colle' : ''}`}>
                  <Doux>{vides === 0 ? 'Toutes les notes sont saisies.' : vides === 1 ? 'La ligne vide reste à saisir.' : `Les ${enLettres(vides)} lignes vides restent à saisir.`}</Doux>
                  {ecrit && <Bouton variante="principal" touches={telephone ? undefined : ['Ctrl', 'S']} charge={charge} onClick={() => void enregistrer()}>Enregistrer</Bouton>}
                </div>
              </Panneau>
            ) },
            { flex: 2, min: 300, enfants: <>
              <Panneau reperes>
                <TitrePanneau titre="Cette évaluation" />
                <Grille min={110} ecart={14}>
                  <InfoCaps libelle="Notes saisies" valeur={`${d.stats.saisies} sur ${d.stats.total}`} />
                  <InfoCaps libelle="Moyenne" valeur={note2(d.stats.moyenne)} />
                  <InfoCaps libelle="Plus haute" valeur={decimal(d.stats.max)} />
                  <InfoCaps libelle="Plus basse" valeur={decimal(d.stats.min)} />
                </Grille>
              </Panneau>
              <Panneau ecart={12}>
                <TitrePanneau titre={`${seq?.libelle ?? ''} · toute la classe`} sous="Le principal suit chaque matière ; il ne modifie pas les notes des autres" />
                {(d.avancement as Obj[]).map((a) => {
                  const complet = nb(a.total) > 0 && a.notes === a.total;
                  return (
                    <div key={a.matiereId} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                        <div style={{ display: 'flex', flexDirection: 'column' }}><span className="gras">{premierAffiche(a)}</span><span className="doux petit">{a.saisiePar}</span></div>
                        <span className="gras" style={{ color: nb(a.notes) === 0 ? 'var(--attention)' : 'var(--texte)' }}>{a.notes} sur {a.total}</span>
                      </div>
                      <BarreProgression valeur={nb(a.total) === 0 ? 0 : nb(a.notes) / nb(a.total)} couleur={complet ? 'var(--succes)' : undefined} />
                    </div>
                  );
                })}
              </Panneau>
              <Panneau ecart={0}>
                <TitrePanneau titre="Évaluations du trimestre"
                  action={moi.a('pedagogie.evaluation.creer') && (d.modifiable === true || d.raison === 'Saisie fermée')
                    ? <Bouton variante="lien" icone="ajouter" onClick={nouvelleEvaluation}>Nouvelle évaluation</Bouton> : undefined} />
                <div style={{ height: 6 }} />
                {(d.evaluations as Obj[]).map((e) => (
                  <button key={e.id} type="button" className="ligne-liste cliquable ligne-bouton" aria-current={e.id === sequence ? 'true' : undefined}
                    onClick={() => { setSequence(e.id); void charger(classe, matiere, e.id); }}>
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 1 }}>
                      <span className="gras">{e.libelle}</span>
                      <span className="doux petit">
                        {e.statut === 'a_venir' ? (e.prevueLe ? `Prévue le ${jjmmaaaa(e.prevueLe)}` : 'À venir')
                          : e.statut === 'ouverte' ? `${e.notes} notes sur ${e.total} · jusqu’au ${jjmmaaaa(e.saisieJusqua)}`
                          : `${e.notes} notes sur ${e.total} · saisie fermée`}
                      </span>
                    </div>
                    {e.statut === 'ouverte' ? <Pastille ton="succes">Ouverte</Pastille> : e.statut === 'fermee' ? <Pastille icone="bouclier">Fermée</Pastille> : <Pastille>À venir</Pastille>}
                  </button>
                ))}
              </Panneau>
              <Panneau ecart={8} className="cache-mobile">
                <TitrePanneau titre="Au clavier" />
                {([[['Entrée'], 'Élève suivant'], [['A'], 'Absent'], [['J'], 'Absent justifié'], [['D'], 'Dispensé'], [['Ctrl', 'S'], 'Enregistrer']] as [string[], string][]).map(([touches, l]) => (
                  <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>{touches.map((t) => <kbd key={t}>{t}</kbd>)}</div>
                    <span className="doux">{l}</span>
                  </div>
                ))}
              </Panneau>
            </> },
          ]} />
        )}
    </Coque>
  );
}

// ===================================================================== vue de l'instituteur de matière

function VueMatiere() {
  const moi = useMoi();
  const naviguer = useNavigate();
  const voitFiches = moi.a('scolarite.eleve.consulter');
  const observe = moi.a('vie_scolaire.observation.creer');
  const sanctionne = moi.a('vie_scolaire.sanction.decider');
  const { telephone, tactile } = useEcran();
  const [mes, setMes] = useState<Obj | null>(null);
  const [choix, setChoix] = useState(0);
  const [d, setD] = useState<Obj | null>(null);
  const [lignes, setLignes] = useState<LigneSaisie[]>([]);
  const [principal, setPrincipal] = useState<string | null>(null);
  const [eleve, setEleve] = useState<string | null>(null);
  const [type, setType] = useState('comportement');
  const [sanction, setSanction] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [resume, setResume] = useState<Obj | null>(null);
  const [charge, setCharge] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  const classes = ((mes?.classes ?? []) as Obj[]);
  const classe = classes[choix];

  const chargerResume = async (inscriptionId: string | null, c: Obj | undefined = classe) => {
    if (!inscriptionId || !c || !voitFiches) { setResume(null); return; }
    try { setResume(await api.get(`/scolarite/inscriptions/${inscriptionId}/resume?matiereExclue=${c.matiereId}`)); } catch { setResume(null); }
  };

  const chargerSaisie = async (m: Obj | null = mes, i = choix) => {
    const c = ((m?.classes ?? []) as Obj[])[i];
    const s = m?.sequence as Obj | null;
    if (!c || !s) { setD(null); return; }
    try {
      const r = await api.get(`/pedagogie/saisie${requete({ classeId: c.classeId, matiereId: c.matiereId, sequenceId: s.id })}`);
      const ls = (r.eleves as Obj[]).map(versLigne);
      setD(r);
      setLignes(ls);
      const manquant = ls.find((l) => l.statut === 'present' && !l.note) ?? ls[0];
      setEleve(manquant?.inscriptionId ?? null);
      void chargerResume(manquant?.inscriptionId ?? null, c);
      setPrincipal(null);
      if (voitFiches) { try { setPrincipal((await api.get(`/scolarite/classes/${c.classeId}`)).principal ?? null); } catch { setPrincipal(null); } }
      setErreur(null);
    } catch (e) { setErreur(e instanceof Error ? e.message : String(e)); }
  };

  const charger = async () => {
    try {
      const m = await api.get('/pedagogie/mes-classes');
      const i = choix < (m.classes as Obj[]).length ? choix : 0;
      setMes(m);
      setChoix(i);
      await chargerSaisie(m, i);
    } catch (e) { setErreur(e instanceof Error ? e.message : String(e)); }
  };
  useEffect(() => { void charger(); }, []);

  const ecrit = d?.modifiable === true && moi.a('pedagogie.note.saisir');
  const enregistrer = async () => {
    if (!d || !ecrit || !classe || charge) return;
    if (!notesValides(lignes, nb(d.bareme))) return;
    setCharge(true);
    const r = await agir(() => api.put('/pedagogie/saisie', { classeId: classe.classeId, matiereId: classe.matiereId, sequenceId: mes!.sequence.id,
      notes: corpsNotes(lignes, true) }), 'Notes enregistrées.');
    setCharge(false);
    if (r) await charger();
  };
  useRaccourci('ctrl+s', () => void enregistrer());

  const observer = async () => {
    if (!eleve || description.trim().length < 3) { signaler('Décrivez ce qui s’est passé.', true); return; }
    const r = await agir(() => api.post('/vie-scolaire/observations', { inscriptionId: eleve, type, description: description.trim(), sanction: sanctionne ? sanction : null,
      matiereId: classe?.matiereId }), 'Observation enregistrée.');
    if (r) { setDescription(''); setSanction(null); void chargerResume(eleve); }
  };

  const manquants = ((d?.manquants ?? []) as string[]);
  const matiere = [...new Set(classes.map((c) => `${c.matiere}`))].join(', ');
  const seqLibelle = `${mes?.sequence?.libelle ?? ''}`.toLowerCase();

  return (
    <Coque module="notes" sansOnglets>
      <StylesPedagogie />
      {erreur ? <Erreur message={erreur} recharger={() => void charger()} /> : !mes ? <Chargement /> : (
        <Colonnes colonnes={[
          { flex: 1, min: 260, enfants: (
            <Panneau ecart={6}>
              <TitrePanneau titre={`Mes classes · ${matiere}`} sous="Affectées par le préfet" />
              {/* Sur téléphone et tablette (colonnes empilées), les classes forment une bande qui défile ; la grille de saisie vient tout de suite dessous. */}
              <div className={tactile ? 'choix-defilants' : undefined} style={tactile ? undefined : { display: 'contents' }}>
                {classes.map((c, i) => (
                  <Choix key={`${c.classeId}-${c.matiereId}`} actif={i === choix} style={{ padding: '10px 12px', flexDirection: 'column', alignItems: 'stretch', gap: 4 }}
                    onClick={() => { setChoix(i); void chargerSaisie(mes, i); }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                      <span className="gras">{c.classe}</span>
                      {c.notes === c.total && nb(c.total) > 0 ? <Pastille ton="succes" icone="coche">Notes complètes</Pastille> : <Pastille ton="attention">{c.notes} sur {c.total}</Pastille>}
                    </div>
                    <span className="doux petit">{c.creneau ?? 'Aucun créneau placé'}</span>
                  </Choix>
                ))}
              </div>
              {classes.length === 0 && <Doux>Aucune classe ne vous est affectée pour l’instant.</Doux>}
            </Panneau>
          ) },
          { flex: 3, min: 560, enfants: classe && d ? (
            <Panneau>
              <TitrePanneau titre={`${classe.classe} · ${classe.matiere} · ${seqLibelle}`}
                sous={manquants.length === 0 ? 'Toutes les notes sont saisies' : manquants.length === 1 ? `1 note manquante : ${manquants[0]}` : `${manquants.length} notes manquantes`} />
              {d.modifiable !== true && d.raison && <Note>{d.raison}</Note>}
              <GrilleSaisie lignes={lignes} setLignes={setLignes} modifiable={ecrit} appreciation libelleNote={`${classe.matiere} sur ${d.bareme}`}
                ariaNote={`Note ${deMatiere(`${classe.matiere}`)}`} />
              <div className={`rangee entre centre ${ecrit ? 'pied-colle' : ''}`}>
                <Doux>Vous ne voyez et ne saisissez que {laMatiere(`${classe.matiere}`)}. Le principal{principal ? `, ${principal},` : ''} rassemble les matières de la classe.</Doux>
                {ecrit && <Bouton variante="principal" touches={telephone ? undefined : ['Ctrl', 'S']} charge={charge} onClick={() => void enregistrer()}>Enregistrer</Bouton>}
              </div>
            </Panneau>
          ) : classe && mes.sequence ? <Chargement /> : classe ? <Panneau><Doux>Aucune évaluation en cours.</Doux></Panneau> : null },
          { flex: 2, min: 340, enfants: <>
            {classe && observe && (
              <Panneau>
                <TitrePanneau titre="Observation pendant mon cours" />
                <div className="rangee">
                  <div style={{ flex: '1 1 200px' }}><Liste libelle="Élève" value={eleve} options={lignes.map((l) => [l.inscriptionId, l.nom])}
                    onChange={(v) => { setEleve(v); void chargerResume(v); }} /></div>
                  <div style={{ flex: '1 1 170px' }}><Liste libelle="Type" value={type} onChange={setType}
                    options={[['comportement', 'Comportement'], ['retard', 'Retard'], ['travail_non_fait', 'Travail non fait'], ['tenue', 'Tenue'], ['felicitations', 'Félicitations']]} /></div>
                </div>
                <Champ libelle="Ce qui s’est passé" value={description} onChange={setDescription} lignes={2} />
                {sanctionne && <Liste libelle="Sanction" value={sanction} onChange={setSanction}
                  options={[[null, 'Aucune'], ['Retenue de 2 h', 'Retenue de 2 h'], ['Avertissement écrit aux parents', 'Avertissement écrit aux parents']]} />}
                <div className="rangee fin pile-mobile"><Bouton variante="principal" icone="coche" onClick={() => void observer()}>Enregistrer l’observation</Bouton></div>
                <Doux>{sanctionne ? 'Vous pouvez décider d’une sanction pour les faits que vous avez relevés. Le principal et le directeur la voient.'
                  : 'Le principal et le directeur voient l’observation.'}</Doux>
              </Panneau>
            )}
            {resume && (
              <Panneau ecart={12}>
                <TitrePanneau titre="Fiche de l’élève" />
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <Avatar nom={`${resume.nom}`} taille={44} />
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <span className="gras">{resume.nom}</span>
                    <span className="doux">{resume.classe} · {resume.sexe === 'F' ? 'née le' : 'né le'} {jjmmaaaa(resume.dateNaissance)}</span>
                  </div>
                </div>
                <Grille min={150} ecart={12}>
                  <InfoCaps libelle="Responsable" valeur={resume.responsable ?? '–'} />
                  <InfoCaps libelle="Discipline" valeur={nb(resume.sanctions) === 0 ? 'Aucune sanction ce trimestre' : `${resume.sanctions} sanction${nb(resume.sanctions) > 1 ? 's' : ''} ce trimestre`} />
                  <InfoCaps libelle="Moyenne des autres matières" valeur={resume.moyenneAutres === null || resume.moyenneAutres === undefined ? '–' : `${note2(resume.moyenneAutres)} sur 20`} />
                </Grille>
                <div><Bouton variante="lien" icone="chevron" onClick={() => naviguer(`/scolarite/eleves/${resume.eleveId}`)}>Ouvrir la fiche</Bouton></div>
                <Doux>Identité, photo, contacts des parents, discipline et notes des autres matières, en lecture seule.</Doux>
              </Panneau>
            )}
          </> },
        ]} />
      )}
    </Coque>
  );
}

// ===================================================================== fusion des notes (principal)

export const tonObservation = (type: string): Ton =>
  type === 'comportement' ? 'danger' : type === 'felicitations' ? 'succes' : type === 'tenue' ? 'neutre' : 'attention';
export const libelleObservation = (type: string) => ({
  comportement: 'Comportement', retard: 'Retard', travail_non_fait: 'Travail non fait', tenue: 'Tenue', felicitations: 'Félicitations', absence: 'Absence',
} as Record<string, string>)[type] ?? type;

/** Filtres classe et période communs à la fusion, aux bulletins et au conseil. */
function useClassePeriode(classeInitiale?: string | null) {
  const [choix, setChoix] = useState<{ classes: Obj[]; periodes: Obj[] } | null>(null);
  const [classe, setClasse] = useState<string | null>(null);
  const [periode, setPeriode] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  useEffect(() => {
    chargerChoix().then((c) => {
      setChoix(c);
      setClasse(classeInitiale && c.classes.some((x) => x.id === classeInitiale) ? classeInitiale : c.classes[0]?.id ?? null);
      setPeriode(periodeCourante(c.periodes));
    }).catch((e) => setErreur(e instanceof Error ? e.message : String(e)));
  }, []);
  return { choix, classe, setClasse, periode, setPeriode, erreur };
}

/** Ce qui reste à saisir avant la transmission (RG-36). */
function resteASaisir(incompletes: Obj[], nomCourt: (m: Obj) => string): string {
  if (incompletes.length > 1) return `${incompletes.length} matières incomplètes : ${incompletes.map(nomCourt).join(', ')}.`;
  const m = incompletes[0]!;
  const manquants = (m.manquants ?? []) as string[];
  return manquants.length === 1 ? `${nomCourt(m)} : il manque la note de ${manquants[0]}.` : `${nomCourt(m)} : ${manquants.length} notes manquent.`;
}

function EcranFusion() {
  const moi = useMoi();
  const { tactile } = useEcran();
  const { choix, classe, setClasse, periode, setPeriode, erreur: erreurChoix } = useClassePeriode();
  const [d, setD] = useState<Obj | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [abreges, setAbreges] = useState<Record<string, string>>({});
  useEffect(() => {
    api.get('/pedagogie/matieres').then((l: Obj[]) => setAbreges(Object.fromEntries(l.map((m) => [m.id, `${m.abrege ?? ''}`])))).catch(() => undefined);
  }, []);
  const nomCourt = (m: Obj) => { const a = abreges[m.matiereId]; return a && a === a.toUpperCase() ? a : `${m.matiere}`; };

  const charger = async (c = classe, p = periode) => {
    if (!c || !p) return;
    try { setD(await api.get(`/pedagogie/fusion?classeId=${c}&periodeId=${p}`)); setErreur(null); } catch (e) { setErreur(e instanceof Error ? e.message : String(e)); }
  };
  useEffect(() => { void charger(); }, [classe, periode]);

  const action = async (chemin: string, succes: string) => {
    const r = await agir(() => api.post(chemin, { classeId: classe, periodeId: periode }), succes);
    if (r) await charger();
  };

  const signalerErreur = (m: Obj) => {
    void ouvrirFormulaire(`Signaler une erreur · ${m.matiere}`, ({ fermer }) => {
      const [texte, setTexte] = useState('');
      return (
        <>
          <p>Le signalement part à {m.saisiePar}, qui corrige ses notes lui-même.</p>
          <Champ libelle="Ce qui ne va pas" value={texte} onChange={setTexte} lignes={3} />
          <PiedFenetre fermer={() => fermer()} action="Signaler" onAction={async () => {
            const r = await agir(() => api.post('/pedagogie/signalements', { classeId: classe, periodeId: periode, matiereId: m.matiereId, texte: texte.trim() }), 'Erreur signalée.');
            if (r) { fermer(); void charger(); }
          }} />
        </>
      );
    });
  };

  const matieres = ((d?.matieres ?? []) as Obj[]);
  const nomClasse = choix?.classes.find((x) => x.id === classe)?.nom ?? '';
  const statut = `${d?.statut ?? 'saisie'}`;
  const incompletes = matieres.filter((m) => m.notes !== m.total || nb(m.total) === 0);
  const signalees = new Set(((d?.signalements ?? []) as Obj[]).filter((s) => s.statut !== 'traite').map((s) => `${s.matiereId}`));
  const etapes: [string, EtatEtape][] = [
    ['Saisie', 'faite'],
    ['Fusion', statut === 'saisie' || statut === 'calculee' ? 'courante' : 'faite'],
    ['Validation du préfet', statut === 'transmise' ? 'courante' : statut === 'publiee' ? 'faite' : 'avenir'],
    ['Publication', statut === 'publiee' ? 'faite' : 'avenir'],
  ];
  const err = erreurChoix ?? erreur;
  return (
    <Coque module="notes">
      <StylesPedagogie />
      <Filtres champs={<>
        <Liste libelle="Classe" value={classe} largeur={140} options={(choix?.classes ?? []).map((x) => [x.id as string, `${x.nom}`])} onChange={setClasse} />
        <Liste libelle="Période" value={periode} largeur={160} options={(choix?.periodes ?? []).map((p) => [p.id as string, `${p.libelleFr}`])} onChange={setPeriode} />
      </>} />
      {err ? <Erreur message={err} recharger={() => void charger()} /> : !d ? <Chargement /> : (
        <Colonnes colonnes={[
          { flex: 3, min: 620, enfants: (
            <Panneau>
              <TitrePanneau titre={`${nomClasse} · ${d.periode} · ${pluriel(matieres.length, 'matière')}`} sous="Rassemblées pour le calcul des notes finales" />
              <Tableau
                colonnes={[{ titre: 'Matière', mobile: 'entete' }, { titre: 'Saisie par' }, { titre: 'Notes' }, { titre: 'État' }]}
                cles={matieres.map((m) => m.matiereId)}
                lignes={matieres.map((m) => {
                  const manque = nb(m.total) - nb(m.notes);
                  return [
                    <span className="gras">{m.matiere}</span>,
                    m.estMoi ? <span className="doux">Vous</span> : <div style={{ display: 'flex', flexDirection: 'column' }}><span>{m.saisiePar}</span><span className="doux petit">{m.role}</span></div>,
                    <div style={{ display: 'flex', flexDirection: 'column' }}><span>{m.notes} sur {m.total}</span>{m.moyenne !== null && <span className="doux petit">moy. {note2(m.moyenne)}</span>}</div>,
                    <div className="rangee centre" style={{ gap: 10 }}>
                      {manque === 0 && nb(m.total) > 0 ? <Pastille ton="succes" icone="coche">Prête</Pastille>
                        : nb(m.notes) === 0 ? <Pastille ton="attention">Aucune note</Pastille>
                        : <Pastille ton="attention">{manque} note{manque > 1 ? 's' : ''} manquante{manque > 1 ? 's' : ''}</Pastille>}
                      {signalees.has(`${m.matiereId}`) && <Pastille ton="attention" icone="alerte">Erreur signalée</Pastille>}
                      {!m.estMoi && moi.a('pedagogie.note.signaler') && <Bouton variante="lien" petit={!tactile} onClick={() => signalerErreur(m)}>Signaler une erreur</Bouton>}
                    </div>,
                  ];
                })}
              />
              <Doux>Vous lisez les notes des instituteurs de matière sans pouvoir les modifier : une erreur leur est signalée, et ils la corrigent eux-mêmes.</Doux>
            </Panneau>
          ) },
          { flex: 2, min: 340, enfants: <>
            <Panneau>
              <TitrePanneau titre="Fusion des notes" />
              <Etapes etapes={etapes} />
              {incompletes.length > 0 && (
                <Bandeau icone="alerte" ton="attention">
                  {`${resteASaisir(incompletes, nomCourt)} Vous transmettez une fois toutes les matières de la classe saisies (RG-36).`}
                </Bandeau>
              )}
              {moi.a('pedagogie.fusion.transmettre') && (
                <div className="rangee fin centre pile-mobile">
                  <Bouton icone="recalculer" onClick={() => void action('/pedagogie/fusion/calcul', 'Notes finales calculées.')}>Calculer les notes finales</Bouton>
                  <Bouton variante="principal" icone="envoyer" disabled={d.complet !== true || statut === 'transmise' || statut === 'publiee'}
                    onClick={() => void action('/pedagogie/fusion/transmission', 'Notes transmises au préfet.')}>Transmettre au préfet</Bouton>
                </div>
              )}
              <Doux>Moyennes et rangs sont calculés par l’application. Le préfet valide puis publie ; le bulletin devient alors visible des parents, sous condition de paiement.</Doux>
            </Panneau>
            <Panneau ecart={0}>
              <TitrePanneau titre="Relevé par les autres instituteurs" sous="Lecture seule" />
              <div style={{ height: 6 }} />
              {(d.releves as Obj[]).map((r, i) => (
                <LigneListe key={i}>
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <div className="rangee centre" style={{ gap: 8 }}><Pastille ton={tonObservation(`${r.type}`)}>{libelleObservation(`${r.type}`)}</Pastille><span className="gras">{r.eleve}</span></div>
                    <span className="doux petit">{r.type === 'absence' ? `${r.detail}, ${r.date} · relevée par ${r.auteur}` : `${r.detail} · relevé par ${r.auteur} · ${r.date}`}</span>
                  </div>
                </LigneListe>
              ))}
              {(d.releves as Obj[]).length === 0 && <div style={{ padding: '10px 0' }}><Doux>Rien de relevé par les autres instituteurs ce trimestre.</Doux></div>}
            </Panneau>
          </> },
        ]} />
      )}
    </Coque>
  );
}

// ===================================================================== bulletins (préfet ; directeur : levée du blocage)

function EcranBulletins() {
  const moi = useMoi();
  const naviguer = useNavigate();
  const { telephone, tactile } = useEcran();
  const [params] = useSearchParams();
  const { choix, classe, setClasse, periode, setPeriode, erreur: erreurChoix } = useClassePeriode(params.get('classeId'));
  const [inscription, setInscription] = useState<string | null>(params.get('inscriptionId'));
  const [d, setD] = useState<Obj | null>(null);
  const [appreciation, setAppreciation] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);

  const corps = () => ({ classeId: classe, periodeId: periode === 'annuel' ? null : periode });
  const charger = async (i: string | null = inscription) => {
    if (!classe || !periode) return;
    try {
      const r = await api.get(`/pedagogie/bulletins${requete({ ...corps(), inscriptionId: i })}`);
      setD(r);
      setInscription(r.choisi ?? null);
      setAppreciation(`${r.bulletin?.appreciationGenerale ?? ''}`);
      setErreur(null);
    } catch (e) { setErreur(e instanceof Error ? e.message : String(e)); }
  };
  useEffect(() => { void charger(); }, [classe, periode]);

  const publier = async () => {
    const ok = await confirmer(libellePublication(nb(d?.nbBulletins)),'Un bulletin publié est figé ; une correction crée une nouvelle version. Les parents le voient selon le paiement de la tranche.', 'Publier');
    if (!ok) return;
    const r = await agir(() => api.post('/pedagogie/bulletins/publication', corps()), 'Bulletins publiés.');
    if (r) await charger();
  };

  const recalculer = async () => {
    const r = await agir(() => api.post('/pedagogie/bulletins/calcul', corps()), 'Bulletins recalculés.');
    if (r) await charger();
  };

  const enAttente = () => {
    if (!d) return;
    const ids = (d.visibilite.eleves as string[]);
    const classement = d.classement as Obj[];
    const peutLever = moi.a('pedagogie.bulletin.lever_blocage');
    const voirImpayes = moi.a('finances.impaye.consulter');
    const periodeId = periode === 'annuel' ? null : periode;
    void ouvrirFormulaire('Bulletins en attente de paiement', ({ fermer }) => {
      const [leves, setLeves] = useState<string[]>([]);
      const [levee, setLevee] = useState<string | null>(null);
      const [motif, setMotif] = useState('');
      const restants = ids.filter((id) => !leves.includes(id));
      return (
        <>
          {levee ? (
            <>
              <p>Le parent verra le bulletin malgré le paiement incomplet ; la levée est notée au journal d’audit.</p>
              <Champ libelle="Motif" value={motif} onChange={setMotif} autoFocus />
              <PiedFenetre fermer={() => setLevee(null)} annuler="Retour" action="Lever le blocage" onAction={async () => {
                const r = await agir(() => api.post('/pedagogie/bulletins/levee-blocage', { inscriptionId: levee, periodeId, motif: motif.trim() || null }), 'Blocage levé.');
                if (r) { setLeves([...leves, levee]); setLevee(null); setMotif(''); void charger(); }
              }} />
            </>
          ) : (
            <>
              <div>
                {restants.map((id) => (
                  <LigneListe key={id}>
                    <span className="gras" style={{ flex: 1 }}>{classement.find((x) => x.inscriptionId === id)?.nom ?? '–'}</span>
                    {peutLever && <Bouton icone="bouclier" petit onClick={() => setLevee(id)}>Lever le blocage</Bouton>}
                  </LigneListe>
                ))}
                {restants.length === 0 && <Doux>Tous les bulletins sont visibles.</Doux>}
              </div>
              {voirImpayes
                ? <PiedFenetre fermer={() => fermer()} annuler="Fermer" action="Voir les impayés" onAction={() => { fermer(); naviguer('/finances/impayes'); }} />
                : <div className="pied"><Bouton onClick={() => fermer()}>Fermer</Bouton></div>}
            </>
          )}
        </>
      );
    });
  };

  // Brouillon de l'assistant : seulement si une proposition vise ce bulletin.
  const { liste: propositions, ecarter } = usePropositions(moi, 'IA-05');
  const proposition = propositions.find((p) => p.contenu?.inscriptionId === inscription && (!p.contenu?.periodeId || p.contenu.periodeId === periode)) ?? null;

  /** Appréciation générale du principal ; le bulletin annuel n'en porte pas. */
  const enregistrerAppreciation = async (texte: string = appreciation) => {
    if (!inscription || periode === 'annuel') return false;
    const r = await agir(() => api.put('/pedagogie/appreciations', { periodeId: periode, inscriptionId: inscription, matiereId: null, texte: texte.trim() }),
      'Appréciation enregistrée.');
    if (r) await charger();
    return r !== null;
  };

  const b = d?.bulletin as Obj | null | undefined;
  const vis = d?.visibilite as Obj | undefined;
  const classement = ((d?.classement ?? []) as Obj[]);
  const nomClasse = choix?.classes.find((x) => x.id === classe)?.nom ?? '';
  const err = erreurChoix ?? erreur;
  return (
    <Coque module="notes">
      <StylesPedagogie />
      <Filtres
        champs={<>
          <Liste libelle="Classe" value={classe} largeur={140} options={(choix?.classes ?? []).map((x) => [x.id as string, `${x.nom}`])}
            onChange={(v) => { setInscription(null); setClasse(v); }} />
          <Liste libelle="Période" value={periode} largeur={160}
            options={[...(choix?.periodes ?? []).map((p): [string, string] => [p.id, `${p.libelleFr}`]), ['annuel', 'Annuel']]} onChange={setPeriode} />
          {/* Sur téléphone et tablette (colonnes empilées), l'élève se choisit dans une liste déroulante : la liste par rang ne précède pas le bulletin. */}
          {tactile && d && classement.length > 0 && (
            <Liste libelle={`Élève · ${nomClasse}, par rang`} value={inscription}
              options={classement.map((e): [string, string] => [e.inscriptionId, `${e.rang ?? '–'}. ${e.nom} · ${note2(e.moyenne)}`])}
              onChange={(v) => { setInscription(v); void charger(v); }} />
          )}
        </>}
        actions={<>
          {moi.a('pedagogie.bulletin.calculer') && <Bouton icone="recalculer" onClick={() => void recalculer()}>Recalculer</Bouton>}
          {moi.unParmi(['pedagogie.bulletin.calculer', 'pedagogie.bulletin.publier', 'pedagogie.bulletin.apprecier', 'pedagogie.bulletin.lever_blocage']) && (
            <Bouton icone="imprimer" disabled={!classe} onClick={() => imprimerDocument(`/pedagogie/bulletins/document${requete(corps())}`)}>Imprimer la classe en PDF</Bouton>
          )}
          {moi.a('pedagogie.bulletin.publier') && <Bouton variante="principal" icone="bouclier" disabled={!d} onClick={() => void publier()}>{libellePublication(nb(d?.nbBulletins))}</Bouton>}
        </>}
      />
      <Bandeau icone="bouclier">Un bulletin publié est figé. Une correction crée la version 2 et conserve la version 1 ; moyennes et rangs sont calculés par l’application, jamais par l’assistant.</Bandeau>
      {vis && (
        <Bandeau icone="bouclier" ton="attention"
          action={nb(vis.enAttente) > 0 ? <Bouton onClick={enAttente}>{nb(vis.enAttente) === 1 ? 'Voir l’élève' : `Voir les ${vis.enAttente} élèves`}</Bouton> : undefined}>
          Visibilité pour les parents : <strong>{pluriel(nb(vis.visibles), 'bulletin')} {nb(vis.visibles) > 1 ? 'visibles' : 'visible'}</strong>, {vis.enAttente} en attente de paiement
          ({periode === 'annuel' ? 'frais de l’année non soldés' : `tranche ${vis.tranche ?? 1} payée à moins de 90 %`}). Le directeur peut lever le blocage pour un élève ; l’action est notée au journal d’audit.
        </Bandeau>
      )}
      {err ? <Erreur message={err} recharger={() => void charger()} /> : !d ? <Chargement /> : (
        <Colonnes colonnes={[
          ...(tactile ? [] : [{ flex: 1, min: 260, enfants: (
            <Panneau ecart={2}>
              <TitrePanneau titre={`${nomClasse} · ${pluriel(classement.length, 'élève')}`} sous="Par rang" />
              <div style={{ height: 8 }} />
              {classement.map((e) => (
                <Choix key={e.inscriptionId} actif={e.inscriptionId === inscription} onClick={() => { setInscription(e.inscriptionId); void charger(e.inscriptionId); }}>
                  <span className="doux" style={{ width: 26 }}>{e.rang ?? '–'}</span>
                  <span className="gras" style={{ flex: 1 }}>{e.nom}</span>
                  <span className="gras">{note2(e.moyenne)}</span>
                </Choix>
              ))}
            </Panneau>
          ) }]),
          { flex: 3, min: 640, enfants: b
            ? <Bulletin b={b} classe={nomClasse} etablissement={moi.etablissement} appreciation={appreciation} setAppreciation={setAppreciation}
                peutApprecier={moi.a('pedagogie.bulletin.apprecier') && periode !== 'annuel'} surAppreciation={(t) => enregistrerAppreciation(t)}
                proposition={proposition} ecarter={() => { if (proposition) ecarter(proposition.id); }} />
            : <Panneau><Doux>Aucun bulletin : les notes de la période ne sont pas encore saisies.</Doux></Panneau> },
        ]} />
      )}
    </Coque>
  );
}

const DISTINCTIONS: Record<string, [string, Ton]> = {
  tableau_honneur: ['Tableau d\'honneur', 'succes'], encouragements: ['Encouragements', 'accent'], avertissement_travail: ['Avertissement travail', 'danger'], aucune: ['Aucune', 'neutre'],
};

/** Brouillon de l'assistant (appréciation générale) : la personne habilitée le relit, le modifie puis l'accepte ou l'écarte. */
function BrouillonAppreciation({ texte, accepter, ecarter }: { texte: string; accepter: (t: string) => void; ecarter: () => void }) {
  const [t, setT] = useState(texte);
  return (
    <div className="bloc-assistant">
      <div className="rangee centre" style={{ gap: 8 }}><Pastille ton="accent" icone="assistant">Brouillon de l’assistant</Pastille><Doux>À relire et à valider par une personne habilitée</Doux></div>
      <Champ libelle="Appréciation générale" value={t} onChange={setT} lignes={3} />
      <div className="rangee centre pile-mobile" style={{ gap: 8 }}>
        <Bouton variante="principal" icone="coche" onClick={() => accepter(t)}>Accepter</Bouton>
        <Bouton icone="fermer" onClick={ecarter}>Écarter</Bouton>
        <Doux>Le texte reste modifiable avant acceptation.</Doux>
      </div>
    </div>
  );
}

function Bulletin({ b, classe, etablissement, appreciation, setAppreciation, peutApprecier, surAppreciation, proposition, ecarter }: {
  b: Obj; classe: string; etablissement: string; appreciation: string; setAppreciation: (v: string) => void; peutApprecier: boolean;
  surAppreciation: (texte?: string) => Promise<boolean>; proposition: Obj | null; ecarter: () => void;
}) {
  const e = b.eleve as Obj;
  const periode = b.periode as Obj;
  const abs = b.absences as Obj;
  const cl = b.classe as Obj;
  const [libDist, tonDist] = DISTINCTIONS[`${b.distinction}`] ?? DISTINCTIONS['aucune']!;
  const publie = b.statut === 'publie';
  const rang = b.rang === null || b.rang === undefined ? '–' : `${b.rang}${b.rang === 1 ? (e.sexe === 'F' ? 're' : 'er') : 'e'}`;
  const { telephone } = useEcran();
  const matieres = b.matieres as Obj[];
  return (
    <Panneau marge={telephone ? undefined : 24} ecart={16}>
      <div className="rangee entre centre">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontWeight: 700 }}>{etablissement.toUpperCase()}</span>
          <span className="doux">Bulletin du {periode.libelleFr} · {periode.libelleEn} report · {b.annee}</span>
        </div>
        <div className="rangee centre" style={{ gap: 8 }}>
          {publie ? <Pastille ton="succes">Publié</Pastille> : <Pastille ton="attention">Brouillon</Pastille>}
          <Pastille>Version {b.version}</Pastille>
        </div>
      </div>
      <Grille min={140} ecart={14}>
        <InfoCaps libelle="Élève" valeur={e.nom} />
        <InfoCaps libelle="Matricule" valeur={e.matricule} />
        <InfoCaps libelle="Classe" valeur={`${classe} · ${pluriel(nb(b.effectif), 'élève')}`} />
        <InfoCaps libelle={e.sexe === 'F' ? 'Née le' : 'Né le'} valeur={jjmmaaaa(e.dateNaissance)} />
      </Grille>
      {telephone ? (
        // Téléphone : une ligne compacte par matière (« Matière · note / coef »), lisible en 390 px.
        <div>
          {matieres.map((m) => (
            <div key={m.matiereId} className="ligne-matiere">
              <div className="haut">
                <span className="gras">{m.libelle}</span>
                <span className="gras" style={{ whiteSpace: 'nowrap' }}>{note2(m.moyenne)} <span className="doux petit">/ 20</span></span>
              </div>
              <div className="haut">
                <span className="doux petit">Coef. {decimal(m.coefficient)} · moyenne de la classe {note2(m.moyenneClasse)}</span>
                <span className="doux petit" style={{ whiteSpace: 'nowrap' }}>{note2(m.points)} pts</span>
              </div>
              {m.appreciation && <span className="petit">{m.appreciation}</span>}
            </div>
          ))}
          <div className="ligne-matiere" style={{ borderBottom: 0 }}>
            <div className="haut"><span className="gras">Total · coef. {decimal(b.totalCoefficients)}</span><span className="gras">{note2(b.totalPoints)} pts</span></div>
          </div>
        </div>
      ) : (
        <Tableau
          colonnes={[{ titre: 'Matière' }, { titre: 'Coef.', droite: true }, { titre: 'Note sur 20', droite: true }, { titre: 'Note × coef.', droite: true }, { titre: 'Moy. classe', droite: true }, { titre: 'Appréciation' }]}
          cles={matieres.map((m) => m.matiereId)}
          lignes={matieres.map((m) => [
            <span className="gras">{m.libelle}</span>, decimal(m.coefficient), <span className="gras">{note2(m.moyenne)}</span>, note2(m.points),
            <span className="doux">{note2(m.moyenneClasse)}</span>, m.appreciation ?? '',
          ])}
          total={['Total', decimal(b.totalCoefficients), '', note2(b.totalPoints), '', '']}
        />
      )}
      <Grille min={telephone ? 125 : 170} ecart={telephone ? 10 : 16}>
        <CarteChiffre etiquette="Moyenne générale" valeur={note2(b.moyenne)} unite="sur 20" />
        <CarteChiffre etiquette="Rang" valeur={rang} sous={`sur ${pluriel(nb(b.effectif), 'élève')}`} />
        <CarteChiffre etiquette="Moyenne de la classe" valeur={note2(cl.moyenne)} sous={`de ${note2(cl.min)} à ${note2(cl.max)}`} />
        <CarteChiffre etiquette="Absences" valeur={heuresOuZero(nb(abs.minutes))} sous={`dont ${heuresOuZero(nb(abs.justifiees))} justifiées`} />
      </Grille>
      <div className="rangee centre" style={{ gap: 10 }}>
        <Etiquette>Distinction</Etiquette><Pastille ton={tonDist}>{libDist}</Pastille><Doux>{b.distinctionSeuil ?? ''}</Doux>
      </div>
      {peutApprecier && !publie && proposition ? (
        <BrouillonAppreciation key={proposition.id} texte={`${proposition.contenu?.texte ?? ''}`} ecarter={ecarter}
          accepter={(t) => { void surAppreciation(t).then((ok) => { if (ok) ecarter(); }); }} />
      ) : peutApprecier && !publie ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Champ libelle="Appréciation générale" value={appreciation} onChange={setAppreciation} lignes={3} />
          <div className="pile-mobile"><Bouton icone="coche" onClick={() => void surAppreciation()}>Enregistrer l’appréciation</Bouton></div>
        </div>
      ) : appreciation ? <InfoCaps libelle="Appréciation générale" valeur={appreciation} /> : null}
      <div className="rangee" style={{ alignItems: 'stretch' }}>
        <div className="signature">L’instituteur principal</div>
        <div className="signature">Le directeur · cachet</div>
        <div className="signature">Le parent</div>
      </div>
    </Panneau>
  );
}

// ===================================================================== conseil de classe (préfet ; directeur : décisions de fin d'année)

function EcranConseil() {
  const moi = useMoi();
  const naviguer = useNavigate();
  const { telephone, tactile } = useEcran();
  const { choix, classe, setClasse, periode, setPeriode, erreur: erreurChoix } = useClassePeriode();
  const [d, setD] = useState<Obj | null>(null);
  const [distinctions, setDistinctions] = useState<Record<string, string>>({});
  const [decisions, setDecisions] = useState<Record<string, string>>({});
  const [erreur, setErreur] = useState<string | null>(null);
  const modifiable = moi.a('pedagogie.conseil.gerer');
  const decideur = moi.a('pedagogie.conseil.decider');

  const charger = async (c = classe, p = periode) => {
    if (!c || !p) return;
    try {
      const r = await api.get(`/pedagogie/conseil?classeId=${c}&periodeId=${p}`);
      setD(r);
      setDistinctions(Object.fromEntries((r.lignes as Obj[]).map((l) => [l.inscriptionId, `${l.distinction}`])));
      setDecisions(Object.fromEntries((r.lignes as Obj[]).filter((l) => l.finAnnee).map((l) => [l.inscriptionId, `${l.finAnnee}`])));
      setErreur(null);
    } catch (e) { setErreur(e instanceof Error ? e.message : String(e)); }
  };
  useEffect(() => { void charger(); }, [classe, periode]);

  const enregistrer = async () => {
    if (!d) return;
    if (modifiable) {
      const r = await agir(() => api.put('/pedagogie/conseil/distinctions', { classeId: classe, periodeId: periode,
        items: Object.entries(distinctions).map(([inscriptionId, distinction]) => ({ inscriptionId, distinction })) }), 'Distinctions enregistrées.');
      if (!r) return;
    }
    if (d.dernierePeriode === true && decideur && Object.keys(decisions).length) {
      await agir(() => api.put('/pedagogie/conseil/decisions', { classeId: classe, periodeId: periode,
        items: Object.entries(decisions).map(([inscriptionId, finAnnee]) => ({ inscriptionId, finAnnee })) }), 'Décisions enregistrées.');
    }
    await charger();
  };
  useRaccourci('ctrl+s', () => void enregistrer(), modifiable || decideur);

  const lignes = ((d?.lignes ?? []) as Obj[]);
  const difficiles = lignes.filter((l) => l.moyenne !== null && nb(l.moyenne) < 10);
  // Synthèse calculée par l'application : absences et sanctions de la période.
  const detail = (l: Obj) => majuscule(`${`${l.absences}` === '0' ? 'aucune absence' : `${l.absences} d’absence`}, ${sanctionsEnLettres(nb(l.sanctions))}.`);
  // Synthèse de l'assistant : seulement si une proposition vise cette classe et cette période.
  const { liste: propositions, ecarter } = usePropositions(moi, 'IA-06');
  const synthese = propositions.find((p) => p.contenu?.classeId === classe && p.contenu?.periodeId === periode) ?? null;
  const elevesSynthese = ((synthese?.contenu?.eleves ?? []) as Obj[]);
  const ajouterAuPv = async (texte: string[]) => {
    const pv = `${d?.procesVerbal ?? ''}`.trim();
    const bloc = ['Élèves en difficulté :', ...texte].join('\n');
    if (pv.includes(bloc)) { signaler('Ces élèves figurent déjà au procès-verbal.'); return; }
    const r = await agir(() => api.put('/pedagogie/conseil/proces-verbal', { classeId: classe, periodeId: periode, contenu: [pv, bloc].filter(Boolean).join('\n\n') }),
      'Ajouté au procès-verbal.');
    if (r) await charger();
  };

  const s = d?.stats as Obj | undefined;
  const seuils = d?.seuils as Obj | undefined;
  const optionsDistinction = Object.entries((d?.distinctions ?? {}) as Record<string, string>) as [string, string][];
  const optionsFin = Object.entries((d?.finsAnnee ?? {}) as Record<string, string>) as [string, string][];
  const nomClasse = choix?.classes.find((x) => x.id === classe)?.nom ?? '';
  const nomPeriode = choix?.periodes.find((x) => x.id === periode)?.libelleFr ?? '';
  const err = erreurChoix ?? erreur;
  return (
    <Coque module="notes">
      <StylesPedagogie />
      <Filtres
        champs={<>
          <Liste libelle="Classe" value={classe} largeur={140} options={(choix?.classes ?? []).map((x) => [x.id as string, `${x.nom}`])} onChange={setClasse} />
          <Liste libelle="Période" value={periode} largeur={160} options={(choix?.periodes ?? []).map((p) => [p.id as string, `${p.libelleFr}`])} onChange={setPeriode} />
        </>}
        actions={<>
          {(modifiable || decideur) && (
            <Bouton icone="imprimer" disabled={!classe || !periode} onClick={() => imprimerDocument(`/pedagogie/conseil/document?classeId=${classe}&periodeId=${periode}`)}>Procès-verbal</Bouton>
          )}
          {(modifiable || decideur) && (
            <Bouton variante="principal" touches={telephone ? undefined : ['Ctrl', 'S']} onClick={() => void enregistrer()}>{modifiable ? 'Enregistrer les distinctions' : 'Enregistrer les décisions'}</Bouton>
          )}
        </>}
      />
      {err ? <Erreur message={err} recharger={() => void charger()} /> : !d || !s ? <Chargement /> : <>
        <Grille min={telephone ? 125 : 220} ecart={telephone ? 10 : 16}>
          <CarteChiffre etiquette="Moyenne de la classe" valeur={note2(s.moyenne)} unite="sur 20" />
          <CarteChiffre etiquette="Taux de réussite" valeur={s.reussite === null ? '–' : `${s.reussite} %`} sous={`${s.reussis} élèves sur ${s.effectif} à 10 ou plus`} />
          <CarteChiffre etiquette="Absences" valeur={heuresOuZero(nb(s.absencesMinutes))} sous="sur le trimestre" />
          <CarteChiffre etiquette="Sanctions" valeur={`${s.sanctions}`} sous={pluriel(nb(s.elevesSanctionnes), 'élève')} />
        </Grille>
        <Colonnes colonnes={[
          { flex: 5, min: 640, enfants: (
            <Panneau>
              <TitrePanneau titre={`${nomClasse} · ${nomPeriode}`} />
              <Tableau serre
                colonnes={[{ titre: 'Rang' }, { titre: 'Élève', mobile: 'entete' }, { titre: 'Moyenne', droite: true }, { titre: 'Absences', droite: true }, { titre: 'Sanct.', droite: true },
                  { titre: 'Distinction' }, { titre: 'Fin d’année' }]}
                cles={lignes.map((l) => l.inscriptionId)}
                lignes={lignes.map((l) => [
                  <span className="doux">{l.rang ?? '–'}</span>,
                  <span className="gras">{l.nom}</span>,
                  <span className="gras" style={{ color: l.moyenne !== null && nb(l.moyenne) < 10 ? 'var(--attention)' : undefined }}
                    title={l.moyenne !== null && nb(l.moyenne) < 10 ? 'Sous la moyenne' : undefined}>{note2(l.moyenne)}{l.moyenne !== null && nb(l.moyenne) < 10 && <span className="cache-bureau"> · sous 10</span>}</span>,
                  <span className={`${l.absences}` === '0' ? 'doux' : ''}>{l.absences}</span>,
                  <span className={nb(l.sanctions) === 0 ? 'doux' : ''}>{l.sanctions}</span>,
                  <Liste petit={!tactile} largeur={190} value={distinctions[l.inscriptionId] ?? null} options={optionsDistinction} ariaLabel={`Distinction de ${l.nom}`}
                    onChange={modifiable ? (v) => setDistinctions((x) => ({ ...x, [l.inscriptionId]: v as string })) : undefined} />,
                  d.dernierePeriode === true && decideur
                    ? <Liste petit={!tactile} largeur={130} value={decisions[l.inscriptionId] ?? null} vide="À décider" options={optionsFin} ariaLabel={`Fin d’année de ${l.nom}`}
                        onChange={(v) => setDecisions((x) => ({ ...x, [l.inscriptionId]: v as string }))} />
                    : <span className="doux">{l.finAnnee ? ((d.finsAnnee as Obj)[l.finAnnee] ?? l.finAnnee) : '3e trim.'}</span>,
                ])}
              />
              {seuils && <Doux>Seuils paramétrables : tableau d’honneur à {decimal(seuils.tableauHonneur)}, encouragements à {decimal(seuils.encouragements)}, avertissement sous {decimal(seuils.avertissement)}.</Doux>}
            </Panneau>
          ) },
          { flex: 2, min: 320, enfants: <>
            <Panneau>
              <TitrePanneau titre="Préparation du conseil" />
              {synthese ? (
                <div className="bloc-assistant">
                  <div className="rangee centre" style={{ gap: 8 }}><Pastille ton="accent" icone="assistant">Élèves en difficulté</Pastille><Doux>À relire et à valider par une personne habilitée</Doux></div>
                  {elevesSynthese.map((e, i) => (
                    <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                      <div className="rangee centre" style={{ gap: 8 }}><span className="gras">{e.nom}</span>
                        {e.moyenne !== null && e.moyenne !== undefined && <Pastille ton="attention">{note2(e.moyenne)} sur 20</Pastille>}</div>
                      <span className="doux petit">{e.texte}</span>
                    </div>
                  ))}
                  <div className="rangee centre pile-mobile" style={{ gap: 8 }}>
                    {modifiable && <Bouton icone="lire" onClick={() => void ajouterAuPv(elevesSynthese.map((e) => `${e.nom} : ${e.texte ?? ''}`))}>Ajouter au procès-verbal</Bouton>}
                    <Bouton variante="lien" icone="fermer" onClick={() => ecarter(synthese.id)}>Écarter</Bouton>
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div><Pastille ton="accent">Élèves en difficulté</Pastille></div>
                  {difficiles.map((l) => (
                    <div key={l.inscriptionId} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                      <div className="rangee centre" style={{ gap: 8 }}><span className="gras">{l.nom}</span><Pastille ton="attention">{note2(l.moyenne)} sur 20</Pastille></div>
                      <span className="doux petit">{detail(l)}</span>
                    </div>
                  ))}
                  {difficiles.length === 0 && <Doux>Aucun élève sous la moyenne.</Doux>}
                  {modifiable && difficiles.length > 0 && (
                    <div className="pile-mobile"><Bouton icone="lire" onClick={() => void ajouterAuPv(difficiles.map((l) => `${l.nom} : ${note2(l.moyenne)} sur 20. ${detail(l)}`))}>Ajouter au procès-verbal</Bouton></div>
                  )}
                </div>
              )}
              <Doux>Synthèse préparée à partir des notes, des absences et des sanctions. Rien n’est enregistré sans votre accord.</Doux>
            </Panneau>
            <Panneau>
              <TitrePanneau titre="Décisions de fin d’année" />
              <p>Au conseil du 3e trimestre, la dernière colonne s’ouvre : admis, redouble ou exclu. Ces décisions alimentent le passage en classe supérieure.</p>
              {moi.a('structure.annee.cloturer') && (
                <div>
                  <Bouton variante="lien" icone="chevron" onClick={() => naviguer('/parametres/cloture')}>Voir la clôture d'année</Bouton>
                </div>
              )}
            </Panneau>
          </> },
        ]} />
      </>}
    </Coque>
  );
}

export const routes: RouteEcran[] = [
  { path: '/pedagogie/matieres', element: <EcranMatieres /> },
  { path: '/pedagogie/notes', element: <EcranNotes /> },
  { path: '/pedagogie/fusion', element: <EcranFusion /> },
  { path: '/pedagogie/bulletins', element: <EcranBulletins /> },
  { path: '/pedagogie/conseil', element: <EcranConseil /> },
];

