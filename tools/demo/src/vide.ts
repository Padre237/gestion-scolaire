// pnpm demo:vide — base vierge : la structure, les sept rôles et les comptes de l'administration (secrétaire, directeur,
// économe, préfet des études), sans aucun élève ni parent. Les mots de passe se choisissent au lancement ou sont tirés au
// sort ; ils sont hachés en base et écrits, une fois, dans COMPTES-DEMO.md (fichier local, hors dépôt) (prompt § 6, E-06, D-07).
//
// Options : --oui (sans confirmation) --defauts (toutes les valeurs proposées, sans question) --nom-fr … --nom-en … --identifiant … --nom … --mot-de-passe … (secrétaire)
//           --sans-administration (secrétaire seule) --comptes <fichier> (défaut : COMPTES-DEMO.md à la racine) --sans-fichier
//           --mot-de-passe-directeur … --mot-de-passe-econome … --mot-de-passe-prefet … (sinon tirés au sort)
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { creerBase, lireOuCreerConfig, migrer, RACINE } from '@gs/db';
import { Bd, creerPool } from '@gs/api/src/core/bd.ts';
import { construireApp } from '@gs/api/src/app.ts';
import { creerEtablissement } from '@gs/api/src/core/etablissement.ts';
import { motDePasseAleatoire } from '@gs/api/src/core/motdepasse.ts';
import { connecter } from './client.ts';
import { argument, demander, drapeau, sortir } from './commun.ts';

const config = lireOuCreerConfig();
console.log('Base vierge : structure, rôles et comptes de l’administration. Aucun élève, aucun parent.');
if (!drapeau('oui')) {
  const ok = await demander(`La base « ${config.pg.base} » sera effacée puis recréée. Tapez OUI pour continuer`);
  if (ok !== 'OUI') sortir('Rien n’a été modifié.', 0);
}
const nomFr = argument('nom-fr') ?? await demander('Nom de l’établissement en français', 'Groupe scolaire bilingue La Ruche d’Or');
const nomEn = argument('nom-en') ?? await demander('Nom de l’établissement en anglais', 'La Ruche d’Or Bilingual School');
const identifiant = (argument('identifiant') ?? await demander('Identifiant de la secrétaire', 'secretaire')).toLowerCase();
const nomAffiche = argument('nom') ?? await demander('Nom affiché de la secrétaire', 'Mme NDZANA Rose');
let motDePasse = argument('mot-de-passe');
if (!motDePasse) {
  motDePasse = await demander('Mot de passe de la secrétaire (8 caractères au moins ; vide : tiré au sort)', undefined, true);
  if (motDePasse) {
    const confirmation = await demander('Confirmez le mot de passe', undefined, true);
    if (confirmation !== motDePasse) sortir('Les deux mots de passe diffèrent : rien n’a été modifié.');
  } else motDePasse = motDePasseAleatoire(10);
}
if (motDePasse.length < 8) sortir('Mot de passe trop court (8 caractères au moins).');
if (!/^[a-z0-9._-]{3,40}$/.test(identifiant)) sortir('Identifiant : lettres minuscules, chiffres, point, tiret.');

// Les autres comptes de l'administration : fiche du personnel puis compte, par l'API, comme à l'écran Personnel.
interface Admin { cle: string; role: string; fonction: string; libelle: string; nomDefaut: string; identifiantDefaut: string }
const ADMINS: Admin[] = [
  { cle: 'directeur', role: 'directeur', fonction: 'directeur', libelle: 'Directeur ou directrice', nomDefaut: 'Mme ATEBA Marie-Claire', identifiantDefaut: 'directrice' },
  { cle: 'econome', role: 'econome', fonction: 'econome', libelle: 'Économe', nomDefaut: 'M. MBIDA Paul', identifiantDefaut: 'econome' },
  { cle: 'prefet', role: 'prefet', fonction: 'prefet', libelle: 'Préfet des études', nomDefaut: 'M. NKOULOU Gérard', identifiantDefaut: 'prefet' },
];
const comptes: { role: string; nom: string; identifiant: string; motDePasse: string }[] = [{ role: 'Secrétaire', nom: nomAffiche, identifiant, motDePasse }];
const demandes: { a: Admin; nom: string; identifiant: string; motDePasse: string }[] = [];
// Le directeur est toujours créé (il est seul à gérer les comptes et les rôles, D-46) ; --sans-administration ne retire que l'économe et le préfet.
for (const a of ADMINS.filter((x) => x.cle === 'directeur' || !drapeau('sans-administration'))) {
  const nom = argument(`nom-${a.cle}`) ?? await demander(`Nom affiché · ${a.libelle}`, a.nomDefaut);
  const id = (argument(`identifiant-${a.cle}`) ?? await demander(`Identifiant · ${a.libelle}`, a.identifiantDefaut)).toLowerCase();
  if (!/^[a-z0-9._-]{3,40}$/.test(id) || id === identifiant || demandes.some((d) => d.identifiant === id)) sortir(`Identifiant invalide ou déjà pris : ${id}`);
  const mdp = argument(`mot-de-passe-${a.cle}`) ?? motDePasseAleatoire(10);
  if (mdp.length < 8) sortir(`Mot de passe trop court pour ${id} (8 caractères au moins).`);
  demandes.push({ a, nom, identifiant: id, motDePasse: mdp });
}

