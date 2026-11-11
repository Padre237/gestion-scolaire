// Applications mobiles installables (PWA), maquettes Mobile-enseignant-* et Mobile-parent-* :
// - instituteur : saisie des notes et appel, utilisables hors ligne (file d'attente sur le téléphone, envoi au retour du réseau) ;
// - parent : accueil, bulletin, paiements, reçu, agenda, messages, écrire à l'école.
// Le serveur reste seul juge : la famille ne voit que ses enfants, à l'écran, sans téléchargement (RG-35), le bulletin
// sous condition de paiement (RG-40) ; l'instituteur ne saisit que ses matières (RG-22) et ses créneaux d'appel (RG-38).
import { Fragment, useEffect, useMemo, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { RouteEcran } from '../App.tsx';
import { api, ErreurApi, requete } from '../core/api.ts';
import { useMoi, useSession } from '../core/session.tsx';
import { aujourdhuiIso, dateLocale, decimal, fcfa, heure, initiale, jjmm, jjmmaaaa, jourDate, montant, note2, pluriel, versDecimal } from '../core/format.ts';
import { agir, Bandeau, Bascules, Bouton, Champ, Chargement, Erreur, Icone, Liste, Note, ouvrirFenetre, ouvrirFormulaire, PiedFenetre, signaler, useDonnees } from '../core/ui.tsx';
import type { NomIcone } from '../core/icones-traces.ts';

// ===================================================================== présentation commune (maquettes mobiles)

const CSS = `
.m-app { min-height: 100vh; min-height: 100dvh; display: flex; justify-content: center; }
.m-colonne { position: relative; width: 100%; max-width: 430px; height: 100vh; height: 100dvh; display: flex; flex-direction: column; background: var(--fond); overflow: hidden; }
@media (min-width: 460px) { .m-colonne { border-left: 1px solid var(--bord); border-right: 1px solid var(--bord); } }
.m-colonne.m-connexion { height: auto; min-height: 100vh; min-height: 100dvh; overflow: visible; padding: calc(56px + env(safe-area-inset-top)) 24px 24px; gap: 22px; }
.m-entete { flex: none; display: flex; align-items: center; gap: 10px; padding: 14px 16px; padding-top: calc(14px + env(safe-area-inset-top)); background: var(--panneau); border-bottom: 1px solid var(--bord); }
.m-entete h1 { margin: 0; font-size: 17px; font-weight: 700; }
.m-titre { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.m-titre > span { font-size: 12px; color: var(--doux); }
.m-logo { flex: none; width: 36px; height: 36px; border-radius: 11px; background: var(--eclat); color: #0B1F4B; display: flex; align-items: center; justify-content: center; }
.m-icone { flex: none; position: relative; display: flex; align-items: center; justify-content: center; width: 44px; height: 44px; padding: 0; border-radius: 8px; border: 1px solid var(--bord); background: transparent; color: var(--doux); cursor: pointer; text-decoration: none; }
a.m-icone:hover { color: var(--texte); }
.m-point { position: absolute; top: 9px; right: 9px; width: 8px; height: 8px; border-radius: 4px; background: var(--accent); }
.m-bande { flex: none; display: flex; align-items: center; gap: 8px; padding: 8px 16px; font-size: 13px; font-weight: 600; }
.m-bande.attention { background: var(--attention-fond); }
.m-bande.attention .icone { color: var(--attention); }
.m-bande.succes { background: var(--succes-fond); }
.m-bande.succes .icone { color: var(--succes); }
.m-contenu { flex: 1; min-height: 0; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 14px; }
.m-pied { flex: none; padding: 10px 16px; background: var(--panneau); border-top: 1px solid var(--bord); }
.m-onglets { flex: none; display: flex; background: var(--panneau); border-top: 1px solid var(--bord); padding-bottom: env(safe-area-inset-bottom); }
.m-onglets a { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; height: 60px; text-decoration: none; font-size: 11px; font-weight: 600; color: var(--doux); }
.m-onglets a.actif { color: var(--accent); }
.m-carte { position: relative; flex: none; background: var(--panneau); border: 1px solid var(--bord); border-radius: 12px; box-shadow: var(--ombre); padding: 14px; display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.m-carte.serree { gap: 0; }
.m-carte.cliquable { cursor: pointer; }
.m-ligne { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px solid var(--bord); }
.m-ligne.cliquable { cursor: pointer; }
.m-pile { display: flex; flex-direction: column; gap: 1px; min-width: 0; flex: 1; }
.m-petit { font-size: 12px; color: var(--doux); }
.m-deux-lignes { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.m-avatar { flex: none; display: flex; align-items: center; justify-content: center; width: 40px; height: 40px; border-radius: 11px; background: var(--champ); border: 1px solid var(--bord-fort); font-size: 16px; font-weight: 700; }
.m-choix { height: 44px; padding: 0 14px; border-radius: 8px; font: inherit; font-weight: 600; cursor: pointer; white-space: nowrap; border: 1px solid var(--bord-fort); background: var(--panneau); color: var(--texte); }
.m-choix[aria-pressed='true'] { border-color: var(--accent); background: var(--accent-fond); color: var(--accent); }
.m-nom { flex: 1; min-width: 0; padding: 0; border: 0; background: none; color: inherit; font: inherit; font-weight: 600; text-align: left; cursor: pointer; }
.m-nom:disabled { cursor: default; }
.m-note { flex: none; width: 64px; height: 36px; padding: 0 8px; text-align: right; font-weight: 600; }
.m-note[readonly] { color: var(--doux); }
.m-pastille-bouton { border: 0; cursor: pointer; font-family: inherit; }
.m-pastille-bouton:disabled { cursor: default; }
.m-presence { width: 44px; height: 44px; border-radius: 8px; font: inherit; font-weight: 700; cursor: pointer; border: 1px solid var(--bord-fort); background: var(--panneau); color: var(--doux); }
.m-presence.p[aria-pressed='true'] { border-color: var(--succes); background: var(--succes-fond); color: var(--succes); }
.m-presence.a[aria-pressed='true'] { border-color: var(--danger); background: var(--danger-fond); color: var(--danger); }
.m-presence.r[aria-pressed='true'] { border-color: var(--attention); background: var(--attention-fond); color: var(--attention); }
.m-presence:disabled { cursor: default; }
.m-radio { display: flex; align-items: flex-start; gap: 10px; padding: 10px 0; border-bottom: 1px solid var(--bord); cursor: pointer; }
.m-radio input { flex: none; width: 18px; height: 18px; margin: 2px 0 0; accent-color: var(--accent); }
.m-bulle { max-width: 85%; padding: 8px 12px; border-radius: 10px; display: flex; flex-direction: column; gap: 2px; }
body:has(.m-app) .messages-flottants { bottom: calc(84px + env(safe-area-inset-bottom)); }
`;
const StyleMobile = () => <style>{CSS}</style>;

interface Onglet { route: string; libelle: string; icone: NomIcone }
const ONGLETS_INSTITUTEUR: Onglet[] = [
  { route: '/instituteur/notes', libelle: 'Notes', icone: 'notes' },
  { route: '/instituteur/appel', libelle: 'Appel', icone: 'vieScolaire' },
];
const ONGLETS_PARENT: Onglet[] = [
  { route: '/parent/accueil', libelle: 'Accueil', icone: 'appParent' },
  { route: '/parent/notes', libelle: 'Notes', icone: 'notes' },
  { route: '/parent/agenda', libelle: 'Agenda', icone: 'emploiDuTemps' },
  { route: '/parent/paiements', libelle: 'Paiements', icone: 'fraisCaisse' },
];

/** Cadre des maquettes mobiles : en-tête (retour ou logo), bande d'état, contenu défilant, barre d'action, onglets. */
function Mobile({ titre, sous, retour, action, bande, pied, onglets, actif, children }: {
  titre: ReactNode; sous?: ReactNode; retour?: string | (() => void); action?: ReactNode; bande?: ReactNode; pied?: ReactNode;
  onglets: Onglet[]; actif: string; children: ReactNode;
}) {
  return (
    <div className="m-app">
      <StyleMobile />
      <div className="m-colonne">
        <header className="m-entete">
          {typeof retour === 'string'
            ? <Link to={retour} className="m-icone" aria-label="Retour"><Icone nom="wifi" /></Link>
            : retour
              ? <button type="button" className="m-icone" aria-label="Retour" onClick={retour}><Icone nom="wifi" /></button>
              : <div className="m-logo" aria-hidden="true"><Icone nom="logo" taille={22} /></div>}
          <div className="m-titre"><h1>{titre}</h1>{sous && <span>{sous}</span>}</div>
          {action}
        </header>
        {bande}
        <main className="m-contenu">{children}</main>
        {pied && <div className="m-pied">{pied}</div>}
        <nav className="m-onglets" aria-label="Navigation">
          {onglets.map((o) => (
            <Link key={o.route} to={o.route} className={o.route === actif ? 'actif' : ''} aria-current={o.route === actif ? 'page' : undefined}>
              <Icone nom={o.icone} taille={20} /><span>{o.libelle}</span>
            </Link>
          ))}
        </nav>
      </div>
    </div>
  );
}

const Carte = ({ children, serree, ecart, style }: { children: ReactNode; serree?: boolean; ecart?: number; style?: CSSProperties }) =>
  <section className={`m-carte ${serree ? 'serree' : ''}`} style={{ ...(ecart !== undefined ? { gap: ecart } : {}), ...style }}>{children}</section>;
const Chevron = () => <span style={{ display: 'flex', color: 'var(--doux)' }}><Icone nom="chevron" /></span>;
const Vide = ({ children }: { children: ReactNode }) => <Carte><span className="m-petit">{children}</span></Carte>;

/** Activation au clavier d'une ligne cliquable (Entrée, Espace). */
const touche = (f: () => void) => (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); f(); } };
const capitale = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** Horodatage de la base (« 2026-10-20 14:30:00.01+00 ») en ISO lisible par tous les navigateurs du téléphone. */
function isoNet(s: string | null | undefined): string {
  if (!s) return '';
  const t = s.replace(' ', 'T');
  return t.includes('T') ? t.replace(/(\.\d{3})\d+/, '$1').replace(/([+-]\d{2})$/, '$1:00') : t;
}
const memeJour = (iso: string) => dateLocale(iso)?.toDateString() === new Date().toDateString();
/** Montants écrits par la base avec une virgule de milliers (« 15,000 ») : affichage « 15 000 ». */
const montantsFr = (texte: string) => texte.replace(/\d{1,3}(?:,\d{3})+/g, (m) => montant(Number(m.replace(/,/g, ''))));
const de = (mot: string) => (/^[aeiouyhàâéèêëîïôöûü]/i.test(mot) ? `d’${mot}` : `de ${mot}`);

