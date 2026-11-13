// Application hybride (D-49) : échange des modifications entre le poste de l'école (principal) et la version en ligne.
// Règle : pour une même ligne, la modification la plus récente l'emporte ; la version écartée est gardée dans sync.conflit.
import { timingSafeEqual } from 'node:crypto';
import { connexionProprietaire, lireConfig, type ConfigPg } from '@gs/db';

export interface Changement { seq: number; horodatage: string; table_nom: string; operation: 'INSERT' | 'UPDATE' | 'DELETE'; cle: Record<string, unknown>; ligne: Record<string, unknown> | null }
export interface Echange { jeton: string; depuis: number; changements: Changement[] }
export interface Reponse { changements: Changement[]; dernier: number; reste: boolean; appliques: number; conflits: number }

const LOT = 300;

/** Rôle de cette instance : variables d'environnement (tests, seconde instance) ou configuration. */
export function reglageSynchro(): { role: 'principal' | 'en_ligne' | null; adresse: string | null; jeton: string | null; intervalle: number } {
  let c: ReturnType<typeof lireConfig>['synchro'];
  try { c = lireConfig().synchro; } catch { c = undefined; }
  const role = (process.env.GS_SYNCHRO_ROLE as 'principal' | 'en_ligne' | undefined) ?? c?.role ?? null;
  return { role, adresse: process.env.GS_SYNCHRO_ADRESSE ?? c?.adresse ?? null, jeton: process.env.GS_SYNCHRO_JETON ?? c?.jeton ?? null,
    intervalle: Math.max(15, c?.intervalleSecondes ?? 60) };
}

export const jetonValide = (recu: string, attendu: string | null) => {
  if (!attendu || !recu) return false;
  const a = Buffer.from(recu), b = Buffer.from(attendu);
  return a.length === b.length && timingSafeEqual(a, b);
};

/** Modifications locales après un numéro du journal, dans l'ordre. */
export async function lireChangements(pg: ConfigPg, base: string, depuis: number, limite = LOT): Promise<{ changements: Changement[]; reste: boolean }> {
  const client = connexionProprietaire(pg, base);
  await client.connect();
  try {
    const r = await client.query<Changement>(
      `SELECT seq::float8 AS seq, horodatage, table_nom, operation, cle, ligne FROM sync.journal WHERE seq > $1 ORDER BY seq LIMIT $2`, [depuis, limite + 1]);
    return { changements: r.rows.slice(0, limite).map((x) => ({ ...x, seq: Number(x.seq) })), reste: r.rows.length > limite };
  } finally { await client.end(); }
}

/**
 * Applique des modifications reçues. Pour chaque ligne, la dernière modification locale décide : plus récente, elle est gardée ;
 * plus ancienne, la modification reçue la remplace. Un conflit (les deux côtés ont changé la ligne depuis le dernier échange,
 * c'est-à-dire après `seuilConflit` dans le journal local) est inscrit avec la version écartée. Une modification refusée par
 * la base (doublon, par exemple) est inscrite aussi, et l'échange continue.
 */
