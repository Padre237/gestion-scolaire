// pnpm demo:restaurer [nom] [--oui] — remet la base dans l'état d'une sauvegarde. L'état actuel est d'abord sauvegardé,
// les connexions ouvertes sont coupées ; le serveur se reconnecte seul.
import { lireOuCreerConfig, listerSauvegardes, restaurer } from '@gs/db';
import { demander, drapeau, sortir } from './commun.ts';

const config = lireOuCreerConfig();
const liste = listerSauvegardes(config);
if (!liste.length) sortir(`Aucune sauvegarde dans ${config.sauvegarde.dossier}. Lancez d’abord : pnpm demo:sauvegarde`);
const demande = process.argv.slice(2).find((a) => !a.startsWith('--'));
let choisie = demande ? liste.find((s) => s.nom === demande || s.nom.includes(demande)) : undefined;
if (demande && !choisie) sortir(`Sauvegarde introuvable : ${demande}`);
if (!choisie) {
  liste.slice(0, 15).forEach((s, i) => console.log(`  ${String(i + 1).padStart(2)}. ${s.nom}  ${new Date(s.date).toLocaleString('fr-FR')}`));
  const n = Number(await demander('Numéro de la sauvegarde à restaurer', '1'));
  choisie = liste[n - 1] ?? sortir('Numéro inconnu.');
}
if (!drapeau('oui')) {
  const ok = await demander(`La base « ${config.pg.base} » sera remise dans l’état de ${choisie.nom}. Tapez OUI pour continuer`);
  if (ok !== 'OUI') sortir('Rien n’a été modifié.', 0);
}
const r = await restaurer(config, choisie.nom);
console.log(`Base restaurée depuis ${choisie.nom}.\nL’état d’avant est conservé dans ${r.avant.nom}.`);
