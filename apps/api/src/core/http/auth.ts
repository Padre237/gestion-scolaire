// CU-01 · S'authentifier (SOC-06, ENF-05).
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { sql } from '../bd.ts';
import { ErreurMetier } from '../erreurs.ts';
import { verifier } from '../motdepasse.ts';
import { COOKIE, DUREE_MAX_MS, chargerContexte, exiger, fermerSession, ouvrirSession } from '../session.ts';
import { libelleRoles } from '../perimetre.ts';
import { journaliser } from '../audit.ts';

const ECHECS_MAX = 5;
const VERROUILLAGE = '15 minutes';

const Connexion = z.object({
  identifiant: z.string().trim().min(1).max(80),
  motDePasse: z.string().min(1).max(200),
  /** « web » : cookie ; « application » : jeton renvoyé dans la réponse (Windows, Android). */
  client: z.enum(['web', 'application']).default('web'),
  appareil: z.string().max(120).optional(),
});

const Moi = z.object({
  compte: z.object({ id: z.string(), nomAffiche: z.string(), identifiant: z.string(), type: z.enum(['personnel', 'famille']) }),
  libelleRoles: z.string(),
  roles: z.array(z.object({ code: z.string(), libelleFr: z.string(), libelleEn: z.string() })),
  permissions: z.array(z.string()),
  etablissement: z.object({ id: z.string(), nomFr: z.string(), nomEn: z.string() }),
  annee: z.object({ id: z.string(), libelle: z.string() }).nullable(),
  jeton: z.string().optional(),
});