export async function appliquerChangements(pg: ConfigPg, base: string, changements: Changement[], seuilConflit: number): Promise<{ appliques: number; conflits: number }> {
  if (!changements.length) return { appliques: 0, conflits: 0 };
  const client = connexionProprietaire(pg, base);
  await client.connect();
  let appliques = 0, conflits = 0;
  try {
    await client.query('BEGIN');
    // Sans déclencheur : ni journal d'audit en double, ni retour au journal de synchronisation, contraintes vérifiées à l'origine.
    await client.query('SET LOCAL session_replication_role = replica');
    for (const c of changements) {
      const local = (await client.query<{ seq: string; horodatage: string; ligne: unknown }>(
        `SELECT seq, horodatage, ligne FROM sync.journal WHERE table_nom = $1 AND cle = $2::jsonb ORDER BY seq DESC LIMIT 1`, [c.table_nom, JSON.stringify(c.cle)])).rows[0];
      const concurrent = local && Number(local.seq) > seuilConflit;
      if (local && new Date(local.horodatage).getTime() > new Date(c.horodatage).getTime()) {
        // La modification locale est plus récente : elle est gardée (et repartira vers l'autre instance).
        if (concurrent) {
          await client.query(`INSERT INTO sync.conflit (table_nom, cle, issue, version_gardee, version_ecartee) VALUES ($1, $2, 'local_garde', $3, $4)`,
            [c.table_nom, JSON.stringify(c.cle), JSON.stringify(local.ligne), JSON.stringify(c.ligne)]);
          conflits++;
        }
        continue;
      }
      await client.query('SAVEPOINT m');
      try {
        await client.query('SELECT sync.appliquer($1, $2, $3::jsonb, $4::jsonb)', [c.table_nom, c.operation, JSON.stringify(c.cle), c.ligne ? JSON.stringify(c.ligne) : null]);
        await client.query('RELEASE SAVEPOINT m');
        appliques++;
        if (concurrent) {
          await client.query(`INSERT INTO sync.conflit (table_nom, cle, issue, version_gardee, version_ecartee) VALUES ($1, $2, 'distant_garde', $3, $4)`,
            [c.table_nom, JSON.stringify(c.cle), JSON.stringify(c.ligne), JSON.stringify(local.ligne)]);
          conflits++;
        }
      } catch (e) {
        await client.query('ROLLBACK TO SAVEPOINT m');
        await client.query(`INSERT INTO sync.conflit (table_nom, cle, issue, version_ecartee, motif) VALUES ($1, $2, 'refuse', $3, $4)`,
          [c.table_nom, JSON.stringify(c.cle), JSON.stringify(c.ligne), (e as Error).message.slice(0, 300)]);
        conflits++;
      }
    }
    await client.query('COMMIT');
    return { appliques, conflits };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally { await client.end(); }
}

async function lireEtat(pg: ConfigPg, base: string): Promise<{ envoye: number; recu: number }> {
  const client = connexionProprietaire(pg, base);
  await client.connect();
  try {
    const r = await client.query<{ cle: string; valeur: string }>(`SELECT cle, valeur FROM sync.etat`);
    const v = (k: string) => Number(r.rows.find((x) => x.cle === k)?.valeur ?? 0);
    return { envoye: v('envoye'), recu: v('recu') };
  } finally { await client.end(); }
}
async function ecrireEtat(pg: ConfigPg, base: string, envoye: number, recu: number) {
  const client = connexionProprietaire(pg, base);
  await client.connect();
  try {
    for (const [k, v] of [['envoye', envoye], ['recu', recu], ['derniere', new Date().toISOString()]] as const) {
      await client.query(`INSERT INTO sync.etat (cle, valeur) VALUES ($1, $2) ON CONFLICT (cle) DO UPDATE SET valeur = EXCLUDED.valeur, modifie_le = now()`, [k, String(v)]);
    }
  } finally { await client.end(); }
}

/**
 * Un cycle du poste principal : envoie ses modifications par lots, reçoit celles de la version en ligne, jusqu'à ce que
 * les deux côtés soient à jour. `envoyer` transporte l'échange (HTTP en service, appel direct dans les tests).
 */
export async function cycleSynchro(pg: ConfigPg, base: string, jeton: string, envoyer: (e: Echange) => Promise<Reponse>) {
  let { envoye, recu } = await lireEtat(pg, base);
  let totalEnvoyes = 0, totalRecus = 0, conflits = 0;
  for (let tour = 0; tour < 200; tour++) {
    const locaux = await lireChangements(pg, base, envoye);
    const rep = await envoyer({ jeton, depuis: recu, changements: locaux.changements });
    const seuil = envoye;
    if (locaux.changements.length) envoye = locaux.changements[locaux.changements.length - 1]!.seq;
    totalEnvoyes += locaux.changements.length;
    conflits += rep.conflits;
    const a = await appliquerChangements(pg, base, rep.changements, seuil);
    conflits += a.conflits;
    totalRecus += rep.changements.length;
    recu = rep.dernier;
    await ecrireEtat(pg, base, envoye, recu);
    if (!locaux.reste && !rep.reste) break;
  }
  return { envoyes: totalEnvoyes, recus: totalRecus, conflits };
}

/** Côté version en ligne : applique ce qui arrive, renvoie ses propres modifications depuis `depuis`. */
export async function repondreEchange(pg: ConfigPg, base: string, e: Echange): Promise<Reponse> {
  const a = await appliquerChangements(pg, base, e.changements, e.depuis);
  const miens = await lireChangements(pg, base, e.depuis);
  const dernier = miens.changements.length ? miens.changements[miens.changements.length - 1]!.seq : e.depuis;
  return { changements: miens.changements, dernier, reste: miens.reste, appliques: a.appliques, conflits: a.conflits };
}