const lire = <T,>(cle: string, defaut: T): T => {
  try { const v = localStorage.getItem(cle); return v ? (JSON.parse(v) as T) : defaut; } catch { return defaut; }
};
const ecrire = (cle: string, v: unknown) => { try { localStorage.setItem(cle, JSON.stringify(v)); } catch { /* stockage indisponible */ } };

function Deconnexion({ vers }: { vers: string }) {
  const { deconnecter } = useSession();
  const naviguer = useNavigate();
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '4px 0' }}>
      <button type="button" className="lien-texte" onClick={async () => { await deconnecter(); naviguer(vers, { replace: true }); }}>Se déconnecter</button>
    </div>
  );
}

// ===================================================================== file d'attente du téléphone (hors ligne)

type StatutNote = 'present' | 'absent' | 'absent_justifie' | 'dispense';
type Presence = 'present' | 'absent' | 'retard';
interface NoteEnvoyee { inscriptionId: string; valeur: number | null; statut: StatutNote }
interface NotesEnAttente { cle: string; compteId: string; classeId: string; matiereId: string; sequenceId: string; libelle: string; notes: NoteEnvoyee[]; garde: string }
interface PresenceEnvoyee { inscriptionId: string; statut: Presence; retardMinutes: number | null }
interface AppelEnAttente { ficheId: string; compteId: string; libelle: string; presences: PresenceEnvoyee[]; garde: string }
interface Bilan { envoyees: string[]; horsLigne: boolean | null }

const CLE_NOTES = 'gs.notes.attente';
const CLE_APPEL = 'gs.appel.attente';
const CLE_SYNCHRO = 'gs.synchro.derniere';
const EVENEMENT = 'gs-synchro';

const horsReseau = (e: unknown) => e instanceof ErreurApi && (e.statut === 0 || e.code === 'RESEAU');
const compterNotes = (notes: NoteEnvoyee[]) => notes.filter((n) => n.valeur !== null || n.statut !== 'present').length;

function mettreEnAttente<T>(cle: string, entree: T, meme: (x: T) => boolean): boolean {
  ecrire(cle, [...lire<T[]>(cle, []).filter((x) => !meme(x)), entree]);
  return lire<T[]>(cle, []).some((x) => JSON.stringify(x) === JSON.stringify(entree));
}
function retirer<T>(cle: string, cible: (x: T) => boolean) { ecrire(cle, lire<T[]>(cle, []).filter((x) => !cible(x))); }

let enCours: Promise<Bilan> | null = null;
/** Envoie au serveur ce que le téléphone a gardé ; s'arrête au premier défaut de réseau (le reste attend). */
function synchroniser(compteId: string): Promise<Bilan> {
  if (enCours) return enCours;
  enCours = (async (): Promise<Bilan> => {
    const envoyees: string[] = [];
    let horsLigne: boolean | null = null;
    const arret = (e: unknown) => horsReseau(e) || (e instanceof ErreurApi && e.statut === 401);
    const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
    for (const x of lire<NotesEnAttente[]>(CLE_NOTES, []).filter((y) => y.compteId === compteId)) {
      const celleCi = (y: NotesEnAttente) => y.cle === x.cle && y.garde === x.garde;
      try {
        await api.put('/pedagogie/saisie', { classeId: x.classeId, matiereId: x.matiereId, sequenceId: x.sequenceId, notes: x.notes });
        retirer(CLE_NOTES, celleCi);
        envoyees.push(x.cle);
        horsLigne = false;
      } catch (e) {
        if (arret(e)) { horsLigne = horsReseau(e); break; }
        // Refus du serveur (règle de gestion) : la saisie reste à l'écran, l'instituteur corrige.
        retirer(CLE_NOTES, celleCi);
        signaler(`${x.libelle} : ${message(e)}`, true);
        horsLigne = false;
      }
    }
    if (horsLigne !== true) {
      for (const x of lire<AppelEnAttente[]>(CLE_APPEL, []).filter((y) => y.compteId === compteId)) {
        const celleCi = (y: AppelEnAttente) => y.ficheId === x.ficheId && y.garde === x.garde;
        try {
          await api.put(`/vie-scolaire/appel/${x.ficheId}`, { presences: x.presences });
          retirer(CLE_APPEL, celleCi);
          envoyees.push(`appel:${x.ficheId}`);
          horsLigne = false;
        } catch (e) {
          if (arret(e)) { horsLigne = horsReseau(e); break; }
          retirer(CLE_APPEL, celleCi);
          signaler(`${x.libelle} : ${message(e)}`, true);
          horsLigne = false;
        }
      }
    }
    if (envoyees.length) ecrire(CLE_SYNCHRO, new Date().toISOString());
    const bilan = { envoyees, horsLigne };
    window.dispatchEvent(new CustomEvent<Bilan>(EVENEMENT, { detail: bilan }));
    return bilan;
  })().finally(() => { enCours = null; });
  return enCours;
}

interface EtatSynchro { enLigne: boolean; notes: NotesEnAttente[]; appels: AppelEnAttente[]; derniere: string | null }
/** État du réseau et de la file ; au retour du réseau, la file part d'elle-même. */
function useSynchro(): EtatSynchro {
  const moi = useMoi();
  const [enLigne, setEnLigne] = useState(() => navigator.onLine);
  const [, setTour] = useState(0);
  useEffect(() => {
    const apres = (e: Event) => {
      const b = (e as CustomEvent<Bilan>).detail;
      if (b && b.horsLigne !== null) setEnLigne(!b.horsLigne);
      setTour((n) => n + 1);
    };
    const enligne = () => { setEnLigne(true); void synchroniser(moi.compteId); };
    const horsligne = () => setEnLigne(false);
    window.addEventListener(EVENEMENT, apres);
    window.addEventListener('online', enligne);
    window.addEventListener('offline', horsligne);
    const enAttente = () => lire<NotesEnAttente[]>(CLE_NOTES, []).some((x) => x.compteId === moi.compteId)
      || lire<AppelEnAttente[]>(CLE_APPEL, []).some((x) => x.compteId === moi.compteId);
    if (navigator.onLine && enAttente()) void synchroniser(moi.compteId);
    // Serveur de l'école injoignable sans perte du Wi-Fi (pas d'événement « online ») : nouvel essai toutes les 30 s.
    const essai = window.setInterval(() => { if (enAttente()) void synchroniser(moi.compteId); }, 30_000);
    return () => {
      window.removeEventListener(EVENEMENT, apres);
      window.removeEventListener('online', enligne);
      window.removeEventListener('offline', horsligne);
      window.clearInterval(essai);
    };
  }, [moi.compteId]);
  return {
    enLigne,
    notes: lire<NotesEnAttente[]>(CLE_NOTES, []).filter((x) => x.compteId === moi.compteId),
    appels: lire<AppelEnAttente[]>(CLE_APPEL, []).filter((x) => x.compteId === moi.compteId),
    derniere: lire<string | null>(CLE_SYNCHRO, null),
  };
}

/** Recharge l'écran quand la file envoie la saisie qu'il affiche. */
function useApresEnvoi(cle: string | null, recharger: () => void) {
  useEffect(() => {
    if (!cle) return;
    const f = (e: Event) => { if ((e as CustomEvent<Bilan>).detail?.envoyees.includes(cle)) recharger(); };
    window.addEventListener(EVENEMENT, f);
    return () => window.removeEventListener(EVENEMENT, f);
  }, [cle, recharger]);
}

function BandeSynchro({ synchro, quoi }: { synchro: EtatSynchro; quoi: 'notes' | 'appel' }) {
  const n = quoi === 'notes' ? synchro.notes.reduce((s, x) => s + compterNotes(x.notes), 0) : synchro.appels.length;
  const garde = n === 0 ? 'la saisie sera gardée sur le téléphone'
    : quoi === 'notes' ? `${pluriel(n, 'note gardée', 'notes gardées')} sur le téléphone` : `${pluriel(n, 'appel gardé', 'appels gardés')} sur le téléphone`;
  if (!synchro.enLigne) return <div className="m-bande attention" role="status"><Icone nom="horsLigne" taille={16} /><span>Hors ligne · {garde}</span></div>;
  if (synchro.notes.length + synchro.appels.length > 0) return <div className="m-bande attention" role="status"><Icone nom="recalculer" taille={16} /><span>Envoi en attente · {garde}</span></div>;
  if (synchro.derniere) {
    const quand = memeJour(synchro.derniere) ? `à ${heure(synchro.derniere)}` : `le ${jjmm(synchro.derniere)} à ${heure(synchro.derniere)}`;
    return <div className="m-bande succes" role="status"><Icone nom="recalculer" taille={16} /><span>Wi-Fi de l’école · synchronisation faite {quand}</span></div>;
  }
  return null;
}

