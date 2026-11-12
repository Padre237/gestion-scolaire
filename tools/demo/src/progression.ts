// pnpm demo:progression — barre de progression de demo:fictif, lue dans var/fictif.log (rafraîchie toutes les 2 s).
// Option --une-fois : affiche l'état et s'arrête.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { RACINE } from '@gs/db';

const JOURNAL = resolve(RACINE, 'var/fictif.log');
// Étapes de demo:fictif dans l'ordre, avec leur poids (durées relatives observées).
const ETAPES: [string, string, number][] = [
  ['Établissement, personnel', 'Établissement et personnel', 2],
  ['A1 Grille des frais', 'Grille des frais', 1], ['A1 Affectations', 'Emploi du temps', 1], ['A1 Inscriptions', 'Inscriptions', 12],
  ['A1 Versements', 'Versements et caisse', 10], ['A1 Notes', 'Notes et bulletins', 8], ['A1 Appels', 'Appels et absences', 6],
  ['A1 Annonces', 'Annonces', 1], ['A1 Départs', 'Clôture', 1],
  ['A2 Affectations', 'Emploi du temps', 1], ['A2 Inscriptions', 'Inscriptions', 3], ['A2 Versements', 'Versements et caisse', 10],
  ['A2 Notes', 'Notes et bulletins', 8], ['A2 Appels', 'Appels et absences', 6], ['A2 Annonces', 'Annonces', 1], ['A2 Départs', 'Clôture', 1],
  ['A3 Affectations', 'Emploi du temps', 1], ['A3 Inscriptions', 'Inscriptions', 3], ['A3 Versements', 'Versements et caisse', 6],
  ['A3 Notes', 'Notes en cours', 3], ['A3 Appels', 'Appels et absences', 6], ['A3 Annonces', 'Annonces', 1], ['A3 Caisse du jour', 'Caisse du jour', 2],
];
const TOTAL = ETAPES.reduce((s, e) => s + e[2], 0);

function etat() {
  if (!existsSync(JOURNAL)) return { texte: 'Aucune génération en cours (var/fictif.log absent).', fini: true };
  const lignes = readFileSync(JOURNAL, 'utf8').split('\n');
  const derniereEcriture = statSync(JOURNAL).mtimeMs;
  let annee = 0, libelleAnnee = '', faites = -1, secondes = 0;
  for (const l of lignes) {
    const a = l.match(/^=== Année (\S+)/);
    if (a) { annee++; libelleAnnee = a[1]!; continue; }
    const m = l.match(/^(.+?)… \((\d+) s\)/);
    if (!m) continue;
    secondes = Number(m[2]);
    const cle = annee === 0 ? m[1]! : `A${annee} ${m[1]!}`;
    const i = ETAPES.findIndex(([k], j) => j > faites && cle.startsWith(k));
    if (i >= 0) faites = i;
  }
  const erreur = lignes.find((l) => /^(error|Error|TypeError)|No space left/.test(l));
  const fini = lignes.some((l) => l.includes('Base de répétition prête'));
  const poidsAvant = ETAPES.slice(0, Math.max(0, faites)).reduce((s, e) => s + e[2], 0);
  const courante = ETAPES[Math.max(0, faites)];
  const part = fini ? 1 : Math.min(0.99, (poidsAvant + (courante ? courante[2] / 2 : 0)) / TOTAL);
  // Temps écoulé : celui de la dernière étape annoncée, plus le temps passé depuis la dernière écriture du journal.
  const ecoule = secondes + (fini ? 0 : (Date.now() - derniereEcriture) / 1000);
  const reste = part > 0.02 && !fini ? (ecoule / part) * (1 - part) : null;
  const largeur = 40;
  const plein = Math.round(part * largeur);
  const barre = `[${'█'.repeat(plein)}${'░'.repeat(largeur - plein)}] ${String(Math.round(part * 100)).padStart(3)} %`;
  const min = (s: number) => `${Math.floor(s / 60)} min`;
  const detail = fini ? 'Terminé : base prête.'
    : erreur ? `Arrêt sur erreur : ${erreur.slice(0, 120)}`
      : `Année ${annee || 1}/3${libelleAnnee ? ` (${libelleAnnee})` : ''} · ${courante?.[1] ?? 'démarrage'} · écoulé ${min(ecoule)}${reste ? ` · reste ≈ ${min(reste)}` : ''}`;
  return { texte: `${barre}  ${detail}`, fini: fini || !!erreur };
}

const uneFois = process.argv.includes('--une-fois') || !process.stdout.isTTY;
if (uneFois) { console.log(etat().texte); process.exit(0); }
const tour = () => {
  const e = etat();
  process.stdout.write(`\r\x1b[2K${e.texte}`);
  if (e.fini) { process.stdout.write('\n'); process.exit(0); }
};
tour();
setInterval(tour, 2000);
