// Sauvegardes de la base (ECARTS E-25) : pg_dump au format personnalisé, chiffré en AES-256-GCM avec la clé de
// var/config.json, gardé 7 jours, 4 semaines et 12 mois. Restauration : sauvegarde de l'état actuel, puis pg_restore.
// PostgreSQL tourne dans Docker (E-01) : les outils sont appelés dans le conteneur ; sinon, ceux du poste.
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { basename, resolve } from 'node:path';
import type { Config } from './config.ts';
import { connexionProprietaire } from './migrer.ts';

const ENTETE = Buffer.from('GSSAUV1');
const conteneur = () => process.env.GS_PG_CONTENEUR ?? 'gs-postgres';

export interface Sauvegarde { nom: string; taille: number; date: string }

const cle = (c: Config) => createHash('sha256').update(`gestion-scolaire:${c.sauvegarde.cle}`).digest();

/** Exécute un outil PostgreSQL dans le conteneur (ou sur le poste) ; renvoie sa sortie. */
function outil(c: Config, programme: 'pg_dump' | 'pg_restore', args: string[], entree?: Buffer): Promise<Buffer> {
  const essayer = (cmd: string, a: string[], env?: NodeJS.ProcessEnv) => new Promise<Buffer>((ok, ko) => {
    const p = spawn(cmd, a, { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
    const sortie: Buffer[] = [];
    const erreurs: Buffer[] = [];
    p.stdout.on('data', (d: Buffer) => sortie.push(d));
    p.stderr.on('data', (d: Buffer) => erreurs.push(d));
    p.on('error', ko);
    p.on('close', (code) => (code === 0 ? ok(Buffer.concat(sortie)) : ko(new Error(`${programme} : ${Buffer.concat(erreurs).toString().trim() || `code ${code}`}`))));
    if (entree) p.stdin.end(entree); else p.stdin.end();
  });
  const u = c.pg.proprietaire.utilisateur;
  return essayer('docker', ['exec', '-i', '-e', `PGPASSWORD=${c.pg.proprietaire.motDePasse}`, conteneur(), programme, '-U', u, ...args])
    .catch((e: NodeJS.ErrnoException) => {
      if (e.code !== 'ENOENT' && !/No such container|Cannot connect/.test(e.message)) throw e;
      return essayer(programme, ['-h', c.pg.hote, '-p', String(c.pg.port), '-U', u, ...args], { PGPASSWORD: c.pg.proprietaire.motDePasse });
    });
}

export function listerSauvegardes(c: Config): Sauvegarde[] {
  if (!existsSync(c.sauvegarde.dossier)) return [];
  return readdirSync(c.sauvegarde.dossier).filter((f) => f.endsWith('.sauvegarde'))
    .map((f) => { const s = statSync(resolve(c.sauvegarde.dossier, f)); return { nom: f, taille: s.size, date: s.mtime.toISOString() }; })
    .sort((a, b) => b.date.localeCompare(a.date));
}

/** Garde la plus récente de chacun des 7 derniers jours, des 4 dernières semaines et des 12 derniers mois. */
export function rotation(c: Config) {
  const liste = listerSauvegardes(c);
  const garder = new Set<string>(liste.slice(0, 1).map((s) => s.nom));
  const parCle = (f: (d: Date) => string, n: number) => {
    const vus: string[] = [];
    for (const s of liste) {
      const k = f(new Date(s.date));
      if (vus.includes(k)) continue;
      vus.push(k);
      if (vus.length > n) break;
      garder.add(s.nom);
    }
  };
  parCle((d) => d.toISOString().slice(0, 10), 7);
  parCle((d) => { const x = new Date(d); x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7)); return x.toISOString().slice(0, 10); }, 4);
  parCle((d) => d.toISOString().slice(0, 7), 12);
  for (const s of liste) if (!garder.has(s.nom)) unlinkSync(resolve(c.sauvegarde.dossier, s.nom));
}

export async function sauvegarder(c: Config, motif = 'manuelle'): Promise<Sauvegarde> {
  const vidage = await outil(c, 'pg_dump', ['-Fc', '--no-owner', c.pg.base]);
  const iv = randomBytes(12);
  const chiffre = createCipheriv('aes-256-gcm', cle(c), iv);
  const corps = Buffer.concat([chiffre.update(vidage), chiffre.final()]);
  mkdirSync(c.sauvegarde.dossier, { recursive: true, mode: 0o700 });
  const horodatage = new Date(Date.now() + 3600_000).toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-');
  const nom = `gs-${horodatage}-${motif}.sauvegarde`;
  const chemin = resolve(c.sauvegarde.dossier, nom);
  writeFileSync(chemin, Buffer.concat([ENTETE, iv, chiffre.getAuthTag(), corps]), { mode: 0o600 });
  // Copie sur un disque externe, si son dossier est indiqué et branché (maquette Données).
  const copie = (c.sauvegarde as { copie?: string }).copie;
  if (copie && existsSync(copie)) copyFileSync(chemin, resolve(copie, nom));
  rotation(c);
  const s = statSync(chemin);
  return { nom, taille: s.size, date: s.mtime.toISOString() };
}

export function dechiffrer(c: Config, nom: string): Buffer {
  const b = readFileSync(resolve(c.sauvegarde.dossier, basename(nom)));
  if (!b.subarray(0, ENTETE.length).equals(ENTETE)) throw new Error('Fichier de sauvegarde inconnu.');
  const iv = b.subarray(ENTETE.length, ENTETE.length + 12);
  const tag = b.subarray(ENTETE.length + 12, ENTETE.length + 28);
  const d = createDecipheriv('aes-256-gcm', cle(c), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(b.subarray(ENTETE.length + 28)), d.final()]);
}

/** Restaure une sauvegarde après avoir sauvegardé l'état actuel ; les connexions ouvertes sont coupées. */
export async function restaurer(c: Config, nom: string): Promise<{ avant: Sauvegarde }> {
  const vidage = dechiffrer(c, nom);
  const avant = await sauvegarder(c, 'avant-restauration');
  const client = connexionProprietaire(c.pg, 'postgres');
  await client.connect();
  try {
    await client.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()', [c.pg.base]);
  } finally {
    await client.end();
  }
  await outil(c, 'pg_restore', ['--clean', '--if-exists', '--no-owner', '--single-transaction', '-d', c.pg.base], vidage);
  return { avant };
}