// ===================================================================== instituteur : notes

interface Matiere { id: string; libelle: string; saisiePar: string }
interface ClasseSaisie { id: string; nom: string; matieres: Matiere[] }
interface Sequence { id: string; periodeId: string; libelle: string; type: string; statut: string; saisieJusqua: string | null }
interface EleveGrille { numero: number; inscriptionId: string; nom: string; valeur: number | null; statut: StatutNote; modifiable: boolean }
interface Grille { classe: string; matiere: string; bareme: number; modifiable: boolean; raison: string | null; eleves: EleveGrille[]; avancement: { matiereId: string; notes: number; total: number }[] }

const CLE_CHOIX = 'gs.instituteur.choix';
const STATUTS_NOTE: [StatutNote, string][] = [['present', 'Note'], ['absent', 'Absent'], ['absent_justifie', 'Absent justifié'], ['dispense', 'Dispensé']];
const libelleStatut = (s: StatutNote) => STATUTS_NOTE.find(([v]) => v === s)?.[1] ?? s;
const etatSaisie = (s: Sequence) => (s.statut === 'ouverte' ? `saisie ouverte${s.saisieJusqua ? ` jusqu’au ${jjmm(s.saisieJusqua)}` : ''}` : s.statut === 'a_venir' ? 'saisie à venir' : 'saisie fermée');

function EcranNotesInstituteur() {
  const [params, setParams] = useSearchParams();
  const { d, erreur, recharger } = useDonnees(async () => {
    const [options, courante] = await Promise.all([
      api.get<{ classes: ClasseSaisie[] }>('/pedagogie/saisie/options'),
      api.get<{ sequence: Sequence | null }>('/pedagogie/sequence-courante'),
    ]);
    return { classes: options.classes, sequence: courante.sequence };
  });
  const paires = useMemo(() => (d?.classes ?? []).flatMap((c) => c.matieres.map((m) => ({ classe: c, matiere: m }))), [d]);
  const voulu = params.get('classe') && params.get('matiere')
    ? { classeId: params.get('classe')!, matiereId: params.get('matiere')! }
    : lire<{ classeId: string; matiereId: string } | null>(CLE_CHOIX, null);
  const choisie = paires.find((p) => p.classe.id === voulu?.classeId && p.matiere.id === voulu?.matiereId) ?? (paires.length === 1 ? paires[0] : undefined);
  const choisir = (classeId: string, matiereId: string) => { ecrire(CLE_CHOIX, { classeId, matiereId }); setParams({ classe: classeId, matiere: matiereId }); };

  if (erreur || !d) {
    return <Mobile onglets={ONGLETS_INSTITUTEUR} actif="/instituteur/notes" titre="Notes">{erreur ? <Erreur message={erreur} recharger={recharger} /> : <Chargement />}</Mobile>;
  }
  if (!d.sequence) {
    return (
      <Mobile onglets={ONGLETS_INSTITUTEUR} actif="/instituteur/notes" titre="Notes">
        <Vide>Aucune séquence n’est ouverte pour l’instant : la saisie s’ouvrira avec la prochaine séquence.</Vide>
        <Deconnexion vers="/instituteur/connexion" />
      </Mobile>
    );
  }
  if (params.get('liste') === '1' || !choisie) return <ChoixClasse classes={d.classes} sequence={d.sequence} choisir={choisir} />;
  return (
    <GrilleNotes key={`${choisie.classe.id}|${choisie.matiere.id}|${d.sequence.id}`} classe={choisie.classe} matiere={choisie.matiere} sequence={d.sequence}
      retour={() => setParams({ liste: '1' })} />
  );
}

function ChoixClasse({ classes, sequence, choisir }: { classes: ClasseSaisie[]; sequence: Sequence; choisir: (classeId: string, matiereId: string) => void }) {
  const moi = useMoi();
  const synchro = useSynchro();
  // Une lecture de la grille d'une matière donne l'avancement de toutes les matières de la classe.
  const { d: avancement } = useDonnees(async () => {
    const res: Record<string, { notes: number; total: number }> = {};
    await Promise.all(classes.map(async (c) => {
      const m = c.matieres[0];
      if (!m) return;
      try {
        const g = await api.get<Grille>(`/pedagogie/saisie${requete({ classeId: c.id, matiereId: m.id, sequenceId: sequence.id })}`);
        for (const a of g.avancement) res[`${c.id}|${a.matiereId}`] = a;
      } catch { /* avancement indisponible : la liste reste utilisable */ }
    }));
    return res;
  }, [sequence.id, classes.map((c) => c.id).join()]);
  return (
    <Mobile onglets={ONGLETS_INSTITUTEUR} actif="/instituteur/notes" titre="Mes classes" sous={`${sequence.libelle} · ${etatSaisie(sequence)}`}
      bande={<BandeSynchro synchro={synchro} quoi="notes" />}>
      {classes.length === 0 && <Vide>Aucune classe ne vous est confiée cette année.</Vide>}
      {classes.map((c) => (
        <Fragment key={c.id}>
          <span className="etiquette">{c.nom}</span>
          <Carte serree>
            {c.matieres.map((m) => {
              const a = avancement?.[`${c.id}|${m.id}`];
              const autre = m.saisiePar !== 'Principal' && m.saisiePar !== moi.nom;
              const aller = () => choisir(c.id, m.id);
              return (
                <div key={m.id} className="m-ligne cliquable" role="button" tabIndex={0} onClick={aller} onKeyDown={touche(aller)}>
                  <div className="m-pile">
                    <span className="gras">{m.libelle}</span>
                    <span className="m-petit">{autre ? `Saisie par ${m.saisiePar}` : a ? `${pluriel(a.notes, 'note')} sur ${a.total}` : ' '}</span>
                  </div>
                  {!autre && a && a.total > 0 && a.notes >= a.total && <span className="pastille succes">Complet</span>}
                  <Chevron />
                </div>
              );
            })}
          </Carte>
        </Fragment>
      ))}
      <Deconnexion vers="/instituteur/connexion" />
    </Mobile>
  );
}

