// Applications mobiles installables (PWA), charte Sekou (maquettes « Sekou — logo » : connexion, accueil, notes et bulletin,
// paiements, messages, mode Nuit) :
// - instituteur : saisie des notes et appel, utilisables hors ligne (file d'attente sur le téléphone, envoi au retour du réseau) ;
// - parent : accueil, notes et bulletin, paiements, reçu, agenda, messagerie, vie scolaire.
// Le serveur reste seul juge : la famille ne voit que ses enfants, à l'écran, sans téléchargement (RG-35), le bulletin
// sous condition de paiement (RG-40) ; l'instituteur ne saisit que ses matières (RG-22) et ses créneaux d'appel (RG-38).
//
// Mise en page : une colonne sur téléphone (fidèle aux maquettes à 390 px) ; à partir de 700 px (tablette portrait) les
// écrans passent en deux colonnes ; à partir de 900 px (tablette paysage) la barre d'onglets devient un rail latéral gauche.
import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { RouteEcran } from '../App.tsx';
import { api, ErreurApi, requete } from '../core/api.ts';
import { useMoi, useSession } from '../core/session.tsx';
import { accueilDe } from '../core/coque.tsx';
import { aujourdhuiIso, dateLocale, decimal, fcfa, heure, initiale, jjmm, jjmmaaaa, jourDate, montant, note2, pluriel, versDecimal } from '../core/format.ts';
import { agir, Bouton, Champ, Chargement, Erreur, Icone, Note, ouvrirFenetre, ouvrirFormulaire, PiedFenetre, signaler, useDonnees } from '../core/ui.tsx';
import type { NomIcone } from '../core/icones-traces.ts';

// ===================================================================== charte Sekou (maquettes mobiles)

const LARGE = 700; // tablette portrait : deux colonnes
const RAIL = 900; // tablette paysage : rail latéral

// Couleurs relevées dans les maquettes : bandeau bleu encre en Jour, gris nuit en Nuit ; jaune craie pour le trait seulement.
const BANDEAU = { jour: '#0B1F4B', nuit: '#171B23' };

