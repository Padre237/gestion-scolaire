// pnpm demo:sauvegarde [--liste] — sauvegarde chiffrée de la base (même procédé que l'écran Données et la sauvegarde quotidienne).
import { lireOuCreerConfig, listerSauvegardes, sauvegarder } from '@gs/db';
import { drapeau } from './commun.ts';

const config = lireOuCreerConfig();
const taille = (o: number) => (o > 1048576 ? `${(o / 1048576).toFixed(1).replace('.', ',')} Mo` : `${Math.max(1, Math.round(o / 1024))} Ko`);
if (!drapeau('liste')) {
  const s = await sauvegarder(config, 'manuelle');
  console.log(`Sauvegarde enregistrée : ${s.nom} (${taille(s.taille)})`);
}
const liste = listerSauvegardes(config);
console.log(`\nSauvegardes conservées dans ${config.sauvegarde.dossier} :`);
for (const s of liste) console.log(`  ${s.nom.padEnd(52)} ${taille(s.taille).padStart(9)}  ${new Date(s.date).toLocaleString('fr-FR')}`);
