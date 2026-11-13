// Paramètres · Données (maquette Donnees) : sauvegardes chiffrées (E-25). Aucun accès direct à la base (D-47).
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { existsSync } from 'node:fs';
import { listerSauvegardes, lireConfig, restaurer, sauvegarder } from '@gs/db';
import { ErreurMetier } from '../erreurs.ts';
import { exiger } from '../session.ts';
import { journaliser } from '../audit.ts';

export async function routesDonnees(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get('/core/sauvegardes', { config: { unePermissionParmi: ['core.sauvegarde.lancer', 'core.sauvegarde.restaurer'] }, schema: { tags: ['core'] } }, async () => {
    const c = lireConfig();
    const liste = listerSauvegardes(c);
    const copie = (c.sauvegarde as { copie?: string }).copie ?? null;
    return { liste: liste.slice(0, 30), derniere: liste[0] ?? null, heure: c.sauvegarde.heure, conservation: '7 jours, 4 semaines, 12 mois',
      copie: copie ? { dossier: copie, branche: existsSync(copie) } : null };
  });

  r.post('/core/sauvegardes', { config: { permission: 'core.sauvegarde.lancer' }, schema: { tags: ['core'] } }, async (req) => {
    const ctx = exiger(req);
    const s = await sauvegarder(lireConfig()).catch((e: Error) => { throw new ErreurMetier('CORE_SAUVEGARDE', 500, `Sauvegarde impossible : ${e.message}`); });
    await app.bd.transaction(ctx.compteId, (tx) => journaliser(tx, ctx, { action: 'Création', objetType: 'Sauvegarde', objetLibelle: `Sauvegarde ${s.nom}`, avant: '–',
      apres: `${Math.max(1, Math.round(s.taille / 1_000_000))} Mo, chiffrée` }));
    return s;
  });

  r.post('/core/sauvegardes/restauration', {
    config: { permission: 'core.sauvegarde.restaurer' }, schema: { tags: ['core'], body: z.object({ nom: z.string().regex(/^[\w.-]+\.sauvegarde$/) }) },
  }, async (req) => {
    const ctx = exiger(req);
    const c = lireConfig();
    if (!listerSauvegardes(c).some((s) => s.nom === req.body.nom)) throw new ErreurMetier('CORE_SAUVEGARDE_INCONNUE', 404, 'Sauvegarde introuvable.');
    const { avant } = await restaurer(c, req.body.nom).catch((e: Error) => { throw new ErreurMetier('CORE_RESTAURATION', 500, `Restauration impossible : ${e.message}`); });
    // Le journal restauré ne contient pas cette opération : on l'y ajoute après coup.
    await app.bd.transaction(null, (tx) => journaliser(tx, { compteId: null as never, etablissementId: ctx.etablissementId },
      { action: 'Modification', objetType: 'Sauvegarde', objetLibelle: `Restauration de ${req.body.nom} par ${ctx.nomAffiche}`, avant: avant.nom, apres: req.body.nom }));
    return { ok: true, avant: avant.nom };
  });
  // Pas d'accès direct à la base depuis l'application (D-47) : les données se lisent par les écrans et leurs exports.
}
