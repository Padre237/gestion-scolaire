// Démarrage du serveur : API et application web sur le même port (conception § 3), en HTTPS si le certificat
// local existe (var/tls, créé par demo:lancer), sinon en HTTP pour un poste de développement.
// Avec le certificat, le poste ouvre aussi http://localhost:<portLocal> (127.0.0.1 seulement) : localhost est un
// contexte sûr pour le navigateur, l'application s'y installe sans certificat à approuver.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { listerSauvegardes, lireConfig, RACINE, sauvegarder } from '@gs/db';
import { Bd, creerPool } from './core/bd.ts';
import { construireApp } from './app.ts';

const config = lireConfig();
const cle = resolve(RACINE, 'var/tls/cle.pem');
const cert = resolve(RACINE, 'var/tls/cert.pem');
const https = existsSync(cle) && existsSync(cert);
process.env.GS_HTTPS = https ? '1' : '0';

const pool = creerPool(config.pg);
const bd = new Bd(pool);
const journal = { level: process.env.GS_JOURNAL ?? 'warn' } as never;
const app = await construireApp({ bd, journal, https: https ? { key: readFileSync(cle), cert: readFileSync(cert) } : undefined });
const port = Number(process.env.GS_PORT ?? config.serveur.port);
await app.listen({ port, host: config.serveur.hote });
console.log(`Serveur prêt : ${https ? 'https' : 'http'}://localhost:${port}`);

let local: Awaited<ReturnType<typeof construireApp>> | null = null;
if (https) {
  const portLocal = Number(process.env.GS_PORT_LOCAL ?? (config.serveur as { portLocal?: number }).portLocal ?? 8080);
  local = await construireApp({ bd, journal });
  try {
    await local.listen({ port: portLocal, host: '127.0.0.1' });
    console.log(`Sur ce poste : http://localhost:${portLocal}`);
  } catch (e) {
    console.warn(`Port ${portLocal} occupé : ce poste utilisera https://localhost:${port} (${(e as Error).message}).`);
    local = null;
  }
}

// Sauvegarde automatique chaque jour à l'heure fixée (E-25), une seule fois par jour.
setInterval(async () => {
  const c = lireConfig();
  const maintenant = new Date(Date.now() + 3600_000).toISOString();
  if (maintenant.slice(11, 16) !== c.sauvegarde.heure) return;
  const jour = maintenant.slice(0, 10).replaceAll('-', '');
  if (listerSauvegardes(c).some((s) => s.nom.startsWith(`gs-${jour}`) && s.nom.includes('quotidienne'))) return;
  try {
    await sauvegarder(c, 'quotidienne');
  } catch (e) {
    console.error(`Sauvegarde automatique impossible : ${(e as Error).message}`);
  }
}, 60_000).unref();

const arreter = async () => { await local?.close(); await app.close(); await pool.end(); process.exit(0); };
process.on('SIGINT', arreter);
process.on('SIGTERM', arreter);
