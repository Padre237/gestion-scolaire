// Migrations SQL versionnées (conception § 4) et rôles PostgreSQL (§ 6.6).
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';
import { PERMISSIONS } from '@gs/shared';
import { RACINE, type ConfigPg } from './config.ts';

const DOSSIER = resolve(RACINE, 'packages/db/migrations');

const SCHEMAS_METIER = ['core', 'structure', 'scolarite', 'finances', 'caisse', 'pedagogie', 'vie_scolaire',
  'personnel', 'communication', 'assistant'];

// Tables de liaison où une ligne peut être retirée ; ailleurs, pas de suppression physique (§ 6.1).
const SUPPRESSION_PERMISE = ['core.role_permission', 'core.compte_role', 'core.compte_permission', 'pedagogie.affectation',
  'finances.ligne_grille', 'scolarite.eleve_responsable', 'pedagogie.cours', 'pedagogie.creneau', 'caisse.budget',
  'communication.annonce_famille', 'pedagogie.bulletin', 'vie_scolaire.absence', 'vie_scolaire.presence', 'communication.message'];

export function connexionProprietaire(c: ConfigPg, base = c.base): pg.Client {
  return new pg.Client({ host: c.hote, port: c.port, database: base, user: c.proprietaire.utilisateur,
    password: c.proprietaire.motDePasse });
}

const litteral = (s: string) => `'${s.replaceAll("'", "''")}'`;

async function assurerRole(client: pg.Client, nom: string, motDePasse: string) {
  const existe = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [nom]);
  const verbe = existe.rowCount ? 'ALTER' : 'CREATE';
  await client.query(`${verbe} ROLE ${nom} WITH LOGIN PASSWORD ${litteral(motDePasse)}`);
}

export async function accorderDroits(client: pg.Client, c: ConfigPg) {
  const app = c.application.utilisateur;
  const lec = c.lecture.utilisateur;
  await client.query(`GRANT CONNECT ON DATABASE ${c.base} TO ${app}, ${lec}`);
  for (const s of SCHEMAS_METIER) {
    await client.query(`GRANT USAGE ON SCHEMA ${s} TO ${app}`);
    await client.query(`GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA ${s} TO ${app}`);
    await client.query(`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA ${s} TO ${app}`);
  }
  // Insertion seule dans le journal d'audit, plus la lecture pour l'écran Journal d'audit.
  await client.query(`REVOKE UPDATE, DELETE, TRUNCATE ON core.journal_audit FROM ${app}`);
  for (const t of SUPPRESSION_PERMISE) await client.query(`GRANT DELETE ON ${t} TO ${app}`);
  await client.query(`GRANT USAGE ON SCHEMA reporting TO ${app}, ${lec}`);
  await client.query(`GRANT SELECT ON ALL TABLES IN SCHEMA reporting TO ${app}, ${lec}`);
}

export async function synchroniserPermissions(client: pg.Client) {
  let ordre = 0;
  for (const perm of PERMISSIONS) {
    await client.query(
      `INSERT INTO core.permission (code, module, libelle_fr, libelle_en, ordre) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (code) DO UPDATE SET module = EXCLUDED.module, libelle_fr = EXCLUDED.libelle_fr,
         libelle_en = EXCLUDED.libelle_en, ordre = EXCLUDED.ordre`,
      [perm.code, perm.groupe, perm.libelleFr, perm.libelleEn, ++ordre],
    );
  }
}

export async function migrer(c: ConfigPg, base = c.base, journal: (m: string) => void = () => {}) {
  const client = connexionProprietaire(c, base);
  await client.connect();
  try {
    await assurerRole(client, c.application.utilisateur, c.application.motDePasse);
    await assurerRole(client, c.lecture.utilisateur, c.lecture.motDePasse);
    // Plus d'accès direct à la base (D-47) : le compte en lecture seule garde ses droits mais ne peut plus se connecter.
    await client.query(`ALTER ROLE ${c.lecture.utilisateur} NOLOGIN`);
    await client.query(`CREATE TABLE IF NOT EXISTS public.gs_migration (
      nom text PRIMARY KEY, appliquee_le timestamptz NOT NULL DEFAULT now())`);
    const faites = new Set((await client.query('SELECT nom FROM public.gs_migration')).rows.map((r) => r.nom));
    const fichiers = readdirSync(DOSSIER).filter((f) => f.endsWith('.sql')).sort();
    for (const f of fichiers) {
      if (faites.has(f)) continue;
      await client.query('BEGIN');
      try {
        await client.query(readFileSync(resolve(DOSSIER, f), 'utf8'));
        await client.query('INSERT INTO public.gs_migration (nom) VALUES ($1)', [f]);
        await client.query('COMMIT');
        journal(`migration appliquée : ${f}`);
      } catch (e) {
        await client.query('ROLLBACK');
        throw new Error(`Échec de la migration ${f} : ${(e as Error).message}`);
      }
    }
    await synchroniserPermissions(client);
    await accorderDroits(client, c);
    // Application hybride (D-49) : déclencheur de synchronisation sur toute nouvelle table ; état et conflits lisibles par le serveur.
    if ((await client.query(`SELECT to_regnamespace('sync') IS NOT NULL AS ok`)).rows[0].ok) {
      await client.query('SELECT sync.installer()');
      await client.query(`GRANT USAGE ON SCHEMA sync TO ${c.application.utilisateur}`);
      await client.query(`GRANT SELECT ON ALL TABLES IN SCHEMA sync TO ${c.application.utilisateur}`);
    }
  } finally {
    await client.end();
  }
}

// Crée une base vide (tests, restauration guidée).
export async function creerBase(c: ConfigPg, nom: string, remplacer = false) {
  const client = connexionProprietaire(c, 'postgres');
  await client.connect();
  try {
    if (remplacer) await client.query(`DROP DATABASE IF EXISTS ${nom} WITH (FORCE)`);
    const existe = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [nom]);
    if (!existe.rowCount) await client.query(`CREATE DATABASE ${nom}`);
  } finally {
    await client.end();
  }
}
