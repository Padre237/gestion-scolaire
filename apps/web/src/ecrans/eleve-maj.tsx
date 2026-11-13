// Fiche d'un élève depuis la liste (lot 3, D-43) : fenêtre « Voir le détail » ou « Mettre à jour », mise à jour de l'élève
// et des responsables, historique des modifications. Les anciennes valeurs ne sont jamais effacées : le journal les garde.
import { useState } from 'react';
import { api, ErreurApi } from '../core/api.ts';
import { choisirFichier } from '../core/documents.ts';
import { jjmmaaaa, versIso } from '../core/format.ts';
import { Bascules, Bouton, CaseACocher, Champ, Chargement, Doux, Erreur, Liste, Note, ouvrirFormulaire, Pastille, signaler, Tableau, useDonnees } from '../core/ui.tsx';
import { ChampsDuBloc, type ChampF, type Formulaire, type Valeurs } from './formulaire-inscription.tsx';

export interface Droits { majEleve: boolean; majResponsables: boolean }
/** La fenêtre de mise à jour (et son onglet Historique) lit le formulaire d'inscription : sans l'une de ces permissions, ses boutons ne s'affichent pas. */
export const LECTURE_FORMULAIRE = ['scolarite.inscription.creer', 'core.modele.modifier', 'structure.consulter'];
interface LigneListe { eleveId: string; nom: string; matricule: string; classe: string; payeur: string | null; payeurTelephone: string | null }

const LIENS: [string, string][] = [['mere', 'Mère'], ['pere', 'Père'], ['tuteur', 'Tuteur']];
const LANGUES: [string, string][] = [['fr', 'Français'], ['en', 'English']];
const vide = (x: unknown) => x === undefined || x === null || x === '' || (Array.isArray(x) && x.length === 0);
const heureCourte = (iso: string) => new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Douala' });

/** Fenêtre ouverte par un clic sur une ligne : deux actions. */
export function ouvrirActionsEleve(l: LigneListe, droits: Droits) {
  return ouvrirFormulaire<'detail' | 'maj'>(`${l.nom}`, ({ fermer }) => (
    <>
      <Doux>{[l.matricule, l.classe, l.payeur ? `Payeur : ${l.payeur}${l.payeurTelephone ? ` · ${l.payeurTelephone}` : ''}` : null].filter(Boolean).join(' · ')}</Doux>
      <div className="actions-eleve">
        <button type="button" className="action-eleve" onClick={() => fermer('detail')} autoFocus>
          <span className="gras">Voir le détail</span><span className="doux petit">Toutes les informations : identité, responsables, renseignements, scolarité, paiements</span>
        </button>
        {(droits.majEleve || droits.majResponsables) && (
          <button type="button" className="action-eleve" onClick={() => fermer('maj')}>
            <span className="gras">Mettre à jour</span><span className="doux petit">Informations de l’élève ou des parents ; les anciennes valeurs restent dans l’historique</span>
          </button>
        )}
      </div>
      <div className="pied"><Bouton onClick={() => fermer()}>Fermer</Bouton></div>
    </>
  ), 520);
}

type Onglet = 'eleve' | 'responsables' | 'historique';

/** Valeurs du formulaire telles qu'enregistrées, prêtes à l'édition (dates en JJ/MM/AAAA). */
function valeursInitiales(champs: ChampF[], bruts: Record<string, unknown>): Valeurs {
  const v: Valeurs = {};
  for (const c of champs) {
    const x = bruts[c.code];
    if (vide(x)) continue;
    v[c.code] = c.type === 'date' && typeof x === 'string' ? jjmmaaaa(x) : c.type === 'nombre' ? String(x) : x;
  }
  return v;
}

