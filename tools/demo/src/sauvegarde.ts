// pnpm demo:sauvegarde [--liste] — sauvegarde chiffrée de la base (même procédé que l'écran Données et la sauvegarde quotidienne).
import { lireOuCreerConfig, listerSauvegardes, motifValide, sauvegarder } from '@gs/db';
import { argument, drapeau, sortir } from './commun.ts';

const config = lireOuCreerConfig();
const taille = (o: number) => (o > 1048576 ? `${(o / 1048576).toFixed(1).replace('.', ',')} Mo` : `${Math.max(1, Math.round(o / 1024))} Ko`);
if (!drapeau('liste')) {
  // --nom depart : sauvegarde nommée, gardée jusqu'à ce que vous l'effaciez ; pnpm demo:restaurer depart la retrouve.
  const nom = (argument('nom') ?? 'manuelle').toLowerCase().normalize('NFD').replace(/[^a-z0-9-]/g, '');
  if (!motifValide(nom)) sortir('Nom de sauvegarde : lettres minuscules, chiffres et tirets.');
  const s = await sauvegarder(config, nom);
  console.log(`Sauvegarde enregistrée : ${s.nom} (${taille(s.taille)})`);
}
const liste = listerSauvegardes(config);
console.log(`\nSauvegardes conservées dans ${config.sauvegarde.dossier} :`);
for (const s of liste) console.log(`  ${s.nom.padEnd(52)} ${taille(s.taille).padStart(9)}  ${new Date(s.date).toLocaleString('fr-FR')}`);
