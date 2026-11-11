// pnpm demo:vide — base vierge : la structure, les sept rôles et un seul compte, celui de la secrétaire,
// dont vous choisissez le mot de passe au lancement (prompt § 6, E-06, D-07).
import { creerBase, lireOuCreerConfig, migrer } from '@gs/db';
import { Bd, creerPool } from '@gs/api/src/core/bd.ts';
import { creerEtablissement } from '@gs/api/src/core/etablissement.ts';
import { argument, demander, drapeau, sortir } from './commun.ts';

const config = lireOuCreerConfig();
console.log('Base vierge pour la démonstration.');
if (!drapeau('oui')) {
  const ok = await demander(`La base « ${config.pg.base} » sera effacée puis recréée. Tapez OUI pour continuer`);
  if (ok !== 'OUI') sortir('Rien n’a été modifié.', 0);
}
const nomFr = argument('nom-fr') ?? await demander('Nom de l’établissement en français', 'Groupe scolaire bilingue La Ruche d’Or');
const nomEn = argument('nom-en') ?? await demander('Nom de l’établissement en anglais', 'La Ruche d’Or Bilingual School');
const identifiant = (argument('identifiant') ?? await demander('Identifiant de la secrétaire', 'secretaire')).toLowerCase();
const nomAffiche = argument('nom') ?? await demander('Nom affiché de la secrétaire', 'Secrétaire');
let motDePasse = argument('mot-de-passe');
if (!motDePasse) {
  motDePasse = await demander('Mot de passe de la secrétaire (8 caractères au moins)', undefined, true);
  const confirmation = await demander('Confirmez le mot de passe', undefined, true);
  if (confirmation !== motDePasse) sortir('Les deux mots de passe diffèrent : rien n’a été modifié.');
}
if (motDePasse.length < 8) sortir('Mot de passe trop court (8 caractères au moins).');
if (!/^[a-z0-9._-]{3,40}$/.test(identifiant)) sortir('Identifiant : lettres minuscules, chiffres, point, tiret.');

await creerBase(config.pg, config.pg.base, true);
await migrer(config.pg, config.pg.base, (m) => console.log(`  ${m}`));
const pool = creerPool(config.pg);
await creerEtablissement(new Bd(pool), { nomFr, nomEn, secretaire: { identifiant, nomAffiche, motDePasse } });
await pool.end();
console.log(`\nBase prête. Connectez-vous avec l’identifiant « ${identifiant} » ; le mot de passe est haché (scrypt), il n’est écrit nulle part.`);
console.log('Lancez ensuite : pnpm demo:lancer');