function OngletEleve({ e, f, modifiable, apres }: { e: any; f: Formulaire; modifiable: boolean; apres: () => void }) {
  const actifs = f.champs.filter((c) => c.actif);
  const [nom, setNom] = useState<string>(e.nom);
  const [prenoms, setPrenoms] = useState<string>(e.prenoms);
  const [sexe, setSexe] = useState<string>(e.sexe);
  const [naissance, setNaissance] = useState<string>(jjmmaaaa(e.dateNaissance));
  const [lieu, setLieu] = useState<string>(e.lieuNaissance ?? '');
  const [photo, setPhoto] = useState<{ base64: string; nom: string } | null>(null);
  const [valeurs, setValeurs] = useState<Valeurs>(valeursInitiales(actifs, e.renseignementsBruts ?? {}));
  const [erreurs, setErreurs] = useState<Record<string, string>>({});
  const [charge, setCharge] = useState(false);
  const enregistrer = async () => {
    const iso = versIso(naissance);
    const er: Record<string, string> = {};
    if (!nom.trim()) er['nom'] = 'Obligatoire';
    if (!prenoms.trim()) er['prenoms'] = 'Obligatoire';
    if (!iso) er['naissance'] = 'Date au format JJ/MM/AAAA';
    for (const c of actifs) {
      const x = valeurs[c.code];
      if (vide(x)) { if (c.obligatoire) er[c.code] = 'Obligatoire'; continue; }
      if (c.type === 'date' && !versIso(String(x))) er[c.code] = 'Date au format JJ/MM/AAAA';
    }
    setErreurs(er);
    if (Object.keys(er).length) return;
    // Toutes les réponses du formulaire sont envoyées : une réponse vidée est retirée (la valeur précédente reste au journal).
    const renseignements: Valeurs = {};
    for (const c of actifs) { const x = valeurs[c.code]; renseignements[c.code] = vide(x) ? null : c.type === 'date' ? versIso(String(x)) : x; }
    setCharge(true);
    try {
      const r = await api.patch<{ modifies: string[] }>(`/scolarite/eleves/${e.id}`, {
        nom: nom.trim(), prenoms: prenoms.trim(), sexe, dateNaissance: iso, lieuNaissance: lieu.trim() || null, renseignements, ...(photo ? { photo: photo.base64 } : {}),
      });
      signaler(r.modifies.length ? `Fiche mise à jour : ${r.modifies.join(', ')}` : 'Aucun changement');
      setPhoto(null);
      apres();
    } catch (x) { signaler(x instanceof ErreurApi ? x.message : String(x), true); } finally { setCharge(false); }
  };
  const blocs = f.blocs.filter((b) => actifs.some((c) => c.bloc === b.code));
  return (
    <>
      {!modifiable && <Note ton="attention">Votre compte peut consulter cette fiche, pas la modifier.</Note>}
      <div className="grille pile-mobile" style={{ ['--min' as string]: '200px', gap: 14 }}>
        <Champ libelle="Nom *" value={nom} onChange={modifiable ? setNom : undefined} readOnly={!modifiable} erreur={erreurs['nom']} />
        <Champ libelle="Prénoms *" value={prenoms} onChange={modifiable ? setPrenoms : undefined} readOnly={!modifiable} erreur={erreurs['prenoms']} />
        <Liste libelle="Sexe" value={sexe} options={[['M', 'Garçon'], ['F', 'Fille']]} onChange={setSexe} disabled={!modifiable} />
        <Champ libelle="Date de naissance *" value={naissance} onChange={modifiable ? setNaissance : undefined} readOnly={!modifiable} placeholder="JJ/MM/AAAA" erreur={erreurs['naissance']} />
        <Champ libelle="Lieu de naissance" value={lieu} onChange={modifiable ? setLieu : undefined} readOnly={!modifiable} />
        {modifiable && (
          <div className="champ-groupe"><span className="libelle">Photo de l’élève</span>
            <Bouton icone="photo" pleine onClick={async () => {
              const fi = await choisirFichier('image/png,image/jpeg');
              if (!fi) return;
              if (fi.octets.length > 5 * 1024 * 1024) { signaler('Photo trop lourde : 5 Mo au plus.', true); return; }
              setPhoto({ base64: fi.base64, nom: fi.nom });
            }}>{photo ? photo.nom : e.aPhoto ? 'Remplacer la photo' : 'Choisir une photo'}</Bouton>
          </div>
        )}
      </div>
      {blocs.map((b) => (
        <div key={b.code} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span className="etiquette">{b.libelle}</span>
          {modifiable
            ? <ChampsDuBloc champs={actifs.filter((c) => c.bloc === b.code)} valeurs={valeurs} maj={(code, v) => setValeurs((x) => ({ ...x, [code]: v }))} erreurs={erreurs} />
            : <Doux>{actifs.filter((c) => c.bloc === b.code).map((c) => `${c.libelle} : ${vide(valeurs[c.code]) ? '–' : Array.isArray(valeurs[c.code]) ? (valeurs[c.code] as string[]).join(', ') : typeof valeurs[c.code] === 'object' ? 'photo jointe' : String(valeurs[c.code])}`).join(' · ')}</Doux>}
        </div>
      ))}
      {modifiable && <div className="pied"><Bouton variante="principal" charge={charge} onClick={enregistrer}>Enregistrer les modifications</Bouton></div>}
    </>
  );
}

