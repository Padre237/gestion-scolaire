// pnpm synchro:essai — essai local de l'application hybride (D-49) : une seconde instance joue la version en ligne.
//   1. copie de la base du poste dans gestion_scolaire_en_ligne (pg_dump / pg_restore dans le conteneur) ;
//   2. configuration var/en-ligne/config.json (rôle « en_ligne ») et réglage du poste (rôle « principal ») avec un jeton commun ;
//   3. démarrage de la version en ligne sur http://localhost:8090 (journal : var/en-ligne/serveur.log).
// Le poste de l'école (pnpm demo:lancer) échange alors ses modifications avec elle toutes les 30 secondes.
// Option --arreter : arrête la version en ligne et retire le réglage de synchronisation du poste.
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, openSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cheminConfig, connexionProprietaire, creerBase, lireOuCreerConfig, migrer, RACINE, type Config } from '@gs/db';
import { drapeau, sortir } from './commun.ts';

const PORT_LOCAL = 8090;
const BASE = 'gestion_scolaire_en_ligne';
const dossier = resolve(RACINE, 'var/en-ligne');
const ecrire = (chemin: string, c: Config) => { writeFileSync(chemin, JSON.stringify(c, null, 2) + '\n', { mode: 0o600 }); chmodSync(chemin, 0o600); };
const pidSur = (port: number) => spawnSync('ss', ['-ltnpH', `sport = :${port}`], { encoding: 'utf8' }).stdout.match(/pid=(\d+)/)?.[1];

const poste = lireOuCreerConfig();
if (drapeau('arreter')) {
  const pid = pidSur(PORT_LOCAL);
  if (pid) process.kill(Number(pid));
  delete poste.synchro;
  ecrire(cheminConfig(), poste);
  console.log('Version en ligne arrêtée ; le poste ne se synchronise plus.');
  process.exit(0);
}
if (pidSur(PORT_LOCAL)) sortir(`Le port ${PORT_LOCAL} est déjà occupé : la version en ligne tourne peut-être déjà (pnpm synchro:essai --arreter pour l'arrêter).`);

// 1. Copie de la base du poste (données comprises) : la version en ligne part du même état.
const superUtilisateur = spawnSync('docker', ['exec', 'gs-postgres', 'printenv', 'POSTGRES_USER'], { encoding: 'utf8' }).stdout.trim();
if (!superUtilisateur) sortir('Conteneur gs-postgres introuvable : lancez d’abord pnpm demo:lancer.');
console.log('Copie de la base du poste…');
await creerBase(poste.pg, BASE, true);
const copie = spawnSync('sh', ['-c',
  `docker exec gs-postgres pg_dump -U ${superUtilisateur} -d ${poste.pg.base} -Fc | docker exec -i gs-postgres pg_restore -U ${superUtilisateur} -d ${BASE} --no-comments`],
{ encoding: 'utf8' });
if (copie.status !== 0 && !/warning|avertissement/i.test(copie.stderr)) sortir(`Copie impossible : ${copie.stderr.slice(0, 400)}`);

// 2. Réglages : même jeton des deux côtés.
const jeton = poste.synchro?.jeton ?? randomBytes(24).toString('base64url');
mkdirSync(dossier, { recursive: true });
const enLigne: Config = JSON.parse(JSON.stringify(poste));
enLigne.pg.base = BASE;
enLigne.serveur = { ...enLigne.serveur, port: 8453, portLocal: PORT_LOCAL } as Config['serveur'];
enLigne.sauvegarde = { ...enLigne.sauvegarde, dossier: resolve(dossier, 'sauvegardes') };
enLigne.synchro = { role: 'en_ligne', jeton };
const cheminEnLigne = resolve(dossier, 'config.json');
ecrire(cheminEnLigne, enLigne);
await migrer(enLigne.pg, BASE);
poste.synchro = { role: 'principal', adresse: `http://localhost:${PORT_LOCAL}`, jeton, intervalleSecondes: 30 };
ecrire(cheminConfig(), poste);

// Départ commun : la copie contient déjà tout, chaque instance repart d'un journal vide de son côté.
for (const [c, b, vider] of [[enLigne, BASE, true], [poste, poste.pg.base, false]] as const) {
  const client = connexionProprietaire(c.pg, b);
  await client.connect();
  if (vider) await client.query('TRUNCATE sync.journal, sync.etat, sync.conflit');
  else {
    await client.query(`INSERT INTO sync.etat (cle, valeur) SELECT 'envoye', COALESCE(max(seq), 0)::text FROM sync.journal
                        ON CONFLICT (cle) DO UPDATE SET valeur = EXCLUDED.valeur`);
    await client.query(`INSERT INTO sync.etat (cle, valeur) VALUES ('recu', '0') ON CONFLICT (cle) DO UPDATE SET valeur = '0'`);
  }
  await client.end();
}

// 3. Démarrage de la version en ligne.
const sortie = openSync(resolve(dossier, 'serveur.log'), 'a');
const serveur = spawn(resolve(RACINE, 'apps/api/node_modules/.bin/tsx'), ['apps/api/src/server.ts'], {
  cwd: RACINE, detached: true, stdio: ['ignore', sortie, sortie],
  env: { ...process.env, GS_CONFIG: cheminEnLigne, GS_PORT: '8453', GS_PORT_LOCAL: String(PORT_LOCAL) },
});
serveur.unref();
console.log(`
Version en ligne : http://localhost:${PORT_LOCAL} (mêmes comptes, mêmes mots de passe).
Poste de l'école : http://localhost:8080 ; il échange ses modifications avec la version en ligne toutes les 30 secondes
(Paramètres › Données › Synchronisation, ou « Synchroniser maintenant »).
Relancez le poste (pnpm demo:lancer) s'il tournait avant cette commande.
Arrêt : pnpm synchro:essai --arreter`);
