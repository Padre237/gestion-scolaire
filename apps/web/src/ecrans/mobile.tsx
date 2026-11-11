// Applications mobiles installables (PWA), maquettes Mobile-enseignant-* et Mobile-parent-* :
// - instituteur : saisie des notes et appel, utilisables hors ligne (file d'attente sur le téléphone, envoi au retour du réseau) ;
// - parent : accueil, bulletin, paiements, reçu, agenda, messages, écrire à l'école.
// Le serveur reste seul juge : la famille ne voit que ses enfants, à l'écran, sans téléchargement (RG-35), le bulletin
// sous condition de paiement (RG-40) ; l'instituteur ne saisit que ses matières (RG-22) et ses créneaux d'appel (RG-38).
//
// Mise en page : une colonne sur téléphone (fidèle aux maquettes à 390 px) ; à partir de 700 px (tablette portrait) les
// écrans passent en deux colonnes ; à partir de 900 px (tablette paysage) la barre d'onglets devient un rail latéral gauche.
import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { RouteEcran } from '../App.tsx';
import { api, ErreurApi, requete } from '../core/api.ts';
import { useMoi, useSession } from '../core/session.tsx';
import { aujourdhuiIso, dateLocale, decimal, fcfa, heure, initiale, jjmm, jjmmaaaa, jourDate, montant, note2, pluriel, versDecimal } from '../core/format.ts';
import { agir, Bandeau, Bascules, Bouton, Champ, Chargement, Erreur, Icone, Liste, Note, ouvrirFenetre, ouvrirFormulaire, PiedFenetre, signaler, useDonnees } from '../core/ui.tsx';
import type { NomIcone } from '../core/icones-traces.ts';

// ===================================================================== présentation commune (maquettes mobiles)

const LARGE = 700; // tablette portrait : deux colonnes
const RAIL = 900; // tablette paysage : rail latéral