const CSS = `
@font-face { font-family: 'Inter Sekou'; font-style: normal; font-weight: 400 800; font-display: swap; src: url('/polices/Inter-variable-latin.woff2') format('woff2');
  unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD; }
@font-face { font-family: 'Inter Sekou'; font-style: normal; font-weight: 400 800; font-display: swap; src: url('/polices/Inter-variable-latin-ext.woff2') format('woff2');
  unicode-range: U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF; }

.m-app {
  --m-bandeau: ${BANDEAU.jour}; --m-bandeau-texte: #FFFFFF; --m-bandeau-doux: #C7D6FF; --m-bandeau-bord: #2A3F73; --m-bandeau-creux: #152A5C;
  --m-puce-fond: #FFFFFF; --m-puce-texte: #0B1F4B; --m-pastille: #1D4ED8; --m-pastille-texte: #FFFFFF; --m-pastille-off: #2A3F73; --m-pastille-off-texte: #FFFFFF;
  --m-compteur: #C7D6FF; --m-compteur-texte: #0B1F4B; --m-trait: #FACC15;
  --m-piste: #E3E8F2; --m-ligne: rgba(11,31,75,0.10); --m-encart: #F1F4FA; --m-carte-bord: transparent; --m-ombre: 0 1px 3px rgba(11,31,75,0.10);
  --m-succes-fond: rgba(21,112,58,0.10); --m-attention-fond: rgba(168,54,10,0.10); --m-attention-bord: rgba(168,54,10,0.35); --m-accent-fond: rgba(29,78,216,0.10);
  min-height: 100vh; min-height: 100dvh; display: flex; justify-content: center; background: var(--fond);
  font-family: 'Inter Sekou', Inter, system-ui, sans-serif; font-size: 14px; line-height: 1.45; font-variant-numeric: tabular-nums slashed-zero;
}
:root[data-theme='nuit'] .m-app {
  --m-bandeau: ${BANDEAU.nuit}; --m-bandeau-texte: #E8ECF3; --m-bandeau-doux: #A9B2C2; --m-bandeau-bord: #2A303C; --m-bandeau-creux: #101318;
  --m-puce-fond: #E8ECF3; --m-puce-texte: #101318; --m-pastille: #A3C1FF; --m-pastille-texte: #0E1320; --m-pastille-off: #2A303C; --m-pastille-off-texte: #E8ECF3;
  --m-compteur: #A3C1FF; --m-compteur-texte: #0E1320;
  --m-piste: #2A303C; --m-ligne: #262C38; --m-encart: #1F242E; --m-carte-bord: #262C38; --m-ombre: none;
  --m-succes-fond: rgba(110,231,160,0.12); --m-attention-fond: rgba(253,186,116,0.12); --m-attention-bord: rgba(253,186,116,0.35); --m-accent-fond: rgba(163,193,255,0.12);
}
.m-app :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.m-entete :focus-visible { outline-color: var(--m-bandeau-texte); }
.m-app .champ, .m-app textarea.champ, .m-app select.champ { font-size: 16px; }
.m-app .etiquette, .m-etiquette { font-size: 11px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--doux); }
.m-app .bouton.principal { min-height: 50px; border-radius: 8px; font-size: 15px; font-weight: 600; }
.m-sombre-seul { display: none !important; }
:root[data-theme='nuit'] .m-sombre-seul { display: block !important; }
:root[data-theme='nuit'] .m-clair-seul { display: none !important; }

.m-colonne { position: relative; width: 100%; height: 100vh; height: 100dvh; display: flex; flex-direction: column; background: var(--fond); overflow: hidden; padding-bottom: var(--m-clavier, 0px); }
.m-principal { order: 1; flex: 1; min-height: 0; min-width: 0; display: flex; flex-direction: column; }

/* Bandeau : logo et actions, trait jaune, titre, puis le choix de l'enfant ou de la période. */
.m-entete { flex: none; background: var(--m-bandeau); color: var(--m-bandeau-texte); border-bottom: 1px solid var(--m-bandeau-bord);
  padding: calc(16px + env(safe-area-inset-top)) max(20px, env(safe-area-inset-right)) 18px max(20px, env(safe-area-inset-left)); }
.m-entete.fil { padding-top: calc(12px + env(safe-area-inset-top)); padding-bottom: 14px; }
.m-entete-int { display: flex; flex-direction: column; gap: 14px; width: 100%; max-width: 1040px; margin: 0 auto; min-width: 0; }
.m-entete.fil .m-entete-int { gap: 12px; }
.m-entete-haut { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 44px; }
.m-logo-entete { display: block; width: 80.4px; height: 26px; }
.m-actions { display: flex; gap: 8px; margin-left: auto; }
.m-titre { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.m-titre.avec-trait { gap: 8px; }
.m-trait { width: 32px; height: 4px; border-radius: 2px; background: var(--m-trait); }
.m-entete h1 { margin: 0; font-size: 22px; font-weight: 700; line-height: 1.2; letter-spacing: -0.01em; overflow-wrap: anywhere; }
.m-entete h1.grand { font-size: 24px; font-variation-settings: 'opsz' 32; }
.m-titre > span:not(.m-trait) { font-size: 13px; color: var(--m-bandeau-doux); }
.m-entete-fil { display: flex; align-items: center; gap: 12px; min-height: 44px; }
.m-entete.fil .m-titre { gap: 0; }
.m-entete.fil h1 { font-size: 20px; }
.m-entete.fil .m-titre > span { font-size: 12px; }
.m-icone { flex: none; position: relative; display: flex; align-items: center; justify-content: center; width: 44px; height: 44px; padding: 0; border-radius: 12px;
  border: 1px solid var(--m-bandeau-bord); background: transparent; color: var(--m-bandeau-texte); font: inherit; cursor: pointer; text-decoration: none; }
.m-icone:hover { color: var(--m-bandeau-texte); background: rgba(255,255,255,0.06); }
.m-retour { border-color: transparent; margin-left: -10px; }
.m-compteur { position: absolute; top: 6px; right: 6px; min-width: 16px; height: 16px; padding: 0 4px; border-radius: 8px; background: var(--m-compteur); color: var(--m-compteur-texte);
  font-size: 10px; font-weight: 700; display: flex; align-items: center; justify-content: center; }

/* Choix de l'enfant (pastille et initiale), de la période (segments), du destinataire (puces). */
.m-enfants { display: flex; gap: 8px; overflow-x: auto; scrollbar-width: none; margin: 0 -20px; padding: 0 20px; }
.m-enfants::-webkit-scrollbar { display: none; }
.m-enfant { flex: none; display: flex; align-items: center; gap: 8px; height: 44px; padding: 0 14px 0 6px; border-radius: 22px; font: inherit; font-size: 13px; font-weight: 600;
  white-space: nowrap; cursor: pointer; background: transparent; color: var(--m-bandeau-doux); border: 1px solid var(--m-bandeau-bord); }
.m-enfant > span { width: 32px; height: 32px; border-radius: 16px; display: flex; align-items: center; justify-content: center; background: var(--m-pastille-off); color: var(--m-pastille-off-texte); font-size: 13px; font-weight: 700; }
.m-enfant[aria-pressed='true'] { background: var(--m-puce-fond); color: var(--m-puce-texte); border-color: var(--m-puce-fond); }
.m-enfant[aria-pressed='true'] > span { background: var(--m-pastille); color: var(--m-pastille-texte); }
.m-segments { display: flex; gap: 4px; padding: 4px; border-radius: 12px; background: var(--m-bandeau-creux); }
.m-segments button { flex: 1 1 0; min-width: 0; height: 40px; padding: 0 6px; border-radius: 8px; border: 0; font: inherit; font-size: 13px; font-weight: 600; cursor: pointer;
  background: transparent; color: var(--m-bandeau-doux); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.m-segments button[aria-pressed='true'] { background: var(--m-puce-fond); color: var(--m-puce-texte); }
.m-segments button:disabled { cursor: default; opacity: 0.55; }
.m-puces { display: flex; gap: 6px; overflow-x: auto; scrollbar-width: none; margin: 0 -20px; padding: 0 20px; }
.m-puces::-webkit-scrollbar { display: none; }
.m-puce { position: relative; flex: none; height: 36px; padding: 0 12px; border-radius: 18px; font: inherit; font-size: 12px; font-weight: 600; white-space: nowrap; cursor: pointer;
  background: transparent; color: var(--m-bandeau-doux); border: 1px solid var(--m-bandeau-bord); }
.m-puce[aria-pressed='true'] { background: var(--m-puce-fond); color: var(--m-puce-texte); border-color: var(--m-puce-fond); }
.m-puce .m-point { position: absolute; top: 4px; right: 4px; width: 8px; height: 8px; border-radius: 4px; background: var(--m-trait); }

.m-bande { flex: none; display: flex; align-items: center; gap: 8px; padding: 8px max(16px, env(safe-area-inset-right)) 8px max(16px, env(safe-area-inset-left)); font-size: 13px; font-weight: 600; }
.m-bande.attention { background: var(--m-attention-fond); }
.m-bande.attention .icone { color: var(--attention); }
.m-bande.succes { background: var(--m-succes-fond); }
.m-bande.succes .icone { color: var(--succes); }
.m-contenu { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; scroll-padding-bottom: 96px; -webkit-overflow-scrolling: touch;
  padding: 16px max(16px, env(safe-area-inset-right)) 28px max(16px, env(safe-area-inset-left)); display: flex; flex-direction: column; gap: 14px; }
.m-contenu > *, .m-deux > *, .m-col > * { flex-shrink: 0; }
.m-pied { flex: none; display: flex; justify-content: center; padding: 10px max(12px, env(safe-area-inset-right)) calc(10px + env(safe-area-inset-bottom)) max(12px, env(safe-area-inset-left));
  background: var(--panneau); border-top: 1px solid var(--m-ligne); }
.m-pied > * { width: 100%; max-width: 1040px; }

/* Onglets du bas : icône au-dessus du libellé, filet bleu sur l'onglet courant. */
.m-onglets { order: 2; flex: none; display: flex; justify-content: center; background: var(--panneau); border-top: 1px solid var(--m-ligne); padding: 0 env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left); }
.m-onglets a { position: relative; flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; height: 62px; padding: 0 4px;
  text-decoration: none; font-size: 11px; font-weight: 600; color: var(--doux); }
.m-onglets a:hover { color: var(--texte); }
.m-onglets a.actif { color: var(--accent); }
.m-onglets a.actif::before { content: ''; position: absolute; top: 0; left: 30%; right: 30%; height: 3px; border-radius: 0 0 3px 3px; background: var(--accent); }
.m-rail-logo { display: none; }
.m-sans-onglets .m-onglets { display: none; }

/* Cartes et lignes. */
.m-carte { position: relative; flex: none; background: var(--panneau); border: 1px solid var(--m-carte-bord); border-radius: 12px; box-shadow: var(--m-ombre); padding: 16px;
  display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.m-carte.serree { gap: 4px; }
.m-carte.cliquable { cursor: pointer; }
.m-carte.cliquable:hover { box-shadow: 0 2px 8px rgba(11,31,75,0.14); }
.m-tete-carte { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.m-lien { display: flex; align-items: center; gap: 2px; min-height: 32px; font-size: 13px; font-weight: 600; text-decoration: none; color: var(--accent); background: none; border: 0; padding: 0; cursor: pointer; font-family: inherit; }
.m-vide { display: flex; align-items: center; gap: 10px; color: var(--doux); font-size: 13px; }
.m-vide .icone { color: var(--doux); }
.m-ligne { display: flex; align-items: center; gap: 12px; min-height: 44px; padding: 10px 0; border-bottom: 1px solid var(--m-ligne); color: inherit; text-decoration: none; }
.m-ligne:last-child, .m-ligne.derniere { border-bottom: 0; }
.m-ligne.cliquable { cursor: pointer; }
.m-ligne.cliquable:hover .gras { color: var(--accent); }
.m-pile { display: flex; flex-direction: column; gap: 1px; min-width: 0; flex: 1; }
.m-pile .gras { font-weight: 600; }
.m-petit { font-size: 12px; color: var(--doux); }
.m-deux-lignes { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.m-note-chiffre { font-size: 17px; font-weight: 700; white-space: nowrap; }
.m-note-chiffre small { font-size: 13px; font-weight: 500; color: var(--doux); }
.m-somme { font-size: 28px; line-height: 1.1; font-weight: 700; font-variation-settings: 'opsz' 32; letter-spacing: -0.01em; white-space: nowrap; }
.m-somme small { font-size: 15px; font-weight: 600; color: var(--doux); }
.m-encart { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 8px; background: var(--m-encart); font-size: 13px; }
.m-encart .icone { color: var(--accent); }
.m-encart b, .m-alerte b { font-weight: 600; }
.m-alerte { display: flex; align-items: flex-start; gap: 10px; padding: 12px; border-radius: 8px; background: var(--m-attention-fond); border: 1px solid var(--m-attention-bord); font-size: 13px; line-height: 1.45; }
.m-alerte > .icone { flex: none; margin-top: 1px; color: var(--attention); }
.m-badge { display: inline-flex; align-items: center; gap: 5px; height: 24px; padding: 0 9px; border-radius: 8px; font-size: 12px; font-weight: 600; white-space: nowrap; }
.m-badge.succes { background: var(--m-succes-fond); color: var(--succes); }
.m-badge.attention { background: var(--m-attention-fond); color: var(--attention); }
.m-badge.accent { background: var(--m-accent-fond); color: var(--accent); }
.m-tranches { display: flex; gap: 6px; }
.m-tranche { flex: 1 1 0; display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.m-tranche > span { font-size: 11px; font-weight: 500; color: var(--doux); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.m-tranche.retard > span { color: var(--attention); font-weight: 600; }
.m-piste { height: 10px; border-radius: 4px; background: var(--m-piste); overflow: hidden; }
.m-piste > div { height: 100%; background: var(--accent); }
.m-tranche.retard .m-piste > div { background: var(--attention); }
.m-barre { flex: 1; height: 6px; border-radius: 3px; background: var(--m-piste); }
.m-barre > div { height: 100%; border-radius: 3px; background: var(--accent); }
.m-tuile { flex: none; width: 40px; height: 40px; border-radius: 12px; background: var(--m-accent-fond); color: var(--accent); display: flex; align-items: center; justify-content: center; }
.m-bouton { display: flex; align-items: center; justify-content: center; gap: 8px; height: 50px; padding: 0 16px; border: 0; border-radius: 8px; background: var(--accent); color: var(--sur-accent);
  font: inherit; font-size: 15px; font-weight: 600; text-decoration: none; cursor: pointer; }
.m-bouton:hover { color: var(--sur-accent); background: var(--accent-survol); }
.m-bouton:disabled { opacity: 0.6; cursor: default; }

/* Messagerie : séparateurs de jour, bulles, barre d'écriture. */
.m-fil { display: flex; flex-direction: column; gap: 10px; }
.m-jour-sep { align-self: center; font-size: 12px; color: var(--doux); padding: 4px 10px; border-radius: 8px; background: var(--m-encart); }
.m-bulle { max-width: 82%; padding: 10px 12px; display: flex; flex-direction: column; gap: 4px; font-size: 14px; line-height: 1.45; }
.m-bulle > span:first-child { white-space: pre-wrap; overflow-wrap: anywhere; }
.m-bulle > span:last-child { font-size: 11px; align-self: flex-end; }
.m-bulle.moi { align-self: flex-end; background: var(--accent); color: var(--sur-accent); border-radius: 14px 14px 4px 14px; }
.m-bulle.moi > span:last-child { opacity: 0.8; }
.m-bulle.ecole { align-self: flex-start; background: var(--panneau); color: var(--texte); border-radius: 14px 14px 14px 4px; box-shadow: var(--m-ombre); border: 1px solid var(--m-carte-bord); }
.m-bulle.ecole > span:last-child { color: var(--doux); }
.m-ecrire { display: flex; align-items: center; gap: 8px; margin: 0; }
.m-ecrire input { flex: 1; min-width: 0; height: 44px; padding: 0 14px; border-radius: 22px; border: 1px solid var(--m-ligne); background: var(--champ); font: inherit; font-size: 16px; color: var(--texte); }
.m-ecrire input:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.m-envoyer { flex: none; display: flex; align-items: center; justify-content: center; width: 44px; height: 44px; border: 0; border-radius: 22px; background: var(--accent); color: var(--sur-accent); cursor: pointer; }
.m-envoyer:disabled { opacity: 0.6; cursor: default; }

/* Écrans de l'instituteur : grille des notes et appel. */
.m-avatar { flex: none; display: flex; align-items: center; justify-content: center; width: 40px; height: 40px; border-radius: 20px; background: var(--m-pastille); color: var(--m-pastille-texte); font-size: 15px; font-weight: 700; }
.m-choix { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 44px; padding: 0 14px; border-radius: 22px; font: inherit; font-size: 13px; font-weight: 600; cursor: pointer;
  white-space: nowrap; border: 1px solid var(--m-ligne); background: var(--panneau); color: var(--doux); }
.m-choix[aria-pressed='true'] { border-color: var(--accent); background: var(--m-accent-fond); color: var(--accent); }
.m-jours { display: flex; align-items: center; gap: 6px; }
.m-jours .m-choix { flex: 1 1 0; min-width: 0; padding: 0; flex-direction: column; gap: 0; line-height: 1.1; border-radius: 12px; }
.m-jours .m-choix small { font-size: 10px; font-weight: 600; color: var(--doux); }
.m-jours .m-choix[aria-pressed='true'] small { color: var(--accent); }
.m-eleves { display: flex; flex-direction: column; }
.m-rang { display: flex; align-items: center; gap: 12px; min-height: 56px; padding: 4px 0; border-bottom: 1px solid var(--m-ligne); }
.m-nom { flex: 1; min-width: 0; min-height: 48px; display: flex; align-items: center; padding: 0 4px 0 0; border: 0; border-radius: 8px; background: none; color: inherit; font: inherit; font-weight: 600; text-align: left; cursor: pointer; }
.m-nom:not(:disabled):hover { background: var(--neutre-fond); }
.m-nom:not(:disabled):active { background: var(--m-accent-fond); }
.m-nom:disabled { cursor: default; }
.m-nom .m-petit { font-weight: 500; }
.m-note { flex: none; width: 76px; height: 44px; padding: 0 10px; text-align: right; font-weight: 600; border-radius: 8px; }
.m-note[readonly] { color: var(--doux); }
.m-statut { flex: none; min-height: 44px; min-width: 76px; padding: 0 12px; border-radius: 8px; border: 1px solid var(--bord-fort); background: var(--panneau); color: var(--texte); font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; white-space: nowrap; }
.m-statut.absent { border-color: var(--m-attention-bord); background: var(--m-attention-fond); color: var(--attention); }
.m-statut.absent_justifie { border-color: var(--bord-fort); background: var(--neutre-fond); color: var(--texte); }
.m-statut.dispense { border-color: var(--accent-bord); background: var(--m-accent-fond); color: var(--accent); }
.m-statut:disabled { cursor: default; }
.m-presences { display: flex; align-items: center; gap: 8px; }
.m-presence { width: 48px; height: 48px; border-radius: 12px; font: inherit; font-size: 16px; font-weight: 700; cursor: pointer; border: 1px solid var(--m-ligne); background: var(--m-encart); color: var(--doux); }
.m-presence:not(:disabled):hover { border-color: var(--bord-fort); }
.m-presence.p[aria-pressed='true'] { border-color: var(--succes); background: var(--succes); color: var(--panneau); }
.m-presence.a[aria-pressed='true'] { border-color: var(--danger); background: var(--danger); color: var(--panneau); }
.m-presence.r[aria-pressed='true'] { border-color: var(--attention); background: var(--attention); color: var(--panneau); }
.m-presence:disabled { cursor: default; opacity: 0.7; }
.m-compteurs { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
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
.m-cours { display: flex; flex-direction: column; gap: 0; padding: 6px 0; border-bottom: 1px solid var(--m-ligne); font-size: 13px; }
.m-cours .m-petit { font-size: 11px; }
.m-tableau { width: 100%; border-collapse: collapse; font-size: 13px; }
.m-tableau th { text-align: left; padding: 6px 8px; font-size: 11px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--doux); border-bottom: 1px solid var(--bord-fort); }
.m-tableau td { padding: 8px; border-bottom: 1px solid var(--m-ligne); vertical-align: top; }
.m-tableau .num { text-align: right; white-space: nowrap; }
.m-tableau tfoot td { font-weight: 700; border-bottom: 0; }
body:has(.m-app) .messages-flottants { bottom: calc(84px + env(safe-area-inset-bottom)); }

/* Connexion : bandeau bleu encre, carte qui le chevauche, langue en bas. */
.m-connexion { width: 100%; min-height: 100vh; min-height: 100dvh; display: flex; flex-direction: column; background: var(--fond); }
.m-connexion-haut { flex: none; background: var(--m-bandeau); padding: calc(56px + env(safe-area-inset-top)) max(28px, env(safe-area-inset-right)) 72px max(28px, env(safe-area-inset-left)); display: flex; flex-direction: column; gap: 28px; }
.m-connexion-haut > *, .m-connexion-corps > * { width: 100%; max-width: 480px; margin-left: auto; margin-right: auto; }
.m-connexion-haut img { display: block; width: 212.2px; height: 44px; }
.m-connexion-haut .m-titre { gap: 10px; }
.m-connexion-haut .m-trait { width: 40px; }
.m-connexion-haut h1 { margin: 0; color: var(--m-bandeau-texte); font-size: 28px; line-height: 1.15; font-weight: 800; letter-spacing: -0.02em; }
.m-connexion-haut p { margin: 0; color: var(--m-bandeau-doux); font-size: 14px; line-height: 1.5; }
.m-connexion-corps { flex: 1; display: flex; flex-direction: column; gap: 16px; margin-top: -40px; padding: 0 max(16px, env(safe-area-inset-right)) calc(16px + env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left)); }
.m-connexion-corps .m-carte { padding: 20px; gap: 0; }
.m-formulaire { display: flex; flex-direction: column; gap: 16px; margin: 0; }
.m-champ { display: flex; flex-direction: column; gap: 6px; }
.m-champ label { font-size: 13px; font-weight: 600; }
.m-saisie { display: flex; align-items: center; gap: 8px; height: 48px; padding: 0 14px; border-radius: 8px; background: var(--champ); border: 1px solid var(--m-ligne); }
.m-saisie:focus-within { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
.m-saisie.erreur { border-color: var(--danger); }
.m-saisie input { flex: 1; min-width: 0; border: 0; background: transparent; font: inherit; font-size: 16px; color: var(--texte); outline: none; }
.m-saisie input::placeholder { color: var(--doux); opacity: 0.85; }
.m-saisie button { display: flex; align-items: center; justify-content: center; width: 44px; height: 44px; margin-right: -10px; border: 0; background: transparent; color: var(--doux); cursor: pointer; }
.m-connexion-note { margin: 0 auto; font-size: 13px; line-height: 1.5; color: var(--doux); text-align: center; }
.m-langues { margin-top: auto; display: flex; justify-content: center; gap: 8px; padding-top: 8px; }
.m-langues button { display: flex; align-items: center; gap: 6px; height: 44px; padding: 0 16px; border-radius: 22px; border: 1px solid var(--m-ligne); background: var(--panneau); color: var(--doux);
  font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; }
.m-langues button[aria-pressed='true'] { border-color: var(--accent); background: var(--m-accent-fond); color: var(--accent); }

/* Téléphone : le tableau du reçu s'empile ligne par ligne (lisible à 360 px). */
@media (max-width: ${LARGE - 1}px) {
  .m-tableau thead { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
  .m-tableau, .m-tableau tbody, .m-tableau tfoot { display: block; }
  .m-tableau tr { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 12px; padding: 10px 0; border-bottom: 1px solid var(--m-ligne); }
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
  .m-entete { padding-left: max(28px, env(safe-area-inset-left)); padding-right: max(28px, env(safe-area-inset-right)); }
  .m-enfants, .m-puces { margin: 0; padding: 0; flex-wrap: wrap; }
  .m-segments { max-width: 560px; }
  .m-bande, .m-contenu, .m-pied { padding-left: max(24px, env(safe-area-inset-left)); padding-right: max(24px, env(safe-area-inset-right)); }
  .m-contenu { padding-top: 20px; gap: 16px; }
  .m-contenu > * { width: 100%; max-width: 1040px; margin-left: auto; margin-right: auto; }
  .m-onglets a { flex: 0 1 200px; flex-direction: row; gap: 8px; font-size: 13px; }
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
  .m-fil { max-width: 760px !important; }
  .m-connexion-corps .m-carte { padding: 28px; }
}
@media (min-width: 1200px) { .m-semaine { grid-template-columns: repeat(6, minmax(0, 1fr)); } }

/* Tablette paysage (≥ 900 px) : la barre d'onglets devient un rail latéral, le logo y passe. */
@media (min-width: ${RAIL}px) {
  .m-colonne { flex-direction: row; }
  .m-onglets, .m-sans-onglets .m-onglets { order: 0; display: flex; flex-direction: column; justify-content: flex-start; gap: 4px; width: 232px; border-top: 0; border-right: 1px solid var(--m-ligne);
    padding: calc(20px + env(safe-area-inset-top)) 12px calc(20px + env(safe-area-inset-bottom)) max(12px, env(safe-area-inset-left)); }
  .m-onglets a { flex: none; flex-direction: row; justify-content: flex-start; gap: 12px; height: 48px; padding: 0 12px; border-radius: 10px; font-size: 14px; color: var(--texte); }
  .m-onglets a .icone { color: var(--doux); }
  .m-onglets a:hover:not(.actif) { background: var(--neutre-fond); }
  .m-onglets a.actif { background: var(--m-accent-fond); color: var(--accent); }
  .m-onglets a.actif .icone { color: var(--accent); }
  .m-onglets a.actif::before { display: none; }
  .m-rail-logo { display: flex; flex-direction: column; gap: 6px; padding: 0 6px 18px; min-width: 0; }
  .m-rail-logo img { display: block; width: 104px; height: 33.6px; }
  .m-entete .m-logo-entete { display: none; }
  .m-entete-haut:not(:has(.m-actions > *)) { display: none; }
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

/** Barre d'état du téléphone à la couleur du bandeau, rendue au fond de l'écran en quittant l'application mobile. */
function useCouleurBarre() {
  const { mode } = useSession();
  useEffect(() => {
    const meta = document.querySelector('meta[name="theme-color"]');
    meta?.setAttribute('content', BANDEAU[mode]);
    return () => meta?.setAttribute('content', mode === 'nuit' ? '#101318' : '#F6F8FC');
  }, [mode]);
}

/** Logo Sekou : version claire sur le bandeau, version du fond de page dans le rail de la tablette. */
const LogoBandeau = () => <img className="m-logo-entete" src="/marque/sekou-logo-sombre.svg" alt="Sekou" width={80} height={26} />;
const LogoRail = () => (
  <>
    <img className="m-clair-seul" src="/marque/sekou-logo.svg" alt="Sekou" width={104} height={34} />
    <img className="m-sombre-seul" src="/marque/sekou-logo-sombre.svg" alt="Sekou" width={104} height={34} />
  </>
);

/** Bascule Jour / Nuit du bandeau (maquette « accueil, mode Nuit »). */
function BoutonMode() {
  const { mode, basculerMode } = useSession();
  return (
    <button type="button" className="m-icone" aria-pressed={mode === 'nuit'} onClick={basculerMode}
      aria-label={mode === 'nuit' ? 'Mode Nuit activé : passer en mode Jour' : 'Passer en mode Nuit'}>
      <Icone nom="nuit" taille={20} />
    </button>
  );
}

/** Accès à la messagerie du parent, avec le nombre de conversations non lues. */
const BoutonMessages = ({ nonLus = 0 }: { nonLus?: number }) => (
  <Link to="/parent/messages" className="m-icone" aria-label={nonLus ? `Messages, ${pluriel(nonLus, 'non lu')}` : 'Messages'}>
    <Icone nom="messages" taille={20} />{nonLus > 0 && <span className="m-compteur" aria-hidden="true">{nonLus > 9 ? '9+' : nonLus}</span>}
  </Link>
);

/** Cadre des écrans mobiles : bandeau (logo et actions, ou retour), bande d'état, contenu défilant, barre d'action, onglets (ou rail). */
function Mobile({ titre, sous, retour, actions, entete, trait, grand, bande, pied, onglets, actif, sansOnglets, children }: {
  titre: ReactNode; sous?: ReactNode; retour?: string | (() => void); actions?: ReactNode; entete?: ReactNode; trait?: boolean; grand?: boolean;
  bande?: ReactNode; pied?: ReactNode; onglets: Onglet[]; actif: string; sansOnglets?: boolean; children: ReactNode;
}) {
  const moi = useMoi();
  const ref = useRef<HTMLDivElement>(null);
  useClavier(ref);
  useCouleurBarre();
  const nomAppli = onglets === ONGLETS_PARENT ? 'Espace parents' : 'Espace instituteur';
  const icone = <Icone nom="wifi" taille={22} />;
  return (
    <div className={`m-app ${sansOnglets ? 'm-sans-onglets' : ''}`}>
      <StyleMobile />
      <div className="m-colonne" ref={ref}>
        <nav className="m-onglets" aria-label="Navigation principale">
          <div className="m-rail-logo"><LogoRail /><span className="m-petit m-deux-lignes">{nomAppli} · {moi.etablissement}</span></div>
          {onglets.map((o) => (
            <Link key={o.route} to={o.route} className={o.route === actif ? 'actif' : ''} aria-current={o.route === actif ? 'page' : undefined}>
              <Icone nom={o.icone} taille={20} /><span>{o.libelle}</span>
            </Link>
          ))}
        </nav>
        <div className="m-principal">
          <header className={`m-entete ${retour ? 'fil' : ''}`}>
            <div className="m-entete-int">
              {retour ? (
                <div className="m-entete-fil">
                  {typeof retour === 'string'
                    ? <Link to={retour} className="m-icone m-retour" aria-label="Retour">{icone}</Link>
                    : <button type="button" className="m-icone m-retour" aria-label="Retour" onClick={retour}>{icone}</button>}
                  <div className="m-titre"><h1>{titre}</h1>{sous && <span>{sous}</span>}</div>
                  {actions && <div className="m-actions">{actions}</div>}
                </div>
              ) : (
                <>
                  <div className="m-entete-haut"><LogoBandeau />{actions ? <div className="m-actions">{actions}</div> : <div className="m-actions" />}</div>
                  <div className={`m-titre ${trait ? 'avec-trait' : ''}`}>
                    {trait && <span className="m-trait" aria-hidden="true" />}
                    <h1 className={grand ? 'grand' : ''}>{titre}</h1>
                    {sous && <span>{sous}</span>}
                  </div>
                </>
              )}
              {entete}
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
const Chevron = ({ taille = 18 }: { taille?: number }) => <span style={{ display: 'flex', color: 'var(--doux)' }} aria-hidden="true"><Icone nom="chevron" taille={taille} /></span>;
/** En-tête de carte : étiquette en capitales, lien « Détail › » à droite. */
const TeteCarte = ({ titre, lien, libelle }: { titre: ReactNode; lien?: string; libelle?: string }) => (
  <div className="m-tete-carte">
    <span className="m-etiquette">{titre}</span>
    {lien && <Link to={lien} className="m-lien">{libelle}<Icone nom="chevron" taille={16} /></Link>}
  </div>
);
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
const de = (mot: string) => (/^[aeiouyhàâéèêëîïôöûü]/i.test(mot) ? `d’${mot}` : `de ${mot}`);
/** « de la tranche 2 », « de l’inscription », « des frais d’examen ». */
const deLa = (mot: string) => (/^[aeiouyhàâéèêëîïôöûü]/i.test(mot) ? `de l’${mot}` : /^frais\b/i.test(mot) ? `des ${mot}` : `de la ${mot}`);
/** « M. ONANA Bertrand » → « M. ONANA » (civilité et nom de famille, comme dans les maquettes). */
const nomCourt = (nom: string) => {
  const mots = nom.trim().split(/\s+/);
  const garde = mots.filter((m, i) => (i === 0 && /^(M\.|Mme|Mlle|Dr)$/.test(m)) || (m.length > 1 && m === m.toUpperCase() && /\p{L}/u.test(m)));
  return garde.length > (/^(M\.|Mme|Mlle|Dr)$/.test(mots[0] ?? '') ? 1 : 0) ? garde.join(' ') : nom;
};
/** Date limite : « 30/11 » dans l'année en cours, « 15/02/2027 » au-delà. */
const dateCourte = (iso: string) => (iso.slice(0, 4) === aujourdhuiIso().slice(0, 4) ? jjmm(iso) : jjmmaaaa(iso));
/** « 2026/2027 » → « 2026‑2027 », insécable comme dans la maquette. */
const anneeTiret = (a: string | null | undefined) => (a ?? '').replace(/\s*[/-]\s*/, '\u2011');

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

/** Barres de paiement par ligne de l'échéancier (inscription, tranches) ; en retard : orange. */
function Tranches({ lignes }: { lignes: { libelle: string; aPayer: number; reste: number; dateLimite: string }[] }) {
  const auj = aujourdhuiIso();
  if (!lignes.length) return null;
  return (
    <div className="m-tranches">
      {lignes.map((l, i) => {
        const part = l.aPayer > 0 ? Math.round(((l.aPayer - l.reste) * 100) / l.aPayer) : 100;
        const retard = l.reste > 0 && l.dateLimite < auj;
        return (
          <div key={i} className={`m-tranche ${retard ? 'retard' : ''}`}>
            <div className="m-piste" role="progressbar" aria-label={`${l.libelle} : payée à ${part} %${retard ? ', en retard' : ''}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={part}>
              <div style={{ width: `${part}%` }} />
            </div>
            <span aria-hidden="true">{l.libelle}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Situation des paiements : soldé, à jour, en retard. */
