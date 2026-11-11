// CU-27, CU-28 · Assistant (IA-01 à IA-07, RG-29 à RG-33). Pendant la démo, le fournisseur est désactivé (E-37) :
// une demande est enregistrée et attend dans la file, comme sans internet ; aucune donnée ne quitte le poste.
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { sql, ligne } from '../../../core/bd.ts';
import { ErreurMetier } from '../../../core/erreurs.ts';
import { exiger } from '../../../core/session.ts';
import { journaliser } from '../../../core/audit.ts';
import { lireConfig } from '@gs/db';

// Tâche → permission qui décide de la proposition (conception § 9.6).
export const TACHES: Record<string, { libelle: string; permission: string }> = {
  'IA-01': { libelle: 'Traduction', permission: 'assistant.proposition.traduction' },
  'IA-02': { libelle: 'Relances d’impayés', permission: 'assistant.proposition.relance' },
  'IA-03': { libelle: 'Lecture d’un bordereau', permission: 'assistant.proposition.bordereau' },
  'IA-04': { libelle: 'Import d’élèves', permission: 'assistant.proposition.import' },
  'IA-05': { libelle: 'Appréciations de bulletin', permission: 'assistant.proposition.appreciation' },
  'IA-06': { libelle: 'Synthèse pour le conseil', permission: 'assistant.proposition.synthese' },
  'IA-07': { libelle: 'Question de la direction', permission: 'assistant.question.poser' },
};

const fournisseurActif = () => {
  try { return lireConfig().ia.fournisseur !== 'desactive'; } catch { return false; }
};

export async function routesAssistant(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get('/assistant', { config: { permission: 'assistant.question.poser' }, schema: { tags: ['assistant'] } }, async (req) => {
    const ctx = exiger(req);
    const questions = await app.bd.lire(sql`
      SELECT t.id, t.entree->>'question' AS question, t.statut, t.cree_le AS "creeLe",
             (SELECT p.contenu FROM assistant.proposition p WHERE p.tache_id = t.id ORDER BY p.id DESC LIMIT 1) AS reponse
        FROM assistant.tache t WHERE t.etablissement_id = ${ctx.etablissementId} AND t.type = 'IA-07' ORDER BY t.cree_le DESC LIMIT 5`);
    const propositions = await app.bd.lire(sql`
      SELECT p.id, t.type, t.libelle, p.contenu, t.cree_le AS "creeLe" FROM assistant.proposition p JOIN assistant.tache t ON t.id = p.tache_id
       WHERE p.etablissement_id = ${ctx.etablissementId} AND p.statut = 'proposee' ORDER BY t.cree_le DESC LIMIT 10`);
    const usage = await app.bd.lireUn<{ en_file: number; cout: number }>(sql`
      SELECT count(*) FILTER (WHERE statut = 'en_file')::int AS en_file,
             COALESCE(sum(cout_fcfa) FILTER (WHERE date_trunc('month', cree_le) = date_trunc('month', now())), 0)::int AS cout
        FROM assistant.tache WHERE etablissement_id = ${ctx.etablissementId}`);
    return { fournisseur: fournisseurActif() ? 'actif' : 'desactive', questions, propositions,
      usage: { enFile: usage!.en_file, coutMois: usage!.cout, plafond: null } };
  });

  // RG-31 : seule la question part chez le fournisseur pour IA-07 ; elle est conservée ici, en file tant que le fournisseur est désactivé.
  r.post('/assistant/questions', {
    config: { permission: 'assistant.question.poser' }, schema: { tags: ['assistant'], body: z.object({ question: z.string().trim().min(5).max(500) }) },
  }, async (req) => {
    const ctx = exiger(req);
    return app.bd.transaction(ctx.compteId, async (tx) => {
      const t = await ligne<{ id: string }>(tx, sql`
        INSERT INTO assistant.tache (etablissement_id, type, entree, libelle, cree_par)
        VALUES (${ctx.etablissementId}, 'IA-07', ${JSON.stringify({ question: req.body.question })}::jsonb, 'Question de la direction', ${ctx.compteId}) RETURNING id`);
      await journaliser(tx, ctx, { action: 'Création', objetType: 'Assistant', objetLibelle: 'Question à l’assistant', avant: '–', apres: 'En file' });
      return { id: t!.id, statut: 'en_file' };
    });
  });

  // Toute autre tâche (traduction, bordereau, import, appréciations, synthèse, relances) : même circuit.
  r.post('/assistant/taches', {
    config: { unePermissionParmi: Object.values(TACHES).map((t) => t.permission) },
    schema: { tags: ['assistant'], body: z.object({ type: z.enum(['IA-01', 'IA-02', 'IA-03', 'IA-04', 'IA-05', 'IA-06']), objet: z.string().trim().max(200) }) },
  }, async (req) => {
    const ctx = exiger(req);
    const t = TACHES[req.body.type]!;
    if (!ctx.a(t.permission)) throw new ErreurMetier('CORE_INTERDIT', 403, `Permission requise : ${t.permission}.`);
    return app.bd.transaction(ctx.compteId, async (tx) => {
      // Rien de personnel n'est stocké dans l'entrée : seulement l'objet de la demande (RG-31).
      const x = await ligne<{ id: string }>(tx, sql`
        INSERT INTO assistant.tache (etablissement_id, type, entree, libelle, cree_par)
        VALUES (${ctx.etablissementId}, ${req.body.type}, ${JSON.stringify({ objet: req.body.objet })}::jsonb, ${t.libelle}, ${ctx.compteId}) RETURNING id`);
      return { id: x!.id, statut: 'en_file' };
    });
  });
}