const CSS = `
.m-app { min-height: 100vh; min-height: 100dvh; display: flex; justify-content: center; }
.m-app :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.m-app .champ:focus-visible { outline-offset: 1px; }
.m-app .champ, .m-app textarea.champ, .m-app select.champ { font-size: 16px; }
.m-colonne { position: relative; width: 100%; height: 100vh; height: 100dvh; display: flex; flex-direction: column; background: var(--fond); overflow: hidden; padding-bottom: var(--m-clavier, 0px); }
.m-colonne.m-connexion { height: auto; min-height: 100vh; min-height: 100dvh; max-width: 560px; overflow: visible; justify-content: center;
  padding: calc(40px + env(safe-area-inset-top)) max(24px, env(safe-area-inset-right)) calc(32px + env(safe-area-inset-bottom)) max(24px, env(safe-area-inset-left)); gap: 22px; }
.m-principal { order: 1; flex: 1; min-height: 0; min-width: 0; display: flex; flex-direction: column; }
.m-entete { flex: none; padding: 12px max(16px, env(safe-area-inset-right)) 12px max(16px, env(safe-area-inset-left)); padding-top: calc(12px + env(safe-area-inset-top)); background: var(--panneau); border-bottom: 1px solid var(--bord); }
.m-entete-int { display: flex; align-items: center; gap: 10px; width: 100%; max-width: 1040px; margin: 0 auto; min-height: 44px; }
.m-entete h1 { margin: 0; font-size: 17px; font-weight: 700; line-height: 1.25; }
.m-titre { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.m-titre > span { font-size: 12px; color: var(--doux); }
.m-logo { flex: none; width: 40px; height: 40px; border-radius: 12px; background: var(--eclat); color: #0B1F4B; display: flex; align-items: center; justify-content: center; }
.m-icone { flex: none; position: relative; display: flex; align-items: center; justify-content: center; gap: 2px; min-width: 44px; height: 44px; padding: 0; border-radius: 10px; border: 1px solid var(--bord-fort); background: var(--panneau); color: var(--texte); font: inherit; font-weight: 600; cursor: pointer; text-decoration: none; }
.m-icone:hover { background: var(--neutre-fond); }
.m-retour-texte { display: none; }
@media (min-width: 460px) { .m-retour { padding: 0 14px 0 8px; } .m-retour-texte { display: inline; } }
.m-compteur { position: absolute; top: -6px; right: -6px; min-width: 20px; height: 20px; padding: 0 5px; border-radius: 10px; background: var(--accent); color: var(--sur-accent); font-size: 11px; font-weight: 700; display: flex; align-items: center; justify-content: center; border: 2px solid var(--panneau); }
.m-bande { flex: none; display: flex; align-items: center; gap: 8px; padding: 8px max(16px, env(safe-area-inset-right)) 8px max(16px, env(safe-area-inset-left)); font-size: 13px; font-weight: 600; }
.m-bande.attention { background: var(--attention-fond); }
.m-bande.attention .icone { color: var(--attention); }
.m-bande.succes { background: var(--succes-fond); }
.m-bande.succes .icone { color: var(--succes); }
.m-contenu { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; scroll-padding-bottom: 96px; -webkit-overflow-scrolling: touch;
  padding: 16px max(16px, env(safe-area-inset-right)) 28px max(16px, env(safe-area-inset-left)); display: flex; flex-direction: column; gap: 14px; }
.m-contenu > *, .m-deux > *, .m-col > * { flex-shrink: 0; }
.m-pied { flex: none; display: flex; justify-content: center; padding: 10px max(16px, env(safe-area-inset-right)) 10px max(16px, env(safe-area-inset-left)); background: var(--panneau); border-top: 1px solid var(--bord); }
.m-pied > * { max-width: 1040px; }
.m-onglets { order: 2; flex: none; display: flex; justify-content: center; background: var(--panneau); border-top: 1px solid var(--bord); padding: 0 env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left); }
.m-onglets a { position: relative; flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; min-height: 60px; padding: 6px 4px; text-decoration: none; font-size: 11px; font-weight: 600; color: var(--doux); }
.m-onglets a:hover { color: var(--texte); }
.m-onglets a.actif { color: var(--accent); }
.m-onglets a.actif::before { content: ''; position: absolute; top: -1px; left: 22%; right: 22%; height: 3px; border-radius: 0 0 3px 3px; background: var(--accent); }
.m-rail-logo { display: none; }
.m-carte { position: relative; flex: none; background: var(--panneau); border: 1px solid var(--bord); border-radius: 12px; box-shadow: var(--ombre); padding: 14px; display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.m-carte.serree { gap: 0; }
.m-carte.cliquable { cursor: pointer; }
.m-carte.cliquable:hover { border-color: var(--bord-fort); }
.m-vide { display: flex; align-items: center; gap: 10px; color: var(--doux); font-size: 13px; }
.m-vide .icone { color: var(--doux); }
.m-ligne { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; min-height: 44px; padding: 8px 0; border-bottom: 1px solid var(--bord); }
.m-ligne.cliquable { cursor: pointer; }
.m-ligne.cliquable:hover .gras, .m-ligne.cliquable:hover > span[style] { color: var(--accent); }
.m-pile { display: flex; flex-direction: column; gap: 1px; min-width: 0; flex: 1; }
.m-petit { font-size: 12px; color: var(--doux); }
.m-deux-lignes { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.m-avatar { flex: none; display: flex; align-items: center; justify-content: center; width: 40px; height: 40px; border-radius: 11px; background: var(--champ); border: 1px solid var(--bord-fort); font-size: 16px; font-weight: 700; }
.m-choix { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 44px; padding: 0 14px; border-radius: 8px; font: inherit; font-weight: 600; cursor: pointer; white-space: nowrap; border: 1px solid var(--bord-fort); background: var(--panneau); color: var(--texte); }
.m-choix[aria-pressed='true'] { border-color: var(--accent); background: var(--accent-fond); color: var(--accent); }
.m-choix .m-avatar { width: 28px; height: 28px; border-radius: 8px; font-size: 13px; }
.m-jours { display: flex; align-items: center; gap: 6px; }
.m-jours .m-choix { flex: 1 1 0; min-width: 0; padding: 0; flex-direction: column; gap: 0; line-height: 1.1; }
.m-jours .m-choix small { font-size: 10px; font-weight: 600; color: var(--doux); }
.m-jours .m-choix[aria-pressed='true'] small { color: var(--accent); }
.m-eleves { display: flex; flex-direction: column; }
.m-rang { display: flex; align-items: center; gap: 12px; min-height: 56px; padding: 4px 0; border-bottom: 1px solid var(--bord); }
.m-nom { flex: 1; min-width: 0; min-height: 48px; display: flex; align-items: center; padding: 0 4px 0 0; border: 0; border-radius: 8px; background: none; color: inherit; font: inherit; font-weight: 600; text-align: left; cursor: pointer; }
.m-nom:not(:disabled):hover { background: var(--neutre-fond); }
.m-nom:not(:disabled):active { background: var(--accent-fond); }
.m-nom:disabled { cursor: default; }
.m-nom .m-petit { font-weight: 500; }
.m-note { flex: none; width: 76px; height: 44px; padding: 0 10px; text-align: right; font-weight: 600; }
.m-note[readonly] { color: var(--doux); }
.m-statut { flex: none; min-height: 44px; min-width: 76px; padding: 0 12px; border-radius: 8px; border: 1px solid var(--bord-fort); background: var(--panneau); color: var(--texte); font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; white-space: nowrap; }
.m-statut.absent { border-color: var(--attention-bord); background: var(--attention-fond); color: var(--attention); }
.m-statut.absent_justifie { border-color: var(--bord-fort); background: var(--neutre-fond); color: var(--texte); }
.m-statut.dispense { border-color: var(--accent-bord); background: var(--accent-fond); color: var(--accent); }
.m-statut:disabled { cursor: default; }
.m-presences { display: flex; align-items: center; gap: 8px; }
.m-presence { width: 48px; height: 48px; border-radius: 10px; font: inherit; font-size: 16px; font-weight: 700; cursor: pointer; border: 1px solid var(--bord-fort); background: var(--panneau); color: var(--doux); }
.m-presence:not(:disabled):hover { background: var(--neutre-fond); }
.m-presence.p[aria-pressed='true'] { border-color: var(--succes); background: var(--succes); color: var(--panneau); }
.m-presence.a[aria-pressed='true'] { border-color: var(--danger); background: var(--danger); color: var(--panneau); }
.m-presence.r[aria-pressed='true'] { border-color: var(--attention); background: var(--attention); color: var(--panneau); }
.m-presence:disabled { cursor: default; opacity: 0.7; }
.m-radio { position: relative; display: flex; align-items: flex-start; gap: 12px; min-height: 56px; padding: 12px 10px; margin: 0 -4px; border-radius: 10px; border: 1px solid transparent; cursor: pointer; }
.m-radio + .m-radio { margin-top: 2px; }
.m-radio:hover { background: var(--neutre-fond); }
.m-radio input { position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; opacity: 0; cursor: pointer; }
.m-rond { flex: none; width: 22px; height: 22px; margin-top: 1px; border-radius: 50%; border: 2px solid var(--doux); background: var(--panneau); display: flex; align-items: center; justify-content: center; }
.m-radio input:checked ~ .m-rond { border-color: var(--accent); }
.m-radio input:checked ~ .m-rond::after { content: ''; width: 10px; height: 10px; border-radius: 50%; background: var(--accent); }
.m-radio:has(input:checked) { background: var(--accent-fond); border-color: var(--accent-bord); }
.m-radio input:focus-visible ~ .m-rond { outline: 2px solid var(--accent); outline-offset: 2px; }
.m-bulle { max-width: 85%; padding: 8px 12px; border-radius: 10px; display: flex; flex-direction: column; gap: 2px; }
.m-deconnexion { min-height: 44px; padding: 0 16px; border-radius: 8px; }
.m-erreur { font-size: 13px; font-weight: 600; color: var(--danger); }
.m-sr { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
.m-grille-classes { display: grid; grid-template-columns: minmax(0, 1fr); gap: 14px; }
.m-classe { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.m-deux, .m-deux > .m-col { display: contents; }
.m-semaine { display: grid; gap: 12px; grid-template-columns: minmax(0, 1fr); }
.m-jour-col { display: flex; flex-direction: column; gap: 0; }
.m-jour-col h2 { margin: 0 0 6px; font-size: 13px; font-weight: 700; display: flex; align-items: baseline; gap: 6px; }
.m-jour-col h2 span { font-size: 12px; font-weight: 500; color: var(--doux); }
.m-jour-col.aujourdhui h2 { color: var(--accent); }
.m-cours { display: flex; flex-direction: column; gap: 0; padding: 6px 0; border-bottom: 1px solid var(--bord); font-size: 13px; }
.m-cours .m-petit { font-size: 11px; }
.m-tableau { width: 100%; border-collapse: collapse; font-size: 13px; }
.m-tableau th { text-align: left; padding: 6px 8px; font-size: 11px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--doux); border-bottom: 1px solid var(--bord-fort); }
.m-tableau td { padding: 8px; border-bottom: 1px solid var(--bord); vertical-align: top; }
.m-tableau .num { text-align: right; white-space: nowrap; }
.m-tableau tfoot td { font-weight: 700; border-bottom: 0; }
body:has(.m-app) .messages-flottants { bottom: calc(84px + env(safe-area-inset-bottom)); }

/* Téléphone : le tableau du reçu s'empile ligne par ligne (lisible à 360 px). */
@media (max-width: ${LARGE - 1}px) {
  .m-tableau thead { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
  .m-tableau, .m-tableau tbody, .m-tableau tfoot { display: block; }
  .m-tableau tr { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 12px; padding: 10px 0; border-bottom: 1px solid var(--bord); }
  .m-tableau tfoot tr { border-bottom: 0; }
  .m-tableau td { display: flex; flex-direction: column; padding: 0; border: 0; }
  .m-tableau td.libelle { grid-column: 1 / -1; font-weight: 600; }
  .m-tableau td::before { content: attr(data-l); font-size: 11px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--doux); }
  .m-tableau td.libelle::before { display: none; }
  .m-tableau .num { text-align: left; }
  .m-cache-petit { display: none !important; }
}

/* Tablette portrait (≥ 700 px) : deux colonnes, contenu centré sur 1040 px au plus, onglets plus larges. */
@media (min-width: ${LARGE}px) {
  .m-cache-large { display: none !important; }
  .m-entete, .m-bande, .m-contenu, .m-pied { padding-left: max(24px, env(safe-area-inset-left)); padding-right: max(24px, env(safe-area-inset-right)); }
  .m-entete h1 { font-size: 19px; }
  .m-titre > span { font-size: 13px; }
  .m-contenu { padding-top: 20px; gap: 16px; }
  .m-contenu > * { width: 100%; max-width: 1040px; margin-left: auto; margin-right: auto; }
  .m-pied > * { max-width: 1040px; }
  .m-onglets a { flex: 0 1 200px; flex-direction: row; gap: 8px; font-size: 13px; }
  .m-onglets a.actif::before { left: 12%; right: 12%; }
  .m-carte { padding: 16px; }
  .m-deux { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 16px 20px; align-items: start; }
  .m-deux.droite-large { grid-template-columns: minmax(0, 2fr) minmax(0, 3fr); }
  .m-deux > .m-col { display: flex; flex-direction: column; gap: 14px; min-width: 0; }
  .m-grille-classes { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px 20px; align-items: start; }
  .m-grille-classes > .m-classe:only-child { grid-column: 1 / -1; }
  .m-grille-classes > .m-classe:only-child .m-carte { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); column-gap: 32px; grid-auto-flow: column; grid-template-rows: repeat(var(--m-lignes, 1), auto); }
  .m-eleves { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); column-gap: 32px; grid-auto-flow: column; grid-template-rows: repeat(var(--m-lignes, 1), auto); }
  .m-rang { min-height: 60px; }
  .m-presence { width: 52px; height: 52px; }
  .m-semaine { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px 18px; }
}
@media (min-width: 1200px) { .m-semaine { grid-template-columns: repeat(6, minmax(0, 1fr)); } }

/* Tablette paysage (≥ 900 px) : la barre d'onglets devient un rail latéral avec icônes et libellés. */
@media (min-width: ${RAIL}px) {
  .m-colonne { flex-direction: row; }
  .m-onglets { order: 0; flex-direction: column; justify-content: flex-start; gap: 4px; width: 224px; border-top: 0; border-right: 1px solid var(--bord);
    padding: calc(20px + env(safe-area-inset-top)) 12px calc(20px + env(safe-area-inset-bottom)) max(12px, env(safe-area-inset-left)); }
  .m-onglets a { flex: none; flex-direction: row; justify-content: flex-start; gap: 12px; min-height: 48px; padding: 0 12px; border-radius: 10px; font-size: 14px; border: 1px solid transparent; color: var(--texte); }
  .m-onglets a .icone { color: var(--doux); }
  .m-onglets a:hover:not(.actif) { background: var(--neutre-fond); }
  .m-onglets a.actif { background: var(--accent-fond); border-color: var(--accent-bord); color: var(--accent); }
  .m-onglets a.actif .icone { color: var(--accent); }
  .m-onglets a.actif::before { display: none; }
  .m-rail-logo { display: flex; align-items: center; gap: 10px; padding: 0 4px 18px; min-width: 0; }
  .m-rail-logo .m-pile { gap: 0; }
  .m-rail-logo strong { font-size: 15px; }
  .m-entete .m-logo { display: none; }
  .m-entete { padding-left: max(28px, env(safe-area-inset-left)); padding-right: max(28px, env(safe-area-inset-right)); }
  .m-contenu, .m-pied, .m-bande { padding-left: max(28px, env(safe-area-inset-left)); padding-right: max(28px, env(safe-area-inset-right)); }
}

@media (prefers-reduced-motion: reduce) {
  .m-app *, .m-app *::before, .m-app *::after { animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; transition-duration: 0.01ms !important; scroll-behavior: auto !important; }
  .m-app .chargement span { border-color: var(--accent); border-top-color: var(--accent-fond); }
}
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

/** Clavier virtuel (iPhone surtout) : la zone visible rétrécit sans que la page le sache ; on réserve la place en bas. */
function useClavier(ref: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const maj = () => {
      const cache = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      ref.current?.style.setProperty('--m-clavier', `${cache > 80 ? Math.round(cache) : 0}px`);
    };
    maj();
    vv.addEventListener('resize', maj);
    vv.addEventListener('scroll', maj);
    return () => { vv.removeEventListener('resize', maj); vv.removeEventListener('scroll', maj); };
  }, [ref]);
}

/** Vrai au-dessus de la largeur donnée (tablette). */
function useLarge(min = LARGE): boolean {
  const [large, setLarge] = useState(() => window.matchMedia(`(min-width: ${min}px)`).matches);
  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${min}px)`);
    const f = () => setLarge(mq.matches);
    mq.addEventListener('change', f);
    return () => mq.removeEventListener('change', f);
  }, [min]);
  return large;
}

