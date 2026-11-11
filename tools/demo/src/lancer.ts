// pnpm demo:lancer — démarre tout sur le poste : PostgreSQL (Docker), migrations, certificat local, application web
// (construite si elle manque), serveur Node.js ; affiche les adresses à ouvrir sur ce poste et sur les téléphones.
// Le certificat est signé par une autorité propre à ce poste, limitée aux adresses du réseau local (contrainte de nom) :
// installée sur un téléphone, elle ne peut garantir aucun autre site (DEMO.md, E-13).
import { spawn, spawnSync } from 'node:child_process';
import { X509Certificate } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { hostname, networkInterfaces } from 'node:os';
import { resolve } from 'node:path';
import { lireOuCreerConfig, migrer, RACINE } from '@gs/db';
import { drapeau } from './commun.ts';

const config = lireOuCreerConfig();
const docker = spawnSync('docker', ['compose', 'up', '-d', 'base'], { cwd: RACINE, stdio: 'inherit' });
if (docker.status !== 0) console.warn('Docker indisponible : PostgreSQL doit déjà tourner sur le port configuré.');
for (let i = 0; i < 30; i++) {
  try { await migrer(config.pg, config.pg.base); break; } catch (e) {
    if (i === 29) throw e;
    await new Promise((r) => setTimeout(r, 1000));
  }
}

// ------------------------------------------------------------------ certificat local
const adresses = Object.values(networkInterfaces()).flat()
  .filter((a) => a && a.family === 'IPv4' && !a.internal).map((a) => a!.address);
const nomPoste = hostname().toLowerCase().replace(/[^a-z0-9-]/g, '');
const tls = resolve(RACINE, 'var/tls');
const fichier = (n: string) => resolve(tls, n);

function openssl(args: string[], entree?: string) {
  const r = spawnSync('openssl', args, { input: entree, encoding: 'utf8' });
  if (r.error || r.status !== 0) throw new Error(`openssl ${args[0]} : ${r.error?.message ?? r.stderr}`);
}

function certificat(): boolean {
  if (drapeau('http')) return false;
  if (spawnSync('openssl', ['version']).status !== 0) {
    console.warn('openssl absent : le serveur démarre en HTTP (les téléphones ne pourront pas installer l’application).');
    return false;
  }
  mkdirSync(tls, { recursive: true, mode: 0o700 });
  const ext = fichier('extensions.cnf');
  const base = '[req]\ndistinguished_name=dn\nprompt=no\n[dn]\nCN=serveur\n';
  if (!existsSync(fichier('autorite.pem'))) {
    const permis = ['IP:10.0.0.0/255.0.0.0', 'IP:172.16.0.0/255.240.0.0', 'IP:192.168.0.0/255.255.0.0', 'IP:127.0.0.0/255.0.0.0',
      'DNS:localhost', ...(nomPoste ? [`DNS:${nomPoste}`, `DNS:${nomPoste}.local`] : [])].map((x) => `permitted;${x}`).join(',');
    writeFileSync(ext, `${base}[autorite]\nbasicConstraints=critical,CA:TRUE,pathlen:0\nkeyUsage=critical,keyCertSign,cRLSign\nsubjectKeyIdentifier=hash\nnameConstraints=critical,${permis}\n`);
    openssl(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '3650', '-keyout', fichier('autorite-cle.pem'),
      '-out', fichier('autorite.pem'), '-subj', '/O=Gestion scolaire/CN=Autorite locale du poste', '-config', ext, '-extensions', 'autorite']);
    chmodSync(fichier('autorite-cle.pem'), 0o600);
    rmSync(fichier('cert.pem'), { force: true });
  }
  const attendus = ['127.0.0.1', ...adresses];
  if (existsSync(fichier('cert.pem'))) {
    const x = new X509Certificate(readFileSync(fichier('cert.pem')));
    const valide = new Date(x.validTo).getTime() > Date.now() + 30 * 86_400_000;
    if (valide && attendus.every((ip) => x.checkIP(ip))) return true;
  }
  // Certificat du serveur : toutes les adresses actuelles du poste (à refaire si le réseau change, ce que fait ce script).
  const noms = ['DNS:localhost', ...(nomPoste ? [`DNS:${nomPoste}`, `DNS:${nomPoste}.local`] : []), ...attendus.map((ip) => `IP:${ip}`)].join(',');
  writeFileSync(ext, `${base}[serveur]\nbasicConstraints=CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=${noms}\n`);
  openssl(['req', '-new', '-newkey', 'rsa:2048', '-nodes', '-keyout', fichier('cle.pem'), '-out', fichier('demande.csr'), '-subj', '/O=Gestion scolaire/CN=Serveur de l ecole', '-config', ext]);
  openssl(['x509', '-req', '-in', fichier('demande.csr'), '-CA', fichier('autorite.pem'), '-CAkey', fichier('autorite-cle.pem'), '-CAcreateserial',
    '-days', '397', '-sha256', '-out', fichier('cert.pem'), '-extensions', 'serveur', '-extfile', ext]);
  chmodSync(fichier('cle.pem'), 0o600);
  rmSync(fichier('demande.csr'), { force: true });
  console.log(`Certificat du serveur établi pour : ${attendus.join(', ')}`);
  return true;
}
const https = certificat();
if (!https) rmSync(fichier('cert.pem'), { force: true });

// ------------------------------------------------------------------ application web
const dist = resolve(RACINE, 'apps/web/dist/index.html');
if (!existsSync(dist) || drapeau('construire')) {
  console.log('Construction de l’application web…');
  const b = spawnSync('pnpm', ['--filter', '@gs/web', 'build'], { cwd: RACINE, stdio: 'inherit' });
  if (b.status !== 0) process.exit(b.status ?? 1);
}

// ------------------------------------------------------------------ serveur
const port = Number(process.env.GS_PORT ?? config.serveur.port);
const portLocal = Number(process.env.GS_PORT_LOCAL ?? (config.serveur as { portLocal?: number }).portLocal ?? 8080);
const serveur = spawn('pnpm', ['exec', 'tsx', 'src/server.ts'], { cwd: resolve(RACINE, 'apps/api'), stdio: 'inherit',
  env: { ...process.env, GS_PORT: String(port), GS_PORT_LOCAL: String(portLocal) } });
setTimeout(() => {
  console.log(`\nSur ce poste : ${https ? `http://localhost:${portLocal}` : `http://localhost:${port}`}`);
  for (const a of adresses.filter((x) => !x.startsWith('172.17.') && !x.startsWith('172.18.'))) {
    const base = `${https ? 'https' : 'http'}://${a}:${port}`;
    console.log(`Téléphones et autres postes du réseau : ${base}`);
    console.log(`  parent : ${base}/parent/connexion · instituteur : ${base}/instituteur/connexion`);
    if (https) console.log(`  certificat de l’école à installer une fois (DEMO.md) : ${base}/autorite.crt`);
  }
  console.log('Arrêt : Ctrl C');
}, 2500);
const arreter = () => serveur.kill('SIGTERM');
process.on('SIGINT', arreter);
process.on('SIGTERM', arreter);
serveur.on('exit', (c) => process.exit(c ?? 0));