export async function routesAuth(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  // Écran de connexion : nom de l'établissement et année ouverte, avant toute session.
  r.get('/auth/accueil', {
    config: { public: true },
    schema: {
      tags: ['auth'],
      response: { 200: z.object({ nomFr: z.string().nullable(), nomEn: z.string().nullable(), annee: z.string().nullable() }) },
    },
  }, async () => {
    const e = await app.bd.lireUn<{ nom_fr: string; nom_en: string; annee: string | null }>(sql`
      SELECT e.nom_fr, e.nom_en, a.libelle AS annee
        FROM structure.etablissement e
        LEFT JOIN structure.annee_scolaire a ON a.etablissement_id = e.id AND a.statut = 'ouverte'
       ORDER BY e.cree_le LIMIT 1`);
    return { nomFr: e?.nom_fr ?? null, nomEn: e?.nom_en ?? null, annee: e?.annee ?? null };
  });

  r.post('/auth/connexion', {
    config: { public: true },
    schema: { tags: ['auth'], body: Connexion, response: { 200: Moi } },
  }, async (req, rep) => {
    const { identifiant, motDePasse, client, appareil } = req.body;
    const c = await app.bd.lireUn<{ id: string; etablissement_id: string; mot_de_passe: string; verrouille: boolean; actif: boolean }>(sql`
      SELECT id, etablissement_id, mot_de_passe, actif, COALESCE(verrouille_jusqua > now(), false) AS verrouille
        FROM core.compte WHERE identifiant = ${identifiant.toLowerCase()} AND type = 'personnel'`);
    const refus = new ErreurMetier('CORE_IDENTIFIANTS_INVALIDES', 401, 'Identifiant ou mot de passe incorrect.');
    if (!c || !c.actif) throw refus;
    if (c.verrouille) {
      throw new ErreurMetier('CORE_COMPTE_VERROUILLE', 423, 'Compte verrouillé pendant 15 minutes après 5 échecs.');
    }
    if (!(await verifier(motDePasse, c.mot_de_passe))) {
      await app.bd.transaction(null, async (tx) => {
        const r2 = await tx.execute(sql`
          UPDATE core.compte SET echecs = echecs + 1,
                 verrouille_jusqua = CASE WHEN echecs + 1 >= ${ECHECS_MAX} THEN now() + ${VERROUILLAGE}::interval END
           WHERE id = ${c.id} RETURNING echecs, verrouille_jusqua IS NOT NULL AS verrouille`);
        const etat = r2.rows[0] as { verrouille: boolean };
        if (etat.verrouille) {
          await tx.execute(sql`UPDATE core.compte SET echecs = 0 WHERE id = ${c.id}`);
          await journaliser(tx, null, { action: 'Connexion refusée', objetType: 'Droits',
            objetLibelle: `Compte ${identifiant.toLowerCase()} verrouillé 15 minutes`, ligneId: c.id, table: 'core.compte' },
          c.etablissement_id);
        }
      });
      throw refus;
    }
    await app.bd.lire(sql`UPDATE core.compte SET echecs = 0, verrouille_jusqua = NULL WHERE id = ${c.id}`);
    const jeton = await ouvrirSession(app.bd, c.id, appareil ?? client);
    if (client === 'web') {
      rep.setCookie(COOKIE, jeton, { httpOnly: true, secure: req.protocol === 'https', sameSite: 'strict', path: '/', maxAge: DUREE_MAX_MS / 1000 });
    }
    req.headers.authorization = `Bearer ${jeton}`;
    req.ctx = await chargerContexte(app.bd, jeton);
    const moi = await decrireMoi(app, req);
    return client === 'application' ? { ...moi, jeton } : moi;
  });

  // POR-04 : connexion du parent par numéro de téléphone et mot de passe ; un compte par famille (RG-35).
  r.post('/auth/connexion-parent', {
    config: { public: true },
    schema: { tags: ['auth'], body: z.object({ telephone: z.string().trim().min(6).max(30), motDePasse: z.string().min(1).max(200),
      client: z.enum(['web', 'application']).default('web') }), response: { 200: Moi } },
  }, async (req, rep) => {
    const telephone = req.body.telephone.replace(/\D/g, '');
    const c = await app.bd.lireUn<{ id: string; etablissement_id: string; mot_de_passe: string; verrouille: boolean; actif: boolean }>(sql`
      SELECT id, etablissement_id, mot_de_passe, actif, COALESCE(verrouille_jusqua > now(), false) AS verrouille
        FROM core.compte WHERE identifiant = ${telephone} AND type = 'famille'`);
    const refus = new ErreurMetier('CORE_IDENTIFIANTS_INVALIDES', 401, 'Numéro de téléphone ou mot de passe incorrect.');
    if (!c || !c.actif) throw refus;
    if (c.verrouille) throw new ErreurMetier('CORE_COMPTE_VERROUILLE', 423, 'Compte verrouillé pendant 15 minutes après 5 échecs.');
    if (!(await verifier(req.body.motDePasse, c.mot_de_passe))) {
      await app.bd.lire(sql`UPDATE core.compte SET echecs = CASE WHEN echecs + 1 >= ${ECHECS_MAX} THEN 0 ELSE echecs + 1 END,
                             verrouille_jusqua = CASE WHEN echecs + 1 >= ${ECHECS_MAX} THEN now() + ${VERROUILLAGE}::interval END WHERE id = ${c.id}`);
      throw refus;
    }
    await app.bd.lire(sql`UPDATE core.compte SET echecs = 0, verrouille_jusqua = NULL WHERE id = ${c.id}`);
    const jeton = await ouvrirSession(app.bd, c.id, req.body.client === 'web' ? 'parent-web' : 'parent-application');
    if (req.body.client === 'web') {
      rep.setCookie(COOKIE, jeton, { httpOnly: true, secure: req.protocol === 'https', sameSite: 'strict', path: '/', maxAge: DUREE_MAX_MS / 1000 });
    }
    req.ctx = await chargerContexte(app.bd, jeton);
    const moi = await decrireMoi(app, req);
    return req.body.client === 'application' ? { ...moi, jeton } : moi;
  });

  r.post('/auth/deconnexion', {
    schema: { tags: ['auth'], response: { 204: z.null() } },
  }, async (req, rep) => {
    const ctx = exiger(req);
    await fermerSession(app.bd, ctx.sessionId);
    rep.clearCookie(COOKIE, { path: '/' });
    return rep.status(204).send(null);
  });

  r.get('/auth/moi', { schema: { tags: ['auth'], response: { 200: Moi } } }, async (req) => decrireMoi(app, req));
}

async function decrireMoi(app: FastifyInstance, req: Parameters<typeof exiger>[0]): Promise<z.infer<typeof Moi>> {
  const ctx = exiger(req);
  const c = await app.bd.lireUn<{ identifiant: string; nom_fr: string; nom_en: string; annee_id: string | null; annee: string | null }>(sql`
    SELECT c.identifiant, e.nom_fr, e.nom_en, a.id AS annee_id, a.libelle AS annee
      FROM core.compte c JOIN structure.etablissement e ON e.id = c.etablissement_id
      LEFT JOIN structure.annee_scolaire a ON a.etablissement_id = e.id AND a.statut = 'ouverte'
     WHERE c.id = ${ctx.compteId}`);
  return {
    compte: { id: ctx.compteId, nomAffiche: ctx.nomAffiche, identifiant: c!.identifiant, type: ctx.type },
    libelleRoles: await libelleRoles(app.bd, ctx),
    roles: ctx.roles.map((x) => ({ code: x.code, libelleFr: x.libelleFr, libelleEn: x.libelleEn })),
    permissions: ctx.permissions(),
    etablissement: { id: ctx.etablissementId, nomFr: c!.nom_fr, nomEn: c!.nom_en },
    annee: c!.annee_id ? { id: c!.annee_id, libelle: c!.annee! } : null,
  };
}
