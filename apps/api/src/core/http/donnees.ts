// Paramètres · Données (maquette Donnees) : sauvegardes chiffrées (E-25), accès en lecture seule à la base.
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { chmodSync, existsSync, writeFileSync } from 'node:fs';
import { cheminConfig, connexionProprietaire, listerSauvegardes, lireConfig, restaurer, sauvegarder } from '@gs/db';
import { sql } from '../bd.ts';
import { ErreurMetier } from '../erreurs.ts';
import { exiger } from '../session.ts';
import { journaliser } from '../audit.ts';
import { motDePasseAleatoire } from '../motdepasse.ts';
import { versCsv } from '../csv.ts';

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

  r.get('/core/base', { config: { permission: 'core.lecture.gerer' }, schema: { tags: ['core'] } }, async () => {
    const c = lireConfig();
    return { lecture: c.pg.lecture.utilisateur, schema: 'reporting', hote: c.pg.hote, port: c.pg.port, base: c.pg.base };
  });

  r.get('/core/base/description', { config: { permission: 'core.lecture.gerer' }, schema: { tags: ['core'] } }, async (req, rep) => {
    const lignes = await app.bd.lire<Record<string, unknown>>(sql`
      SELECT table_name AS "Vue", column_name AS "Colonne", data_type AS "Type"
        FROM information_schema.columns WHERE table_schema = 'reporting' ORDER BY table_name, ordinal_position`);
    return rep.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', 'attachment; filename="vues-reporting.csv"').send(versCsv(lignes));
  });

  // Nouveau mot de passe du compte en lecture seule ; affiché une seule fois, gardé dans var/config.json (0600).
  r.post('/core/base/lecture', { config: { permission: 'core.lecture.gerer' }, schema: { tags: ['core'] } }, async (req) => {
    const ctx = exiger(req);
    const c = lireConfig();
    const motDePasse = motDePasseAleatoire(16);
    const client = connexionProprietaire(c.pg);
    await client.connect();
    try {
      await client.query(`ALTER ROLE ${c.pg.lecture.utilisateur} WITH PASSWORD '${motDePasse.replaceAll("'", "''")}'`);
    } finally {
      await client.end();
    }
    c.pg.lecture.motDePasse = motDePasse;
    writeFileSync(cheminConfig(), JSON.stringify(c, null, 2) + '\n', { mode: 0o600 });
    chmodSync(cheminConfig(), 0o600);
    await app.bd.transaction(ctx.compteId, (tx) => journaliser(tx, ctx, { action: 'Réinitialisation', objetType: 'Droits', objetLibelle: `Compte ${c.pg.lecture.utilisateur}`, avant: '–', apres: 'Nouveau mot de passe' }));
    return { utilisateur: c.pg.lecture.utilisateur, motDePasse };
  });
}