function GrilleNotes({ classe, matiere, sequence, retour }: { classe: ClasseSaisie; matiere: Matiere; sequence: Sequence; retour: () => void }) {
  const moi = useMoi();
  const synchro = useSynchro();
  const cle = `${classe.id}|${matiere.id}|${sequence.id}`;
  const { d, erreur, recharger } = useDonnees<Grille>(() => api.get(`/pedagogie/saisie${requete({ classeId: classe.id, matiereId: matiere.id, sequenceId: sequence.id })}`), [cle]);
  const [saisies, setSaisies] = useState<Record<string, string>>({});
  const [statuts, setStatuts] = useState<Record<string, StatutNote>>({});
  const [charge, setCharge] = useState(false);
  useApresEnvoi(cle, recharger);

  // Valeurs du serveur, recouvertes par ce que le téléphone garde encore pour cette grille.
  useEffect(() => {
    if (!d) return;
    const garde = lire<NotesEnAttente[]>(CLE_NOTES, []).find((x) => x.cle === cle && x.compteId === moi.compteId);
    const s: Record<string, string> = {};
    const st: Record<string, StatutNote> = {};
    for (const e of d.eleves) {
      const g = garde?.notes.find((n) => n.inscriptionId === e.inscriptionId);
      const valeur = g ? g.valeur : e.valeur;
      s[e.inscriptionId] = valeur === null || valeur === undefined ? '' : decimal(Number(valeur));
      st[e.inscriptionId] = g ? g.statut : e.statut;
    }
    setSaisies(s);
    setStatuts(st);
  }, [d, cle, moi.compteId]);

  const bareme = d?.bareme ?? 20;
  const statutDe = (e: EleveGrille) => statuts[e.inscriptionId] ?? e.statut;
  const enErreur = (e: EleveGrille) => {
    if (statutDe(e) !== 'present') return false;
    const t = (saisies[e.inscriptionId] ?? '').trim();
    if (!t) return false;
    const v = versDecimal(t);
    return v === null || v < 0 || v > bareme;
  };

  const enregistrer = async () => {
    if (!d || !d.modifiable || charge) return;
    const fautive = d.eleves.find((e) => e.modifiable && enErreur(e));
    if (fautive) { signaler(`Note de ${fautive.nom} : saisissez une note entre 0 et ${bareme} (RG-23).`, true); return; }
    const notes: NoteEnvoyee[] = d.eleves.filter((e) => e.modifiable).map((e) => {
      const statut = statutDe(e);
      const t = (saisies[e.inscriptionId] ?? '').trim();
      return { inscriptionId: e.inscriptionId, statut, valeur: statut === 'present' && t ? versDecimal(t) : null };
    }).filter((n) => {
      const e = d.eleves.find((x) => x.inscriptionId === n.inscriptionId)!;
      return n.valeur !== null || n.statut !== 'present' || e.valeur !== null || e.statut !== 'present';
    });
    if (!notes.length) { signaler('Aucune note à enregistrer.'); return; }
    const entree: NotesEnAttente = { cle, compteId: moi.compteId, classeId: classe.id, matiereId: matiere.id, sequenceId: sequence.id,
      libelle: `${d.classe} · ${d.matiere}`, notes, garde: new Date().toISOString() };
    setCharge(true);
    try {
      if (!mettreEnAttente(CLE_NOTES, entree, (x) => x.cle === cle && x.compteId === moi.compteId)) {
        // Stockage du téléphone indisponible : envoi direct.
        const r = await agir(() => api.put('/pedagogie/saisie', { classeId: classe.id, matiereId: matiere.id, sequenceId: sequence.id, notes }), 'Notes enregistrées.');
        if (r) void recharger();
        return;
      }
      const b = await synchroniser(moi.compteId);
      if (b.envoyees.includes(cle)) signaler('Notes enregistrées.');
      else if (b.horsLigne !== false) signaler(`Hors ligne : ${pluriel(compterNotes(notes), 'note gardée', 'notes gardées')} sur le téléphone, envoi au retour du réseau.`);
    } finally {
      setCharge(false);
    }
  };

  const changerStatut = async (e: EleveGrille) => {
    if (!d?.modifiable || !e.modifiable) return;
    const actuel = statutDe(e);
    const choix = await ouvrirFenetre<StatutNote>(e.nom, (fermer) => (
      <>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {STATUTS_NOTE.map(([s, l]) => (
            <Bouton key={s} pleine variante={actuel === s ? 'principal' : 'secondaire'} onClick={() => fermer(s)}>{s === 'present' ? 'Saisir une note' : l}</Bouton>
          ))}
        </div>
        <div className="pied"><Bouton onClick={() => fermer()}>Annuler</Bouton></div>
      </>
    ), 400);
    if (!choix) return;
    setStatuts((x) => ({ ...x, [e.inscriptionId]: choix }));
    if (choix !== 'present') setSaisies((x) => ({ ...x, [e.inscriptionId]: '' }));
  };

  // Entrée : passe à l'élève suivant (saisie rapide au clavier du téléphone).
  const suivant = (ev: KeyboardEvent<HTMLInputElement>) => {
    if (ev.key !== 'Enter') return;
    ev.preventDefault();
    const champs = Array.from(document.querySelectorAll<HTMLInputElement>('input[data-note]:not([readonly])'));
    const i = champs.indexOf(ev.currentTarget);
    if (i >= 0 && champs[i + 1]) champs[i + 1]!.focus();
    else ev.currentTarget.blur();
  };

  return (
    <Mobile onglets={ONGLETS_INSTITUTEUR} actif="/instituteur/notes" retour={retour}
      titre={`${d?.classe ?? classe.nom} · ${d?.matiere ?? matiere.libelle}`}
      sous={`${sequence.libelle}${sequence.type === 'composition' ? '' : ' · devoir'} sur ${bareme}`}
      bande={<BandeSynchro synchro={synchro} quoi="notes" />}
      pied={<Bouton variante="principal" pleine icone="coche" charge={charge} disabled={!d?.modifiable} onClick={enregistrer}>Enregistrer sur le téléphone</Bouton>}>
      {erreur ? <Erreur message={erreur} recharger={recharger} /> : !d ? <Chargement /> : (
        <>
          {!d.modifiable && d.raison && <Note ton="attention">{d.raison === 'Saisie fermée' ? 'Saisie fermée : un déverrouillage du préfet est nécessaire pour modifier ces notes.' : d.raison}</Note>}
          <Carte serree>
            {d.eleves.length === 0 && <span className="m-petit">Aucun élève inscrit dans cette classe.</span>}
            {d.eleves.map((e) => {
              const st = statutDe(e);
              const lecture = !d.modifiable || !e.modifiable;
              return (
                <div key={e.inscriptionId} style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 44, borderBottom: '1px solid var(--bord)' }}>
                  <button type="button" className="m-nom" aria-haspopup="dialog" disabled={lecture} onClick={() => void changerStatut(e)}>{e.nom}</button>
                  {st === 'present'
                    ? <input type="text" inputMode="decimal" enterKeyHint="next" data-note="" className={`champ m-note ${enErreur(e) ? 'erreur' : ''}`}
                        aria-label={`Note de ${e.nom}`} aria-invalid={enErreur(e) || undefined} readOnly={lecture} value={saisies[e.inscriptionId] ?? ''}
                        onChange={(ev) => { const v = ev.target.value; setSaisies((x) => ({ ...x, [e.inscriptionId]: v })); }} onKeyDown={suivant} />
                    : <button type="button" className={`pastille m-pastille-bouton ${st === 'absent' ? 'attention' : ''}`} disabled={lecture}
                        aria-label={`${e.nom} : ${libelleStatut(st)}`} onClick={() => void changerStatut(e)}>{libelleStatut(st)}</button>}
                </div>
              );
            })}
          </Carte>
        </>
      )}
    </Mobile>
  );
}

// ===================================================================== instituteur : appel

interface FicheAppel {
  id: string; classe: string; jour: string; debut: string; fin: string; libelle: string; statut: string; faiteLe: string | null; modifiable: boolean;
  eleves: { inscriptionId: string; nom: string; statut: Presence; retardMinutes: number | null }[];
}
const PRESENCES: [Presence, string, string][] = [['present', 'P', 'Présent'], ['absent', 'A', 'Absent'], ['retard', 'R', 'En retard']];

function EcranAppelInstituteur() {
  const moi = useMoi();
  const synchro = useSynchro();
  const { d, erreur, recharger } = useDonnees<{ fiche: FicheAppel | null }>(() => api.get('/vie-scolaire/appel/mobile'));
  const fiche = d?.fiche ?? null;
  const [statuts, setStatuts] = useState<Record<string, Presence>>({});
  const [charge, setCharge] = useState(false);
  useApresEnvoi(fiche ? `appel:${fiche.id}` : null, recharger);

  useEffect(() => {
    if (!fiche) return;
    const garde = lire<AppelEnAttente[]>(CLE_APPEL, []).find((x) => x.ficheId === fiche.id && x.compteId === moi.compteId);
    const s: Record<string, Presence> = {};
    for (const e of fiche.eleves) s[e.inscriptionId] = garde?.presences.find((p) => p.inscriptionId === e.inscriptionId)?.statut ?? e.statut;
    setStatuts(s);
  }, [fiche, moi.compteId]);

  const statutDe = (e: FicheAppel['eleves'][number]) => statuts[e.inscriptionId] ?? e.statut;
  const nombre = (p: Presence) => (fiche ? fiche.eleves.filter((e) => statutDe(e) === p).length : 0);

  const enregistrer = async () => {
    if (!fiche || !fiche.modifiable || charge) return;
    const presences: PresenceEnvoyee[] = fiche.eleves.map((e) => {
      const statut = statutDe(e);
      return { inscriptionId: e.inscriptionId, statut, retardMinutes: statut === 'retard' ? e.retardMinutes : null };
    });
    const entree: AppelEnAttente = { ficheId: fiche.id, compteId: moi.compteId, libelle: `${fiche.classe} · appel de ${fiche.debut}`, presences, garde: new Date().toISOString() };
    setCharge(true);
    try {
      if (!mettreEnAttente(CLE_APPEL, entree, (x) => x.ficheId === fiche.id && x.compteId === moi.compteId)) {
        const r = await agir(() => api.put(`/vie-scolaire/appel/${fiche.id}`, { presences }), 'Appel enregistré.');
        if (r) void recharger();
        return;
      }
      const b = await synchroniser(moi.compteId);
      if (b.envoyees.includes(`appel:${fiche.id}`)) signaler('Appel enregistré.');
      else if (b.horsLigne !== false) signaler('Hors ligne : appel gardé sur le téléphone, envoi au retour du réseau.');
    } finally {
      setCharge(false);
    }
  };

  return (
    <Mobile onglets={ONGLETS_INSTITUTEUR} actif="/instituteur/appel" retour="/instituteur/notes"
      titre={fiche ? `${fiche.classe} · appel` : 'Appel'}
      sous={fiche ? `${capitale(jourDate(fiche.jour))} · ${fiche.debut} – ${fiche.fin} · ${fiche.libelle}` : undefined}
      bande={<BandeSynchro synchro={synchro} quoi="appel" />}
      pied={fiche ? <Bouton variante="principal" pleine icone="coche" charge={charge} disabled={!fiche.modifiable} onClick={enregistrer}>Enregistrer l'appel</Bouton> : undefined}>
      {erreur ? <Erreur message={erreur} recharger={recharger} /> : !d ? <Chargement /> : !fiche ? (
        <Vide>Aucun appel à faire aujourd’hui : pas de cours prévu à votre emploi du temps.</Vide>
      ) : (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
            <span className="pastille succes">{pluriel(nombre('present'), 'présent')}</span>
            <span className="pastille danger">{pluriel(nombre('absent'), 'absent')}</span>
            <span className="pastille attention">{pluriel(nombre('retard'), 'retard')}</span>
          </div>
          {!fiche.modifiable && <Note ton="attention">Seul l’instituteur prévu à ce créneau fait l’appel (RG-38).</Note>}
          {fiche.statut === 'faite' && fiche.faiteLe && <span className="m-petit">Appel enregistré à {heure(isoNet(fiche.faiteLe))} ; une correction reste possible.</span>}
          <Carte serree>
            {fiche.eleves.map((e) => {
              const st = statutDe(e);
              return (
                <div key={e.inscriptionId} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '4px 0', borderBottom: '1px solid var(--bord)' }}>
                  <span style={{ flex: 1, minWidth: 0, fontWeight: 600, fontSize: 13 }}>{e.nom}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {PRESENCES.map(([p, lettre, libelle]) => (
                      <button key={p} type="button" className={`m-presence ${lettre.toLowerCase()}`} aria-label={`${e.nom} : ${libelle}`} aria-pressed={st === p}
                        disabled={!fiche.modifiable} onClick={() => setStatuts((x) => ({ ...x, [e.inscriptionId]: p }))}>{lettre}</button>
                    ))}
                  </div>
                </div>
              );
            })}
          </Carte>
        </>
      )}
    </Mobile>
  );
}