function LigneResponsable({ eleveId, r, modifiable, apres }: { eleveId: string; r: any; modifiable: boolean; apres: () => void }) {
  const [nom, setNom] = useState<string>(r.nom);
  const [tel, setTel] = useState<string>(r.telephone);
  const [lien, setLien] = useState<string>(r.lien);
  const [langue, setLangue] = useState<string>(r.langue);
  const [sms, setSms] = useState<boolean>(r.recoitSms);
  const [charge, setCharge] = useState(false);
  const enregistrer = async () => {
    setCharge(true);
    try {
      const x = await api.patch<{ modifies: string[] }>(`/scolarite/eleves/${eleveId}/responsables/${r.id}`, { nom: nom.trim(), telephone: tel, lien, langue, recoitSms: sms });
      signaler(x.modifies.length ? `Responsable mis à jour : ${x.modifies.join(', ')}` : 'Aucun changement');
      apres();
    } catch (e) { signaler(e instanceof ErreurApi ? e.message : String(e), true); } finally { setCharge(false); }
  };
  return (
    <div className="responsable-maj">
      <div className="grille pile-mobile" style={{ ['--min' as string]: '160px', gap: 12 }}>
        <Champ libelle="Nom" value={nom} onChange={modifiable ? setNom : undefined} readOnly={!modifiable} />
        <Champ libelle="Téléphone" value={tel} onChange={modifiable ? setTel : undefined} readOnly={!modifiable} inputMode="tel" />
        <Liste libelle="Lien" value={lien} options={LIENS} onChange={setLien} disabled={!modifiable} />
        <Liste libelle="Langue des messages" value={langue} options={LANGUES} onChange={setLangue} disabled={!modifiable} />
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
        <CaseACocher libelle="Reçoit les SMS" valeur={sms} onChange={setSms} disabled={!modifiable} />
        {r.payeur && <Pastille ton="accent">Payeur</Pastille>}
        <span style={{ flex: 1 }} />
        {modifiable && <Bouton charge={charge} onClick={enregistrer}>Enregistrer</Bouton>}
      </div>
      {r.payeur && <Doux>Le compte famille se connecte avec le téléphone du payeur : un nouveau numéro devient son identifiant.</Doux>}
    </div>
  );
}

function OngletHistorique({ eleveId }: { eleveId: string }) {
  const h = useDonnees(() => api.get<{ variations: { quand: string; auteur: string; objet: string; champ: string; avant: string; apres: string }[] }>(`/scolarite/eleves/${eleveId}/variations`));
  if (h.erreur) return <Erreur message={h.erreur} recharger={h.recharger} />;
  if (!h.d) return <Chargement />;
  return (
    <>
      <Doux>Chaque modification garde la valeur précédente : rien n’est effacé, seule la valeur la plus récente est utilisée par l’application.</Doux>
      <Tableau
        colonnes={[{ titre: 'Date', mobile: 'entete' }, { titre: 'Par' }, { titre: 'Objet' }, { titre: 'Information' }, { titre: 'Avant' }, { titre: 'Après' }]}
        vide="Aucune modification depuis l’inscription."
        lignes={h.d.variations.map((v) => [heureCourte(v.quand), v.auteur, v.objet, <span className="gras">{v.champ}</span>, <span className="doux">{v.avant}</span>, v.apres])}
      />
    </>
  );
}

function FenetreMiseAJour({ eleveId, droits, onglet, fermer }: { eleveId: string; droits: Droits; onglet: Onglet; fermer: (v?: boolean) => void }) {
  const [o, setO] = useState<Onglet>(onglet);
  const [version, setVersion] = useState(0);
  const e = useDonnees(() => api.get<any>(`/scolarite/eleves/${eleveId}`), [version]);
  const f = useDonnees(() => api.get<Formulaire>('/scolarite/formulaire'));
  const apres = () => setVersion((v) => v + 1);
  return (
    <>
      <Bascules options={[['eleve', 'Élève'], ['responsables', 'Responsables'], ['historique', 'Historique des modifications']]} valeur={o} onChange={setO} />
      {e.erreur || f.erreur ? <Erreur message={e.erreur ?? f.erreur ?? ''} /> : !e.d || !f.d ? <Chargement />
        : o === 'eleve' ? <OngletEleve key={version} e={e.d} f={f.d} modifiable={droits.majEleve} apres={apres} />
          : o === 'responsables' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {e.d.responsables.map((r: any) => <LigneResponsable key={`${r.id}-${version}`} eleveId={eleveId} r={r} modifiable={droits.majResponsables} apres={apres} />)}
            </div>
          ) : <OngletHistorique key={version} eleveId={eleveId} />}
      <div className="pied"><Bouton onClick={() => fermer(version > 0)}>Fermer</Bouton></div>
    </>
  );
}

/** Fenêtre de mise à jour ; renvoie vrai si quelque chose a été enregistré. */
export function ouvrirMiseAJour(eleveId: string, nom: string, droits: Droits, onglet: Onglet = 'eleve') {
  return ouvrirFormulaire<boolean>(`Mettre à jour · ${nom}`, ({ fermer }) => <FenetreMiseAJour eleveId={eleveId} droits={droits} onglet={onglet} fermer={fermer} />, 860);
}
