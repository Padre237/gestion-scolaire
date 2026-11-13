// Modules Emploi du temps, Vie scolaire et Messages : maquettes Emploi-du-temps, Appel, Discipline, Annonces, Messages (SMS), Messagerie.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import type { RouteEcran } from '../App.tsx';
import { api, requete } from '../core/api.ts';
import { Coque, routePermise } from '../core/coque.tsx';
import { useMoi } from '../core/session.tsx';
import { aujourdhuiIso, heures, jjmm, jjmmaaaa, jourDate, heure, pluriel, versIso } from '../core/format.ts';
import {
  agir, Bandeau, Bascules, Bouton, CarteChiffre, CaseACocher, Champ, Chargement, Colonnes, Doux, Erreur, Etapes, Etiquette, Grille, InfoCaps,
  LigneListe, Liste, Note, ouvrirFenetre, ouvrirFormulaire, Panneau, Pastille, PiedFenetre, Rangee, signaler, Tableau, TitrePanneau, useDonnees, useRaccourci,
  type EtatEtape, type Ton,
} from '../core/ui.tsx';

// Horodatages de PostgreSQL (« 2026-11-10 07:30:00.083+00 ») rendus lisibles par tous les navigateurs ; une date seule reste telle quelle.
const iso = (s: string | null | undefined) => (s && s.length > 10 ? s.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00') : s);
const hm = (s: string | null | undefined) => heure(iso(s));
const jm = (s: string | null | undefined) => jjmm(iso(s));
const jma = (s: string | null | undefined) => jjmmaaaa(iso(s));

const JOURS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
const JOURS_MIN = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

/** Couleur d'un cours selon le groupe de sa matière (maquette Emploi-du-temps). */
const fondGroupe = (groupe: string | null | undefined) => ({ Langues: 'var(--accent-fond)', Sciences: 'var(--succes-fond)', 'Sciences humaines': 'var(--attention-fond)' } as Record<string, string>)[groupe ?? ''] ?? 'var(--neutre-fond)';

const libelleObservation = (type: string) => ({ comportement: 'Comportement', retard: 'Retard', travail_non_fait: 'Travail non fait', tenue: 'Tenue', felicitations: 'Félicitations', absence: 'Absence' } as Record<string, string>)[type] ?? type;
const tonObservation = (type: string): Ton => (type === 'comportement' ? 'danger' : type === 'felicitations' ? 'succes' : type === 'tenue' ? 'neutre' : 'attention');

/** Sous-titre de l'équipe : « Principal : M. ONANA Bertrand · anglais : Mrs TANYI Rose · EPS : M. ESSAMA Luc ». */
const matiereMinuscule = (m: string) => (m === m.toUpperCase() ? m : m.toLowerCase());
/** « un cours d’éducation physique », « un cours de mathématiques », « un cours d’EPS ». */
const unCoursDe = (m: string) => { const x = matiereMinuscule(m); return `un cours ${/^[aeiouyhàâéèêëîïôöûü]/i.test(x) ? 'd’' : 'de '}${x}`; };
/** « 8 h 30 » à partir de « 08:30 », pour les libellés parlés (aria-label). */
const heureParlee = (h: string) => { const [hh, mm] = h.split(':'); return `${Number(hh)} h${mm && mm !== '00' ? ` ${mm}` : ''}`; };

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

/** Styles propres aux écrans de ces modules, en complément du contrat commun (styles.css). */
const STYLES_VIE = `
.ligne-bouton { background: none; border-top: 0; border-left: 0; border-right: 0; width: 100%; text-align: left; font: inherit; color: inherit; cursor: pointer; border-radius: 0; }
.ligne-bouton:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.case-cours { background: none; border: 0; padding: 0; cursor: pointer; font: inherit; color: inherit; text-align: left; }
.case-cours:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 6px; }
.creneau-jour { display: flex; align-items: center; gap: 12px; min-height: 52px; padding: 6px 0; border-bottom: 1px solid var(--bord); }
.creneau-jour:last-child { border-bottom: 0; }
.creneau-jour > .heure { flex: none; width: 52px; }
.creneau-jour > .contenu { flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px; }
.creneau-jour .case-cours { width: 100%; min-height: 44px; display: flex; align-items: center; gap: 8px; }
.carte-appel { display: flex; flex-direction: column; gap: 8px; padding: 12px 0; border-bottom: 1px solid var(--bord); }
.carte-appel:last-child { border-bottom: 0; }
.carte-appel .bascules { flex-wrap: nowrap; }
.carte-appel .bascules > button { flex: 1 1 0; min-height: 44px; padding: 0 6px; }
.bulle { display: flex; flex-direction: column; gap: 4px; padding: 10px 12px; border-radius: 12px; max-width: 78%; }
.bulle.famille { align-self: flex-start; background: var(--champ); }
.bulle.ecole { align-self: flex-end; background: var(--accent-fond); }
.bulle.reponse { align-self: flex-end; width: 78%; background: var(--accent-fond); }
@media (max-width: 1024px) {
  .edt-grille .tableau-cadre { overflow-x: auto; }
  .edt-grille table.tableau th:first-child, .edt-grille table.tableau td:first-child { position: sticky; left: 0; z-index: 1; background: var(--panneau); }
  .edt-grille table.tableau td { white-space: nowrap; }
  .edt-grille .case-cours { min-height: 44px; min-width: 44px; display: inline-flex; align-items: center; }
}
@media (max-width: 640px) {
  .pied-colle { position: sticky; bottom: 0; z-index: 2; margin: 0 -14px -14px; padding: 10px 14px calc(12px + env(safe-area-inset-bottom)); background: var(--panneau); border-top: 1px solid var(--bord); border-radius: 0 0 12px 12px; display: flex; flex-direction: column; gap: 8px; align-items: stretch; }
  .pied-colle .bouton { width: 100%; flex: none; }
  .bulle { max-width: 92%; }
  .bulle.reponse { width: 100%; }
  .bascules.defile-x { padding-bottom: 4px; }
  .bascules.defile-x > button { white-space: nowrap; }
}
`;
const StylesVie = () => <style>{STYLES_VIE}</style>;

/** Bascules qui, sur téléphone, défilent horizontalement au lieu de passer à la ligne (destinataires, modèles, jours). */
function BasculesDefilantes<T extends string>({ options, valeur, onChange, ariaLabel, defiler }: { options: [T, string][]; valeur: T; onChange: (v: T) => void; ariaLabel: string; defiler: boolean }) {
  return (
    <div className={`bascules ${defiler ? 'defile-x' : ''}`} role="group" aria-label={ariaLabel}>
      {options.map(([v, l]) => <button key={v} type="button" className={v === valeur ? 'actif' : ''} aria-pressed={v === valeur} onClick={() => onChange(v)}>{l}</button>)}
    </div>
  );
}

// ===================================================================== emploi du temps et cahier de textes

function GrilleHoraire({ fermer, creneaux }: { fermer: (v?: boolean) => void; creneaux: any[] }) {
  const [lignes, setLignes] = useState<{ debut: string; fin: string; type: string; jours: number[] }[]>(
    creneaux.map((c) => ({ debut: c.debut, fin: c.fin, type: c.type, jours: [...c.jours] })));
  const [charge, setCharge] = useState(false);
  const { tactile } = useEcran();
  const changer = (i: number, p: Partial<{ debut: string; fin: string; type: string; jours: number[] }>) => setLignes((l) => l.map((x, k) => (k === i ? { ...x, ...p } : x)));
  const nomCreneau = (l: { debut: string }, i: number) => `créneau ${i + 1} (${l.debut})`;
  return (
    <>
      <Doux>Créneaux de l’école, du lundi au samedi. La grille se change avant de placer les cours.</Doux>
      <Tableau serre colonnes={[{ titre: 'Début', mobile: 'entete' }, { titre: 'Fin' }, { titre: 'Type' }, { titre: 'Jours' }, { titre: 'Action' }]} lignes={lignes.map((l, i) => [
        <Champ petit={!tactile} value={l.debut} onChange={(v) => changer(i, { debut: v })} largeur={tactile ? 96 : 80} ariaLabel={`Début du ${nomCreneau(l, i)}`} />,
        <Champ petit={!tactile} value={l.fin} onChange={(v) => changer(i, { fin: v })} largeur={tactile ? 96 : 80} ariaLabel={`Fin du ${nomCreneau(l, i)}`} />,
        <Liste petit={!tactile} value={l.type} options={[['cours', 'Cours'], ['recreation', 'Récréation'], ['pause', 'Pause']]} onChange={(v) => changer(i, { type: v })} largeur={130} ariaLabel={`Type du ${nomCreneau(l, i)}`} />,
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {JOURS.map((j, k) => (
            <label key={j} className="case" style={{ minHeight: tactile ? 44 : 30, gap: 4 }}>
              <input type="checkbox" checked={l.jours.includes(k + 1)} aria-label={`${j}, ${nomCreneau(l, i)}`}
                onChange={(e) => changer(i, { jours: e.target.checked ? [...l.jours, k + 1].sort() : l.jours.filter((x) => x !== k + 1) })} />
              {j.slice(0, 3)}
            </label>
          ))}
        </div>,
        <button type="button" className="lien-texte danger" style={{ fontWeight: 600, minHeight: tactile ? 44 : undefined }} aria-label={`Retirer le ${nomCreneau(l, i)}`}
          onClick={() => setLignes((x) => x.filter((_, k) => k !== i))}>Retirer</button>,
      ])} />
      <div><Bouton icone="ajouter" variante="lien" onClick={() => setLignes((l) => [...l, { debut: '15:00', fin: '16:00', type: 'cours', jours: [1, 2, 3, 4, 5] }])}>Ajouter un créneau</Bouton></div>
      <PiedFenetre fermer={() => fermer()} action="Enregistrer la grille" charge={charge} onAction={async () => {
        setCharge(true);
        const r = await agir(() => api.put('/pedagogie/edt/creneaux', { creneaux: lignes }), 'Grille horaire enregistrée.');
        setCharge(false);
        if (r) fermer(true);
      }} />
    </>
  );
}

function PlacerCours({ fermer, titre: _t, cours, matieres, classeId, jour, creneauId }: {
  fermer: (v?: boolean) => void; titre: string; cours: any | undefined; matieres: any[]; classeId: string; jour: number; creneauId: string;
}) {
  const [matiere, setMatiere] = useState<string | null>(cours?.matiereId ?? null);
  const [libre, setLibre] = useState<string>(cours && !cours.matiereId ? cours.libelle : '');
  const placer = async (matiereId: string | null, libelle: string | null) => {
    const r = await agir(() => api.put('/pedagogie/edt/cours', { classeId, jour, creneauId, matiereId, libelle }));
    if (r) fermer(true);
  };
  return (
    <>
      <Liste libelle="Matière" value={matiere} options={[[null, 'Autre activité (texte libre)'], ...matieres.map((m): [string, string] => [m.id, m.libelleFr])]} onChange={setMatiere} />
      {matiere === null && <Champ libelle="Activité" value={libre} onChange={setLibre} placeholder="Révisions" />}
      <Note>L’instituteur du cours est celui de la matière dans la classe. Toute modification repasse par la validation du préfet.</Note>
      <div className="pied">
        {cours && <Bouton onClick={() => placer(null, null)}>Retirer le cours</Bouton>}
        <Bouton onClick={() => fermer()}>Annuler</Bouton>
        <Bouton variante="principal" onClick={() => placer(matiere, matiere ? null : (libre.trim() || 'Révisions'))}>Placer</Bouton>
      </div>
    </>
  );
}

function NouvelleSeance({ fermer, classeId, jour, matieres }: { fermer: (v?: boolean) => void; classeId: string; jour: string; matieres: any[] }) {
  const [h, setH] = useState('07:30');
  const [libelle, setLibelle] = useState('');
  const [contenu, setContenu] = useState('');
  const [devoir, setDevoir] = useState('');
  const [pour, setPour] = useState('');
  const [charge, setCharge] = useState(false);
  return (
    <>
      <Rangee>
        <Champ libelle="Heure" value={h} onChange={setH} largeur={110} inputMode="numeric" />
        <div style={{ flex: '1 1 200px' }}><Champ libelle="Matière ou activité" value={libelle} onChange={setLibelle} autoFocus /></div>
      </Rangee>
      <Champ libelle="Ce qui a été fait" value={contenu} onChange={setContenu} lignes={2} />
      <Rangee>
        <div style={{ flex: '1 1 200px' }}><Champ libelle="Devoir" value={devoir} onChange={setDevoir} /></div>
        <Champ libelle="Pour le" value={pour} onChange={setPour} placeholder="JJ/MM/AAAA" largeur={140} inputMode="numeric" />
      </Rangee>
      <PiedFenetre fermer={() => fermer()} action="Ajouter" charge={charge} onAction={async () => {
        const l = libelle.trim().toLowerCase();
        const m = matieres.find((x) => `${x.libelleFr}`.toLowerCase() === l || `${x.abrege}`.toLowerCase() === l);
        setCharge(true);
        const r = await agir(() => api.post('/pedagogie/seances', { classeId, faitLe: jour, heure: h.trim(), matiereId: m?.id ?? null, libelle: libelle.trim(),
          contenu: contenu.trim(), devoir: devoir.trim() || null, devoirPour: versIso(pour) }), 'Séance ajoutée au cahier de textes.');
        setCharge(false);
        if (r) fermer(true);
      }} />
    </>
  );
}

function Motif({ fermer, libelle, action }: { fermer: (v?: string) => void; libelle: string; action: string }) {
  const [m, setM] = useState('');
  return (
    <>
      <Champ libelle={libelle} value={m} onChange={setM} lignes={3} />
      <PiedFenetre fermer={() => fermer()} action={action} disabled={!m.trim()} onAction={() => fermer(m.trim())} />
    </>
  );
}

export function EcranEmploiDuTemps() {
  const moi = useMoi();
  const { telephone } = useEcran();
  const [vue, setVue] = useState<'classe' | 'instituteur'>('classe');
  // Téléphone : un jour à la fois ; par défaut le jour courant (ou lundi le dimanche).
  const [jourChoisi, setJourChoisi] = useState<number | null>(null);
  const [choixClasse, setChoixClasse] = useState<string | null>(null);
  const [personnel, setPersonnel] = useState<string | null>(null);
  const [matieres, setMatieres] = useState<any[]>([]);
  useEffect(() => { api.get('/pedagogie/matieres').then((m) => setMatieres(m as any[])).catch(() => undefined); }, []);
  // Sans choix, le serveur ouvre la classe de la personne (principal, puis instituteur de matière).
  const { d, erreur, recharger } = useDonnees(() => api.get(`/pedagogie/edt${requete(vue === 'classe' ? { classeId: choixClasse } : { personnelId: personnel })}`), [vue, choixClasse, personnel]);
  const classe: string | null = choixClasse ?? (vue === 'classe' ? d?.classeId ?? null : null);
  const changerVue = (v: 'classe' | 'instituteur') => {
    if (v === 'instituteur' && !personnel) setPersonnel(d?.instituteurs?.[0]?.id ?? null);
    setVue(v);
  };

  const creneaux: any[] = d?.creneaux ?? [];
  const cours: any[] = d?.cours ?? [];
  const statut: string = d?.etat?.statut ?? 'brouillon';
  const placement = moi.a('pedagogie.edt.placer') && d?.peutPlacer === true;
  const peutPlacer = placement && vue === 'classe' && statut !== 'soumis';
  const equipe = d?.equipe;
  const sousTitre = vue === 'classe' && equipe
    ? [equipe.principal ? `Principal : ${equipe.principal}` : null, ...(equipe.exceptions ?? []).map((e: any) => `${matiereMinuscule(e.matiere)} : ${e.nom}`)].filter(Boolean).join(' · ')
    : undefined;

  const placer = async (cr: any, jour: number, c: any | undefined) => {
    const ok = await ouvrirFormulaire<boolean>(`${JOURS[jour - 1]} · ${cr.debut} – ${cr.fin}`, ({ fermer }) =>
      <PlacerCours fermer={fermer} titre="" cours={c} matieres={matieres} classeId={classe!} jour={jour} creneauId={cr.id} />, 440);
    if (ok) await recharger();
  };
  const caseCours = (cr: any, jour: number, libre = 'Libre'): ReactNode => {
    const ouvert = (cr.jours as number[]).includes(jour);
    if (cr.type !== 'cours') return <span className="doux">{ouvert ? (cr.type === 'recreation' ? 'Récréation' : 'Pause') : '–'}</span>;
    const c = cours.find((x) => x.creneauId === cr.id && x.jour === jour);
    const contenu = c
      ? <span style={{ display: 'inline-block', padding: '4px 8px', borderRadius: 6, background: fondGroupe(c.groupe), fontWeight: 600 }}>{vue === 'classe' ? c.libelle : `${c.libelle} · ${c.classe}`}</span>
      : <span className="doux">{libre}</span>;
    if (!peutPlacer || !ouvert) return contenu;
    const quand = `${JOURS[jour - 1]!.toLowerCase()} ${heureParlee(cr.debut)}`;
    return (
      <button type="button" className="case-cours" onClick={() => placer(cr, jour, c)} title="Placer un cours"
        aria-label={c ? `Modifier le cours, ${quand} : ${c.libelle}` : `Placer un cours, ${quand}`}>{contenu}</button>
    );
  };
  const jourAuj = (() => { const j = new Date(`${d?.aujourdhui ?? aujourdhuiIso()}T12:00:00`).getDay(); return j >= 1 && j <= 6 ? j : 1; })();
  const jourVu = jourChoisi ?? jourAuj;
  const joursOuverts = [1, 2, 3, 4, 5, 6].filter((j) => creneaux.some((cr) => (cr.jours as number[]).includes(j)));
  const etapes: [string, EtatEtape][] = [
    ['Grille horaire', 'faite'],
    ['Cours de la classe', cours.length ? 'faite' : 'courante'],
    ['Validation', statut === 'soumis' ? 'courante' : statut === 'publie' ? 'faite' : 'avenir'],
    ['Publication', statut === 'publie' ? 'faite' : 'avenir'],
  ];
  const decision = async (publier: boolean) => {
    let motif: string | null = null;
    if (!publier) {
      const m = await ouvrirFormulaire<string>('Renvoyer au principal', ({ fermer }) => <Motif fermer={fermer} libelle="Ce qui est à revoir" action="Renvoyer" />, 440);
      if (!m) return;
      motif = m;
    }
    const r = await agir(() => api.post(`/pedagogie/edt/${classe}/${publier ? 'publication' : 'renvoi'}`, { motif }), publier ? 'Emploi du temps publié.' : 'Renvoyé au principal.');
    if (r) await recharger();
  };
  const seances: any[] = d?.seances ?? [];
  const etat = d?.etat;
  return (
    <Coque module="edt" titre="Emploi du temps">
      <StylesVie />
      <div className="filtres">
        <div className="champs">
          <div className="champ-groupe">
            <span className="libelle">Vue</span>
            <BasculesDefilantes ariaLabel="Vue" options={[['classe', 'Par classe'], ['instituteur', 'Par instituteur']]} valeur={vue} onChange={changerVue} defiler={false} />
          </div>
          {vue === 'classe'
            ? <Liste libelle="Classe" largeur={160} value={classe} options={((d?.classes ?? []) as any[]).map((c): [string, string] => [c.id, c.nom])} onChange={setChoixClasse} />
            : <Liste libelle="Instituteur" largeur={240} value={personnel} options={((d?.instituteurs ?? []) as any[]).map((c): [string, string] => [c.id, c.nom])} onChange={setPersonnel} />}
        </div>
        <div className="actions">
          <Bouton icone="imprimer" onClick={() => window.print()}>Imprimer</Bouton>
          {moi.a('pedagogie.edt.grille') && (
            <Bouton icone="parametres" onClick={async () => {
              const ok = await ouvrirFormulaire<boolean>('Grille horaire de l’école', ({ fermer }) => <GrilleHoraire fermer={fermer} creneaux={creneaux} />, 760);
              if (ok) await recharger();
            }}>Grille horaire de l’école</Bouton>
          )}
        </div>
      </div>
      {erreur ? <Erreur message={erreur} recharger={recharger} /> : !d ? <Chargement /> : (
        <Colonnes colonnes={[
          { flex: 5, min: 640, enfants: (
            <Panneau>
              <TitrePanneau titre={`${d.titre} · semaine du ${jjmmaaaa(d.semaine)}`} sous={sousTitre || undefined} />
              {telephone ? (
                // Téléphone : les jours défilent en bandeau, les créneaux du jour choisi s'empilent.
                <>
                  <BasculesDefilantes ariaLabel="Jour" defiler options={joursOuverts.map((j): [string, string] => [`${j}`, JOURS[j - 1]!])} valeur={`${jourVu}`} onChange={(v) => setJourChoisi(Number(v))} />
                  <div>
                    {creneaux.filter((cr) => (cr.jours as number[]).includes(jourVu)).map((cr) => (
                      <div key={cr.id} className="creneau-jour">
                        <span className={`heure ${cr.type === 'cours' ? 'gras' : 'doux'}`}>{cr.debut}</span>
                        <div className="contenu">{caseCours(cr, jourVu, peutPlacer ? 'Placer un cours' : 'Libre')}</div>
                      </div>
                    ))}
                    {creneaux.every((cr) => !(cr.jours as number[]).includes(jourVu)) && <Doux>Aucun créneau ce jour-là.</Doux>}
                  </div>
                </>
              ) : (
                <div className="edt-grille">
                  <Tableau serre colonnes={[{ titre: 'Début' }, ...JOURS.map((j) => ({ titre: j }))]}
                    lignes={creneaux.map((cr) => [<span className={cr.type === 'cours' ? 'gras' : 'doux'}>{cr.debut}</span>, ...[1, 2, 3, 4, 5, 6].map((j) => caseCours(cr, j, '–'))])} />
                </div>
              )}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center' }}>
                {((d.groupes ?? []) as any[]).map((g) => (
                  <div key={g.libelle} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 12, height: 12, borderRadius: 3, background: fondGroupe(g.libelle) }} /><span className="doux">{g.libelle}</span>
                  </div>
                ))}
              </div>
            </Panneau>
          ) },
          { flex: 2, min: 300, enfants: vue !== 'classe' ? null : (
            <>
              <Panneau>
                <TitrePanneau titre="Circuit de l’emploi du temps" />
                <Etapes etapes={etapes} />
                <Doux>{statut === 'publie' && etat?.publie_le ? `Le préfet a fixé la grille horaire de l’école. Emploi du temps de ${d.titre} publié aux parents le ${etat.publie_le}.`
                  : etat?.place_par ? `Le préfet a fixé la grille horaire de l’école. ${etat.place_par} a placé les cours de ${d.titre} et les instituteurs de matière le ${etat.place_le} ; le préfet valide avant publication aux parents.`
                  : 'Le préfet a fixé la grille horaire de l’école ; le principal place les cours de sa classe.'}</Doux>
                {etat?.renvoi_motif && <Note ton="attention">Renvoyé au principal : {etat.renvoi_motif}</Note>}
                {((d.conflits ?? []) as any[]).map((c, i) => (
                  <Bandeau key={i} icone="eleves">
                    <strong>{c.jourLibelle} {c.debut}</strong> · {c.instituteur} a aussi {unCoursDe(String(c.matiere ?? ''))} avec {c.autres} : cours commun aux deux classes, autorisé. Chaque classe garde sa fiche d’appel.
                  </Bandeau>
                ))}
                <div className="rangee fin centre pile-mobile">
                  {placement && statut !== 'soumis' && cours.length > 0 && (
                    <Bouton icone="envoyer" variante="principal" onClick={async () => {
                      const r = await agir(() => api.post(`/pedagogie/edt/${classe}/soumission`), 'Emploi du temps soumis au préfet.');
                      if (r) await recharger();
                    }}>Soumettre au préfet</Bouton>
                  )}
                  {moi.a('pedagogie.edt.valider') && statut !== 'publie' && (
                    <>
                      <Bouton disabled={statut !== 'soumis'} onClick={() => decision(false)}>Renvoyer au principal</Bouton>
                      <Bouton icone="coche" variante="principal" disabled={!cours.length} onClick={() => decision(true)}>Valider et publier</Bouton>
                    </>
                  )}
                </div>
              </Panneau>
              <Panneau ecart={0}>
                <TitrePanneau titre={`Cahier de textes · ${jourDate(d.aujourdhui ?? aujourdhuiIso())}`}
                  action={moi.a('pedagogie.cahier.ecrire') ? <Bouton icone="ajouter" variante="lien" onClick={async () => {
                    const ok = await ouvrirFormulaire<boolean>('Ajouter une séance', ({ fermer }) => <NouvelleSeance fermer={fermer} classeId={classe!} jour={d.aujourdhui ?? aujourdhuiIso()} matieres={matieres} />);
                    if (ok) await recharger();
                  }}>Ajouter une séance</Bouton> : undefined} />
                <div style={{ marginTop: 6 }}>
                  {seances.map((s, i) => (
                    <LigneListe key={i}>
                      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}><Pastille>{s.heure}</Pastille><span className="gras">{s.libelle}</span></div>
                        <span>{s.contenu}</span>
                        {s.devoir && <Doux>Devoir : {s.devoir}{s.devoirPour ? ` · pour le ${jjmmaaaa(s.devoirPour)}` : ''}</Doux>}
                      </div>
                    </LigneListe>
                  ))}
                  {seances.length === 0 && <LigneListe><Doux>Aucune séance notée aujourd’hui.</Doux></LigneListe>}
                </div>
              </Panneau>
            </>
          ) },
        ].filter((x) => x.enfants !== null)} />
      )}
    </Coque>
  );
}

