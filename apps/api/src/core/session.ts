// Sessions (conception § 8) : jeton aléatoire dont seule l'empreinte est stockée ;
// cookie httpOnly, Secure, SameSite=Strict pour la version web, en-tête Authorization
// pour les applications ; expiration après 30 min d'inactivité et 10 h au plus.
import { createHash, randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { Bd, sql } from './bd.ts';
import { Contexte, type Portee, type RoleActif } from './contexte.ts';
import { interdit, nonAutorise } from './erreurs.ts';

export const COOKIE = 'gs_session';
export const INACTIVITE_MS = 30 * 60 * 1000;
export const DUREE_MAX_MS = 10 * 60 * 60 * 1000;

declare module 'fastify' {
  interface FastifyContextConfig {
    /** Route accessible sans session (connexion). */
    public?: boolean;
    /** Permission exigée ; le serveur répond 403 sinon. */
    permission?: string;
    /** Une permission parmi celles-ci suffit. */
    unePermissionParmi?: string[];
  }
  interface FastifyRequest {
    ctx: Contexte | null;
  }
  interface FastifyInstance {
    bd: Bd;
    inventaireRoutes: { methode: string; url: string; config: Record<string, unknown> }[];
  }
}

const empreinte = (jeton: string) => createHash('sha256').update(jeton).digest();

export async function ouvrirSession(bd: Bd, compteId: string, appareil: string | null): Promise<string> {
  const jeton = randomBytes(32).toString('base64url');
  await bd.lire(sql`
    INSERT INTO core.session (compte_id, empreinte, expire_max, appareil)
    VALUES (${compteId}, ${empreinte(jeton)}, now() + ${`${DUREE_MAX_MS} milliseconds`}::interval, ${appareil})`);
  return jeton;
}

export async function fermerSession(bd: Bd, sessionId: string) {
  await bd.lire(sql`UPDATE core.session SET revoquee_le = now() WHERE id = ${sessionId}`);
}

function lireJeton(req: FastifyRequest): string | null {
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) return auth.slice(7);
  return req.cookies?.[COOKIE] ?? null;
}

export async function chargerContexte(bd: Bd, jeton: string): Promise<Contexte | null> {
  const s = await bd.lireUn<{
    session_id: string; compte_id: string; etablissement_id: string; nom_affiche: string; type: 'personnel' | 'famille';
    personnel_id: string | null; famille_id: string | null;
  }>(sql`
    UPDATE core.session s SET derniere_activite = now()
      FROM core.compte c
     WHERE s.empreinte = ${empreinte(jeton)} AND c.id = s.compte_id AND c.actif
       AND s.revoquee_le IS NULL AND s.expire_max > now()
       AND s.derniere_activite > now() - ${`${INACTIVITE_MS} milliseconds`}::interval
    RETURNING s.id AS session_id, c.id AS compte_id, c.etablissement_id, c.nom_affiche, c.type, c.personnel_id, c.famille_id`);
  if (!s) return null;

  const lignes = await bd.lire<{ code: string; libelle_fr: string; libelle_en: string; perimetre_type: Portee; ordre: number; permission_code: string | null }>(sql`
    SELECT r.code, r.libelle_fr, r.libelle_en, r.perimetre_type, r.ordre, rp.permission_code
      FROM core.compte_role cr
      JOIN core.role r ON r.id = cr.role_id
      LEFT JOIN core.role_permission rp ON rp.role_id = r.id
     WHERE cr.compte_id = ${s.compte_id}
     ORDER BY r.ordre, r.code`);
  const roles = new Map<string, RoleActif>();
  const droits = new Map<string, Set<Portee>>();
  for (const l of lignes) {
    roles.set(l.code, { code: l.code, libelleFr: l.libelle_fr, libelleEn: l.libelle_en, perimetre: l.perimetre_type });
    if (l.permission_code) {
      if (!droits.has(l.permission_code)) droits.set(l.permission_code, new Set());
      droits.get(l.permission_code)!.add(l.perimetre_type);
    }
  }
  await bd.lire(sql`UPDATE core.compte SET derniere_activite = now() WHERE id = ${s.compte_id}`);
  return new Contexte(s.session_id, s.compte_id, s.etablissement_id, s.nom_affiche, s.type, s.personnel_id,
    s.famille_id, [...roles.values()], droits);
}

/** Exige une session ; renvoie le contexte. */
export function exiger(req: FastifyRequest): Contexte {
  if (!req.ctx) throw nonAutorise();
  return req.ctx;
}

export const pluginSession = fp(async (app: FastifyInstance) => {
  app.decorateRequest('ctx', null);

  app.addHook('onRequest', async (req) => {
    const jeton = lireJeton(req);
    req.ctx = jeton ? await chargerContexte(app.bd, jeton) : null;
  });

  // Chaque route déclare sa permission ; le contrôle se fait ici, côté serveur.
  app.addHook('preValidation', async (req) => {
    const config = req.routeOptions.config;
    if (!req.url.startsWith('/api/') || config.public) return;
    const ctx = exiger(req);
    if (config.permission && !ctx.a(config.permission)) throw interdit(config.permission);
    if (config.unePermissionParmi && !config.unePermissionParmi.some((p) => ctx.a(p))) {
      throw interdit(config.unePermissionParmi.join(' ou '));
    }
  });
});