/** Cadre des maquettes mobiles : en-tête (retour ou logo), bande d'état, contenu défilant, barre d'action, onglets (ou rail). */
function Mobile({ titre, sous, retour, action, bande, pied, onglets, actif, children }: {
  titre: ReactNode; sous?: ReactNode; retour?: string | (() => void); action?: ReactNode; bande?: ReactNode; pied?: ReactNode;
  onglets: Onglet[]; actif: string; children: ReactNode;
}) {
  const moi = useMoi();
  const ref = useRef<HTMLDivElement>(null);
  useClavier(ref);
  const nomAppli = onglets === ONGLETS_PARENT ? 'Espace parents' : 'Espace instituteur';
  const boutonRetour = <><Icone nom="wifi" /><span className="m-retour-texte">Retour</span></>;
  return (
    <div className="m-app">
      <StyleMobile />
      <div className="m-colonne" ref={ref}>
        <nav className="m-onglets" aria-label="Navigation principale">
          <div className="m-rail-logo">
            <div className="m-logo" aria-hidden="true"><Icone nom="logo" taille={22} /></div>
            <div className="m-pile"><strong>{nomAppli}</strong><span className="m-petit m-deux-lignes">{moi.etablissement}</span></div>
          </div>
          {onglets.map((o) => (
            <Link key={o.route} to={o.route} className={o.route === actif ? 'actif' : ''} aria-current={o.route === actif ? 'page' : undefined}>
              <Icone nom={o.icone} taille={22} /><span>{o.libelle}</span>
            </Link>
          ))}
        </nav>
        <div className="m-principal">
          <header className="m-entete">
            <div className="m-entete-int">
              {typeof retour === 'string'
                ? <Link to={retour} className="m-icone m-retour" aria-label="Retour">{boutonRetour}</Link>
                : retour
                  ? <button type="button" className="m-icone m-retour" aria-label="Retour" onClick={retour}>{boutonRetour}</button>
                  : <div className="m-logo" aria-hidden="true"><Icone nom="logo" taille={22} /></div>}
              <div className="m-titre"><h1>{titre}</h1>{sous && <span>{sous}</span>}</div>
              {action}
            </div>
          </header>
          {bande}
          <main className="m-contenu">{children}</main>
          {pied && <div className="m-pied">{pied}</div>}
        </div>
      </div>
    </div>
  );
}

const Carte = ({ children, serree, ecart, style, className, ariaLabel }: { children: ReactNode; serree?: boolean; ecart?: number; style?: CSSProperties; className?: string; ariaLabel?: string }) =>
  <section className={`m-carte ${serree ? 'serree' : ''} ${className ?? ''}`} aria-label={ariaLabel} style={{ ...(ecart !== undefined ? { gap: ecart } : {}), ...style }}>{children}</section>;
const Chevron = () => <span style={{ display: 'flex', color: 'var(--doux)' }} aria-hidden="true"><Icone nom="chevron" /></span>;
/** État vide, explicite et bienveillant. */
const Vide = ({ children, icone = 'lire', style }: { children: ReactNode; icone?: NomIcone; style?: CSSProperties }) =>
  <Carte style={style}><span className="m-vide"><Icone nom={icone} taille={20} /><span>{children}</span></span></Carte>;