function BadgeSituation({ lignes }: { lignes: { reste: number; dateLimite: string }[] }) {
  const auj = aujourdhuiIso();
  const reste = lignes.reduce((s, l) => s + l.reste, 0);
  if (lignes.some((l) => l.reste > 0 && l.dateLimite < auj)) return <span className="m-badge attention"><Icone nom="bouclier" taille={13} />En retard</span>;
  return <span className="m-badge succes"><Icone nom="cercleCoche" taille={13} />{reste === 0 && lignes.length ? 'Soldé' : 'À jour'}</span>;
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
    return <Mobile onglets={ONGLETS_INSTITUTEUR} actif="/instituteur/notes" trait titre="Notes" actions={<BoutonMode />}>{erreur ? <ErreurMobile message={erreur} recharger={recharger} /> : <Chargement />}</Mobile>;
  }
  if (!d.sequence) {
    return (
      <Mobile onglets={ONGLETS_INSTITUTEUR} actif="/instituteur/notes" trait titre="Notes" actions={<BoutonMode />}>
        <Vide>Aucune séquence n’est ouverte pour l’instant : la saisie s’ouvrira avec la prochaine séquence.</Vide>
        <Deconnexion vers="/connexion" />
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
    <Mobile onglets={ONGLETS_INSTITUTEUR} actif="/instituteur/notes" trait titre="Mes classes" sous={`${sequence.libelle} · ${etatSaisie(sequence)}`}
      actions={<BoutonMode />} bande={<BandeSynchro synchro={synchro} quoi="notes" />}>
      {classes.length === 0 && <Vide>Aucune classe ne vous est confiée cette année.</Vide>}
      <div className="m-grille-classes">
        {classes.map((c) => (
          <section key={c.id} className="m-classe" aria-label={c.nom}>
            <span className="m-etiquette">{c.nom}</span>
            <Carte serree style={{ '--m-lignes': Math.max(1, Math.ceil(c.matieres.length / 2)) } as CSSProperties}>
              {c.matieres.length === 0 && <VideLigne icone="notes">Aucune matière n’est encore programmée pour cette classe : le préfet des études la définit dans le programme de l’année.</VideLigne>}
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
                    {!autre && a && a.total > 0 && a.notes >= a.total && <span className="m-badge succes"><Icone nom="cercleCoche" taille={13} />Complet</span>}
                    <Chevron />
                  </div>
                );
              })}
            </Carte>
          </section>
        ))}
      </div>
      <Deconnexion vers="/connexion" />
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
    <Mobile onglets={ONGLETS_INSTITUTEUR} actif="/instituteur/appel" actions={<BoutonMode />}
      titre={fiche ? `${fiche.classe} · appel` : 'Appel'}
      sous={fiche ? `${capitale(jourDate(fiche.jour))} · ${fiche.debut} – ${fiche.fin} · ${fiche.libelle}` : undefined}
      bande={<BandeSynchro synchro={synchro} quoi="appel" />}
      pied={fiche ? <Bouton variante="principal" pleine icone="coche" charge={charge} disabled={!fiche.modifiable} onClick={enregistrer}>Enregistrer l’appel</Bouton> : undefined}>
      {erreur ? <ErreurMobile message={erreur} recharger={recharger} /> : !d ? <Chargement /> : !fiche ? (
        <Vide icone="emploiDuTemps">Aucun appel à faire aujourd’hui : pas de cours prévu à votre emploi du temps.</Vide>
      ) : (
        <>
          <div className="m-compteurs" role="status" aria-live="polite">
            <span className="m-badge succes">{pluriel(nombre('present'), 'présent')}</span>
            <span className="m-badge attention" style={{ background: 'var(--danger-fond)', color: 'var(--danger)' }}>{pluriel(nombre('absent'), 'absent')}</span>
            <span className="m-badge attention">{pluriel(nombre('retard'), 'retard')}</span>
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

// ===================================================================== connexion unique (charte Sekou, D-38)

const TEXTES_CONNEXION = {
  fr: { titre: 'Connexion', sous: 'Direction, secrétariat, caisse, enseignants et parents : un seul accès.', identifiant: 'Identifiant ou numéro de téléphone',
    exemple: 'prenom.n ou 6XX XX XX XX', motDePasse: 'Mot de passe', indice: 'Remis par l’école', connecter: 'Se connecter', oubli: 'Mot de passe oublié ?',
    oubliTexte: 'Le secrétariat de l’école vous remet un nouveau mot de passe. Les parents présentent une pièce d’identité ; un seul compte par famille.',
    note: 'Les parents se connectent avec leur numéro de téléphone, le personnel avec l’identifiant remis par le secrétariat.',
    afficher: 'Afficher le mot de passe', masquer: 'Masquer le mot de passe', langue: 'Langue', fermer: 'Fermer', logo: 'Sekou, logiciel de gestion scolaire', annee: 'année scolaire' },
  en: { titre: 'Sign in', sous: 'Management, office, cash desk, teachers and parents: one single access.', identifiant: 'Username or phone number',
    exemple: 'firstname.i or 6XX XX XX XX', motDePasse: 'Password', indice: 'Given by the school', connecter: 'Sign in', oubli: 'Forgot your password?',
    oubliTexte: 'The school office gives you a new password. Parents show an identity document; one account per family.',
    note: 'Parents sign in with their phone number, staff with the username given by the school office.',
    afficher: 'Show password', masquer: 'Hide password', langue: 'Language', fermer: 'Close', logo: 'Sekou, school management software', annee: 'school year' },
};

/** Page de connexion de tout le monde : chacun est ensuite conduit vers son espace (parent, instituteur, bureau). */
export function EcranConnexionSekou() {
  const { connecter } = useSession();
  const naviguer = useNavigate();
  const [identifiant, setIdentifiant] = useState('');
  const [motDePasse, setMotDePasse] = useState('');
  const [visible, setVisible] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [charge, setCharge] = useState(false);
  const [langue, setLangue] = useState<'fr' | 'en'>('fr');
  const [ecole, setEcole] = useState<{ nomFr: string; nomEn: string; annee: string | null } | null>(null);
  useEffect(() => { api.get<{ nomFr: string; nomEn: string; annee: string | null }>('/auth/accueil').then(setEcole).catch(() => undefined); }, []);
  useCouleurBarre();
  const t = TEXTES_CONNEXION[langue];
  const valider = async () => {
    if (charge) return;
    setCharge(true);
    setErreur(null);
    try {
      const m = await connecter(identifiant.trim(), motDePasse);
      naviguer(accueilDe(m), { replace: true });
    } catch (e) {
      setErreur(e instanceof ErreurApi ? e.message : String(e));
    } finally {
      setCharge(false);
    }
  };
  const oubli = () => void ouvrirFenetre(t.oubli, (fermer) => (
    <>
      <p>{t.oubliTexte}</p>
      <div className="pied"><Bouton variante="principal" onClick={() => fermer()}>{t.fermer}</Bouton></div>
    </>
  ), 420);
  return (
    <div className="m-app" lang={langue}>
      <StyleMobile />
      <div className="m-connexion">
        <div className="m-connexion-haut">
          <div><img src="/marque/sekou-logo-signature-sombre.svg" alt={t.logo} width={212} height={44} /></div>
          <div className="m-titre">
            <span className="m-trait" aria-hidden="true" />
            <h1>{t.titre}</h1>
            <p>{ecole ? `${langue === 'en' ? ecole.nomEn : ecole.nomFr}${ecole.annee ? ` · ${t.annee} ${ecole.annee}` : ''}` : t.sous}</p>
          </div>
        </div>
        <main className="m-connexion-corps">
          <section className="m-carte">
            <form className="m-formulaire" noValidate onSubmit={(e) => { e.preventDefault(); void valider(); }}>
              <div className="m-champ">
                <label htmlFor="m-identifiant">{t.identifiant}</label>
                <div className={`m-saisie ${erreur ? 'erreur' : ''}`}>
                  <input id="m-identifiant" type="text" autoComplete="username" autoCapitalize="none" spellCheck={false} placeholder={t.exemple} autoFocus
                    value={identifiant} onChange={(e) => setIdentifiant(e.target.value)} aria-invalid={erreur ? true : undefined} />
                </div>
              </div>
              <div className="m-champ">
                <label htmlFor="m-mot-de-passe">{t.motDePasse}</label>
                <div className={`m-saisie ${erreur ? 'erreur' : ''}`}>
                  <input id="m-mot-de-passe" type={visible ? 'text' : 'password'} autoComplete="current-password" placeholder={t.indice}
                    value={motDePasse} onChange={(e) => setMotDePasse(e.target.value)} aria-invalid={erreur ? true : undefined} aria-describedby={erreur ? 'm-erreur-connexion' : undefined} />
                  <button type="button" aria-label={visible ? t.masquer : t.afficher} aria-pressed={visible} onClick={() => setVisible((v) => !v)}><Icone nom="oeil" taille={20} /></button>
                </div>
              </div>
              {erreur && <div id="m-erreur-connexion" className="m-alerte" role="alert" style={{ background: 'var(--danger-fond)', borderColor: 'var(--danger)' }}><Icone nom="alerte" taille={18} style={{ color: 'var(--danger)' }} /><span>{erreur}</span></div>}
              <button type="submit" className="m-bouton" disabled={charge} aria-busy={charge || undefined}>{charge ? <span className="chargement" aria-hidden="true"><span /></span> : null}{t.connecter}</button>
              <button type="button" className="m-lien" style={{ alignSelf: 'center', padding: 8 }} onClick={oubli}>{t.oubli}</button>
            </form>
          </section>
          <p className="m-connexion-note">{t.note}</p>
          <div className="m-langues" role="group" aria-label={t.langue}>
            <button type="button" aria-pressed={langue === 'fr'} onClick={() => setLangue('fr')} lang="fr">{langue === 'fr' && <Icone nom="globe" taille={16} />}Français</button>
            <button type="button" aria-pressed={langue === 'en'} onClick={() => setLangue('en')} lang="en">{langue === 'en' && <Icone nom="globe" taille={16} />}English</button>
          </div>
        </main>
      </div>
    </div>
  );
}

// ===================================================================== page publique « Vérifier » (QR codes, D-44)

interface Verification { valide: boolean; type: string; titre: string; etablissement: string; alerte: string | null; lignes: { libelle: string; valeur: string }[] }

/** Ouverte en scannant le QR code d'une carte scolaire ou d'un bulletin, sans connexion. */
export function EcranVerifier() {
  const { code = '' } = useParams();
  const d = useDonnees(() => api.get<Verification>(`/verification/${encodeURIComponent(code)}`), [code]);
  useCouleurBarre();
  const maintenant = new Date().toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Douala' });
  return (
    <div className="m-app">
      <StyleMobile />
      <div className="m-connexion">
        <div className="m-connexion-haut">
          <div><img src="/marque/sekou-logo-signature-sombre.svg" alt="Sekou, logiciel de gestion scolaire" width={212} height={44} /></div>
          <div className="m-titre">
            <span className="m-trait" aria-hidden="true" />
            <h1>Vérification</h1>
            <p>{d.d?.etablissement ?? 'Document scolaire'}</p>
          </div>
        </div>
        <main className="m-connexion-corps">
          <section className="m-carte" aria-live="polite">
            {!d.d && !d.erreur ? <Chargement /> : !d.d ? (
              <div className="verif">
                <div className="verif-statut danger"><Icone nom="alerte" taille={28} /><span>Document non reconnu</span></div>
                <p className="doux">Ce code ne correspond à aucun document. Scannez de nouveau le QR code, ou vérifiez l’adresse saisie.</p>
              </div>
            ) : (
              <div className="verif">
                <div className={`verif-statut ${d.d.valide ? 'succes' : 'attention'}`}>
                  <Icone nom={d.d.valide ? 'cercleCoche' : 'alerte'} taille={28} /><span>{d.d.valide ? 'Vérifié' : 'Non valable'}</span>
                </div>
                <span className="gras" style={{ fontSize: 17 }}>{d.d.titre}</span>
                {d.d.alerte && <div className="m-alerte" role="alert"><Icone nom="alerte" taille={18} /><span>{d.d.alerte}</span></div>}
                <dl className="verif-lignes">
                  {d.d.lignes.map((l) => <div key={l.libelle}><dt>{l.libelle}</dt><dd>{l.valeur}</dd></div>)}
                </dl>
                <p className="doux petit">Document émis par {d.d.etablissement}. Vérifié le {maintenant}, d’après les registres de l’établissement.</p>
              </div>
            )}
          </section>
        </main>
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

/** Choix de l'enfant dans le bandeau, identique sur toutes les pages (initiale, prénom, classe). */
function ChoixEnfant({ enfants, choisi, choisir }: { enfants: { eleveId: string; prenom: string; classe: string }[] | null | undefined; choisi: string | null | undefined; choisir: (id: string) => void }) {
  if (!enfants || enfants.length === 0) return null;
  return (
    <div className="m-enfants" role="group" aria-label="Enfant">
      {enfants.map((e) => (
        <button key={e.eleveId} type="button" className="m-enfant" aria-pressed={e.eleveId === choisi} onClick={() => choisir(e.eleveId)}>
          <span aria-hidden="true">{initiale(e.prenom)}</span>{e.prenom} · {e.classe}
        </button>
      ))}
    </div>
  );
}

// ===================================================================== parent : accueil

interface LigneEcheance { libelle: string; aPayer: number; reste: number; dateLimite: string }
interface Annonce { id: string; titre: string; texteFr: string; texteEn: string | null; date: string; cible: string | null }
interface AccueilParent {
  salutation: string; annee: string | null; nonLus: number; blocages: { eleveId: string; prenom: string; texte: string }[]; annonces: Annonce[];
  enfants: { eleveId: string; nom: string; prenom: string; classe: string; resteDu: number; absences: number; absencesJustifiees: number;
    prochaine: { montant: number; date: string; ligne: string; enRetard: boolean } | null; tranches: LigneEcheance[];
    dernieresNotes: { matiere: string; valeur: number; bareme: number; sequence: string; date: string }[] }[];
}

const lireAnnonce = (a: Annonce) => void ouvrirFenetre(a.titre, (fermer) => (
  <>
    <span className="m-petit">{jjmmaaaa(isoNet(a.date))}{a.cible ? ` · ${a.cible}` : ''}</span>
    <p style={{ whiteSpace: 'pre-wrap' }}>{a.texteFr}</p>
    {a.texteEn && <p className="doux" lang="en" style={{ whiteSpace: 'pre-wrap' }}>{a.texteEn}</p>}
    <div className="pied"><Bouton onClick={() => fermer()}>Fermer</Bouton></div>
  </>
));

function texteAbsences(n: number, justifiees: number) {
  if (!n) return 'Aucune absence';
  return `${pluriel(n, 'demi-journée')} d’absence`;
}
function detailAbsences(n: number, justifiees: number) {
  if (!n) return 'Ce trimestre';
  const accord = (k: number) => (k > 1 ? 'justifiées' : 'justifiée');
  return `Ce trimestre · ${justifiees === n ? (n > 1 ? 'toutes justifiées' : 'justifiée') : justifiees === 0 ? `non ${accord(n)}` : `dont ${justifiees} ${accord(justifiees)}`}`;
}

function EcranAccueilParent() {
  const moi = useMoi();
  const naviguer = useNavigate();
  const [params, setParams] = useSearchParams();
  const { d, erreur, recharger } = useDonnees<AccueilParent>(() => api.get('/portail/accueil'));
  const voulu = params.get('eleve') ?? lire<string | null>(CLE_ENFANT, null);
  const e = d?.enfants.find((x) => x.eleveId === voulu) ?? d?.enfants[0] ?? null;
  const choisir = (id: string) => { ecrire(CLE_ENFANT, id); setParams({ eleve: id }, { replace: true }); };
  const prochaine = e?.prochaine;
  const echeance = !e ? null : !prochaine ? <span>Tout est payé pour cette année.</span>
    : prochaine.enRetard
      ? <span><b>{fcfa(prochaine.montant)}</b> {deLa(prochaine.ligne.toLowerCase())}, à payer depuis le {jjmm(prochaine.date)}</span>
      : <span><b>{fcfa(prochaine.montant)}</b> {deLa(prochaine.ligne.toLowerCase())} avant le {jjmm(prochaine.date)}</span>;
  const annee = d?.annee ?? moi.annee;
  return (
    <Mobile onglets={ONGLETS_PARENT} actif="/parent/accueil" trait grand titre={d?.salutation ? `Bonjour, ${d.salutation}` : 'Bonjour'}
      sous={`${moi.etablissement}${annee ? ` · année\u00a0${anneeTiret(annee)}` : ''}`}
      actions={<><BoutonMode /><BoutonMessages nonLus={d?.nonLus ?? 0} /></>}
      entete={<ChoixEnfant enfants={d?.enfants} choisi={e?.eleveId} choisir={choisir} />}>
      {erreur ? <ErreurMobile message={erreur} recharger={recharger} /> : !d ? <Chargement /> : (
        <>
          {d.enfants.length === 0 && <Vide icone="eleves">Aucun enfant inscrit cette année. Rapprochez-vous du secrétariat de l’école.</Vide>}
          {e && (
            <div className="m-deux">
              <Col>
                <Carte style={ordre(1)}>
                  <TeteCarte titre={`Scolarité ${de(e.prenom)}`} lien={`/parent/paiements?eleve=${e.eleveId}`} libelle="Détail" />
                  <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 }}>
                    <div className="m-pile" style={{ gap: 2, flex: 'none' }}>
                      <span style={{ fontSize: 13, color: 'var(--doux)' }}>Reste à payer</span>
                      <span className="m-somme">{montant(e.resteDu)} <small>FCFA</small></span>
                    </div>
                    <BadgeSituation lignes={e.tranches} />
                  </div>
                  <Tranches lignes={e.tranches} />
                  <div className="m-encart"><Icone nom="emploiDuTemps" taille={18} />{echeance}</div>
                </Carte>
                {d.blocages.map((b) => (
                  <div key={b.eleveId} className="m-alerte" style={ordre(2)}><Icone nom="bouclier" taille={18} /><span><b>{b.prenom}</b> : {b.texte}</span></div>
                ))}
              </Col>
              <Col>
                <Carte serree style={ordre(3)}>
                  <TeteCarte titre="Dernières notes" lien={`/parent/notes?eleve=${e.eleveId}`} libelle="Tout voir" />
                  {e.dernieresNotes.length === 0 && <VideLigne icone="notes">Aucune note publiée pour l’instant.</VideLigne>}
                  {e.dernieresNotes.map((n, i) => (
                    <div key={i} className="m-ligne" style={{ padding: '8px 0' }}>
                      <div className="m-pile"><span className="gras">{n.matiere}</span><span className="m-petit">{n.sequence} · {jjmm(n.date)}</span></div>
                      <span className="m-note-chiffre">{decimal(n.valeur)}<small> / {n.bareme}</small></span>
                    </div>
                  ))}
                </Carte>
                <section className="m-carte cliquable" style={ordre(4)} role="link" tabIndex={0} aria-label={`${texteAbsences(e.absences, e.absencesJustifiees)}, ${detailAbsences(e.absences, e.absencesJustifiees)} : voir le détail`}
                  onClick={() => naviguer(`/parent/vie-scolaire?eleve=${e.eleveId}`)} onKeyDown={touche(() => naviguer(`/parent/vie-scolaire?eleve=${e.eleveId}`))}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span className="m-tuile" aria-hidden="true"><Icone nom="vieScolaire" taille={20} /></span>
                    <div className="m-pile"><span className="gras">{texteAbsences(e.absences, e.absencesJustifiees)}</span><span className="m-petit">{detailAbsences(e.absences, e.absencesJustifiees)}</span></div>
                    <Chevron />
                  </div>
                </section>
                <Carte ecart={6} style={ordre(5)}>
                  <span className="m-etiquette">Annonces</span>
                  {d.annonces.length === 0 && <VideLigne>Aucune annonce pour l’instant.</VideLigne>}
                  {d.annonces.map((a) => (
                    <div key={a.id} className="m-ligne cliquable" style={{ padding: '4px 0', minHeight: 44 }} role="button" tabIndex={0} aria-label={`Lire l’annonce : ${a.titre}`}
                      onClick={() => lireAnnonce(a)} onKeyDown={touche(() => lireAnnonce(a))}>
                      <div className="m-pile">
                        <span className="gras" style={{ fontSize: 13 }}>{a.titre}</span>
                        <span className="m-petit">{jjmm(isoNet(a.date))}{a.cible ? ` · ${a.cible}` : ''}</span>
                      </div>
                    </div>
                  ))}
                </Carte>
              </Col>
            </div>
          )}
          <Deconnexion vers="/connexion" />
        </>
      )}
    </Mobile>
  );
}

// ===================================================================== parent : notes et bulletin

interface ResultatBulletin {
  matieres: { matiereId: string; libelle: string; moyenne: number | null; appreciation: string | null }[];
  moyenne: number | null; rang: number | null; effectif: number;
  classe: { nom: string; moyenne: number | null };
  absences: { demiJournees: number; demiJourneesJustifiees: number };
  appreciationGenerale: string | null; principal: string | null; annee: string;
}
interface BulletinParent {
  prenom: string; classe: string; principal: string | null; periodes: { id: string; libelle: string; publie: boolean }[]; enseignants: Record<string, string>;
  periodeId: string | null; periode?: string; bulletin: ResultatBulletin | null; bloque: string | null;
}

/** Mention d'une moyenne sur 20 (barème des bulletins du primaire). */
const mention = (m: number | null) => (m === null ? '' : m >= 18 ? 'Excellent' : m >= 16 ? 'Très bien' : m >= 14 ? 'Bien' : m >= 12 ? 'Assez bien' : m >= 10 ? 'Passable' : 'Insuffisant');
function absencesBulletin(a: ResultatBulletin['absences']) {
  const n = a.demiJournees;
  const j = a.demiJourneesJustifiees;
  if (!n) return 'aucune';
  const accord = (mot: string, k: number) => `${mot}${k > 1 ? 's' : ''}`;
  return `${pluriel(n, 'demi-journée')}, ${j === n ? accord('justifiée', n) : j === 0 ? `non ${accord('justifiée', n)}` : `dont ${j} ${accord('justifiée', j)}`}`;
}
/** « 7e », avec l'exposant des maquettes. */
const Rang = ({ r }: { r: number | null }) => (r === null ? <>–</> : <>{r}<sup style={{ fontSize: 15 }}>{r === 1 ? 'er' : 'e'}</sup></>);

function bulletinComplet(d: BulletinParent, b: ResultatBulletin) {
  void ouvrirFenetre(`Bulletin ${de(d.prenom)} · ${d.periode === 'Annuel' ? 'bulletin annuel' : d.periode ?? ''}`, (fermer) => (
    <>
      <span className="m-petit">{d.classe} · année {anneeTiret(b.annee)} · moyenne de la classe : {note2(b.classe.moyenne)} · absences : {absencesBulletin(b.absences)}</span>
      <table className="m-tableau">
        <caption className="m-sr">Moyennes et appréciations par matière</caption>
        <thead><tr><th scope="col">Matière</th><th scope="col" className="num">Moyenne</th><th scope="col">Appréciation</th></tr></thead>
        <tbody>
          {b.matieres.map((m) => (
            <tr key={m.matiereId}>
              <td className="libelle">{m.libelle}</td>
              <td className="num" data-l="Moyenne">{decimal(m.moyenne)} / 20</td>
              <td data-l="Appréciation">{m.appreciation || mention(m.moyenne) || '–'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {b.appreciationGenerale && <p><b>Appréciation générale :</b> {b.appreciationGenerale}</p>}
      {b.principal && <span className="m-petit">{b.principal}, instituteur principal</span>}
      <span className="m-petit">Bulletin consultable à l’écran, sans téléchargement.</span>
      <div className="pied"><Bouton variante="principal" onClick={() => fermer()}>Fermer</Bouton></div>
    </>
  ), 640);
}

function EcranNotesParent() {
  const { enfants, choisi, choisir, erreur: erreurEnfants, recharger: rechargerEnfants } = useEnfant();
  const [params, setParams] = useSearchParams();
  const periodeVoulue = params.get('periode');
  const id = choisi?.eleveId ?? null;
  const { d, erreur, recharger } = useDonnees<BulletinParent | null>(
    () => (id ? api.get(`/portail/enfants/${id}/bulletin${requete({ periodeId: periodeVoulue })}`) : Promise.resolve(null)), [id, periodeVoulue]);
  const b = d?.bulletin ?? null;
  const choisirPeriode = (p: string) => { const q = new URLSearchParams(params); q.set('periode', p); setParams(q, { replace: true }); };
  const sous = d ? `${d.prenom} · ${d.classe}${d.principal ? ` · instituteur principal : ${nomCourt(d.principal)}` : ''}` : choisi ? `${choisi.prenom} · ${choisi.classe}` : undefined;
  const periodes = d?.periodes ?? [];
  return (
    <Mobile onglets={ONGLETS_PARENT} actif="/parent/notes" titre="Notes et bulletin" sous={sous} actions={<BoutonMessages />}
      entete={(
        <>
          {enfants && enfants.length > 1 && <ChoixEnfant enfants={enfants} choisi={choisi?.eleveId} choisir={(x) => { const q = new URLSearchParams(params); q.delete('periode'); q.set('eleve', x); ecrire(CLE_ENFANT, x); setParams(q, { replace: true }); }} />}
          {periodes.length > 0 && (
            <div className="m-segments" role="group" aria-label="Période">
              {periodes.map((p) => (
                <button key={p.id} type="button" aria-pressed={p.id === d?.periodeId} disabled={!p.publie && p.id !== d?.periodeId} onClick={() => choisirPeriode(p.id)}
                  title={p.publie ? undefined : 'Bulletin pas encore publié'}>{p.libelle}</button>
              ))}
            </div>
          )}
        </>
      )}>
      {erreurEnfants ? <ErreurMobile message={erreurEnfants} recharger={rechargerEnfants} /> : erreur ? <ErreurMobile message={erreur} recharger={recharger} /> : !enfants || (id && !d) ? <Chargement /> : (
        <>
          {!choisi && <Vide icone="eleves">Aucun enfant inscrit cette année.</Vide>}
          {d?.bloque && <div className="m-alerte"><Icone nom="bouclier" taille={18} /><span>{d.bloque}</span></div>}
          {d && !b && !d.bloque && <Vide icone="notes">Aucun bulletin publié pour l’instant : il apparaîtra ici dès que l’école le publiera.</Vide>}
          {d && b && (
            <div className="m-deux droite-large">
              <Col>
                <Carte style={ordre(1)}>
                  <div style={{ display: 'flex', alignItems: 'stretch', gap: 12 }}>
                    <div className="m-pile" style={{ gap: 2 }}>
                      <span className="m-etiquette">Moyenne</span>
                      <span className="m-somme" style={{ fontSize: 34, letterSpacing: '-0.02em' }}>{note2(b.moyenne)}<small> / 20</small></span>
                    </div>
                    <div aria-hidden="true" style={{ width: 1, background: 'var(--m-ligne)' }} />
                    <div className="m-pile" style={{ gap: 2 }}>
                      <span className="m-etiquette">Rang</span>
                      <span className="m-somme" style={{ fontSize: 34 }}><Rang r={b.rang} /><small> sur {b.effectif}</small></span>
                    </div>
                  </div>
                  {b.appreciationGenerale && <p className="m-encart" style={{ display: 'block', margin: 0, lineHeight: 1.5 }}><b>Appréciation :</b> {b.appreciationGenerale}</p>}
                </Carte>
                <button type="button" className="m-bouton m-cache-petit" style={ordre(3)} onClick={() => bulletinComplet(d, b)}><Icone nom="bulletin" taille={20} />Voir le bulletin complet</button>
              </Col>
              <Col>
                <Carte serree style={ordre(2)} ariaLabel="Moyennes par matière">
                  <span className="m-etiquette">Par matière</span>
                  <div>
                    {b.matieres.map((m) => {
                      const prof = d.enseignants[m.matiereId];
                      const quoi = [mention(m.moyenne), prof ? nomCourt(prof) : null].filter(Boolean).join(' · ');
                      return (
                        <div key={m.matiereId} className="m-ligne" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6, minHeight: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                            <span className="gras" style={{ flex: 1 }}>{m.libelle}</span>
                            <span style={{ fontSize: 16, fontWeight: 700, whiteSpace: 'nowrap' }}>{decimal(m.moyenne)}<small style={{ fontSize: 12, fontWeight: 500, color: 'var(--doux)' }}> / 20</small></span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <div className="m-barre" aria-hidden="true"><div style={{ width: `${Math.max(0, Math.min(100, ((m.moyenne ?? 0) * 100) / 20))}%` }} /></div>
                            {quoi && <span className="m-petit" style={{ whiteSpace: 'nowrap' }}>{quoi}</span>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </Carte>
              </Col>
              <button type="button" className="m-bouton m-cache-large" style={ordre(4)} onClick={() => bulletinComplet(d, b)}><Icone nom="bulletin" taille={20} />Voir le bulletin complet</button>
            </div>
          )}
          <span className="m-petit" style={ordre(99)}>Bulletin consultable à l’écran, sans téléchargement. Il s’affiche quand la tranche de la période est payée à 90 % au moins (100 % pour le bulletin de fin d’année).</span>
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
  const auj = aujourdhuiIso();
  const banque = d ? [d.banque, d.numeroCompte ? `compte ${d.numeroCompte}` : null].filter(Boolean).join(', ') : '';
  return (
    <Mobile onglets={ONGLETS_PARENT} actif="/parent/paiements" titre="Paiements" actions={<BoutonMessages />}
      entete={<ChoixEnfant enfants={enfants} choisi={choisi?.eleveId} choisir={choisir} />}>
      {erreurEnfants ? <ErreurMobile message={erreurEnfants} recharger={rechargerEnfants} /> : erreur ? <ErreurMobile message={erreur} recharger={recharger} /> : !enfants || (id && !d) ? <Chargement /> : (
        <>
          {!d && <Vide icone="eleves">Aucun enfant inscrit cette année.</Vide>}
          {d && (
            <div className="m-deux">
              <Col>
                <Carte style={ordre(1)}>
                  <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 }}>
                    <div className="m-pile" style={{ gap: 2, flex: 'none' }}>
                      <span style={{ fontSize: 13, color: 'var(--doux)' }}>Reste à payer pour l’année</span>
                      <span className="m-somme" style={{ fontSize: 30 }}>{montant(d.resteDu)} <small>FCFA</small></span>
                    </div>
                    <BadgeSituation lignes={d.lignes} />
                  </div>
                  <Tranches lignes={d.lignes} />
                </Carte>
                <Carte ecart={10} style={ordre(4)}>
                  <span className="m-etiquette">Comment payer</span>
                  <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                    <Icone nom="fraisCaisse" taille={20} style={{ flex: 'none', color: 'var(--accent)' }} />
                    <span style={{ fontSize: 13, lineHeight: 1.5 }}><b style={{ fontWeight: 600 }}>Au guichet de l’école</b>, auprès de l’économe. Le reçu arrive ici aussitôt.</span>
                  </div>
                  <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                    <Icone nom="virement" taille={20} style={{ flex: 'none', color: 'var(--accent)' }} />
                    <span style={{ fontSize: 13, lineHeight: 1.5 }}><b style={{ fontWeight: 600 }}>Par virement bancaire</b>{banque ? ` (${banque})` : ''} : apportez le bordereau à l’économe, qui le pointe sur le relevé.</span>
                  </div>
                </Carte>
              </Col>
              <Col>
                <Carte serree style={ordre(2)} ariaLabel="Échéancier">
                  <span className="m-etiquette">Échéancier · {d.classe}</span>
                  <div>
                    {d.lignes.length === 0 && <VideLigne icone="fraisCaisse">Aucun frais à régler pour l’instant.</VideLigne>}
                    {d.lignes.map((l, i) => {
                      const retard = !l.solde && l.dateLimite < auj;
                      const partiel = !l.solde && l.reste < l.aPayer;
                      return (
                        <div key={i} className="m-ligne">
                          <div className="m-pile">
                            <span className="gras">{l.libelle}</span>
                            {l.solde
                              ? <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--succes)' }}>Payée{l.reduction ? ` · réduction ${l.reduction.toLowerCase()}` : ''}</span>
                              : retard
                                ? <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--attention)' }}>Reste {montant(l.reste)} · limite dépassée ({jjmm(l.dateLimite)})</span>
                                : <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--doux)' }}>{partiel ? `Reste ${montant(l.reste)} avant le ` : 'Avant le '}{dateCourte(l.dateLimite)}</span>}
                          </div>
                          <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{fcfa(l.aPayer)}</span>
                        </div>
                      );
                    })}
                  </div>
                </Carte>
                <Carte serree style={ordre(3)} ariaLabel="Reçus">
                  <span className="m-etiquette">Reçus</span>
                  <div>
                    {d.recus.length === 0 && <VideLigne icone="lire">Aucun versement pour l’instant : vos reçus apparaîtront ici après chaque paiement.</VideLigne>}
                    {d.recus.map((r) => (
                      <Link key={r.id} to={`/parent/recus/${r.id}?eleve=${id}`} className="m-ligne cliquable" style={{ padding: '9px 0' }} aria-label={`Reçu ${r.numero}, ${fcfa(r.montant)}, du ${jjmmaaaa(isoNet(r.date))}`}>
                        <div className="m-pile"><span className="gras">{r.numero}</span><span className="m-petit">{jjmmaaaa(isoNet(r.date))}{r.modeLibelle ? ` · ${r.modeLibelle}` : ''}</span></div>
                        <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{fcfa(r.montant)}</span>
                        <Chevron />
                      </Link>
                    ))}
                  </div>
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
    <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}><span className="m-petit">{libelle}</span><span style={{ fontWeight: 600 }}>{valeur}</span></div>
  );
  const total = (f: (l: RecuParent['lignes'][number]) => number) => d?.lignes.reduce((s, l) => s + f(l), 0) ?? 0;
  return (
    <Mobile onglets={ONGLETS_PARENT} actif="/parent/paiements" retour={`/parent/paiements${eleve ? `?eleve=${eleve}` : ''}`}
      titre={d ? `Reçu ${d.numero}` : 'Reçu'} sous={d ? `${d.date} à ${d.heure}` : undefined}>
      {erreur ? <ErreurMobile message={erreur} recharger={recharger} /> : !d ? <Chargement /> : (
        <>
          {d.annule && <div className="m-alerte"><Icone nom="alerte" taille={18} /><span>Ce versement a été annulé : le reçu n’a plus de valeur.</span></div>}
          <div className="m-deux">
            <Col>
              <Carte ecart={0} style={{ padding: 0, overflow: 'hidden', ...ordre(1) }}>
                <div aria-hidden="true" style={{ height: 6, background: 'var(--accent)' }} />
                <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div className="m-pile" style={{ gap: 2 }}>
                    <span style={{ fontWeight: 700 }}>{[d.etablissement.nom_fr, d.etablissement.nom_en].filter(Boolean).join(' · ').toUpperCase()}</span>
                    {(d.etablissement.ville_bp || d.etablissement.telephone) && (
                      <span className="m-petit">{[d.etablissement.ville_bp, d.etablissement.telephone ? `Tél. ${d.etablissement.telephone}` : null].filter(Boolean).join(' · ')}</span>
                    )}
                  </div>
                  <div className="m-pile" style={{ gap: 2 }}>
                    <span className="m-etiquette">Reçu de paiement · Payment receipt</span>
                    <span style={{ fontSize: 17, fontWeight: 700, color: 'var(--accent)' }}>N° {d.numero}</span>
                    <span className="m-petit">{d.date} à {d.heure}</span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 12px', padding: '10px 12px', borderRadius: 8, background: 'var(--m-encart)' }}>
                    {champ('Élève / Student', d.eleve)}{champ('Matricule / Reg. no.', d.matricule)}{champ('Classe / Class', d.classe)}{champ('Année / Year', d.annee)}
                  </div>
                </div>
              </Carte>
              <Carte ecart={6} style={ordre(3)}>
                <span className="m-etiquette">Montant versé / Amount paid</span>
                <span className="m-somme">{montant(d.montant)} <small>FCFA</small></span>
                <span style={{ fontSize: 13 }}>{d.montantLettresFr} · {d.montantLettresEn}</span>
                <span className="m-petit">Mode / Method : {d.modeFr} / {d.modeEn}{d.bordereau ? ` · bordereau ${d.bordereau}` : ''}</span>
                <span className="m-petit">Encaissé par / Received by : {d.caissier}</span>
              </Carte>
            </Col>
            <Col>
              <Carte serree style={{ padding: '6px 16px', ...ordre(2) }}>
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
          <span className="m-petit" style={ordre(99)}>Reçu consultable à l’écran, sans téléchargement. L’original papier reste celui remis à la caisse.</span>
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
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

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
    <Mobile onglets={ONGLETS_PARENT} actif="/parent/agenda" titre="Agenda" actions={<BoutonMessages />}
      sous={courant ? `${courant.prenom} · ${courant.classe} · ${large ? 'semaine' : jourDate(courant.date)}` : choisi ? `${choisi.prenom} · ${choisi.classe}` : undefined}
      entete={<ChoixEnfant enfants={enfants} choisi={choisi?.eleveId} choisir={choisir} />}>
      {erreurEnfants ? <ErreurMobile message={erreurEnfants} recharger={rechargerEnfants} /> : (
        <>
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
              ) : <Carte serree><span className="m-etiquette">Emploi du temps</span><div>{listeCours(courant)}</div></Carte>}
              <Carte serree>
                <span className="m-etiquette">Devoirs à faire</span>
                <div>
                  {courant.devoirs.length === 0 && <VideLigne icone="notes">Aucun devoir à faire pour l’instant.</VideLigne>}
                  {courant.devoirs.map((x, i) => {
                    const pour = pourLe(x.pour);
                    return (
                      <div key={i} className="m-ligne">
                        <div className="m-pile"><span className="gras">{x.matiere}</span><span style={{ fontSize: 13 }}>{x.devoir}</span></div>
                        {pour && <span className="m-badge attention">{pour}</span>}
                      </div>
                    );
                  })}
                </div>
              </Carte>
            </>
          )}
        </>
      )}
    </Mobile>
  );
}

// ===================================================================== parent : messagerie (RG-42 : un seul destinataire)

interface Evenement { type: string; prenom: string; date: string; texte: string; inscriptionId: string | null; jour: string | null; justifiable: boolean }
interface MessagesParent {
  famille: string;
  annonces: Annonce[];
  evenements: Evenement[];
  conversations: { id: string; eleveId: string | null; destinataire: string; sujet: string | null; nonLu: boolean; dernier: string | null; dernierAuteur: string | null; date: string }[];
}
interface Conversation { id: string; destinataire: string; sujet: string | null; messages: { auteurType: string; auteur: string; texte: string; envoyeLe: string }[] }
interface Destinataire { code: string; role: string; nom: string; aide: string }
const DESTINATAIRES: Record<string, string> = { instituteur_principal: 'Instituteur principal', econome: 'Économe', directeur: 'Directeur', secretaire: 'Secrétaire' };
const CODES_DESTINATAIRES = Object.keys(DESTINATAIRES);

/** Séparateur de jour du fil : « Aujourd’hui », « Hier », « Lundi 9 novembre ». */
function jourFil(iso: string): string {
  const d = dateLocale(iso);
  if (!d) return jjmmaaaa(iso);
  const hier = new Date();
  hier.setDate(hier.getDate() - 1);
  if (d.toDateString() === new Date().toDateString()) return 'Aujourd’hui';
  if (d.toDateString() === hier.toDateString()) return 'Hier';
  return `${capitale(JOURS_LONGS[d.getDay()]!)} ${d.getDate()} ${MOIS[d.getMonth()]}${d.getFullYear() !== new Date().getFullYear() ? ` ${d.getFullYear()}` : ''}`;
}

function EcranMessagesParent() {
  const [params, setParams] = useSearchParams();
  const { enfants, choisi, choisir, erreur: erreurEnfants, recharger: rechargerEnfants } = useEnfant();
  const eleveId = choisi?.eleveId ?? null;
  const code = CODES_DESTINATAIRES.includes(params.get('destinataire') ?? '') ? params.get('destinataire')! : 'instituteur_principal';
  const choisirDestinataire = (c: string) => { const q = new URLSearchParams(params); q.set('destinataire', c); setParams(q, { replace: true }); };
  const { d: destinataires } = useDonnees<Destinataire[] | null>(
    () => (eleveId ? api.get(`/portail/destinataires${requete({ eleveId })}`) : Promise.resolve(null)), [eleveId]);
  // Vue d'ensemble : conversations de la famille (non lues signalées sur les puces), puis le fil choisi.
  const { d: vue, erreur, recharger } = useDonnees<MessagesParent>(() => api.get('/portail/messages'));
  const conversations = useMemo(() => (vue?.conversations ?? []).filter((c) => c.eleveId === eleveId && c.destinataire === code), [vue, eleveId, code]);
  const ids = conversations.map((c) => c.id).join(',');
  const { d: fils, erreur: erreurFil, recharger: rechargerFil } = useDonnees<Conversation[]>(
    () => Promise.all(conversations.map((c) => api.get<Conversation>(`/portail/conversations/${c.id}`))), [ids]);
  const [nonLus] = useState(() => new Set<string>());
  useEffect(() => { for (const c of vue?.conversations ?? []) if (c.nonLu && c.eleveId === eleveId) nonLus.add(c.destinataire); }, [vue, eleveId, nonLus]);
  const [texte, setTexte] = useState('');
  const [charge, setCharge] = useState(false);
  const bas = useRef<HTMLDivElement>(null);
  const messages = useMemo(() => (fils ?? []).flatMap((f) => f.messages).sort((a, b) => isoNet(a.envoyeLe).localeCompare(isoNet(b.envoyeLe))), [fils]);
  useEffect(() => { bas.current?.scrollIntoView({ block: 'end' }); }, [messages.length]);
  const dest = destinataires?.find((x) => x.code === code);
  const role = dest?.role ?? DESTINATAIRES[code]!;
  const envoyer = async () => {
    if (!eleveId || charge) return;
    if (texte.trim().length < 2) { signaler('Écrivez votre message avant de l’envoyer.', true); return; }
    setCharge(true);
    const r = await agir(() => api.post('/portail/messages', { destinataire: code, eleveId, texte: texte.trim() }), 'Message envoyé.');
    setCharge(false);
    if (r) { setTexte(''); await recharger(); void rechargerFil(); }
  };
  let jourPrecedent = '';
  return (
    <Mobile onglets={ONGLETS_PARENT} actif="/parent/accueil" sansOnglets retour="/parent/accueil" titre={role}
      sous={dest ? dest.nom || dest.aide : undefined}
      entete={(
        <div className="m-puces" role="group" aria-label="Écrire à">
          {CODES_DESTINATAIRES.map((c) => (
            <button key={c} type="button" className="m-puce" aria-pressed={c === code} onClick={() => { nonLus.delete(c); choisirDestinataire(c); }}
              aria-label={`${destinataires?.find((x) => x.code === c)?.role ?? DESTINATAIRES[c]}${nonLus.has(c) && c !== code ? ', message non lu' : ''}`}>
              {destinataires?.find((x) => x.code === c)?.role ?? DESTINATAIRES[c]}
              {nonLus.has(c) && c !== code && <span className="m-point" aria-hidden="true" />}
            </button>
          ))}
        </div>
      )}
      pied={(
        <form className="m-ecrire" onSubmit={(e) => { e.preventDefault(); void envoyer(); }}>
          <label htmlFor="m-message" className="m-sr">Votre message</label>
          <input id="m-message" type="text" enterKeyHint="send" autoComplete="off" placeholder={`Écrire ${role === 'Économe' ? 'à l’économe' : role === 'Secrétaire' ? 'au secrétariat' : `au ${role.toLowerCase()}`}…`}
            value={texte} onChange={(e) => setTexte(e.target.value)} disabled={!eleveId} maxLength={2000} />
          <button type="submit" className="m-envoyer" aria-label="Envoyer" disabled={charge || !eleveId}><Icone nom="envoi" taille={20} /></button>
        </form>
      )}>
      {erreurEnfants ? <ErreurMobile message={erreurEnfants} recharger={rechargerEnfants} /> : erreur ? <ErreurMobile message={erreur} recharger={recharger} /> : !enfants || !vue ? <Chargement /> : (
        <div className="m-fil" style={{ width: '100%', maxWidth: 760, alignSelf: 'center' }}>
          {enfants.length > 1 && (
            <div role="group" aria-label="Au sujet de" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
              <span className="m-petit">Au sujet de</span>
              {enfants.map((x) => <button key={x.eleveId} type="button" className="m-choix" style={{ minHeight: 36 }} aria-pressed={x.eleveId === eleveId} onClick={() => choisir(x.eleveId)}>{x.prenom}</button>)}
            </div>
          )}
          {erreurFil ? <ErreurMobile message={erreurFil} recharger={rechargerFil} /> : !fils ? <Chargement /> : messages.length === 0 ? (
            <div className="m-vide" style={{ justifyContent: 'center', textAlign: 'center', padding: '24px 8px' }}>
              <span>{dest ? `${dest.aide} : écrivez ${role === 'Économe' ? 'à l’économe' : role === 'Secrétaire' ? 'au secrétariat' : `au ${role.toLowerCase()}`}, la réponse arrivera ici et par SMS.` : 'Écrivez votre message, la réponse arrivera ici et par SMS.'}</span>
            </div>
          ) : messages.map((m, i) => {
            const iso = isoNet(m.envoyeLe);
            const jour = jourFil(iso);
            const sep = jour !== jourPrecedent;
            jourPrecedent = jour;
            const moi = m.auteurType === 'famille';
            return (
              <Fragment key={i}>
                {sep && <span className="m-jour-sep">{jour}</span>}
                <div className={`m-bulle ${moi ? 'moi' : 'ecole'}`}>
                  <span>{m.texte}</span>
                  <span><span className="m-sr">{moi ? 'Vous' : m.auteur}, à </span>{heure(iso)}</span>
                </div>
              </Fragment>
            );
          })}
          <div ref={bas} />
        </div>
      )}
    </Mobile>
  );
}

/** Ancienne adresse « Écrire à l'école » : la messagerie fait désormais les deux. */
function RedirectionEcrire() {
  const { search } = useLocation();
  return <Navigate to={`/parent/messages${search}`} replace />;
}

// ===================================================================== parent : vie scolaire (absences, observations, annonces)

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

function EcranVieScolaireParent() {
  // « lu=0 » : consulter les absences ne vaut pas lecture des messages.
  const { d, erreur, recharger } = useDonnees<MessagesParent>(() => api.get('/portail/messages?lu=0'));
  const justifier = (ev: Evenement) => void ouvrirFormulaire<boolean>('Justifier une absence', ({ fermer }) => <FormJustification ev={ev} fermer={fermer} />, 440)
    .then((ok) => { if (ok) void recharger(); });
  return (
    <Mobile onglets={ONGLETS_PARENT} actif="/parent/accueil" retour="/parent/accueil" titre="Vie scolaire" sous={d ? `Famille ${d.famille}` : undefined}>
      {erreur ? <ErreurMobile message={erreur} recharger={recharger} /> : !d ? <Chargement /> : (
        <div className="m-deux">
          <Col>
            <Carte serree style={ordre(1)}>
              <span className="m-etiquette">Absences et observations</span>
              <div>
                {d.evenements.length === 0 && <VideLigne icone="vieScolaire">Aucune absence ni observation : tout va bien.</VideLigne>}
                {d.evenements.map((ev, i) => (
                  <div key={i} className="m-ligne">
                    <div className="m-pile" style={{ gap: 3 }}>
                      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
                        <span className={`m-badge ${ev.type === 'Félicitations' ? 'succes' : 'attention'}`}>{ev.type}</span><span className="gras">{ev.prenom}</span>
                      </div>
                      <span className="m-petit">{jjmm(isoNet(ev.date))} · {ev.texte}</span>
                    </div>
                    {ev.justifiable && ev.inscriptionId && ev.jour && (
                      <button type="button" className="m-lien" aria-label={`Justifier l’absence de ${ev.prenom} du ${jjmm(ev.jour)}`} onClick={() => justifier(ev)}>Justifier</button>
                    )}
                  </div>
                ))}
              </div>
            </Carte>
          </Col>
          <Col>
            <Carte serree style={ordre(2)}>
              <span className="m-etiquette">Annonces</span>
              <div>
                {d.annonces.length === 0 && <VideLigne>Aucune annonce pour l’instant.</VideLigne>}
                {d.annonces.map((a) => (
                  <div key={a.id} className="m-ligne cliquable" role="button" tabIndex={0} aria-label={`Lire l’annonce : ${a.titre}`} onClick={() => lireAnnonce(a)} onKeyDown={touche(() => lireAnnonce(a))}>
                    <div className="m-pile">
                      <span className="gras" style={{ fontSize: 13 }}>{a.titre}</span>
                      <span className="m-petit">{jjmm(isoNet(a.date))}{a.cible ? ` · ${a.cible}` : ''}</span>
                    </div>
                    <Chevron />
                  </div>
                ))}
              </div>
            </Carte>
          </Col>
        </div>
      )}
    </Mobile>
  );
}

export const routes: RouteEcran[] = [
  { path: '/verifier/:code', element: <EcranVerifier /> },
  { path: '/connexion', element: <EcranConnexionSekou /> },
  { path: '/instituteur/connexion', element: <Navigate to="/connexion" replace /> },
  { path: '/instituteur/notes', element: <EcranNotesInstituteur /> },
  { path: '/instituteur/appel', element: <EcranAppelInstituteur /> },
  { path: '/parent/connexion', element: <Navigate to="/connexion" replace /> },
  { path: '/parent/accueil', element: <EcranAccueilParent /> },
  { path: '/parent/notes', element: <EcranNotesParent /> },
  { path: '/parent/paiements', element: <EcranPaiementsParent /> },
  { path: '/parent/recus/:id', element: <EcranRecuParent /> },
  { path: '/parent/agenda', element: <EcranAgendaParent /> },
  { path: '/parent/messages', element: <EcranMessagesParent /> },
  { path: '/parent/ecrire', element: <RedirectionEcrire /> },
  { path: '/parent/vie-scolaire', element: <EcranVieScolaireParent /> },
];