// ===================================================================== parent : connexion

const TEXTES_CONNEXION = {
  fr: { titre: 'Espace parents', sous: 'suivez les notes, les absences et les paiements de vos enfants.', telephone: 'Numéro de téléphone', motDePasse: 'Mot de passe',
    connecter: 'Se connecter', aide: 'Un seul compte par famille, créé à l’inscription. Le mot de passe figure sur la fiche remise par le secrétariat ; en cas d’oubli, demandez-en un nouveau à l’école.',
    appareils: 'Android, iPhone ou navigateur' },
  en: { titre: 'Parents’ area', sous: 'follow your children’s marks, absences and payments.', telephone: 'Phone number', motDePasse: 'Password',
    connecter: 'Sign in', aide: 'One account per family, created at registration. The password is on the sheet given by the school office; if you forget it, ask the school for a new one.',
    appareils: 'Android, iPhone or browser' },
};

function EcranConnexionParent() {
  const { connecterParent } = useSession();
  const naviguer = useNavigate();
  const [telephone, setTelephone] = useState('');
  const [motDePasse, setMotDePasse] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const [charge, setCharge] = useState(false);
  const [langue, setLangue] = useState<'fr' | 'en'>('fr');
  const [accueil, setAccueil] = useState<{ nomFr: string; nomEn: string } | null>(null);
  useEffect(() => { api.get('/auth/accueil').then(setAccueil).catch(() => undefined); }, []);
  const t = TEXTES_CONNEXION[langue];
  const valider = async () => {
    if (charge) return;
    setCharge(true);
    setErreur(null);
    try {
      await connecterParent(telephone.trim(), motDePasse);
      naviguer('/parent/accueil', { replace: true });
    } catch (e) {
      setErreur(e instanceof ErreurApi ? e.message : String(e));
    } finally {
      setCharge(false);
    }
  };
  const ecole = accueil ? (langue === 'en' ? accueil.nomEn : accueil.nomFr) : null;
  return (
    <div className="m-app">
      <StyleMobile />
      <div className="m-colonne m-connexion">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
          <div className="m-logo" aria-hidden="true" style={{ width: 56, height: 56, borderRadius: 17 }}><Icone nom="logo" taille={34} /></div>
          <h1 style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.01em' }}>{t.titre}</h1>
          <span className="doux">{ecole ? `${ecole} · ${t.sous}` : capitale(t.sous)}</span>
        </div>
        <Carte ecart={12}>
          <Champ libelle={t.telephone} type="tel" inputMode="tel" value={telephone} onChange={setTelephone} onEnter={valider} />
          <Champ libelle={t.motDePasse} type="password" value={motDePasse} onChange={setMotDePasse} onEnter={valider} erreur={erreur} />
          <Bouton variante="principal" pleine charge={charge} onClick={valider}>{t.connecter}</Bouton>
          <span className="m-petit">{t.aide}</span>
        </Carte>
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <Bascules options={[['fr', 'Français'], ['en', 'English']]} valeur={langue} onChange={setLangue} />
        </div>
        <span className="m-petit" style={{ textAlign: 'center' }}>{t.appareils}</span>
      </div>
    </div>
  );
}

// ===================================================================== parent : enfants

interface Enfant { eleveId: string; prenom: string; nom: string; classe: string }
const CLE_ENFANT = 'gs.parent.enfant';

/** Enfant affiché : celui de l'adresse, sinon le dernier consulté, sinon l'aîné. */
function useEnfant() {
  const { d: enfants, erreur, recharger } = useDonnees<Enfant[]>(() => api.get('/portail/enfants'));
  const [params, setParams] = useSearchParams();
  const voulu = params.get('eleve') ?? lire<string | null>(CLE_ENFANT, null);
  const choisi = enfants?.find((e) => e.eleveId === voulu) ?? enfants?.[0] ?? null;
  useEffect(() => { if (choisi) ecrire(CLE_ENFANT, choisi.eleveId); }, [choisi?.eleveId]);
  const choisir = (id: string) => {
    ecrire(CLE_ENFANT, id);
    const p = new URLSearchParams(params);
    p.set('eleve', id);
    setParams(p, { replace: true });
  };
  return { enfants, choisi, choisir, erreur, recharger };
}

function ChoixEnfant({ enfants, choisi, choisir }: { enfants: Enfant[] | null; choisi: Enfant | null; choisir: (id: string) => void }) {
  if (!enfants || enfants.length < 2) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {enfants.map((e) => (
        <button key={e.eleveId} type="button" className="m-choix" aria-pressed={e.eleveId === choisi?.eleveId} onClick={() => choisir(e.eleveId)}>{e.prenom} · {e.classe}</button>
      ))}
    </div>
  );
}

// ===================================================================== parent : accueil

interface AccueilParent {
  salutation: string; nonLus: number; alertes: string[]; nouvelles: { date: string; type: string; texte: string }[];
  enfants: { eleveId: string; nom: string; prenom: string; classe: string; resteDu: number; absences: number;
    prochaine: { montant: number; date: string; ligne: string; enRetard: boolean } | null;
    derniereNote: { matiere: string; valeur: number; bareme: number } | null }[];
}

function EcranAccueilParent() {
  const moi = useMoi();
  const naviguer = useNavigate();
  const { d, erreur, recharger } = useDonnees<AccueilParent>(() => api.get('/portail/accueil'));
  const echeance = (p: AccueilParent['enfants'][number]['prochaine']) =>
    !p ? 'Tout est payé' : p.enRetard ? `${fcfa(p.montant)} ${de(p.ligne.toLowerCase())}, en retard` : `${fcfa(p.montant)} avant le ${jjmm(p.date)}`;
  return (
    <Mobile onglets={ONGLETS_PARENT} actif="/parent/accueil" titre={d?.salutation ? `Bonjour, ${d.salutation}` : 'Bonjour'} sous={moi.etablissement}
      action={<Link to="/parent/messages" className="m-icone" aria-label="Messages et annonces"><Icone nom="messages" />{!!d?.nonLus && <span className="m-point" />}</Link>}>
      {erreur ? <Erreur message={erreur} recharger={recharger} /> : !d ? <Chargement /> : (
        <>
          <span className="etiquette">Vos enfants</span>
          {d.enfants.length === 0 && <Vide>Aucun enfant inscrit cette année.</Vide>}
          {d.enfants.map((e) => {
            const aller = () => naviguer(`/parent/notes?eleve=${e.eleveId}`);
            return (
              <section key={e.eleveId} className="m-carte cliquable" role="link" tabIndex={0} aria-label={`${e.nom} · ${e.classe}`} onClick={aller} onKeyDown={touche(aller)}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span className="m-avatar" aria-hidden="true">{initiale(e.prenom)}</span>
                  <div className="m-pile" style={{ gap: 0 }}><span className="gras">{e.nom}</span><span className="m-petit">{e.classe}</span></div>
                  <Chevron />
                </div>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                  <div className="m-pile" style={{ gap: 2 }}>
                    <span className="etiquette">Reste dû</span>
                    <span style={{ fontSize: 20, fontWeight: 700, color: e.resteDu > 0 ? 'var(--attention)' : 'var(--succes)' }}>{fcfa(e.resteDu)}</span>
                  </div>
                  <div className="m-pile" style={{ gap: 2 }}>
                    <span className="etiquette">Prochaine échéance</span>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{echeance(e.prochaine)}</span>
                  </div>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
                  {e.derniereNote && <span className="pastille accent"><Icone nom="notes" taille={13} />{e.derniereNote.matiere} : {decimal(e.derniereNote.valeur)} sur {e.derniereNote.bareme}</span>}
                  <span className="pastille"><Icone nom="vieScolaire" taille={13} />{e.absences > 0 ? pluriel(e.absences, 'demi-journée') : 'Aucune absence'}</span>
                </div>
              </section>
            );
          })}
          {d.alertes.map((a, i) => <Bandeau key={i} icone="bouclier" ton="attention">{a}</Bandeau>)}
          {d.nouvelles.length > 0 && (
            <>
              <span className="etiquette">Dernières nouvelles</span>
              <Carte serree>
                {d.nouvelles.map((n, i) => (
                  <div key={i} className="m-ligne">
                    <div className="m-pile"><span className="m-petit">{jjmm(isoNet(n.date))} · {n.type}</span><span style={{ fontSize: 13 }}>{montantsFr(n.texte)}</span></div>
                  </div>
                ))}
              </Carte>
            </>
          )}
          <Deconnexion vers="/parent/connexion" />
        </>
      )}
    </Mobile>
  );
}

// ===================================================================== parent : bulletin

interface ResultatBulletin {
  matieres: { matiereId: string; libelle: string; moyenne: number | null; appreciation: string | null }[];
  moyenne: number | null; rang: number | null; effectif: number;
  classe: { nom: string; moyenne: number | null };
  absences: { demiJournees: number; demiJourneesJustifiees: number };
  appreciationGenerale: string | null; principal: string | null; annee: string;
}
interface BulletinParent { prenom: string; classe: string; periode?: string; bulletin: ResultatBulletin | null; bloque: string | null }

const rang = (r: number | null) => (r === null ? '–' : r === 1 ? '1er' : `${r}e`);
function absencesBulletin(a: ResultatBulletin['absences']) {
  const n = a.demiJournees;
  const j = a.demiJourneesJustifiees;
  if (!n) return 'aucune';
  const accord = (mot: string, k: number) => `${mot}${k > 1 ? 's' : ''}`;
  return `${pluriel(n, 'demi-journée')}, ${j === n ? accord('justifiée', n) : j === 0 ? `non ${accord('justifiée', n)}` : `dont ${j} ${accord('justifiée', j)}`}`;
}