const VideLigne = ({ children, icone = 'lire' }: { children: ReactNode; icone?: NomIcone }) =>
  <span className="m-vide" style={{ padding: '6px 0' }}><Icone nom={icone} taille={18} /><span>{children}</span></span>;
/** Erreur annoncée au lecteur d'écran, avec « Réessayer ». */
const ErreurMobile = ({ message, recharger }: { message: string; recharger?: () => void }) => <div role="alert"><Erreur message={message} recharger={recharger} /></div>;
/** Colonne d'une mise en page à deux colonnes (une seule colonne sur téléphone, l'ordre suit `ordre`). */
const Col = ({ children }: { children: ReactNode }) => <div className="m-col">{children}</div>;
const ordre = (n: number): CSSProperties => ({ order: n });

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
    <div style={{ display: 'flex', justifyContent: 'center', padding: '4px 0', order: 99 }}>
      <button type="button" className="lien-texte m-deconnexion" onClick={async () => { await deconnecter(); naviguer(vers, { replace: true }); }}>Se déconnecter</button>
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
  // Une seule zone vivante, toujours présente : le passage hors ligne / en ligne est annoncé sans surprise.
  const contenu = !synchro.enLigne
    ? { ton: 'attention', icone: 'horsLigne' as NomIcone, texte: `Hors ligne · ${garde}` }
    : synchro.notes.length + synchro.appels.length > 0
      ? { ton: 'attention', icone: 'recalculer' as NomIcone, texte: `Envoi en attente · ${garde}` }
      : synchro.derniere
        ? { ton: 'succes', icone: 'recalculer' as NomIcone, texte: `Wi-Fi de l’école · synchronisation faite ${memeJour(synchro.derniere) ? `à ${heure(synchro.derniere)}` : `le ${jjmm(synchro.derniere)} à ${heure(synchro.derniere)}`}` }
        : null;
  return (
    <div className={`m-bande ${contenu?.ton ?? ''}`} role="status" aria-live="polite" style={contenu ? undefined : { display: 'none' }}>
      {contenu && <><Icone nom={contenu.icone} taille={16} /><span>{contenu.texte}</span></>}
    </div>
  );
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
    return <Mobile onglets={ONGLETS_INSTITUTEUR} actif="/instituteur/notes" titre="Notes">{erreur ? <ErreurMobile message={erreur} recharger={recharger} /> : <Chargement />}</Mobile>;
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
      <div className="m-grille-classes">
        {classes.map((c) => (
          <section key={c.id} className="m-classe" aria-label={c.nom}>
            <span className="etiquette">{c.nom}</span>
            <Carte serree style={{ '--m-lignes': Math.max(1, Math.ceil(c.matieres.length / 2)) } as CSSProperties}>
              {c.matieres.map((m) => {
                const a = avancement?.[`${c.id}|${m.id}`];
                const autre = m.saisiePar !== 'Principal' && m.saisiePar !== moi.nom;
                const aller = () => choisir(c.id, m.id);
                return (
                  <div key={m.id} className="m-ligne cliquable" role="button" tabIndex={0} aria-label={`${m.libelle}, ${c.nom}`} onClick={aller} onKeyDown={touche(aller)}>
                    <div className="m-pile">
                      <span className="gras">{m.libelle}</span>
                      <span className="m-petit">{autre ? `Saisie par ${m.saisiePar}` : a ? `${pluriel(a.notes, 'note')} sur ${a.total}` : ' '}</span>
                    </div>
                    {!autre && a && a.total > 0 && a.notes >= a.total && <span className="pastille succes">Complet</span>}
                    <Chevron />
                  </div>
                );
              })}
            </Carte>
          </section>
        ))}
      </div>
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
  const [annonce, setAnnonce] = useState('');
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
  const saisiesFaites = d ? d.eleves.filter((e) => statutDe(e) !== 'present' || (saisies[e.inscriptionId] ?? '').trim() !== '').length : 0;

  const enregistrer = async () => {
    if (!d || !d.modifiable || charge) return;
    const fautive = d.eleves.find((e) => e.modifiable && enErreur(e));
    if (fautive) {
      signaler(`Note de ${fautive.nom} : saisissez une note entre 0 et ${bareme}.`, true);
      document.querySelector<HTMLInputElement>(`input[data-note="${fautive.inscriptionId}"]`)?.focus();
      return;
    }
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
        <span className="m-petit">Statut de l’élève pour ce devoir : {libelleStatut(actuel).toLowerCase()}.</span>
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
    setAnnonce(`${e.nom} : ${choix === 'present' ? 'saisie de la note' : libelleStatut(choix).toLowerCase()}.`);
    if (choix === 'present') window.setTimeout(() => document.querySelector<HTMLInputElement>(`input[data-note="${e.inscriptionId}"]`)?.focus(), 50);
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
      {erreur ? <ErreurMobile message={erreur} recharger={recharger} /> : !d ? <Chargement /> : (
        <>
          {!d.modifiable && d.raison && <Note ton="attention">{d.raison === 'Saisie fermée' ? 'Saisie fermée : un déverrouillage du préfet est nécessaire pour modifier ces notes.' : d.raison}</Note>}
          {d.modifiable && d.eleves.length > 0 && (
            <span className="m-petit">{saisiesFaites} sur {pluriel(d.eleves.length, 'élève')} {saisiesFaites > 1 ? 'renseignés' : 'renseigné'} · touchez le nom d’un élève pour le déclarer absent, justifié ou dispensé.</span>
          )}
          <span className="m-sr" role="status" aria-live="polite">{annonce}</span>
          <Carte serree>
            {d.eleves.length === 0 && <VideLigne icone="eleves">Aucun élève inscrit dans cette classe.</VideLigne>}
            <div className="m-eleves" style={{ '--m-lignes': Math.max(1, Math.ceil(d.eleves.length / 2)) } as CSSProperties}>
              {d.eleves.map((e) => {
                const st = statutDe(e);
                const lecture = !d.modifiable || !e.modifiable;
                return (
                  <div key={e.inscriptionId} className="m-rang">
                    <button type="button" className="m-nom" aria-haspopup="dialog" disabled={lecture} aria-label={`${e.nom}, changer le statut`} onClick={() => void changerStatut(e)}>
                      <span className="m-pile"><span>{e.nom}</span>{!lecture && st !== 'present' && <span className="m-petit">Sans note pour ce devoir</span>}</span>
                    </button>
                    {st === 'present'
                      ? <input type="text" inputMode="decimal" enterKeyHint="next" data-note={e.inscriptionId} className={`champ m-note ${enErreur(e) ? 'erreur' : ''}`}
                          aria-label={`Note de ${e.nom} sur ${bareme}`} aria-invalid={enErreur(e) || undefined} readOnly={lecture} value={saisies[e.inscriptionId] ?? ''}
                          onChange={(ev) => { const v = ev.target.value; setSaisies((x) => ({ ...x, [e.inscriptionId]: v })); }} onKeyDown={suivant} />
                      : <button type="button" className={`m-statut ${st}`} disabled={lecture} aria-haspopup="dialog"
                          aria-label={`${e.nom} : ${libelleStatut(st)}, changer`} onClick={() => void changerStatut(e)}>{libelleStatut(st)}</button>}
                  </div>
                );
              })}
            </div>
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
      pied={fiche ? <Bouton variante="principal" pleine icone="coche" charge={charge} disabled={!fiche.modifiable} onClick={enregistrer}>Enregistrer l’appel</Bouton> : undefined}>
      {erreur ? <ErreurMobile message={erreur} recharger={recharger} /> : !d ? <Chargement /> : !fiche ? (
        <Vide icone="emploiDuTemps">Aucun appel à faire aujourd’hui : pas de cours prévu à votre emploi du temps.</Vide>
      ) : (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }} role="status" aria-live="polite">
            <span className="pastille succes">{pluriel(nombre('present'), 'présent')}</span>
            <span className="pastille danger">{pluriel(nombre('absent'), 'absent')}</span>
            <span className="pastille attention">{pluriel(nombre('retard'), 'retard')}</span>
          </div>
          {!fiche.modifiable && <Note ton="attention">Seul l’instituteur prévu à ce créneau fait l’appel.</Note>}
          {fiche.statut === 'faite' && fiche.faiteLe && <span className="m-petit">Appel enregistré à {heure(isoNet(fiche.faiteLe))} ; une correction reste possible.</span>}
          <Carte serree>
            {fiche.eleves.length === 0 && <VideLigne icone="eleves">Aucun élève inscrit dans cette classe.</VideLigne>}
            <div className="m-eleves" style={{ '--m-lignes': Math.max(1, Math.ceil(fiche.eleves.length / 2)) } as CSSProperties}>
              {fiche.eleves.map((e) => {
                const st = statutDe(e);
                return (
                  <div key={e.inscriptionId} className="m-rang">
                    <span style={{ flex: 1, minWidth: 0, fontWeight: 600 }}>{e.nom}</span>
                    <div className="m-presences" role="group" aria-label={e.nom}>
                      {PRESENCES.map(([p, lettre, libelle]) => (
                        <button key={p} type="button" className={`m-presence ${lettre.toLowerCase()}`} aria-label={`${e.nom} : ${libelle}`} aria-pressed={st === p}
                          disabled={!fiche.modifiable} onClick={() => setStatuts((x) => ({ ...x, [e.inscriptionId]: p }))}>{lettre}</button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
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
    appareils: 'Android, iPhone ou navigateur', langue: 'Langue' },
  en: { titre: 'Parents’ area', sous: 'follow your children’s marks, absences and payments.', telephone: 'Phone number', motDePasse: 'Password',
    connecter: 'Sign in', aide: 'One account per family, created at registration. The password is on the sheet given by the school office; if you forget it, ask the school for a new one.',
    appareils: 'Android, iPhone or browser', langue: 'Language' },
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
    <div className="m-app" lang={langue}>
      <StyleMobile />
      <div className="m-colonne m-connexion">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
          <div className="m-logo" aria-hidden="true" style={{ width: 56, height: 56, borderRadius: 17 }}><Icone nom="logo" taille={34} /></div>
          <h1 style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.01em' }}>{t.titre}</h1>
          <span className="doux">{ecole ? `${ecole} · ${t.sous}` : capitale(t.sous)}</span>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); void valider(); }} noValidate>
          <Carte ecart={12}>
            <Champ libelle={t.telephone} type="tel" inputMode="tel" value={telephone} onChange={setTelephone} />
            <Champ libelle={t.motDePasse} type="password" value={motDePasse} onChange={setMotDePasse} erreur={erreur ? ' ' : null} />
            {erreur && <div className="note danger" role="alert">{erreur}</div>}
            <Bouton type="submit" variante="principal" pleine charge={charge}>{t.connecter}</Bouton>
            <span className="m-petit">{t.aide}</span>
          </Carte>
        </form>
        <div style={{ display: 'flex', justifyContent: 'center' }} role="group" aria-label={t.langue}>
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

/** Choix de l'enfant, identique sur toutes les pages (initiale, prénom, classe) ; absent quand la famille n'a qu'un enfant. */
function ChoixEnfant({ enfants, choisi, choisir, style }: { enfants: Enfant[] | null; choisi: Enfant | null; choisir: (id: string) => void; style?: CSSProperties }) {
  if (!enfants || enfants.length < 2) return null;
  return (
    <div role="group" aria-label="Enfant" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, ...style }}>
      {enfants.map((e) => (
        <button key={e.eleveId} type="button" className="m-choix" aria-pressed={e.eleveId === choisi?.eleveId} onClick={() => choisir(e.eleveId)}>
          <span className="m-avatar" aria-hidden="true">{initiale(e.prenom)}</span>{e.prenom} · {e.classe}
        </button>
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
  const nonLus = d?.nonLus ?? 0;
  return (
    <Mobile onglets={ONGLETS_PARENT} actif="/parent/accueil" titre={d?.salutation ? `Bonjour, ${d.salutation}` : 'Bonjour'} sous={moi.etablissement}
      action={(
        <Link to="/parent/messages" className="m-icone" aria-label={nonLus ? `Messages, ${pluriel(nonLus, 'non lu')}` : 'Messages et annonces'}>
          <Icone nom="messages" />{nonLus > 0 && <span className="m-compteur" aria-hidden="true">{nonLus > 9 ? '9+' : nonLus}</span>}
        </Link>
      )}>
      {erreur ? <ErreurMobile message={erreur} recharger={recharger} /> : !d ? <Chargement /> : (
        <>
          <div className="m-deux">
            <Col>
              <span className="etiquette" style={ordre(1)}>Vos enfants</span>
              {d.enfants.length === 0 && <Vide icone="eleves">Aucun enfant inscrit cette année. Rapprochez-vous du secrétariat de l’école.</Vide>}
              {d.enfants.map((e) => {
                const aller = () => naviguer(`/parent/notes?eleve=${e.eleveId}`);
                return (
                  <section key={e.eleveId} className="m-carte cliquable" role="button" tabIndex={0} aria-label={`${e.nom}, ${e.classe} : voir le bulletin`} style={ordre(2)}
                    onClick={aller} onKeyDown={touche(aller)}>
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
            </Col>
            <Col>
              {d.alertes.map((a, i) => <div key={i} style={ordre(3)}><Bandeau icone="bouclier" ton="attention">{a}</Bandeau></div>)}
              <span className="etiquette" style={ordre(4)}>Dernières nouvelles</span>
              {d.nouvelles.length === 0 ? <Vide style={ordre(5)}>Aucune nouvelle pour l’instant : les notes publiées, les reçus et les annonces apparaîtront ici.</Vide> : (
                <Carte serree style={ordre(5)}>
                  {d.nouvelles.map((n, i) => (
                    <div key={i} className="m-ligne">
                      <div className="m-pile"><span className="m-petit">{jjmm(isoNet(n.date))} · {n.type}</span><span style={{ fontSize: 13 }}>{montantsFr(n.texte)}</span></div>
                    </div>
                  ))}
                </Carte>
              )}
            </Col>
          </div>
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
      {erreurEnfants ? <ErreurMobile message={erreurEnfants} recharger={rechargerEnfants} /> : erreur ? <ErreurMobile message={erreur} recharger={recharger} /> : !enfants || (id && !d) ? <Chargement /> : (
        <>
          <ChoixEnfant enfants={enfants} choisi={choisi} choisir={choisir} />
          {!choisi && <Vide icone="eleves">Aucun enfant inscrit cette année.</Vide>}
          {d?.bloque && <Bandeau icone="bouclier" ton="attention">{d.bloque}</Bandeau>}
          {d && !b && !d.bloque && <Vide icone="notes">Aucun bulletin publié pour l’instant : il apparaîtra ici dès que l’école le publiera.</Vide>}
          {b && (
            <div className="m-deux droite-large">
              <Col>
                <Carte style={ordre(1)}>
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
                {(b.appreciationGenerale || b.principal) && (
                  <Carte style={ordre(3)}>
                    <span className="etiquette">Appréciation générale</span>
                    {b.appreciationGenerale && <span style={{ fontSize: 13 }}>{b.appreciationGenerale}</span>}
                    {b.principal && <span className="m-petit">{b.principal}, instituteur principal</span>}
                  </Carte>
                )}
              </Col>
              <Col>
                <Carte serree style={ordre(2)} ariaLabel="Moyennes par matière">
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
              </Col>
            </div>
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
  const part = d && d.aPayer > 0 ? Math.min(100, Math.round((d.verse * 100) / d.aPayer)) : 0;
  return (
    <Mobile onglets={ONGLETS_PARENT} actif="/parent/paiements" titre="Paiements" sous={d ? `${d.nom} · ${d.classe}` : choisi ? `${choisi.nom} · ${choisi.classe}` : undefined}>
      {erreurEnfants ? <ErreurMobile message={erreurEnfants} recharger={rechargerEnfants} /> : erreur ? <ErreurMobile message={erreur} recharger={recharger} /> : !enfants || (id && !d) ? <Chargement /> : (
        <>
          <ChoixEnfant enfants={enfants} choisi={choisi} choisir={choisir} />
          {!d && <Vide icone="eleves">Aucun enfant inscrit cette année.</Vide>}
          {d && (
            <div className="m-deux">
              <Col>
                <Carte ecart={8} style={ordre(1)}>
                  <span className="etiquette">Reste dû</span>
                  <span style={{ fontSize: 30, fontWeight: 700, lineHeight: 1.1, color: d.resteDu > 0 ? 'var(--attention)' : 'var(--succes)' }}>
                    {montant(d.resteDu)}<span style={{ fontSize: 13, fontWeight: 600, color: 'var(--doux)' }}> FCFA</span>
                  </span>
                  <div role="progressbar" aria-label="Part des frais déjà versée" aria-valuemin={0} aria-valuemax={100} aria-valuenow={part}
                    style={{ height: 6, borderRadius: 3, background: 'var(--bord)', overflow: 'hidden' }}>
                    <div style={{ width: `${part}%`, height: '100%', borderRadius: 3, background: 'var(--accent)' }} />
                  </div>
                  <span className="m-petit">{montant(d.verse)} {d.verse > 1 ? 'versés' : 'versé'} sur {montant(d.aPayer)} FCFA</span>
                </Carte>
                <Carte ecart={6} style={ordre(4)}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
                    <span style={{ display: 'flex', color: 'var(--accent)' }} aria-hidden="true"><Icone nom="banque" /></span><span className="gras">Comment payer</span>
                  </div>
                  <span style={{ fontSize: 13 }}>{banque ? `À la caisse de l’école, ou par versement à la banque : ${banque}. Gardez le bordereau.` : 'À la caisse de l’école. Gardez votre reçu.'}</span>
                  <span className="m-petit">Aucun paiement ne se fait dans l’application.</span>
                </Carte>
              </Col>
              <Col>
                <Carte serree style={ordre(2)} ariaLabel="Frais de l’année">
                  {d.lignes.length === 0 && <VideLigne icone="fraisCaisse">Aucun frais à régler pour l’instant.</VideLigne>}
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
                <Carte serree style={ordre(3)} ariaLabel="Reçus">
                  {d.recus.length === 0 && <VideLigne icone="lire">Aucun versement pour l’instant : vos reçus apparaîtront ici après chaque paiement à la caisse.</VideLigne>}
                  {d.recus.map((r) => (
                    <div key={r.id} className="m-ligne" style={{ padding: '2px 0' }}>
                      <div className="m-pile">
                        <span className="gras">{r.numero} · {fcfa(r.montant)}</span>
                        <span className="m-petit">{jjmmaaaa(isoNet(r.date))}{r.modeLibelle ? ` · ${r.modeLibelle}` : ''}</span>
                      </div>
                      <Link to={`/parent/recus/${r.id}?eleve=${id}`} className="bouton lien" aria-label={`Voir le reçu ${r.numero}`}><span>Voir</span></Link>
                    </div>
                  ))}
                </Carte>
              </Col>
            </div>
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
  const total = (f: (l: RecuParent['lignes'][number]) => number) => d?.lignes.reduce((s, l) => s + f(l), 0) ?? 0;
  return (
    <Mobile onglets={ONGLETS_PARENT} actif="/parent/paiements" retour={`/parent/paiements${eleve ? `?eleve=${eleve}` : ''}`}
      titre={d ? `Reçu ${d.numero}` : 'Reçu'} sous={d ? `${d.date} à ${d.heure}` : undefined}>
      {erreur ? <ErreurMobile message={erreur} recharger={recharger} /> : !d ? <Chargement /> : (
        <>
          {d.annule && <Bandeau icone="alerte" ton="attention">Ce versement a été annulé : le reçu n’a plus de valeur.</Bandeau>}
          <div className="m-deux">
            <Col>
              <Carte ecart={0} style={{ padding: 0, overflow: 'hidden', ...ordre(1) }}>
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
              <Carte ecart={6} style={ordre(3)}>
                <span className="etiquette">Montant versé / Amount paid</span>
                <span style={{ fontSize: 24, fontWeight: 700 }}>{fcfa(d.montant)}</span>
                <span style={{ fontSize: 13 }}>{d.montantLettresFr} · {d.montantLettresEn}</span>
                <span className="m-petit">Mode / Method : {d.modeFr} / {d.modeEn}{d.bordereau ? ` · bordereau ${d.bordereau}` : ''}</span>
                <span className="m-petit">Encaissé par / Received by : {d.caissier}</span>
              </Carte>
            </Col>
            <Col>
              <Carte serree style={{ padding: '6px 14px', ...ordre(2) }}>
                <table className="m-tableau">
                  <caption className="m-sr">Détail du versement par frais</caption>
                  <thead>
                    <tr><th scope="col">Frais / Fee</th><th scope="col" className="num">À payer / Due</th><th scope="col" className="num">Versé / Paid</th><th scope="col" className="num">Reste / Balance</th><th scope="col">Avant le / By</th></tr>
                  </thead>
                  <tbody>
                    {d.lignes.map((l, i) => (
                      <tr key={i}>
                        <td className="libelle"><span>{l.libelleFr} / {l.libelleEn}</span>{l.reduction > 0 && <span className="m-petit" style={{ fontWeight: 500 }}>Réduction {montant(l.reduction)}</span>}</td>
                        <td className="num" data-l="À payer">{montant(l.aPayer)}</td>
                        <td className="num" data-l="Versé">{montant(l.verse)}</td>
                        <td className="num" data-l="Reste">{montant(l.reste)}</td>
                        <td data-l="Avant le">{l.dateLimite}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td className="libelle">Total</td>
                      <td className="num" data-l="À payer">{montant(total((l) => l.aPayer))}</td>
                      <td className="num" data-l="Versé">{montant(total((l) => l.verse))}</td>
                      <td className="num" data-l="Reste">{montant(total((l) => l.reste))}</td>
                      <td className="m-cache-petit" />
                    </tr>
                  </tfoot>
                </table>
              </Carte>
            </Col>
          </div>
          <span className="m-petit">Reçu consultable à l’écran, sans téléchargement. L’original papier reste celui remis à la caisse.</span>
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
  const large = useLarge();
  const jourVoulu = Number(params.get('jour')) || null;
  const id = choisi?.eleveId ?? null;
  const aujourdhui = new Date().getDay(); // 1 = lundi … 6 = samedi
  // Téléphone : un jour à la fois ; tablette : la semaine entière (six lectures, affichées côte à côte).
  const { d, erreur, recharger } = useDonnees<AgendaParent[] | null>(
    () => (!id ? Promise.resolve(null)
      : large ? Promise.all(JOURS_COURTS.map((_, i) => api.get<AgendaParent>(`/portail/enfants/${id}/agenda${requete({ jour: i + 1 })}`)))
        : api.get<AgendaParent>(`/portail/enfants/${id}/agenda${requete({ jour: jourVoulu })}`).then((x) => [x])),
    [id, jourVoulu, large]);
  const courant = d?.find((x) => x.jour === (jourVoulu ?? (aujourdhui >= 1 && aujourdhui <= 6 ? aujourdhui : 1))) ?? d?.[0] ?? null;
  const jour = courant?.jour ?? jourVoulu;
  const choisirJour = (j: number) => {
    const p = new URLSearchParams(params);
    p.set('jour', String(j));
    setParams(p, { replace: true });
  };
  const listeCours = (a: AgendaParent) => (
    <>
      {a.cours.length === 0 && <VideLigne icone="emploiDuTemps">Aucun cours ce jour-là.</VideLigne>}
      {a.cours.map((c, i) => (
        <div key={i} className={large ? 'm-cours' : 'm-ligne'}>
          <span style={{ flex: large ? undefined : '0 0 96px', fontSize: large ? 12 : 13, color: 'var(--doux)' }}>{c.debut} – {c.fin}</span>
          <div className="m-pile" style={{ gap: 0 }}>
            <span className="gras">{c.libelle}</span>
            {c.enseignant && <span className="m-petit">{c.enseignant}{c.principal ? ', instituteur principal' : ''}</span>}
          </div>
        </div>
      ))}
    </>
  );
  return (
    <Mobile onglets={ONGLETS_PARENT} actif="/parent/agenda" titre="Agenda" sous={courant ? `${courant.nom} · ${large ? 'semaine' : jourDate(courant.date)}` : choisi?.nom}>
      {erreurEnfants ? <ErreurMobile message={erreurEnfants} recharger={rechargerEnfants} /> : (
        <>
          <ChoixEnfant enfants={enfants} choisi={choisi} choisir={choisir} />
          {!large && (
            <div className="m-jours" role="group" aria-label="Jour de la semaine">
              {JOURS_COURTS.map((j, i) => (
                <button key={j} type="button" className="m-choix" aria-pressed={jour === i + 1} onClick={() => choisirJour(i + 1)}
                  aria-label={`${capitale(JOURS_LONGS[i + 1]!)}${aujourdhui === i + 1 ? ', aujourd’hui' : ''}`}>
                  {j}{aujourdhui === i + 1 && <small aria-hidden="true">auj.</small>}
                </button>
              ))}
            </div>
          )}
          {erreur ? <ErreurMobile message={erreur} recharger={recharger} /> : !enfants || (id && !d) ? <Chargement /> : !d || !courant ? <Vide icone="eleves">Aucun enfant inscrit cette année.</Vide> : (
            <>
              {large ? (
                <Carte>
                  <div className="m-semaine">
                    {d.map((a) => (
                      <section key={a.jour} className={`m-jour-col ${aujourdhui === a.jour ? 'aujourdhui' : ''}`} aria-label={`${capitale(JOURS_LONGS[a.jour] ?? '')} ${jjmm(a.date)}`}>
                        <h2>{capitale(JOURS_LONGS[a.jour] ?? '')}<span>{jjmm(a.date)}{aujourdhui === a.jour ? ' · aujourd’hui' : ''}</span></h2>
                        {listeCours(a)}
                      </section>
                    ))}
                  </div>
                </Carte>
              ) : <Carte serree>{listeCours(courant)}</Carte>}
              <span className="etiquette">Devoirs à faire</span>
              <Carte serree>
                {courant.devoirs.length === 0 && <VideLigne icone="notes">Aucun devoir à faire pour l’instant.</VideLigne>}
                {courant.devoirs.map((x, i) => {
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
  if (erreur) return <><div role="alert"><Note ton="danger">{erreur}</Note></div><div className="pied"><Bouton onClick={fermer}>Fermer</Bouton></div></>;
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
  const [erreur, setErreur] = useState<string | null>(null);
  const envoyer = async () => {
    if (texte.trim().length < 3) { setErreur('Indiquez le motif de l’absence.'); return; }
    setErreur(null);
    setCharge(true);
    const r = await agir(() => api.post('/portail/absences/justification', { inscriptionId: ev.inscriptionId, jour: ev.jour, texte: texte.trim() }),
      'Demande envoyée au secrétariat.');
    setCharge(false);
    if (r) fermer(true);
  };
  return (
    <>
      <span className="m-petit">{ev.prenom} · absence du {jjmmaaaa(ev.jour)} ({ev.texte.split(' · ')[0]})</span>
      <Champ libelle="Motif de l’absence" lignes={4} value={texte} onChange={setTexte} erreur={erreur ? ' ' : null} />
      {erreur && <span className="m-erreur" role="alert">{erreur}</span>}
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
      {a.texteEn && <p className="doux" lang="en" style={{ whiteSpace: 'pre-wrap' }}>{a.texteEn}</p>}
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
      {erreur ? <ErreurMobile message={erreur} recharger={recharger} /> : !d ? <Chargement /> : (
        <div className="m-deux">
          <Col>
            <span className="etiquette" style={ordre(1)}>Annonces</span>
            <Carte serree style={ordre(2)}>
              {d.annonces.length === 0 && <VideLigne>Aucune annonce pour l’instant.</VideLigne>}
              {d.annonces.map((a) => (
                <div key={a.id} className="m-ligne cliquable" role="button" tabIndex={0} aria-label={`Lire l’annonce : ${a.titre}`} onClick={() => lireAnnonce(a)} onKeyDown={touche(() => lireAnnonce(a))}>
                  <div className="m-pile">
                    <span className="m-petit">{jjmm(isoNet(a.date))}{a.cible ? ` · ${a.cible}` : ''}</span>
                    <span style={{ fontWeight: 600, fontSize: 13 }}>{a.titre}</span>
                  </div>
                  <Chevron />
                </div>
              ))}
            </Carte>
            <span className="etiquette" style={ordre(3)}>Absences et observations</span>
            <Carte serree style={ordre(4)}>
              {d.evenements.length === 0 && <VideLigne icone="vieScolaire">Aucune absence ni observation : tout va bien.</VideLigne>}
              {d.evenements.map((ev, i) => (
                <div key={i} className="m-ligne" style={{ padding: '6px 0' }}>
                  <div className="m-pile" style={{ gap: 3 }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
                      <span className={`pastille ${ev.type === 'Félicitations' ? 'succes' : 'attention'}`}>{ev.type}</span><span className="gras">{ev.prenom}</span>
                    </div>
                    <span className="m-petit">{jjmm(isoNet(ev.date))} · {ev.texte}</span>
                  </div>
                  {ev.justifiable && ev.inscriptionId && ev.jour && (
                    <button type="button" className="bouton lien" aria-label={`Justifier l’absence de ${ev.prenom} du ${jjmm(ev.jour)}`} onClick={() => justifier(ev)}><span>Justifier</span></button>
                  )}
                </div>
              ))}
            </Carte>
          </Col>
          <Col>
            <span className="etiquette" style={ordre(5)}>Messagerie</span>
            <Carte ecart={8} style={ordre(6)}>
              {d.conversations.length === 0 && <VideLigne icone="messages">Aucune conversation pour l’instant : écrivez à l’école, la réponse arrivera ici.</VideLigne>}
              {d.conversations.map((c) => (
                <div key={c.id} className="m-ligne cliquable" style={{ padding: '6px 0' }} role="button" tabIndex={0}
                  aria-label={`${DESTINATAIRES[c.destinataire] ?? c.destinataire}${c.nonLu ? ', non lu' : ''} : ouvrir la conversation`} onClick={() => ouvrir(c)} onKeyDown={touche(() => ouvrir(c))}>
                  <div className="m-pile">
                    <span className="gras" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {DESTINATAIRES[c.destinataire] ?? c.destinataire}
                      {c.nonLu && <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 4, background: 'var(--accent)' }} />}
                    </span>
                    {c.dernier && <span className="m-petit m-deux-lignes">{c.dernierAuteur === 'famille' ? 'Vous : ' : ''}«{' '}{c.dernier}{' '}»</span>}
                  </div>
                  <span className="m-petit">{horodatage(c.date)}</span>
                  <Chevron />
                </div>
              ))}
              <Link to="/parent/ecrire" className="bouton pleine"><Icone nom="messages" /><span>Écrire à l’école</span></Link>
            </Carte>
          </Col>
        </div>
      )}
    </Mobile>
  );
}

// ===================================================================== parent : écrire à l'école (RG-42 : un seul destinataire)

interface Destinataire { code: string; role: string; nom: string; aide: string }

function EcranEcrireParent() {
  const moi = useMoi();
  const [params] = useSearchParams();
  const { d: enfants, erreur, recharger } = useDonnees<Enfant[]>(() => api.get('/portail/enfants'));
  const [eleveId, setEleveId] = useState<string | null>(() => params.get('eleve') ?? lire<string | null>(CLE_ENFANT, null));
  const eleve = enfants?.find((e) => e.eleveId === eleveId) ?? enfants?.[0] ?? null;
  const { d: destinataires, erreur: erreurDest, recharger: rechargerDest } = useDonnees<Destinataire[] | null>(
    () => (eleve ? api.get(`/portail/destinataires${requete({ eleveId: eleve.eleveId })}`) : Promise.resolve(null)), [eleve?.eleveId]);
  const [code, setCode] = useState(params.get('destinataire') ?? 'instituteur_principal');
  const [texte, setTexte] = useState('');
  const [charge, setCharge] = useState(false);
  const [erreurTexte, setErreurTexte] = useState<string | null>(null);
  const [envoye, setEnvoye] = useState<{ destinataire: string; eleve: string } | null>(null);
  const destinataire = destinataires?.find((x) => x.code === code);
  const envoyer = async () => {
    if (!eleve || charge) return;
    if (texte.trim().length < 2) {
      setErreurTexte('Écrivez votre message avant de l’envoyer.');
      document.querySelector<HTMLTextAreaElement>('.m-contenu textarea')?.focus();
      return;
    }
    setErreurTexte(null);
    setCharge(true);
    const r = await agir(() => api.post('/portail/messages', { destinataire: code, eleveId: eleve.eleveId, texte: texte.trim() }), 'Message envoyé.');
    setCharge(false);
    if (r) { setEnvoye({ destinataire: destinataire?.role ?? DESTINATAIRES[code] ?? code, eleve: eleve.prenom }); setTexte(''); }
  };
  return (
    <Mobile onglets={ONGLETS_PARENT} actif="/parent/accueil" retour="/parent/messages" titre="Écrire à l’école" sous={moi.nom}>
      {erreur ? <ErreurMobile message={erreur} recharger={recharger} /> : !enfants ? <Chargement /> : !eleve ? <Vide icone="eleves">Aucun enfant inscrit cette année.</Vide> : envoye ? (
        <Carte ecart={12} style={{ maxWidth: 560, alignSelf: 'center', width: '100%' }}>
          <div role="status" style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <span style={{ flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 44, height: 44, borderRadius: 22, background: 'var(--succes-fond)', color: 'var(--succes)' }} aria-hidden="true"><Icone nom="coche" taille={24} /></span>
            <div className="m-pile" style={{ gap: 4 }}>
              <span style={{ fontSize: 17, fontWeight: 700 }}>Message envoyé</span>
              <span style={{ fontSize: 13 }}>Votre message au sujet {de(envoye.eleve)} a été transmis : {envoye.destinataire.toLowerCase()}. La réponse arrivera dans l’application et par SMS.</span>
            </div>
          </div>
          <Link to="/parent/messages" className="bouton principal pleine"><Icone nom="messages" /><span>Voir mes messages</span></Link>
          <Bouton pleine onClick={() => setEnvoye(null)}>Écrire un autre message</Bouton>
        </Carte>
      ) : (
        <div className="m-deux">
          <Col>
            <span className="etiquette" id="m-dest-titre" style={ordre(1)}>À qui écrivez-vous ?</span>
            <Carte serree style={ordre(2)}>
              {erreurDest ? <ErreurMobile message={erreurDest} recharger={rechargerDest} /> : !destinataires ? <Chargement /> : (
                <div role="radiogroup" aria-labelledby="m-dest-titre">
                  {destinataires.map((x) => (
                    <label key={x.code} className="m-radio">
                      <input type="radio" name="destinataire" value={x.code} checked={code === x.code} onChange={() => setCode(x.code)} />
                      <span className="m-rond" aria-hidden="true" />
                      <span className="m-pile">
                        <span className="gras">{x.role}</span>
                        {x.nom && <span className="m-petit">{x.nom}</span>}
                        <span style={{ fontSize: 12 }}>{x.aide}</span>
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </Carte>
          </Col>
          <Col>
            <div style={ordre(3)}>
              <Liste libelle="Au sujet de" value={eleve.eleveId} options={enfants.map((e) => [e.eleveId, `${e.prenom} · ${e.classe}`] as [string, string])} onChange={(v) => setEleveId(v)} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, ...ordre(4) }}>
              <Champ libelle="Votre message" lignes={5} value={texte} onChange={(v) => { setTexte(v); if (erreurTexte && v.trim().length >= 2) setErreurTexte(null); }} erreur={erreurTexte ? ' ' : null} />
              {erreurTexte && <span className="m-erreur" role="alert">{erreurTexte}</span>}
            </div>
            <div style={ordre(5)}><Bouton variante="principal" pleine icone="envoyer" charge={charge} onClick={envoyer}>Envoyer</Bouton></div>
            <span className="m-petit" style={ordre(6)}>Seul le destinataire choisi lit votre message. Réponse dans l’application et par SMS.</span>
          </Col>
        </div>
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
