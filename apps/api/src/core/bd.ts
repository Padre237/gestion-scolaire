// Accès à la base : rôle gs_application, transactions qui posent
// app.utilisateur_id pour le journal d'audit (conception § 6.5 et § 9.1).
import pg from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { sql, type SQL } from 'drizzle-orm';
import type { ConfigPg } from '@gs/db';

export { sql };
export type Tx = NodePgDatabase & { $client: pg.PoolClient };

// Les dates SQL restent des chaînes AAAA-MM-JJ ; les bigint (montants) deviennent des nombres :
// les montants en francs CFA restent très loin de 2^53.
pg.types.setTypeParser(1082, (v) => v);
pg.types.setTypeParser(20, (v) => Number(v));
pg.types.setTypeParser(1700, (v) => Number(v));

export function creerPool(c: ConfigPg, base = c.base): pg.Pool {
  return new pg.Pool({
    host: c.hote, port: c.port, database: base,
    user: c.application.utilisateur, password: c.application.motDePasse,
    max: 10,
  });
}

export class Bd {
  constructor(readonly pool: pg.Pool) {}

  /** Lecture simple, hors transaction. */
  async lire<T>(requete: SQL): Promise<T[]> {
    const client = await this.pool.connect();
    try {
      const db = drizzle(client);
      const r = await db.execute(requete);
      return r.rows as T[];
    } finally {
      client.release();
    }
  }

  async lireUn<T>(requete: SQL): Promise<T | undefined> {
    return (await this.lire<T>(requete))[0];
  }

  /** Transaction auditée : toute écriture passe par ici. */
  async transaction<T>(utilisateurId: string | null, fn: (tx: Tx) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.utilisateur_id', $1, true)", [utilisateurId ?? '']);
      const tx = drizzle(client) as Tx;
      const resultat = await fn(tx);
      await client.query('COMMIT');
      return resultat;
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }
}

export async function lignes<T>(tx: Tx, requete: SQL): Promise<T[]> {
  const r = await tx.execute(requete);
  return r.rows as T[];
}

export async function ligne<T>(tx: Tx, requete: SQL): Promise<T | undefined> {
  return (await lignes<T>(tx, requete))[0];
}

/** Tableau passé comme un seul paramètre PostgreSQL ({"a","b"}) : drizzle déplierait sinon un tableau JavaScript en liste. */
export function tableau(valeurs: readonly unknown[]): string {
  return `{${valeurs.map((v) => `"${String(v).replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`).join(',')}}`;
}