function EcranNotesParent() {
  const moi = useMoi();
  const { enfants, choisi, choisir, erreur: erreurEnfants, recharger: rechargerEnfants } = useEnfant();
  const id = choisi?.eleveId ?? null;
  const { d, erreur, recharger } = useDonnees<BulletinParent | null>(() => (id ? api.get(`/portail/enfants/${id}/bulletin`) : Promise.resolve(null)), [id]);
  const b = d?.bulletin ?? null;
  const periode = d?.periode === 'Annuel' ? 'bulletin annuel' : d?.periode;
  const sous = d && periode ? `${d.classe} · ${periode} ${b?.annee ?? moi.annee ?? ''} · publié` : choisi?.classe;
  return (
    <Mobile onglets={ONGLETS_PARENT} actif="/parent/notes" retour="/parent/accueil" titre={`Bulletin de ${d?.prenom ?? choisi?.prenom ?? ''}`.trim()} sous={sous}>
      {erreurEnfants ? <Erreur message={erreurEnfants} recharger={rechargerEnfants} /> : erreur ? <Erreur message={erreur} recharger={recharger} /> : !enfants || (id && !d) ? <Chargement /> : (
        <>
          <ChoixEnfant enfants={enfants} choisi={choisi} choisir={choisir} />
          {!choisi && <Vide>Aucun enfant inscrit cette année.</Vide>}
          {d?.bloque && <Bandeau icone="bouclier" ton="attention">{d.bloque}</Bandeau>}
          {d && !b && !d.bloque && <Vide>Aucun bulletin publié pour l’instant.</Vide>}
          {b && (
            <>
              <Carte>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div className="m-pile" style={{ gap: 2 }}>
                    <span className="etiquette">Moyenne générale</span>
                    <span style={{ fontSize: 26, fontWeight: 700 }}>{note2(b.moyenne)}<span style={{ fontSize: 13, fontWeight: 600, color: 'var(--doux)' }}> sur 20</span></span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                    <span className="etiquette">Rang</span>
                    <span style={{ fontSize: 26, fontWeight: 700 }}>{rang(b.rang)}<span style={{ fontSize: 13, fontWeight: 600, color: 'var(--doux)' }}> sur {b.effectif}</span></span>
                  </div>
                </div>
                <span className="m-petit">Moyenne de la classe : {note2(b.classe.moyenne)} · absences : {absencesBulletin(b.absences)}</span>
              </Carte>
              <Carte serree>
                {b.matieres.map((m) => (
                  <div key={m.matiereId} className="m-ligne">
                    <div className="m-pile" style={{ gap: 2 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'space-between' }}>
                        <span className="gras">{m.libelle}</span><span style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{decimal(m.moyenne)} / 20</span>
                      </div>
                      {m.appreciation && <span className="m-petit">{m.appreciation}</span>}
                    </div>
                  </div>
                ))}
              </Carte>
              {(b.appreciationGenerale || b.principal) && (
                <Carte>
                  <span className="etiquette">Appréciation générale</span>
                  {b.appreciationGenerale && <span style={{ fontSize: 13 }}>{b.appreciationGenerale}</span>}
                  {b.principal && <span className="m-petit">{b.principal}, instituteur principal</span>}
                </Carte>
              )}
            </>
          )}
          <span className="m-petit">Bulletin consultable à l’écran, sans téléchargement. Il s’affiche quand la tranche de la période est payée à 90 % au moins (100 % pour le bulletin de fin d’année).</span>
        </>
      )}
    </Mobile>
  );
}

// ===================================================================== parent : paiements

interface PaiementsParent {
  nom: string; classe: string; resteDu: number; verse: number; aPayer: number; banque: string | null; numeroCompte: string | null;
  lignes: { libelle: string; aPayer: number; reste: number; dateLimite: string; solde: boolean; reduction: string | null }[];
  recus: { id: string; numero: string; montant: number; date: string; modeLibelle: string | undefined }[];
}

function EcranPaiementsParent() {
  const { enfants, choisi, choisir, erreur: erreurEnfants, recharger: rechargerEnfants } = useEnfant();
  const id = choisi?.eleveId ?? null;
  const { d, erreur, recharger } = useDonnees<PaiementsParent | null>(() => (id ? api.get(`/portail/enfants/${id}/paiements`) : Promise.resolve(null)), [id]);
  const aujourdhui = aujourdhuiIso();
  const premiere = d?.lignes.findIndex((l) => !l.solde) ?? -1;
  const banque = d ? [d.banque, d.numeroCompte ? `compte ${d.numeroCompte}` : null].filter(Boolean).join(', ') : '';
  return (
    <Mobile onglets={ONGLETS_PARENT} actif="/parent/paiements" titre="Paiements" sous={d ? `${d.nom} · ${d.classe}` : choisi ? `${choisi.nom} · ${choisi.classe}` : undefined}>
      {erreurEnfants ? <Erreur message={erreurEnfants} recharger={rechargerEnfants} /> : erreur ? <Erreur message={erreur} recharger={recharger} /> : !enfants || (id && !d) ? <Chargement /> : (
        <>
          <ChoixEnfant enfants={enfants} choisi={choisi} choisir={choisir} />
          {!d && <Vide>Aucun enfant inscrit cette année.</Vide>}
          {d && (
            <>
              <Carte ecart={8}>
                <span className="etiquette">Reste dû</span>
                <span style={{ fontSize: 30, fontWeight: 700, lineHeight: 1.1, color: d.resteDu > 0 ? 'var(--attention)' : 'var(--succes)' }}>
                  {montant(d.resteDu)}<span style={{ fontSize: 13, fontWeight: 600, color: 'var(--doux)' }}> FCFA</span>
                </span>
                <div aria-hidden="true" style={{ height: 6, borderRadius: 3, background: 'var(--bord)', overflow: 'hidden' }}>
                  <div style={{ width: `${d.aPayer > 0 ? Math.min(100, (d.verse * 100) / d.aPayer) : 0}%`, height: '100%', borderRadius: 3, background: 'var(--accent)' }} />
                </div>
                <span className="m-petit">{montant(d.verse)} {d.verse > 1 ? 'versés' : 'versé'} sur {montant(d.aPayer)} FCFA</span>
              </Carte>
              <Carte serree>
                {d.lignes.map((l, i) => {
                  const urgent = i === premiere || l.dateLimite < aujourdhui;
                  return (
                    <div key={i} className="m-ligne" style={{ padding: '5px 0' }}>
                      <div className="m-pile">
                        <span className="gras">{l.libelle}</span>
                        {l.solde
                          ? <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--succes)' }}>Soldé{l.reduction ? ` · réduction ${l.reduction.toLowerCase()}` : ''}</span>
                          : <span style={{ fontSize: 12, fontWeight: 600, color: urgent ? 'var(--attention)' : 'var(--doux)' }}>Reste {montant(l.reste)} avant le {jjmmaaaa(l.dateLimite)}</span>}
                      </div>
                      <span style={{ fontWeight: 600 }}>{montant(l.aPayer)}</span>
                    </div>
                  );
                })}
              </Carte>
              <Carte serree>
                {d.recus.length === 0 && <span className="m-petit">Aucun versement pour l’instant.</span>}
                {d.recus.map((r) => (
                  <div key={r.id} className="m-ligne" style={{ padding: '2px 0' }}>
                    <div className="m-pile">
                      <span className="gras">{r.numero} · {fcfa(r.montant)}</span>
                      <span className="m-petit">{jjmmaaaa(isoNet(r.date))}{r.modeLibelle ? ` · ${r.modeLibelle}` : ''}</span>
                    </div>
                    <Link to={`/parent/recus/${r.id}?eleve=${id}`} className="bouton lien" aria-label="Voir le reçu"><span>Voir</span></Link>
                  </div>
                ))}
              </Carte>
              <Carte ecart={6}>
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
                  <span style={{ display: 'flex', color: 'var(--accent)' }}><Icone nom="banque" /></span><span className="gras">Comment payer</span>
                </div>
                <span style={{ fontSize: 13 }}>{banque ? `À la caisse de l’école, ou par versement à la banque : ${banque}. Gardez le bordereau.` : 'À la caisse de l’école. Gardez votre reçu.'}</span>
                <span className="m-petit">Aucun paiement ne se fait dans l’application.</span>
              </Carte>
            </>
          )}
        </>
      )}
    </Mobile>
  );
}

// ===================================================================== parent : reçu (à l'écran seulement, RG-35)

interface RecuParent {
  etablissement: { nom_fr: string; nom_en: string | null; ville_bp: string | null; telephone: string | null };
  numero: string; date: string; heure: string; eleve: string; matricule: string; classe: string; annee: string;
  lignes: { libelleFr: string; libelleEn: string; prix: number; reduction: number; aPayer: number; verse: number; reste: number; dateLimite: string }[];
  montant: number; montantLettresFr: string; montantLettresEn: string; modeFr: string; modeEn: string; bordereau: string | null; caissier: string; annule: boolean;
}