await creerBase(config.pg, config.pg.base, true);
await migrer(config.pg, config.pg.base, (m) => console.log(`  ${m}`));
const pool = creerPool(config.pg);
const bd = new Bd(pool);
const dirDemande = demandes.find((d) => d.a.cle === 'directeur')!;
await creerEtablissement(bd, { nomFr, nomEn, secretaire: { identifiant, nomAffiche, motDePasse },
  directeur: { identifiant: dirDemande.identifiant, nomAffiche: dirDemande.nom, motDePasse: dirDemande.motDePasse } });
comptes.push({ role: dirDemande.a.libelle, nom: dirDemande.nom, identifiant: dirDemande.identifiant, motDePasse: dirDemande.motDePasse });
{
  const app = await construireApp({ bd, dossierWeb: '/inexistant', journal: false });
  await app.ready();
  try {
    const sec = await connecter(app, identifiant, motDePasse);
    // Sections préinstallées (lot 1, D-40) : maternelle et primaire, francophones et anglophones, avec leurs niveaux.
    // Les classes et les matières viennent avec la première année scolaire, créée dans l'assistant de configuration.
    for (const sousSysteme of ['francophone', 'anglophone']) for (const ordreEnseignement of ['maternelle', 'primaire']) await sec.post('/structure/cycles', { sousSysteme, ordreEnseignement });
    const dir = await connecter(app, dirDemande.identifiant, dirDemande.motDePasse);
    const roles = await dir.get<{ id: string; code: string }[]>('/core/roles');
    for (const d of demandes.filter((x) => x !== dirDemande)) {
      const fiche = await sec.post<{ id: string }>('/personnel', { nomAffiche: d.nom, fonction: d.a.fonction, statut: 'permanent' });
      const role = roles.find((r) => r.code === d.a.role);
      if (!role) sortir(`Rôle introuvable : ${d.a.role}`);
      await dir.post('/core/comptes', { identifiant: d.identifiant, nomAffiche: d.nom, personnelId: fiche.id, roles: [{ roleId: role.id }], motDePasse: d.motDePasse });
      comptes.push({ role: d.a.libelle, nom: d.nom, identifiant: d.identifiant, motDePasse: d.motDePasse });
    }
  } finally {
    await app.close();
  }
}
await pool.end();

console.log('\nBase prête. Les mots de passe sont hachés en base (scrypt) ; les voici, une seule fois :');
for (const c of comptes) console.log(`  ${c.role.padEnd(24)} ${c.identifiant.padEnd(14)} ${c.motDePasse}`);
if (!drapeau('sans-fichier')) {
  const chemin = resolve(RACINE, argument('comptes') ?? 'COMPTES-DEMO.md');
  const date = new Date().toLocaleDateString('fr-FR');
  const lignes = [
    '# Comptes de la démonstration', '',
    `Fichier local, écrit par \`pnpm demo:vide\` le ${date} ; il n’entre jamais dans le dépôt (\`.gitignore\`). Gardez-le pour vous : les mots de passe ne s’affichent plus nulle part.`, '',
    `Établissement : ${nomFr} · ${nomEn}. Base vide : aucun élève, aucun parent. Les instituteurs se créent dans Personnel, les classes dans Paramètres › Établissement.`, '',
    'Connexion : sur ce PC http://localhost:8080 ; sur un téléphone du même Wi-Fi, l’adresse affichée par `pnpm demo:lancer`.', '',
    '| Rôle | Nom | Identifiant | Mot de passe |', '|---|---|---|---|',
    ...comptes.map((c) => `| ${c.role} | ${c.nom} | \`${c.identifiant}\` | \`${c.motDePasse}\` |`), '',
    'Pour revenir à cet état après une répétition : `pnpm demo:sauvegarde --nom depart` tout de suite, puis `pnpm demo:restaurer depart --oui` plus tard.', '',
  ];
  writeFileSync(chemin, lignes.join('\n'), { mode: 0o600 });
  console.log(`\nComptes écrits dans ${chemin} (lisible par vous seul).`);
}
console.log('Lancez ensuite : pnpm demo:lancer');
