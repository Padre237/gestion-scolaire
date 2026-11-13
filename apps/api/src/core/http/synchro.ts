// Application hybride (D-49) : échange des modifications, état de la synchronisation, synchronisation à la demande.
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { lireConfig } from '@gs/db';
import { sql } from '../bd.ts';
import { ErreurMetier } from '../erreurs.ts';
import { exiger } from '../session.ts';
import { cycleSynchro, jetonValide, reglageSynchro, repondreEchange, type Echange, type Reponse } from '../synchro.ts';

const Changement = z.object({
  seq: z.number(), horodatage: z.string(), table_nom: z.string().regex(/^[a-z_]+\.[a-z_]+$/), operation: z.enum(['INSERT', 'UPDATE', 'DELETE']),
  cle: z.record(z.string(), z.unknown()), ligne: z.record(z.string(), z.unknown()).nullable(),
});

/** Transport HTTP vers la version en ligne. */
export const transportHttp = (adresse: string) => async (e: Echange): Promise<Reponse> => {
  const ctrl = new AbortController();
  const minuteur = setTimeout(() => ctrl.abort(), 120_000);
  try {
    const r = await fetch(`${adresse.replace(/\/+$/, '')}/api/v1/synchro/echange`, {
      method: 'POST', signal: ctrl.signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify(e),
    });
    if (!r.ok) throw new Error(r.status === 401 ? 'jeton refusé par la version en ligne' : `réponse ${r.status} de la version en ligne`);
    return await r.json() as Reponse;
  } finally { clearTimeout(minuteur); }
};

let enCours: Promise<unknown> | null = null;
let derniereErreur: string | null = null;
/** Un seul cycle à la fois (minuterie ou bouton « Synchroniser maintenant »). */
export async function synchroniserMaintenant(app: FastifyInstance) {
  const s = reglageSynchro();
  if (s.role !== 'principal' || !s.adresse || !s.jeton) throw new ErreurMetier('SYNC_NON_REGLEE', 422, 'Synchronisation non réglée sur ce poste.');
  if (enCours) return enCours;
  const base = app.bd.pool.options.database as string;
  enCours = cycleSynchro(lireConfig().pg, base, s.jeton, transportHttp(s.adresse))
    .then((r) => { derniereErreur = null; return r; })
    .catch((e: Error) => { derniereErreur = e.name === 'AbortError' ? 'version en ligne injoignable (délai dépassé)' : e.message.includes('fetch failed') ? 'version en ligne injoignable' : e.message; throw e; })
    .finally(() => { enCours = null; });
  return enCours;
}

export async function routesSynchro(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  // Reçu par la version en ligne : authentifié par le jeton partagé, pas par une session (le poste de l'école n'a pas d'utilisateur ici).
  r.post('/synchro/echange', {
    config: { public: true }, bodyLimit: 80_000_000,
    schema: { tags: ['core'], body: z.object({ jeton: z.string().max(200), depuis: z.number().min(0), changements: z.array(Changement).max(1000) }) },
  }, async (req, rep) => {
    const s = reglageSynchro();
    if (s.role !== 'en_ligne' || !jetonValide(req.body.jeton, s.jeton)) return rep.status(401).send({ code: 'SYNC_JETON', title: 'Jeton de synchronisation refusé', status: 401 });
    return repondreEchange(lireConfig().pg, app.bd.pool.options.database as string, req.body as Echange);
  });

  r.get('/synchro/etat', { config: { unePermissionParmi: ['core.sauvegarde.lancer', 'core.compte.gerer'] }, schema: { tags: ['core'] } }, async () => {
    const s = reglageSynchro();
    if (!s.role) return { role: null };
    const etat = await app.bd.lire<{ cle: string; valeur: string }>(sql`SELECT cle, valeur FROM sync.etat`);
    const v = (k: string) => etat.find((x) => x.cle === k)?.valeur ?? null;
    const enAttente = await app.bd.lireUn<{ n: number }>(sql`SELECT count(*)::int AS n FROM sync.journal WHERE seq > ${Number(v('envoye') ?? 0)}`);
    const conflits = await app.bd.lire(sql`
      SELECT id, horodatage, table_nom AS "table", issue, motif FROM sync.conflit ORDER BY id DESC LIMIT 10`);
    return { role: s.role, adresse: s.adresse, intervalle: s.intervalle, derniere: v('derniere'), enAttente: s.role === 'principal' ? enAttente!.n : null,
      enCours: !!enCours, erreur: derniereErreur, conflits };
  });

  r.post('/synchro/maintenant', { config: { unePermissionParmi: ['core.sauvegarde.lancer', 'core.compte.gerer'] }, schema: { tags: ['core'] } }, async () => {
    try {
      return await synchroniserMaintenant(app);
    } catch (e) {
      if (e instanceof ErreurMetier) throw e;
      throw new ErreurMetier('SYNC_ECHEC', 503, `Synchronisation impossible pour l’instant : ${derniereErreur ?? (e as Error).message}. Les modifications attendent et partiront au prochain essai.`);
    }
  });
}

/** Instance en ligne : un document numéroté se fait au poste de l'école, où la numérotation sans trou est tenue. */
export function exigerPostePrincipal() {
  if (reglageSynchro().role === 'en_ligne') {
    throw new ErreurMetier('SYNC_POSTE_PRINCIPAL', 409,
      'Ce document numéroté (reçu, avis, matricule, exeat, sortie de caisse) se fait au poste de l’école : la numérotation sans trou ni doublon y est tenue.');
  }
}

export { exiger };