function EcranRecuParent() {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const { d, erreur, recharger } = useDonnees<RecuParent>(() => api.get(`/portail/recus/${id}`), [id]);
  const eleve = params.get('eleve');
  const champ = (libelle: string, valeur: string) => (
    <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}><span className="m-petit">{libelle}</span><span className="gras">{valeur}</span></div>
  );
  return (
    <Mobile onglets={ONGLETS_PARENT} actif="/parent/paiements" retour={`/parent/paiements${eleve ? `?eleve=${eleve}` : ''}`}
      titre={d ? `Reçu ${d.numero}` : 'Reçu'} sous={d ? `${d.date} à ${d.heure}` : undefined}>
      {erreur ? <Erreur message={erreur} recharger={recharger} /> : !d ? <Chargement /> : (
        <>
          {d.annule && <Bandeau icone="alerte" ton="attention">Ce versement a été annulé : le reçu n’a plus de valeur.</Bandeau>}
          <Carte ecart={0} style={{ padding: 0, overflow: 'hidden' }}>
            <div aria-hidden="true" style={{ height: 6, background: 'var(--accent)' }} />
            <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="m-pile" style={{ gap: 2 }}>
                <span style={{ fontWeight: 700 }}>{[d.etablissement.nom_fr, d.etablissement.nom_en].filter(Boolean).join(' · ').toUpperCase()}</span>
                {(d.etablissement.ville_bp || d.etablissement.telephone) && (
                  <span className="m-petit">{[d.etablissement.ville_bp, d.etablissement.telephone ? `Tél. ${d.etablissement.telephone}` : null].filter(Boolean).join(' · ')}</span>
                )}
              </div>
              <div className="m-pile" style={{ gap: 2 }}>
                <span className="etiquette">Reçu de paiement · Payment receipt</span>
                <span style={{ fontSize: 17, fontWeight: 700, color: 'var(--accent)' }}>N° {d.numero}</span>
                <span className="m-petit">{d.date} à {d.heure}</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 12px', padding: '8px 12px', border: '1px solid var(--bord-fort)', borderRadius: 6 }}>
                {champ('Élève / Student', d.eleve)}{champ('Matricule / Reg. no.', d.matricule)}{champ('Classe / Class', d.classe)}{champ('Année / Year', d.annee)}
              </div>
            </div>
          </Carte>
          <Carte serree>
            {d.lignes.map((l, i) => (
              <div key={i} className="m-ligne">
                <div className="m-pile">
                  <span className="gras">{l.libelleFr} / {l.libelleEn}</span>
                  <span className="m-petit">À payer {montant(l.aPayer)}{l.reduction > 0 ? ` (réduction ${montant(l.reduction)})` : ''} · versé {montant(l.verse)} · avant le {l.dateLimite}</span>
                </div>
                <span style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>Reste {montant(l.reste)}</span>
              </div>
            ))}
            <div className="m-ligne">
              <div className="m-pile"><span className="gras">Total</span>
                <span className="m-petit">À payer {montant(d.lignes.reduce((s, l) => s + l.aPayer, 0))} · versé {montant(d.lignes.reduce((s, l) => s + l.verse, 0))}</span></div>
              <span style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>Reste {montant(d.lignes.reduce((s, l) => s + l.reste, 0))}</span>
            </div>
          </Carte>
          <Carte ecart={6}>
            <span className="etiquette">Montant versé / Amount paid</span>
            <span style={{ fontSize: 24, fontWeight: 700 }}>{fcfa(d.montant)}</span>
            <span style={{ fontSize: 13 }}>{d.montantLettresFr} · {d.montantLettresEn}</span>
            <span className="m-petit">Mode / Method : {d.modeFr} / {d.modeEn}{d.bordereau ? ` · bordereau ${d.bordereau}` : ''}</span>
            <span className="m-petit">Encaissé par / Received by : {d.caissier}</span>
          </Carte>
          <span className="m-petit">Reçu consultable à l’écran, sans téléchargement.</span>
        </>
      )}
    </Mobile>
  );
}

// ===================================================================== parent : agenda

interface AgendaParent {
  prenom: string; nom: string; classe: string; jour: number; date: string;
  cours: { debut: string; fin: string; libelle: string; enseignant: string | null; principal: boolean }[];
  devoirs: { matiere: string; devoir: string; pour: string | null }[];
}
const JOURS_COURTS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
const JOURS_LONGS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

function pourLe(iso: string | null): string | null {
  const d = dateLocale(iso);
  if (!iso || !d) return null;
  const midi = new Date();
  midi.setHours(12, 0, 0, 0);
  const ecart = Math.round((d.getTime() - midi.getTime()) / 86_400_000);
  if (ecart === 0) return 'Pour aujourd’hui';
  if (ecart > 0 && ecart < 7) return `Pour ${JOURS_LONGS[d.getDay()]}`;
  return `Pour le ${jjmm(iso)}`;
}

function EcranAgendaParent() {
  const { enfants, choisi, choisir, erreur: erreurEnfants, recharger: rechargerEnfants } = useEnfant();
  const [params, setParams] = useSearchParams();
  const jourVoulu = Number(params.get('jour')) || null;
  const id = choisi?.eleveId ?? null;
  const { d, erreur, recharger } = useDonnees<AgendaParent | null>(
    () => (id ? api.get(`/portail/enfants/${id}/agenda${requete({ jour: jourVoulu })}`) : Promise.resolve(null)), [id, jourVoulu]);
  const jour = d?.jour ?? jourVoulu;
  const choisirJour = (j: number) => {
    const p = new URLSearchParams(params);
    p.set('jour', String(j));
    setParams(p, { replace: true });
  };
  return (
    <Mobile onglets={ONGLETS_PARENT} actif="/parent/agenda" titre="Agenda" sous={d ? `${d.nom} · ${jourDate(d.date)}` : choisi?.nom}>
      {erreurEnfants ? <Erreur message={erreurEnfants} recharger={rechargerEnfants} /> : (
        <>
          <ChoixEnfant enfants={enfants} choisi={choisi} choisir={choisir} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {JOURS_COURTS.map((j, i) => (
              <button key={j} type="button" className="m-choix" style={{ flex: 1, padding: 0 }} aria-pressed={jour === i + 1} onClick={() => choisirJour(i + 1)}>{j}</button>
            ))}
          </div>
          {erreur ? <Erreur message={erreur} recharger={recharger} /> : !enfants || (id && !d) ? <Chargement /> : !d ? <Vide>Aucun enfant inscrit cette année.</Vide> : (
            <>
              <Carte serree>
                {d.cours.length === 0 && <span className="m-petit">Aucun cours ce jour-là.</span>}
                {d.cours.map((c, i) => (
                  <div key={i} className="m-ligne">
                    <span style={{ flex: '0 0 96px', fontSize: 13, color: 'var(--doux)' }}>{c.debut} – {c.fin}</span>
                    <div className="m-pile" style={{ gap: 0 }}>
                      <span className="gras">{c.libelle}</span>
                      {c.enseignant && <span className="m-petit">{c.enseignant}{c.principal ? ', instituteur principal' : ''}</span>}
                    </div>
                  </div>
                ))}
              </Carte>
              <span className="etiquette">Devoirs à faire</span>
              <Carte serree>
                {d.devoirs.length === 0 && <span className="m-petit">Aucun devoir à faire pour l’instant.</span>}
                {d.devoirs.map((x, i) => {
                  const pour = pourLe(x.pour);
                  return (
                    <div key={i} className="m-ligne" style={{ padding: '4px 0' }}>
                      <div className="m-pile"><span className="gras">{x.matiere}</span><span style={{ fontSize: 13 }}>{x.devoir}</span></div>
                      {pour && <span className="pastille attention">{pour}</span>}
                    </div>
                  );
                })}
              </Carte>
            </>
          )}
        </>
      )}
    </Mobile>
  );
}

// ===================================================================== parent : messages

interface Evenement { type: string; prenom: string; date: string; texte: string; inscriptionId: string | null; jour: string | null; justifiable: boolean }
interface MessagesParent {
  famille: string;
  annonces: { id: string; titre: string; texteFr: string; texteEn: string | null; date: string; cible: string | null }[];
  evenements: Evenement[];
  conversations: { id: string; destinataire: string; nonLu: boolean; dernier: string | null; dernierAuteur: string | null; date: string }[];
}
interface Conversation { id: string; destinataire: string; sujet: string | null; messages: { auteurType: string; auteur: string; texte: string; envoyeLe: string }[] }
const DESTINATAIRES: Record<string, string> = { instituteur_principal: 'Instituteur principal', econome: 'Économe', directeur: 'Directeur', secretaire: 'Secrétariat' };
const horodatage = (s: string) => { const iso = isoNet(s); return memeJour(iso) ? heure(iso) : jjmm(iso); };

function FilConversation({ id, fermer, repondre }: { id: string; fermer: () => void; repondre: (destinataire: string) => void }) {
  const { d, erreur } = useDonnees<Conversation>(() => api.get(`/portail/conversations/${id}`), [id]);
  if (erreur) return <><Note ton="danger">{erreur}</Note><div className="pied"><Bouton onClick={fermer}>Fermer</Bouton></div></>;
  if (!d) return <Chargement />;
  return (
    <>
      {d.sujet && <span className="m-petit">{d.sujet}</span>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: '55vh', overflowY: 'auto' }}>
        {d.messages.map((m, i) => {
          const famille = m.auteurType === 'famille';
          const iso = isoNet(m.envoyeLe);
          return (
            <div key={i} className="m-bulle" style={{ alignSelf: famille ? 'flex-end' : 'flex-start', background: famille ? 'var(--accent-fond)' : 'var(--neutre-fond)' }}>
              <span style={{ whiteSpace: 'pre-wrap' }}>{m.texte}</span>
              <span className="m-petit">{famille ? 'Vous' : m.auteur} · {jjmm(iso)} à {heure(iso)}</span>
            </div>
          );
        })}
      </div>
      <div className="pied">
        <Bouton onClick={fermer}>Fermer</Bouton>
        <Bouton variante="principal" icone="messages" onClick={() => { fermer(); repondre(d.destinataire); }}>Répondre</Bouton>
      </div>
    </>
  );
}