// ===================================================================== appel

type Presence = { statut: 'present' | 'absent' | 'retard'; minutes: number | null };

export function EcranAppel() {
  const moi = useMoi();
  const naviguer = useNavigate();
  const { telephone, tactile } = useEcran();
  const [jour, setJour] = useState(jjmmaaaa(aujourdhuiIso()));
  const [jourIso, setJourIso] = useState(aujourdhuiIso());
  const [choixClasse, setChoixClasse] = useState<string | null>(null);
  const [choixFiche, setChoixFiche] = useState<string | null>(null);
  const [presences, setPresences] = useState<Record<string, Presence>>({});
  const [charge, setCharge] = useState(false);
  // Sans choix, le serveur ouvre la classe de la personne et la fiche du créneau en cours.
  const { d, erreur, recharger } = useDonnees(() => api.get(`/vie-scolaire/appel${requete({ classeId: choixClasse, jour: jourIso, ficheId: choixFiche })}`),
    [choixClasse, jourIso, choixFiche]);
  useEffect(() => {
    const p: Record<string, Presence> = {};
    for (const e of (d?.fiche?.eleves ?? []) as any[]) p[e.inscriptionId] = { statut: e.statut, minutes: e.retardMinutes ?? null };
    setPresences(p);
  }, [d]);
  const classe: string | null = choixClasse ?? d?.classeId ?? null;
  const allerAu = (v: string) => { setChoixFiche(null); setJourIso(v); };
  const f = d?.fiche;
  const modifiable = f?.modifiable === true && moi.a('vie_scolaire.appel.faire');
  const enregistrer = async () => {
    if (!f || !modifiable) return;
    setCharge(true);
    const r = await agir(() => api.put(`/vie-scolaire/appel/${f.id}`, {
      presences: Object.entries(presences).map(([inscriptionId, p]) => ({ inscriptionId, statut: p.statut, retardMinutes: p.statut === 'retard' ? (p.minutes ?? 15) : null })),
    }), 'Appel enregistré.');
    setCharge(false);
    if (r) await recharger();
  };
  useRaccourci('ctrl+s', enregistrer, modifiable);
  const valeurs = Object.values(presences);
  const presents = valeurs.filter((v) => v.statut === 'present').length;
  const absents = valeurs.filter((v) => v.statut === 'absent').length;
  const retards = valeurs.filter((v) => v.statut === 'retard');
  const minutes = retards.reduce((s, v) => s + (v.minutes ?? 15), 0);
  const classes: any[] = d?.classes ?? [];
  const nomClasse = classes.find((c) => c.id === classe)?.nom ?? f?.classe ?? '';
  const fiches: any[] = d?.fiches ?? [];
  const ecole = d?.ecole;
  const PRESENCES: [Presence['statut'], string][] = [['present', 'Présent'], ['absent', 'Absent'], ['retard', 'Retard']];
  const poserPresence = (e: any, p: Presence) => (v: Presence['statut']) => setPresences((x) => ({ ...x, [e.inscriptionId]: { statut: v, minutes: v === 'retard' ? (p.minutes ?? 15) : null } }));
  const listeMinutes = (e: any, p: Presence) => (
    <Liste petit={!tactile} largeur={telephone ? undefined : 110} value={p.minutes ?? 15} options={[5, 10, 15, 20, 30, 45, 60].map((m): [number, string] => [m, `${m} min`])}
      onChange={(v) => setPresences((x) => ({ ...x, [e.inscriptionId]: { statut: 'retard', minutes: v } }))} ariaLabel={`Minutes de retard de ${e.nom}`} />
  );
  const compteurs = `${pluriel(presents, 'présent')} · ${pluriel(absents, 'absent')} · ${pluriel(retards.length, 'retard')}`;
  return (
    <Coque module="vie" titre="Vie scolaire">
      <StylesVie />
      <div className="filtres">
        <div className="champs">
          <Champ libelle="Date" value={jour} placeholder="JJ/MM/AAAA" largeur={150} inputMode="numeric"
            onChange={(v) => { setJour(v); const x = versIso(v); if (x && v.trim().length === 10 && x !== jourIso) allerAu(x); }}
            onEnter={() => { const v = versIso(jour); if (v) allerAu(v); else signaler('Date au format JJ/MM/AAAA.', true); }} />
          <Liste libelle="Classe" largeur={150} value={classe} options={classes.map((c): [string, string] => [c.id, c.nom])} onChange={(v) => { setChoixFiche(null); setChoixClasse(v); }} />
          <Liste libelle="Créneau" largeur={280} value={f?.id ?? null} vide="Aucun cours ce jour-là" options={fiches.map((x): [string, string] => [x.id, `${x.debut} – ${x.fin} · ${x.libelle}`])} onChange={setChoixFiche} />
        </div>
      </div>
      {erreur ? <Erreur message={erreur} recharger={recharger} /> : !d ? <Chargement /> : !f ? (
        <Panneau><Note>Aucune fiche d’appel : l’emploi du temps de la classe n’est pas publié, ou aucun cours n’a lieu ce jour-là.</Note></Panneau>
      ) : (
        <>
          <Grille min={telephone ? 90 : 220} ecart={telephone ? 10 : 16}>
            <CarteChiffre etiquette="Présents" valeur={presents} couleur="var(--succes)" sous={`sur ${valeurs.length} élèves`} />
            <CarteChiffre etiquette="Absents" valeur={absents} couleur="var(--danger)" />
            <CarteChiffre etiquette="Retards" valeur={retards.length} couleur="var(--attention)" sous={retards.length ? `${minutes} minutes` : undefined} />
          </Grille>
          <Bandeau icone="envoyer">À 10:00, le responsable de chaque absent reçoit un SMS, sauf si l’absence a été justifiée ou corrigée d’ici là.</Bandeau>
          <Colonnes colonnes={[
            { flex: 5, min: 600, enfants: (
              <Panneau>
                <TitrePanneau titre={`${nomClasse} · ${jourDate(f.jour)} · ${f.debut} – ${f.fin}`}
                  sous={`${f.libelle} · ${f.personnel ?? '–'}${f.coursCommun ? ` · ${f.coursCommun}` : ''} · ${f.statut === 'faite' ? 'fiche faite' : 'pré-rempli d’après l’emploi du temps'}`} />
                {!modifiable && <Note>Seul l’instituteur prévu à ce créneau fait l’appel ; vous lisez la fiche.</Note>}
                {telephone ? (
                  // Téléphone : une carte par élève, trois boutons larges pour le statut.
                  <div>
                    {((f.eleves ?? []) as any[]).map((e) => {
                      const p = presences[e.inscriptionId] ?? { statut: 'present', minutes: null };
                      return (
                        <div key={e.inscriptionId} className="carte-appel">
                          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                            <span className="doux">{e.numero}</span><span className="gras" style={{ flex: 1 }}>{e.nom}</span>
                            {!modifiable && <span className={p.statut === 'present' ? 'doux' : 'gras'}>{PRESENCES.find(([v]) => v === p.statut)?.[1]}{p.statut === 'retard' ? ` · ${p.minutes ?? 15} min` : ''}</span>}
                          </div>
                          {modifiable && (
                            <div role="group" aria-label={`Présence de ${e.nom}`} className="bascules">
                              {PRESENCES.map(([v, l]) => (
                                <button key={v} type="button" className={v === p.statut ? 'actif' : ''} aria-pressed={v === p.statut} onClick={() => poserPresence(e, p)(v)}>{l}</button>
                              ))}
                            </div>
                          )}
                          {modifiable && p.statut === 'retard' && listeMinutes(e, p)}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <Tableau serre colonnes={[{ titre: 'N°' }, { titre: 'Élève', mobile: 'entete' }, { titre: 'Présence' }, { titre: 'Retard' }]}
                    lignes={((f.eleves ?? []) as any[]).map((e) => {
                      const p = presences[e.inscriptionId] ?? { statut: 'present', minutes: null };
                      return [
                        <span className="doux">{e.numero}</span>,
                        <span className="gras">{e.nom}</span>,
                        <div role="group" aria-label={`Présence de ${e.nom}`}>
                          <Bascules petites={!tactile} options={PRESENCES} valeur={p.statut} onChange={modifiable ? poserPresence(e, p) : undefined} />
                        </div>,
                        p.statut === 'retard'
                          ? (modifiable ? listeMinutes(e, p) : <span>{p.minutes ?? 15} min</span>)
                          : <span className="doux">–</span>,
                      ];
                    })} />
                )}
                {modifiable && (
                  <div className="rangee fin centre pied-colle">
                    {telephone && <Doux>{compteurs}</Doux>}
                    <Bouton onClick={() => setPresences((x) => Object.fromEntries(Object.keys(x).map((k) => [k, { statut: 'present', minutes: null }])) as Record<string, Presence>)}>Tous présents</Bouton>
                    <Bouton variante="principal" touches={telephone ? undefined : ['Ctrl', 'S']} charge={charge} onClick={enregistrer}>Enregistrer l'appel</Bouton>
                  </div>
                )}
              </Panneau>
            ) },
            { flex: 2, min: 300, enfants: (
              <>
                <Panneau ecart={0}>
                  <TitrePanneau titre={`Fiches du jour · ${nomClasse}`} />
                  <div style={{ marginTop: 6 }}>
                    {fiches.map((x) => (
                      <button key={x.id} type="button" className="ligne-liste cliquable ligne-bouton" aria-current={x.id === f.id ? 'true' : undefined} onClick={() => setChoixFiche(x.id)}>
                        <div style={{ flex: '1 1 180px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}><Pastille>{x.debut} – {x.fin}</Pastille><span className="gras">{x.libelle}</span></div>
                          <Doux>{x.personnel ?? '–'}{x.coursCommun ? ` · ${x.coursCommun}` : ''}</Doux>
                        </div>
                        {x.statut === 'faite' ? <Pastille ton="succes" icone="coche">Faite</Pastille> : <Pastille>À faire</Pastille>}
                      </button>
                    ))}
                  </div>
                  <Doux style={{ marginTop: 10 }}>Une fiche par classe et par créneau, créée chaque matin. Quand un cours réunit deux classes, chacune garde sa fiche.</Doux>
                </Panneau>
                {ecole && (
                  <Panneau>
                    <TitrePanneau titre="Toute l’école, ce matin" />
                    <Grille min={120} ecart={14}>
                      <InfoCaps libelle="Fiches faites" valeur={`${ecole.faites} sur ${ecole.total}`} />
                      <InfoCaps libelle="En retard" valeur={ecole.nb_retard ? `${ecole.nb_retard} · ${ecole.retard}` : '0'} />
                    </Grille>
                    {moi.a('pilotage.statistiques.consulter') && ecole.nb_retard > 0 && (
                      <div><Bouton icone="chevron" variante="lien" onClick={() => naviguer('/pilotage/statistiques')}>Voir les fiches en retard</Bouton></div>
                    )}
                  </Panneau>
                )}
              </>
            ) },
          ]} />
        </>
      )}
    </Coque>
  );
}

// ===================================================================== absences et discipline

function Justifier({ fermer, a }: { fermer: (v?: boolean) => void; a: any }) {
  const [motif, setMotif] = useState(String(a.motif ?? '').replace(/^Demande du parent : « (.*) »$/, '$1'));
  const [charge, setCharge] = useState(false);
  return (
    <>
      <p>{jjmmaaaa(a.jour)} {a.moment} · {heures(a.minutes)}</p>
      <Champ libelle="Motif" value={motif} onChange={setMotif} autoFocus />
      <PiedFenetre fermer={() => fermer()} action="Justifier" charge={charge} disabled={motif.trim().length < 2} onAction={async () => {
        setCharge(true);
        const r = await agir(() => api.post('/vie-scolaire/absences/justification', { inscriptionId: a.inscriptionId, jour: a.jour, motif: motif.trim() }), 'Absence justifiée.');
        setCharge(false);
        if (r) fermer(true);
      }} />
    </>
  );
}

const SANCTIONS: [string, string][] = [['Retenue de 2 h', 'Retenue de 2 h'], ['Avertissement écrit aux parents', 'Avertissement écrit aux parents'], ['Exclusion d’un jour', 'Exclusion d’un jour']];

function DeciderSanction({ fermer, o }: { fermer: (v?: boolean) => void; o: { id: string; description: string } }) {
  const [laSanction, setLaSanction] = useState<string | null>(null);
  const [charge, setCharge] = useState(false);
  return (
    <>
      <Doux>{o.description}</Doux>
      <Liste libelle="Sanction" value={laSanction} onChange={setLaSanction} options={[[null, 'Choisir…'], ...SANCTIONS]} />
      <PiedFenetre fermer={() => fermer()} action="Décider la sanction" disabled={!laSanction} charge={charge} onAction={async () => {
        setCharge(true);
        const r = await agir(() => api.post(`/vie-scolaire/observations/${o.id}/sanction`, { sanction: laSanction }), 'Sanction enregistrée.');
        setCharge(false);
        if (r) fermer(true);
      }} />
    </>
  );
}

function NouvelleObservation({ fermer, types, sanction }: { fermer: (v?: boolean) => void; types: Record<string, string>; sanction: boolean }) {
  const [q, setQ] = useState('');
  const [resultats, setResultats] = useState<any[]>([]);
  const [eleve, setEleve] = useState<any | null>(null);
  const [type, setType] = useState('comportement');
  const [description, setDescription] = useState('');
  const [laSanction, setLaSanction] = useState<string | null>(null);
  const [charge, setCharge] = useState(false);
  useEffect(() => {
    if (q.trim().length < 2) { setResultats([]); return; }
    const t = setTimeout(() => { api.get(`/scolarite/recherche${requete({ q: q.trim() })}`).then((r) => setResultats(r as any[])).catch(() => setResultats([])); }, 250);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <>
      {eleve ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="gras" style={{ flex: 1 }}>{eleve.nom} · {eleve.classe}</span>
          <button type="button" className="lien-texte" style={{ fontWeight: 600, display: 'inline-flex', alignItems: 'center', minHeight: 44 }} onClick={() => setEleve(null)}>Changer d’élève</button>
        </div>
      ) : (
        <div>
          <Champ libelle="Élève" value={q} onChange={setQ} placeholder="Nom ou matricule" autoFocus />
          {resultats.map((e) => (
            <button key={e.inscriptionId} type="button" className="ligne-liste cliquable ligne-bouton" onClick={() => setEleve(e)}><span className="gras" style={{ flex: 1 }}>{e.nom}</span><Doux>{e.classe}</Doux></button>
          ))}
        </div>
      )}
      <Liste libelle="Type" value={type} options={Object.entries(types)} onChange={setType} />
      <Champ libelle="Ce qui s’est passé" value={description} onChange={setDescription} lignes={2} />
      {sanction && (
        <Liste libelle="Sanction" value={laSanction} onChange={setLaSanction}
          options={[[null, 'Aucune'], ...SANCTIONS]} />
      )}
      <PiedFenetre fermer={() => fermer()} action="Enregistrer l’observation" disabled={!eleve || description.trim().length < 3} charge={charge} onAction={async () => {
        setCharge(true);
        const r = await agir(() => api.post('/vie-scolaire/observations', { inscriptionId: eleve.inscriptionId, type, description: description.trim(), sanction: laSanction }), 'Observation enregistrée.');
        setCharge(false);
        if (r) fermer(true);
      }} />
    </>
  );
}

export function EcranDiscipline() {
  const moi = useMoi();
  const naviguer = useNavigate();
  const { tactile } = useEcran();
  const { d, erreur, recharger } = useDonnees(() => api.get('/vie-scolaire/absences'));
  // Sur écran tactile, les liens texte gardent leur aspect mais atteignent 44 px de haut.
  const lienTactile = tactile ? { display: 'inline-flex', alignItems: 'center', minHeight: 44 } as const : {};
  const ficheEleve = routePermise('/scolarite/eleves', moi);
  const peutJustifier = d?.peutJustifier === true && moi.a('vie_scolaire.absence.justifier');
  // « Nouvelle observation » : l'élève se choisit par la recherche des élèves, qui exige sa propre permission.
  const justifier = async (a: any) => {
    const ok = await ouvrirFormulaire<boolean>(`Justifier · ${a.eleve}`, ({ fermer }) => <Justifier fermer={fermer} a={a} />, 460);
    if (ok) await recharger();
  };
  // Sanction décidée par le directeur sur un fait relevé par un instituteur (D-52).
  const sanctionner = async (o: any) => {
    const ok = await ouvrirFormulaire<boolean>(`Sanction · ${o.eleve}`, ({ fermer }) => <DeciderSanction fermer={fermer} o={o} />, 460);
    if (ok) await recharger();
  };
  const observer = async () => {
    const ok = await ouvrirFormulaire<boolean>('Nouvelle observation', ({ fermer }) =>
      <NouvelleObservation fermer={fermer} types={d?.types ?? {}} sanction={moi.a('vie_scolaire.sanction.decider')} />);
    if (ok) await recharger();
  };
  return (
    <Coque module="vie" titre="Vie scolaire">
      <StylesVie />
      {erreur ? <Erreur message={erreur} recharger={recharger} /> : !d ? <Chargement /> : (
        <Colonnes colonnes={[
          { flex: 3, min: 620, enfants: (
            <>
              <Panneau>
                <TitrePanneau titre="Absences" sous={`Du ${jjmmaaaa(d.du).slice(0, 5)} au ${jjmmaaaa(d.au)}`} />
                <Tableau colonnes={[{ titre: 'Élève', mobile: 'entete' }, { titre: 'Date' }, { titre: 'Durée', droite: true }, { titre: 'Motif' }, { titre: 'État' }, { titre: 'Action' }]}
                  vide="Aucune absence cette semaine"
                  lignes={((d.absences ?? []) as any[]).map((a) => [
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      {ficheEleve
                        ? <button type="button" className="lien-texte" style={{ textAlign: 'left', fontWeight: 600, ...lienTactile }} aria-label={`Ouvrir la fiche de ${a.eleve}`}
                            onClick={() => naviguer(`/scolarite/eleves/${a.eleveId}`)}>{a.eleve}</button>
                        : <span className="gras">{a.eleve}</span>}
                      <Doux>{a.classe}</Doux>
                    </div>,
                    <span className="doux">{jjmmaaaa(a.jour)} {a.moment}</span>,
                    heures(a.minutes),
                    a.motif ? <span>{a.motif}</span> : <span className="doux">–</span>,
                    a.justifiee ? <Pastille ton="succes" icone="coche">Justifiée</Pastille> : <Pastille ton="attention">Non justifiée</Pastille>,
                    a.justifiee || !peutJustifier ? <span className="doux">–</span>
                      : <button type="button" className="lien-texte" style={{ fontWeight: 600, ...lienTactile }} aria-label={`Justifier l’absence de ${a.eleve} du ${jjmmaaaa(a.jour)}`} onClick={() => justifier(a)}>Justifier</button>,
                  ])} />
                <Doux>Une absence se justifie par le préfet des études ; le parent peut le demander depuis son application.</Doux>
              </Panneau>
              <Panneau>
                <TitrePanneau titre={`Cumul du ${d.periode ?? 'trimestre'}`} sous="Les trois plus élevés" />
                <Tableau colonnes={[{ titre: 'Élève', mobile: 'entete' }, { titre: 'Classe' }, { titre: 'Total', droite: true }, { titre: 'Dont justifiées', droite: true }]}
                  vide="Aucune absence sur la période"
                  lignes={((d.cumul ?? []) as any[]).map((c) => [
                    <span className="gras">{c.eleve}</span>, c.classe, heures(c.minutes), <span className={c.justifiees ? '' : 'doux'}>{heures(c.justifiees)}</span>,
                  ])} />
                <Doux>Le total d’heures de la période est reporté sur le bulletin.</Doux>
              </Panneau>
            </>
          ) },
          { flex: 2, min: 340, enfants: (
            <Panneau ecart={0}>
              <TitrePanneau titre="Observations et sanctions" sous="Historique conservé par élève ; le principal lit celles de sa classe"
                action={moi.a('vie_scolaire.observation.creer') && moi.a('scolarite.eleve.consulter')
                  ? <Bouton icone="ajouter" variante="principal" onClick={observer}>Nouvelle observation</Bouton> : undefined} />
              <div style={{ marginTop: 6 }}>
                {((d.observations ?? []) as any[]).map((o) => (
                  <LigneListe key={o.id}>
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                        <Pastille ton={tonObservation(o.type)}>{libelleObservation(o.type)}</Pastille><span className="gras">{o.eleve} · {o.classe}</span>
                      </div>
                      <span>{o.description}</span>
                      {o.sanction && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}><span className="gras doux">Sanction</span><span className="gras">{o.sanction}</span></div>}
                      <Doux>{jjmmaaaa(o.survenuLe)} · relevé par {o.auteur}</Doux>
                      {!o.sanction && o.type !== 'felicitations' && moi.a('vie_scolaire.sanction.decider') && (
                        <span><button type="button" className="lien-texte" style={{ fontWeight: 600, ...lienTactile }} aria-label={`Décider une sanction pour ${o.eleve}`}
                          onClick={() => sanctionner(o)}>Décider une sanction</button></span>
                      )}
                    </div>
                  </LigneListe>
                ))}
                {(d.observations ?? []).length === 0 && <LigneListe><Doux>Aucune observation pour l’instant.</Doux></LigneListe>}
              </div>
              <Doux style={{ marginTop: 10 }}>Types : retard, comportement, travail non fait, tenue, félicitations. L’instituteur relève les faits ; la sanction est décidée par le directeur.</Doux>
            </Panneau>
          ) },
        ]} />
      )}
    </Coque>
  );
}

// ===================================================================== annonces

const CIBLES: Record<string, string> = { ecole: 'Toute l’école', niveau: 'Un niveau', classe: 'Une classe', parent: 'Un parent', debiteurs: 'Familles débitrices' };

export function EcranAnnonces() {
  const { telephone } = useEcran();
  const { d, erreur, recharger } = useDonnees(() => api.get('/communication/annonces'));
  const [cible, setCible] = useState('classe');
  const [cibleId, setCibleId] = useState<string | null>(null);
  const [titre, setTitre] = useState('');
  const [fr, setFr] = useState('');
  const [en, setEn] = useState('');
  const [estimation, setEstimation] = useState<any | null>(null);
  const [charge, setCharge] = useState(false);
  const options = useMemo(() => {
    const x = ({ classe: d?.classes, niveau: d?.niveaux, parent: d?.familles } as Record<string, any[] | undefined>)[cible] ?? [];
    return x.map((o): [string, string] => [o.id, o.nom]);
  }, [d, cible]);
  useEffect(() => {
    if (!d) return;
    const cibles: string[] = d.cibles ?? [];
    if (!cibles.includes(cible)) setCible(cibles[0] ?? 'classe');
  }, [d, cible]);
  useEffect(() => { if (!options.some(([id]) => id === cibleId)) setCibleId(options[0]?.[0] ?? null); }, [options, cibleId]);
  useEffect(() => {
    if (['classe', 'niveau', 'parent'].includes(cible) && !cibleId) { setEstimation(null); return; }
    let actif = true; // une réponse tardive d'une cible précédente est ignorée
    api.get(`/communication/annonces/estimation${requete({ cible, cibleId })}`).then((r) => { if (actif) setEstimation(r); }).catch(() => { if (actif) setEstimation(null); });
    return () => { actif = false; };
  }, [cible, cibleId]);
  const envoyer = async (publier: boolean) => {
    setCharge(true);
    const r = await agir(() => api.post('/communication/annonces', { titre: titre.trim(), texteFr: fr.trim(), texteEn: en.trim() || null, cible, cibleId, publier }),
      publier ? 'Annonce publiée.' : 'Brouillon enregistré.');
    setCharge(false);
    if (r) { setTitre(''); setFr(''); setEn(''); await recharger(); }
  };
  const libelleChoix = ({ classe: 'Classe', niveau: 'Niveau', parent: 'Famille' } as Record<string, string>)[cible];
  const complete = titre.trim().length >= 3 && fr.trim().length >= 3 && (!libelleChoix || !!cibleId);
  return (
    <Coque module="messages" titre="Messages">
      <StylesVie />
      {erreur ? <Erreur message={erreur} recharger={recharger} /> : !d ? <Chargement /> : (
        <Colonnes colonnes={[
          { flex: 3, min: 600, enfants: (
            <Panneau>
              <TitrePanneau titre="Nouvelle annonce" />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <Etiquette>Destinataires</Etiquette>
                <BasculesDefilantes ariaLabel="Destinataires" defiler={telephone} options={((d.cibles ?? []) as string[]).map((c): [string, string] => [c, CIBLES[c] ?? c])} valeur={cible} onChange={setCible} />
              </div>
              <div className="rangee pile-mobile">
                {libelleChoix && <Liste libelle={libelleChoix} largeur={200} value={cibleId} options={options} onChange={setCibleId} />}
                <div style={{ flex: '3 1 320px' }}><Champ libelle="Titre" value={titre} onChange={setTitre} /></div>
              </div>
              <div className="rangee pile-mobile">
                <div style={{ flex: '1 1 260px' }}><Champ libelle="Texte en français" value={fr} onChange={setFr} lignes={4} /></div>
                <div style={{ flex: '1 1 260px' }}><Champ libelle="Text in English" value={en} onChange={setEn} lignes={4} /></div>
              </div>
              <Grille min={140} ecart={14}>
                <InfoCaps libelle="Familles concernées" valeur={estimation?.familles ?? '–'} />
                <InfoCaps libelle="Par SMS" valeur={estimation ? estimation.sms : '–'} />
                <InfoCaps libelle="Dans l’application" valeur={estimation?.familles ?? '–'} />
              </Grille>
              <div className="rangee fin centre pile-mobile">
                <Bouton disabled={!complete || charge} onClick={() => envoyer(false)}>Enregistrer le brouillon</Bouton>
                <Bouton icone="envoyer" variante="principal" charge={charge} disabled={!complete} onClick={() => envoyer(true)}>Publier</Bouton>
              </div>
            </Panneau>
          ) },
          { flex: 2, min: 380, enfants: (
            <Panneau ecart={0}>
              <TitrePanneau titre="Annonces publiées" />
              <div style={{ marginTop: 6 }}>
                {((d.publiees ?? []) as any[]).map((a) => (
                  <LigneListe key={a.id}>
                    <div style={{ flex: '1 1 200px', display: 'flex', flexDirection: 'column', gap: 1 }}>
                      <span className="gras">{a.titre}</span>
                      <Doux>{[jm(a.publieeLe ?? a.creeLe), a.cibleLibelle, a.cible === 'debiteurs' ? a.nbFamilles : null, `par ${a.auteur}`].filter((x) => x !== null && x !== undefined).join(' · ')}</Doux>
                    </div>
                    {a.statut === 'publiee' ? <Pastille ton="succes">Publiée</Pastille> : <Pastille>Brouillon</Pastille>}
                  </LigneListe>
                ))}
                {(d.publiees ?? []).length === 0 && <LigneListe><Doux>Aucune annonce pour l’instant.</Doux></LigneListe>}
              </div>
              <Doux style={{ marginTop: 10 }}>Publient : la secrétaire, le préfet des études, l’économe, et chaque instituteur principal pour sa classe.</Doux>
            </Panneau>
          ) },
        ]} />
      )}
    </Coque>
  );
}

// ===================================================================== SMS

export function EcranSms() {
  const moi = useMoi();
  const { telephone, tactile } = useEcran();
  const { d, erreur, recharger } = useDonnees(() => api.get('/communication/sms'));
  const [cible, setCible] = useState('debiteurs');
  const [cibleId, setCibleId] = useState<string | null>(null);
  const [modele, setModele] = useState('relance');
  const [fr, setFr] = useState('');
  const [en, setEn] = useState('');
  const [estimation, setEstimation] = useState<any | null>(null);
  const [charge, setCharge] = useState(false);
  const modeles: any[] = useMemo(() => {
    const permis = d?.permis as string[] | null | undefined;
    return ((d?.modeles ?? []) as any[]).filter((m) => !permis || permis.includes(m.code));
  }, [d]);
  const appliquer = (code: string) => {
    const m = modeles.find((x) => x.code === code) ?? modeles[0];
    if (!m) return;
    setModele(m.code);
    setFr(String(m.fr).replaceAll('[école]', moi.etablissement));
    setEn(String(m.en).replaceAll('[school]', moi.etablissementEn));
  };
  const peutEnvoyer = moi.a('communication.sms.envoyer') && !(Array.isArray(d?.permis) && d.permis.length === 0);
  // Premier modèle autorisé, textes préremplis.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (modeles.length && !fr) appliquer(modele); }, [modeles]);
  useEffect(() => {
    if (!d || !peutEnvoyer || fr.trim().length < 3) return;
    if ((cible === 'classe' || cible === 'niveau') && !cibleId) { setEstimation(null); return; }
    let actif = true; // une réponse tardive d'une saisie précédente est ignorée
    const t = setTimeout(() => {
      api.post('/communication/sms/estimation', { cible, cibleId, modele, texteFr: fr, texteEn: en || null })
        .then((r) => { if (actif) setEstimation(r); }).catch(() => { if (actif) setEstimation(null); });
    }, 300);
    return () => { actif = false; clearTimeout(t); };
  }, [d, peutEnvoyer, cible, cibleId, modele, fr, en]);
  const corps = () => ({ cible, cibleId, modele, texteFr: fr, texteEn: en || null });
  const apercu = () => {
    const a = estimation?.apercu;
    void ouvrirFenetre('Aperçu par famille', (fermer) => (
      <>
        {a ? <><Etiquette>Famille de {a.famille}</Etiquette><Note ton="accent">{a.texte}</Note></> : <Doux>Aucun destinataire dans cette cible.</Doux>}
        <div className="pied"><Bouton variante="principal" onClick={() => fermer()}>Fermer</Bouton></div>
      </>
    ), 460);
  };
  const choisirCible = (v: string) => {
    setCible(v);
    setCibleId(v === 'classe' ? (d?.classes?.[0]?.id ?? null) : v === 'niveau' ? (d?.niveaux?.[0]?.id ?? null) : null);
  };
  return (
    <Coque module="messages" titre="Messages">
      <StylesVie />
      {erreur ? <Erreur message={erreur} recharger={recharger} /> : !d ? <Chargement /> : (
        <Colonnes colonnes={[
          { flex: 3, min: 600, enfants: !peutEnvoyer ? null : (
            <Panneau>
              <TitrePanneau titre="Nouveau message" />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <Etiquette>Destinataires</Etiquette>
                <BasculesDefilantes ariaLabel="Destinataires" defiler={telephone} options={[['classe', 'Une classe'], ['niveau', 'Un niveau'], ['ecole', 'Tout l\'établissement'], ['debiteurs', 'Familles en retard']]} valeur={cible} onChange={choisirCible} />
              </div>
              <div className="rangee pile-mobile">
                <div style={{ flex: '1 1 240px' }}>
                  <Liste libelle="Modèle" value={modele} options={modeles.map((m): [string, string] => [m.code, m.libelle])} onChange={appliquer} />
                </div>
                {(cible === 'classe' || cible === 'niveau') && (
                  <div style={{ flex: '1 1 200px' }}>
                    <Liste libelle={cible === 'classe' ? 'Classe' : 'Niveau'} value={cibleId}
                      options={((cible === 'classe' ? d.classes : d.niveaux) as any[]).map((o): [string, string] => [o.id, o.nom])} onChange={setCibleId} />
                  </div>
                )}
              </div>
              <div className="rangee pile-mobile">
                <div style={{ flex: '1 1 260px' }}><Champ libelle="Message en français" value={fr} onChange={setFr} lignes={5} /></div>
                <div style={{ flex: '1 1 260px' }}><Champ libelle="Message in English" value={en} onChange={setEn} lignes={5} /></div>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                <span className="gras doux">Variables</span>
                {['[responsable]', '[élève]', '[classe]', '[montant]', '[date limite]'].map((v) => <Pastille key={v}>{v}</Pastille>)}
              </div>
              <Grille min={130} ecart={14}>
                <InfoCaps libelle="Destinataires" valeur={estimation ? pluriel(estimation.destinataires, 'responsable') : '–'} />
                <InfoCaps libelle="En français" valeur={estimation?.fr ?? '–'} />
                <InfoCaps libelle="In English" valeur={estimation?.en ?? '–'} />
                <InfoCaps libelle="SMS par message" valeur={estimation?.smsParMessage ?? '–'} />
                <InfoCaps libelle="Coût estimé" valeur={estimation ? `${pluriel(estimation.destinataires * (Number(estimation.smsParMessage) || 1), 'SMS')} au tarif du prestataire` : '–'} />
              </Grille>
              <div className="rangee fin centre pile-mobile">
                <Bouton onClick={apercu}>Aperçu par famille</Bouton>
                <Bouton icone="envoyer" variante="principal" charge={charge} disabled={fr.trim().length < 3} onClick={async () => {
                  setCharge(true);
                  const r = await agir(() => api.post('/communication/sms', corps()), 'Message mis en file d’attente.');
                  setCharge(false);
                  if (r) await recharger();
                }}>Mettre en file d'attente</Bouton>
              </div>
            </Panneau>
          ) },
          { flex: 2, min: 380, enfants: (
            <>
              <Panneau ecart={0}>
                <TitrePanneau titre="File d'attente et envois" sous={pluriel(d.enAttente, 'SMS en attente', 'SMS en attente')} />
                <div style={{ marginTop: 6 }}>
                  {((d.file ?? []) as any[]).map((f) => (
                    <LigneListe key={f.id}>
                      <div style={{ flex: '1 1 170px', display: 'flex', flexDirection: 'column', gap: 1 }}>
                        <span className="gras">{f.modele}</span>
                        <Doux>{[`${jm(f.partirLe ?? f.creeLe)} ${hm(f.partirLe ?? f.creeLe)}`, pluriel(f.destinataires, 'destinataire'), f.statut === 'envoye' ? pluriel(f.sms, 'SMS', 'SMS') : null,
                          f.echecs > 0 ? pluriel(f.echecs, 'échec') : null].filter(Boolean).join(' · ')}</Doux>
                      </div>
                      {f.statut === 'envoye' ? <Pastille ton="succes">Envoyé</Pastille> : <Pastille ton="attention">En attente d’internet</Pastille>}
                    </LigneListe>
                  ))}
                </div>
                <Doux style={{ marginTop: 10 }}>{d.fournisseur === 'desactive'
                  ? 'Les SMS attendent ici et partent dès que la connexion au prestataire est établie.'
                  : 'Sans internet, les SMS attendent ici et partent dès que la connexion revient.'}</Doux>
              </Panneau>
              <Panneau ecart={0}>
                <TitrePanneau titre="Notifications automatiques" />
                <div style={{ marginTop: 6 }}>
                  {((d.notifications ?? []) as any[]).map((n) => {
                    const parametrer = moi.a('communication.sms.parametrer');
                    const changer = async (v: boolean) => {
                      const r = await agir(() => api.put(`/communication/notifications/${n.code}`, { active: v }));
                      if (r) await recharger();
                    };
                    return (
                      <LigneListe key={n.code} style={{ padding: tactile ? '4px 0' : 0 }}>
                        {tactile ? (
                          // Écran tactile : un interrupteur large (44 px), l'état est écrit et pas seulement coché.
                          <>
                            <span style={{ flex: '1 1 160px', fontWeight: 500 }}>{n.libelle}</span>
                            <Doux>{n.canal}</Doux>
                            {parametrer
                              ? <Bouton petit={false} icone={n.active === true ? 'coche' : undefined} onClick={() => void changer(n.active !== true)}
                                  title={`${n.libelle} : ${n.active === true ? 'activée' : 'désactivée'}`}>{n.active === true ? 'Activée' : 'Désactivée'}</Bouton>
                              : <Pastille ton={n.active === true ? 'succes' : 'neutre'} icone={n.active === true ? 'coche' : undefined}>{n.active === true ? 'Activée' : 'Désactivée'}</Pastille>}
                          </>
                        ) : (
                          <>
                            <span style={{ flex: 1 }}><CaseACocher libelle={n.libelle} valeur={n.active === true} onChange={parametrer ? changer : undefined} /></span>
                            <Doux>{n.canal}</Doux>
                          </>
                        )}
                      </LigneListe>
                    );
                  })}
                </div>
              </Panneau>
            </>
          ) },
        ].filter((x) => x.enfants !== null)} />
      )}
    </Coque>
  );
}

// ===================================================================== messagerie des parents

function quand(s: string | null | undefined): string {
  const v = iso(s);
  if (!v) return '';
  const dt = new Date(v);
  if (Number.isNaN(dt.getTime())) return '';
  const auj = new Date();
  const jours = Math.round((new Date(auj.getFullYear(), auj.getMonth(), auj.getDate()).getTime() - new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()).getTime()) / 86_400_000);
  if (jours === 0) return heure(v);
  if (jours === 1) return 'hier';
  if (jours < 7) return JOURS_MIN[dt.getDay()]!;
  return jjmm(v);
}

/** Boîte de la personne connectée (RG-42) : « Adressées à la secrétaire », « ici, la boîte de la secrétaire ». */
function boite(libelle: string): { a: string; de: string } {
  const l = libelle.trim();
  if (/^secr/i.test(l)) return { a: 'la secrétaire', de: 'la boîte de la secrétaire' };
  if (/^[ée]con/i.test(l)) return { a: 'l’économe', de: 'la boîte de l’économe' };
  if (/^direct/i.test(l)) return { a: 'la direction', de: 'la boîte de la direction' };
  if (/^instit/i.test(l)) return { a: 'l’instituteur principal', de: 'la boîte de l’instituteur principal' };
  return l ? { a: l, de: `la boîte ${l}` } : { a: 'vous', de: 'votre boîte' };
}

export function EcranMessagerie() {
  const moi = useMoi();
  const { telephone, tactile } = useEcran();
  const [choisie, setChoisie] = useState<string | null>(null);
  // Téléphone : un seul panneau à la fois ; la conversation ne s'ouvre qu'au toucher d'une ligne et « Retour » ramène à la liste.
  const [ouverte, setOuverte] = useState(false);
  const [reponse, setReponse] = useState('');
  const [saisie, setSaisie] = useState(false);
  const liste = useDonnees(() => api.get('/communication/conversations'));
  const conv = useDonnees(() => (choisie ? api.get(`/communication/conversations/${choisie}`) : Promise.resolve(null)), [choisie]);
  // Brouillon enregistré, conversation déjà préremplie, et file des envois : un brouillon parti au moment où l'on clique « Envoyer » passe avant la réponse.
  const enregistre = useRef('');
  const preremplie = useRef<string | null>(null);
  const file = useRef<Promise<unknown>>(Promise.resolve());
  const enFile = <T,>(f: () => Promise<T>): Promise<T> => { const p = file.current.then(f, f); file.current = p.catch(() => undefined); return p; };
  useEffect(() => { if (!choisie && liste.d?.conversations?.[0]) setChoisie(liste.d.conversations[0].id); }, [liste.d, choisie]);
  useEffect(() => {
    if (!conv.d || preremplie.current === conv.d.id) return;
    preremplie.current = conv.d.id;
    const brouillon = ((conv.d.messages ?? []) as any[]).filter((m) => m.brouillon).at(-1);
    setReponse(brouillon?.texte ?? '');
    enregistre.current = String(brouillon?.texte ?? '').trim();
  }, [conv.d]);
  const garderBrouillon = () => {
    const texte = reponse.trim();
    const id = conv.d?.id as string | undefined;
    if (!id || !texte || texte === enregistre.current) return;
    enregistre.current = texte;
    enFile(() => api.post(`/communication/conversations/${id}/messages`, { texte, brouillon: true }))
      .catch((e) => { enregistre.current = ''; signaler(e instanceof Error ? e.message : String(e), true); });
  };
  const envoyer = async () => {
    const texte = reponse.trim();
    const id = conv.d?.id as string | undefined;
    if (!texte || !id) return;
    const r = await agir(() => enFile(() => api.post(`/communication/conversations/${id}/messages`, { texte, brouillon: false })), 'Réponse envoyée.');
    if (r) {
      setReponse('');
      enregistre.current = '';
      await Promise.all([liste.recharger(), conv.recharger()]);
    }
  };
  const l = liste.d;
  const b = boite(String(l?.boite ?? ''));
  const c = conv.d;
  const conversations: any[] = l?.conversations ?? [];
  const montrerListe = !telephone || !ouverte;
  const montrerConversation = !telephone || ouverte;
  const panneauListe = (
    <Panneau ecart={0}>
      <TitrePanneau titre="Conversations" sous={`Adressées à ${b.a} · ${l?.nonLues ?? 0} non lue${(l?.nonLues ?? 0) > 1 ? 's' : ''}`} />
      <div style={{ marginTop: 6 }}>
        {conversations.map((x) => (
          <button key={x.id} type="button" className="ligne-liste cliquable ligne-bouton" style={{ alignItems: 'flex-start' }} aria-current={x.id === choisie ? 'true' : undefined}
            onClick={() => { setChoisie(x.id); setOuverte(true); }}>
            <div style={{ flex: '1 1 200px', display: 'flex', flexDirection: 'column', gap: 2 }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                <span className="gras" style={x.id === choisie ? { color: 'var(--accent)' } : undefined}>Famille {x.famille}</span>
                {x.nonLu && <Pastille ton="accent">Nouveau</Pastille>}
              </div>
              <Doux>{x.eleve}, {x.classe ?? '–'}</Doux>
              <span style={{ fontSize: 13 }}>{x.sujet ?? x.dernier ?? ''}</span>
            </div>
            <Doux>{quand(x.derniereActivite)}</Doux>
          </button>
        ))}
        {conversations.length === 0 && <LigneListe><Doux>Aucun message des parents pour l’instant.</Doux></LigneListe>}
      </div>
    </Panneau>
  );
  const panneauConversation = !c ? (choisie ? <Panneau><Chargement /></Panneau> : null) : (
    <Panneau ecart={12}>
      {telephone && <div><Bouton variante="lien" icone="chevron" onClick={() => setOuverte(false)}>Retour aux conversations</Bouton></div>}
      <TitrePanneau titre={`Famille ${c.famille} · ${c.eleve}, ${c.classe ?? '–'}`} />
      {((c.messages ?? []) as any[]).filter((m) => !m.brouillon).map((m) => (
        <div key={m.id} className={`bulle ${m.auteurType === 'famille' ? 'famille' : 'ecole'}`}>
          <span>{m.texte}</span>
          <Doux>{m.auteur} · {jm(m.envoyeLe)} à {hm(m.envoyeLe)}</Doux>
        </div>
      ))}
      {/* Réponse en cours : bulle de l'école, enregistrée comme brouillon dès qu'on la quitte ; sur téléphone, réponse et Envoyer restent collés en bas. */}
      <div className={telephone ? 'pied-colle' : undefined} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="bulle reponse" style={{ outline: saisie ? '2px solid var(--accent)' : 'none', outlineOffset: 1 }}>
          <textarea value={reponse} rows={3} placeholder="Votre réponse" aria-label="Votre réponse"
            onChange={(e) => setReponse(e.target.value)} onFocus={() => setSaisie(true)} onBlur={() => { setSaisie(false); garderBrouillon(); }}
            style={{ width: '100%', minHeight: 48, padding: 0, border: 0, outline: 'none', resize: 'vertical', background: 'transparent', color: 'inherit', font: 'inherit', lineHeight: 'inherit' }} />
          {reponse.trim() && <Doux>{moi.nom} · brouillon</Doux>}
        </div>
        <div className="rangee fin centre pile-mobile">
          {c.absenceAJustifier && moi.a('vie_scolaire.absence.justifier') && (
            <Bouton icone="coche" onClick={async () => {
              const r = await agir(() => api.post('/vie-scolaire/absences/justification', { inscriptionId: c.inscription_id, jour: c.absenceAJustifier,
                motif: 'Demande du parent, certificat à suivre' }), 'Absence justifiée.');
              if (r) await conv.recharger();
            }}>Justifier l’absence</Bouton>
          )}
          <Bouton icone="envoyer" variante="principal" disabled={!reponse.trim()} onClick={envoyer}>Envoyer</Bouton>
        </div>
      </div>
      <Doux>Le parent choisit son destinataire : instituteur principal, économe, directeur ou secrétaire. Chacun ne voit que les messages qui lui sont adressés ; ici, {b.de}.</Doux>
    </Panneau>
  );
  return (
    <Coque module="messages" titre="Messages">
      <StylesVie />
      {liste.erreur ? <Erreur message={liste.erreur} recharger={liste.recharger} /> : !l ? <Chargement />
        : tactile && !telephone ? (
          // Tablette : liste et fil côte à côte (2/5 – 3/5), alors que les colonnes ordinaires s'empilent.
          <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
            <div style={{ flex: '2 1 0', minWidth: 0 }}>{panneauListe}</div>
            {panneauConversation && <div style={{ flex: '3 1 0', minWidth: 0 }}>{panneauConversation}</div>}
          </div>
        ) : (
          <Colonnes colonnes={[
            ...(montrerListe ? [{ flex: 2, min: 360, enfants: panneauListe }] : []),
            ...(montrerConversation ? [{ flex: 3, min: 560, enfants: panneauConversation }] : []),
          ].filter((x) => x.enfants !== null)} />
        )}
    </Coque>
  );
}

export const routes: RouteEcran[] = [
  { path: '/emploi-du-temps', element: <EcranEmploiDuTemps /> },
  { path: '/vie-scolaire/appel', element: <EcranAppel /> },
  { path: '/vie-scolaire/discipline', element: <EcranDiscipline /> },
  { path: '/messages/annonces', element: <EcranAnnonces /> },
  { path: '/messages/sms', element: <EcranSms /> },
  { path: '/messages/messagerie', element: <EcranMessagerie /> },
];