function FormJustification({ ev, fermer }: { ev: Evenement; fermer: (ok?: boolean) => void }) {
  const [texte, setTexte] = useState('');
  const [charge, setCharge] = useState(false);
  const envoyer = async () => {
    if (texte.trim().length < 3) { signaler('Indiquez le motif de l’absence.', true); return; }
    setCharge(true);
    const r = await agir(() => api.post('/portail/absences/justification', { inscriptionId: ev.inscriptionId, jour: ev.jour, texte: texte.trim() }),
      'Demande envoyée au secrétariat.');
    setCharge(false);
    if (r) fermer(true);
  };
  return (
    <>
      <span className="m-petit">{ev.prenom} · absence du {jjmmaaaa(ev.jour)} ({ev.texte.split(' · ')[0]})</span>
      <Champ libelle="Motif de l’absence" lignes={4} value={texte} onChange={setTexte} />
      <span className="m-petit">La secrétaire reçoit la demande et décide de la justification ; un certificat peut vous être demandé.</span>
      <PiedFenetre fermer={() => fermer()} action="Envoyer" onAction={envoyer} charge={charge} />
    </>
  );
}

function EcranMessagesParent() {
  const moi = useMoi();
  const naviguer = useNavigate();
  const { d, erreur, recharger } = useDonnees<MessagesParent>(() => api.get('/portail/messages'));
  const lireAnnonce = (a: MessagesParent['annonces'][number]) => void ouvrirFenetre(a.titre, (fermer) => (
    <>
      <span className="m-petit">{jjmmaaaa(isoNet(a.date))}{a.cible ? ` · ${a.cible}` : ''}</span>
      <p style={{ whiteSpace: 'pre-wrap' }}>{a.texteFr}</p>
      {a.texteEn && <p className="doux" style={{ whiteSpace: 'pre-wrap' }}>{a.texteEn}</p>}
      <div className="pied"><Bouton onClick={() => fermer()}>Fermer</Bouton></div>
    </>
  ));
  const justifier = (ev: Evenement) => void ouvrirFormulaire<boolean>('Justifier une absence', ({ fermer }) => <FormJustification ev={ev} fermer={fermer} />, 440)
    .then((ok) => { if (ok) void recharger(); });
  const ouvrir = (c: MessagesParent['conversations'][number]) => void ouvrirFenetre(DESTINATAIRES[c.destinataire] ?? c.destinataire, (fermer) => (
    <FilConversation id={c.id} fermer={() => fermer()} repondre={(dest) => naviguer(`/parent/ecrire?destinataire=${dest}`)} />
  ));
  return (
    <Mobile onglets={ONGLETS_PARENT} actif="/parent/accueil" retour="/parent/accueil" titre="Messages" sous={d ? `Famille ${d.famille}` : moi.nom}>
      {erreur ? <Erreur message={erreur} recharger={recharger} /> : !d ? <Chargement /> : (
        <>
          <span className="etiquette">Annonces</span>
          <Carte serree>
            {d.annonces.length === 0 && <span className="m-petit">Aucune annonce pour l’instant.</span>}
            {d.annonces.map((a) => (
              <div key={a.id} className="m-ligne cliquable" role="button" tabIndex={0} onClick={() => lireAnnonce(a)} onKeyDown={touche(() => lireAnnonce(a))}>
                <div className="m-pile">
                  <span className="m-petit">{jjmm(isoNet(a.date))}{a.cible ? ` · ${a.cible}` : ''}</span>
                  <span style={{ fontWeight: 600, fontSize: 13 }}>{a.titre}</span>
                </div>
              </div>
            ))}
          </Carte>
          <span className="etiquette">Absences et observations</span>
          <Carte serree>
            {d.evenements.length === 0 && <span className="m-petit">Aucune absence ni observation.</span>}
            {d.evenements.map((ev, i) => (
              <div key={i} className="m-ligne" style={{ padding: '6px 0' }}>
                <div className="m-pile" style={{ gap: 3 }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
                    <span className={`pastille ${ev.type === 'Félicitations' ? 'succes' : 'attention'}`}>{ev.type}</span><span className="gras">{ev.prenom}</span>
                  </div>
                  <span className="m-petit">{jjmm(isoNet(ev.date))} · {ev.texte}</span>
                </div>
                {ev.justifiable && ev.inscriptionId && ev.jour && <button type="button" className="bouton lien" onClick={() => justifier(ev)}><span>Justifier</span></button>}
              </div>
            ))}
          </Carte>
          <span className="etiquette">Messagerie</span>
          <Carte ecart={8}>
            {d.conversations.map((c) => (
              <div key={c.id} className="m-ligne cliquable" style={{ padding: '6px 0' }} role="button" tabIndex={0} onClick={() => ouvrir(c)} onKeyDown={touche(() => ouvrir(c))}>
                <div className="m-pile">
                  <span className="gras" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {DESTINATAIRES[c.destinataire] ?? c.destinataire}
                    {c.nonLu && <span aria-label="Non lu" style={{ width: 8, height: 8, borderRadius: 4, background: 'var(--accent)' }} />}
                  </span>
                  {c.dernier && <span className="m-petit m-deux-lignes">{c.dernierAuteur === 'famille' ? 'Vous : ' : ''}«{' '}{c.dernier}{' '}»</span>}
                </div>
                <span className="m-petit">{horodatage(c.date)}</span>
              </div>
            ))}
            <Link to="/parent/ecrire" className="bouton pleine"><Icone nom="messages" /><span>Écrire à l’école</span></Link>
          </Carte>
        </>
      )}
    </Mobile>
  );
}

// ===================================================================== parent : écrire à l'école (RG-42 : un seul destinataire)

interface Destinataire { code: string; role: string; nom: string; aide: string }

function EcranEcrireParent() {
  const moi = useMoi();
  const naviguer = useNavigate();
  const [params] = useSearchParams();
  const { d: enfants, erreur, recharger } = useDonnees<Enfant[]>(() => api.get('/portail/enfants'));
  const [eleveId, setEleveId] = useState<string | null>(() => params.get('eleve') ?? lire<string | null>(CLE_ENFANT, null));
  const eleve = enfants?.find((e) => e.eleveId === eleveId) ?? enfants?.[0] ?? null;
  const { d: destinataires } = useDonnees<Destinataire[] | null>(
    () => (eleve ? api.get(`/portail/destinataires${requete({ eleveId: eleve.eleveId })}`) : Promise.resolve(null)), [eleve?.eleveId]);
  const [code, setCode] = useState(params.get('destinataire') ?? 'instituteur_principal');
  const [texte, setTexte] = useState('');
  const [charge, setCharge] = useState(false);
  const envoyer = async () => {
    if (!eleve || charge) return;
    if (texte.trim().length < 2) { signaler('Écrivez votre message.', true); return; }
    setCharge(true);
    const r = await agir(() => api.post('/portail/messages', { destinataire: code, eleveId: eleve.eleveId, texte: texte.trim() }), 'Message envoyé.');
    setCharge(false);
    if (r) naviguer('/parent/messages');
  };
  return (
    <Mobile onglets={ONGLETS_PARENT} actif="/parent/accueil" retour="/parent/messages" titre="Écrire à l’école" sous={moi.nom}>
      {erreur ? <Erreur message={erreur} recharger={recharger} /> : !enfants ? <Chargement /> : !eleve ? <Vide>Aucun enfant inscrit cette année.</Vide> : (
        <>
          <span className="etiquette">À qui écrivez-vous ?</span>
          <Carte serree>
            {!destinataires ? <Chargement /> : destinataires.map((x) => (
              <label key={x.code} className="m-radio">
                <input type="radio" name="destinataire" checked={code === x.code} onChange={() => setCode(x.code)} />
                <div className="m-pile">
                  <span className="gras">{x.role}</span>
                  {x.nom && <span className="m-petit">{x.nom}</span>}
                  <span style={{ fontSize: 12 }}>{x.aide}</span>
                </div>
              </label>
            ))}
          </Carte>
          <Liste libelle="Au sujet de" value={eleve.eleveId} options={enfants.map((e) => [e.eleveId, `${e.prenom} · ${e.classe}`] as [string, string])} onChange={(v) => setEleveId(v)} />
          <Champ libelle="Votre message" lignes={4} value={texte} onChange={setTexte} />
          <Bouton variante="principal" pleine icone="envoyer" charge={charge} onClick={envoyer}>Envoyer</Bouton>
          <span className="m-petit">Seul le destinataire choisi lit votre message. Réponse dans l’application et par SMS.</span>
        </>
      )}
    </Mobile>
  );
}

export const routes: RouteEcran[] = [
  { path: '/instituteur/notes', element: <EcranNotesInstituteur /> },
  { path: '/instituteur/appel', element: <EcranAppelInstituteur /> },
  { path: '/parent/connexion', element: <EcranConnexionParent /> },
  { path: '/parent/accueil', element: <EcranAccueilParent /> },
  { path: '/parent/notes', element: <EcranNotesParent /> },
  { path: '/parent/paiements', element: <EcranPaiementsParent /> },
  { path: '/parent/recus/:id', element: <EcranRecuParent /> },
  { path: '/parent/agenda', element: <EcranAgendaParent /> },
  { path: '/parent/messages', element: <EcranMessagesParent /> },
  { path: '/parent/ecrire', element: <EcranEcrireParent /> },
];
