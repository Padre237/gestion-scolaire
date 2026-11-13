// CU-03 · Gérer les comptes et les rôles (SOC-06 à SOC-09, ADR-12) ; CU-04 · journal d'audit.
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { estPermission, PERMISSIONS } from '@gs/shared';
import { sql, lignes, ligne, tableau } from '../bd.ts';
import { ErreurMetier, interdit, introuvable } from '../erreurs.ts';
import { exiger } from '../session.ts';
import { hacher, motDePasseAleatoire } from '../motdepasse.ts';
import { journaliser } from '../audit.ts';
import { resumeClasses, texteFamille, type ClasseNiveau } from '../perimetre-texte.ts';
import { versCsv } from '../csv.ts';
import { perimetreDePersonnel } from '../perimetre.ts';

const Id = z.object({ id: z.uuid() });

/** Rôle attribué à un compte, pour une période définie (du, au, incluses) ou sans limite (D-46). */
const RoleAttribue = z.object({ roleId: z.uuid(), cycleId: z.uuid().nullish(), du: z.iso.date().nullish(), au: z.iso.date().nullish() })
  .refine((x) => !x.du || !x.au || x.au >= x.du, { message: 'La fin de la période doit suivre son début.', path: ['au'] });
const Periode = { du: z.iso.date().nullish(), au: z.iso.date().nullish() };

const NouveauCompte = z.object({
  identifiant: z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{3,40}$/, 'Lettres minuscules, chiffres, point, tiret.'),
  nomAffiche: z.string().trim().min(2).max(80),
  personnelId: z.uuid().nullish(),
  roles: z.array(RoleAttribue).min(1),
  motDePasse: z.string().min(8).max(200).optional(),
});

export interface LigneCompte {
  id: string; identifiant: string; nom_affiche: string; type: string; actif: boolean; derniere_activite: string | null;
  personnel_id: string | null; famille_id: string | null;
  roles: { code: string; libelle: string; perimetre: string; roleId: string; cycleId: string | null; du: string | null; au: string | null }[];
}

export async function routesAdministration(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  // ------------------------------------------------------------- comptes

  r.get('/core/comptes', { config: { permission: 'core.compte.consulter' }, schema: { tags: ['core'] } }, async (req) => {
    const ctx = exiger(req);
    const comptes = await app.bd.lire<LigneCompte>(sql`
      SELECT c.id, c.identifiant, c.nom_affiche, c.type, c.actif, c.derniere_activite, c.personnel_id, c.famille_id,
             COALESCE(json_agg(json_build_object('code', r.code, 'libelle', r.libelle_fr, 'perimetre', r.perimetre_type, 'roleId', r.id, 'cycleId', cr.cycle_id,
                               'du', cr.du, 'au', cr.au)
                      ORDER BY r.ordre) FILTER (WHERE r.id IS NOT NULL), '[]') AS roles
        FROM core.compte c
        LEFT JOIN core.compte_role cr ON cr.compte_id = c.id
        LEFT JOIN core.role r ON r.id = cr.role_id
       WHERE c.etablissement_id = ${ctx.etablissementId}
       GROUP BY c.id
       ORDER BY (c.type = 'famille'), min(r.ordre), c.cree_le`);
    const classes = await toutesClasses(app, ctx.etablissementId);
    const resultat = [];
    for (const c of comptes) {
      resultat.push({
        id: c.id, identifiant: c.identifiant, nomAffiche: c.nom_affiche, type: c.type, actif: c.actif,
        derniereActivite: c.derniere_activite,
        roles: c.roles.map((x) => x.libelle),
        attributions: c.roles.map((x) => ({ roleId: x.roleId, cycleId: x.cycleId, du: x.du, au: x.au, libelle: x.libelle })),
        perimetre: await texteperimetre(app, ctx.etablissementId, c, classes),
      });
    }
    return resultat;
  });

  r.post('/core/comptes', {
    config: { permission: 'core.compte.gerer' }, schema: { tags: ['core'], body: NouveauCompte },
  }, async (req) => {
    const ctx = exiger(req);
    const b = req.body;
    const motDePasse = b.motDePasse ?? motDePasseAleatoire(10);
    const empreinte = await hacher(motDePasse);
    return app.bd.transaction(ctx.compteId, async (tx) => {
      const roles = await verifierRoles(tx, ctx.etablissementId, b.roles.map((x) => x.roleId));
      const c = await ligne<{ id: string }>(tx, sql`
        INSERT INTO core.compte (etablissement_id, identifiant, nom_affiche, mot_de_passe, type, personnel_id, cree_par)
        VALUES (${ctx.etablissementId}, ${b.identifiant}, ${b.nomAffiche}, ${empreinte}, 'personnel', ${b.personnelId ?? null}, ${ctx.compteId})
        RETURNING id`);
      for (const ro of b.roles) {
        await tx.execute(sql`INSERT INTO core.compte_role (etablissement_id, compte_id, role_id, cycle_id, du, au)
                             VALUES (${ctx.etablissementId}, ${c!.id}, ${ro.roleId}, ${ro.cycleId ?? null}, ${ro.du ?? null}, ${ro.au ?? null})`);
      }
      await journaliser(tx, ctx, { action: 'Création', objetType: 'Droits', objetLibelle: `Droits · ${b.nomAffiche}`,
        avant: '–', apres: roles.join(', '), ligneId: c!.id, table: 'core.compte' });
      return { id: c!.id, identifiant: b.identifiant, motDePasse };
    });
  });

  r.patch('/core/comptes/:id', {
    config: { permission: 'core.compte.gerer' },
    schema: { tags: ['core'], params: Id, body: z.object({ nomAffiche: z.string().trim().min(2).max(80).optional(), personnelId: z.uuid().nullish(), roles: z.array(RoleAttribue).min(1).optional() }) },
  }, async (req) => {
    const ctx = exiger(req);
    const b = req.body;
    return app.bd.transaction(ctx.compteId, async (tx) => {
      const avant = await ligne<{ nom_affiche: string; roles: string }>(tx, sql`
        SELECT c.nom_affiche, string_agg(r.libelle_fr, ', ' ORDER BY r.ordre) AS roles
          FROM core.compte c LEFT JOIN core.compte_role cr ON cr.compte_id = c.id LEFT JOIN core.role r ON r.id = cr.role_id
         WHERE c.id = ${req.params.id} AND c.etablissement_id = ${ctx.etablissementId} GROUP BY c.id`);
      if (!avant) throw introuvable('Compte');
      if (b.nomAffiche) await tx.execute(sql`UPDATE core.compte SET nom_affiche = ${b.nomAffiche} WHERE id = ${req.params.id}`);
      if (b.personnelId !== undefined) await tx.execute(sql`UPDATE core.compte SET personnel_id = ${b.personnelId} WHERE id = ${req.params.id}`);
      if (b.roles) {
        const libelles = await verifierRoles(tx, ctx.etablissementId, b.roles.map((x) => x.roleId));
        await tx.execute(sql`DELETE FROM core.compte_role WHERE compte_id = ${req.params.id}`);
        for (const ro of b.roles) {
          await tx.execute(sql`INSERT INTO core.compte_role (etablissement_id, compte_id, role_id, cycle_id, du, au)
                               VALUES (${ctx.etablissementId}, ${req.params.id}, ${ro.roleId}, ${ro.cycleId ?? null}, ${ro.du ?? null}, ${ro.au ?? null})`);
        }
        await journaliser(tx, ctx, { action: 'Modification', objetType: 'Droits',
          objetLibelle: `Droits · ${b.nomAffiche ?? avant.nom_affiche}`, avant: avant.roles ?? '–', apres: libelles.join(', '),
          ligneId: req.params.id, table: 'core.compte' });
      }
      return { id: req.params.id };
    });
  });

  r.post('/core/comptes/:id/reinitialisation', {
    config: { permission: 'core.compte.reinitialiser' }, schema: { tags: ['core'], params: Id },
  }, async (req) => {
    const ctx = exiger(req);
    const motDePasse = motDePasseAleatoire(10);
    const empreinte = await hacher(motDePasse);
    // Le secrétariat remet un nouveau mot de passe aux familles ; les comptes du personnel relèvent du directeur (D-46).
    const famillesSeules = !ctx.a('core.compte.gerer');
    return app.bd.transaction(ctx.compteId, async (tx) => {
      const c = await ligne<{ nom_affiche: string; type: string }>(tx, sql`
        UPDATE core.compte SET mot_de_passe = ${empreinte}, echecs = 0, verrouille_jusqua = NULL
         WHERE id = ${req.params.id} AND etablissement_id = ${ctx.etablissementId} AND (${!famillesSeules} OR type = 'famille')
        RETURNING nom_affiche, type`);
      if (!c && famillesSeules) throw interdit('core.compte.gerer');
      if (!c) throw introuvable('Compte');
      await tx.execute(sql`UPDATE core.session SET revoquee_le = now() WHERE compte_id = ${req.params.id} AND revoquee_le IS NULL`);
      await journaliser(tx, ctx, { action: 'Réinitialisation', objetType: 'Droits', objetLibelle: `Mot de passe · ${c.nom_affiche}`,
        avant: '–', apres: 'Nouveau mot de passe', ligneId: req.params.id, table: 'core.compte' });
      return { id: req.params.id, motDePasse, type: c.type };
    });
  });

  r.post('/core/comptes/:id/desactivation', {
    config: { permission: 'core.compte.desactiver' }, schema: { tags: ['core'], params: Id },
  }, async (req) => {
    const ctx = exiger(req);
    if (req.params.id === ctx.compteId) throw new ErreurMetier('CORE_AUTO_DESACTIVATION', 422, 'Vous ne pouvez pas désactiver votre propre compte.');
    return app.bd.transaction(ctx.compteId, async (tx) => {
      const c = await ligne<{ nom_affiche: string; actif: boolean }>(tx, sql`
        UPDATE core.compte SET actif = NOT actif WHERE id = ${req.params.id} AND etablissement_id = ${ctx.etablissementId}
        RETURNING nom_affiche, actif`);
      if (!c) throw introuvable('Compte');
      if (!c.actif) await tx.execute(sql`UPDATE core.session SET revoquee_le = now() WHERE compte_id = ${req.params.id} AND revoquee_le IS NULL`);
      await journaliser(tx, ctx, { action: c.actif ? 'Modification' : 'Désactivation', objetType: 'Droits',
        objetLibelle: `Compte · ${c.nom_affiche}`, avant: c.actif ? 'Désactivé' : 'Actif', apres: c.actif ? 'Actif' : 'Désactivé',
        ligneId: req.params.id, table: 'core.compte' });
      return { id: req.params.id, actif: c.actif };
    });
  });

  // ------------------------------------------------------------- rôles et permissions

  r.get('/core/permissions', { config: { unePermissionParmi: ['core.compte.consulter', 'core.role.gerer'] }, schema: { tags: ['core'] } },
    async () => PERMISSIONS.filter((p) => p.groupe !== 'Espace parent').map((p) => ({ code: p.code, groupe: p.groupe, libelle: p.libelleFr, libelleEn: p.libelleEn })));

  r.get('/core/roles', { config: { unePermissionParmi: ['core.compte.consulter', 'core.role.gerer'] }, schema: { tags: ['core'] } }, async (req) => {
    const ctx = exiger(req);
    return app.bd.lire(sql`
      SELECT r.id, r.code, r.libelle_fr AS libelle, r.libelle_en AS "libelleEn", r.systeme, r.perimetre_type AS perimetre, r.du::text AS du, r.au::text AS au,
             COALESCE(array_agg(rp.permission_code ORDER BY rp.permission_code) FILTER (WHERE rp.permission_code IS NOT NULL), '{}') AS permissions
        FROM core.role r LEFT JOIN core.role_permission rp ON rp.role_id = r.id
       WHERE r.etablissement_id = ${ctx.etablissementId}
       GROUP BY r.id ORDER BY r.ordre, r.libelle_fr`);
  });

  r.post('/core/roles', {
    config: { permission: 'core.role.gerer' },
    schema: { tags: ['core'], body: z.object({ depuisRoleId: z.uuid().nullish(), libelle: z.string().trim().min(2).max(60), libelleEn: z.string().trim().max(60).optional(),
      /** Rôle créé de zéro : actions choisies une à une (D-46). */
      permissions: z.array(z.string()).max(200).optional(), ...Periode }) },
  }, async (req) => {
    const ctx = exiger(req);
    const b = req.body;
    if (b.du && b.au && b.au < b.du) throw new ErreurMetier('CORE_PERIODE', 422, 'La fin de la période doit suivre son début.', 'au');
    const inconnue = (b.permissions ?? []).find((p) => !estPermission(p));
    if (inconnue) throw new ErreurMetier('CORE_PERMISSION_INCONNUE', 422, `Permission inconnue : ${inconnue}.`);
    return app.bd.transaction(ctx.compteId, async (tx) => {
      const base = b.depuisRoleId ? await ligne<{ id: string; perimetre_type: string; libelle_fr: string }>(tx, sql`
        SELECT id, perimetre_type, libelle_fr FROM core.role WHERE id = ${b.depuisRoleId} AND etablissement_id = ${ctx.etablissementId}`)
        : { id: null, perimetre_type: 'etablissement', libelle_fr: '' };
      if (!base) throw introuvable('Rôle');
      const code = 'perso_' + b.libelle.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 30)
        + '_' + Date.now().toString(36);
      const nouveau = await ligne<{ id: string }>(tx, sql`
        INSERT INTO core.role (etablissement_id, code, libelle_fr, libelle_en, systeme, perimetre_type, cree_depuis, ordre, cree_par, du, au)
        VALUES (${ctx.etablissementId}, ${code}, ${b.libelle}, ${b.libelleEn ?? b.libelle}, false, ${base.perimetre_type}, ${base.id}, 50, ${ctx.compteId}, ${b.du ?? null}, ${b.au ?? null})
        RETURNING id`);
      if (b.permissions) {
        for (const p of new Set(b.permissions)) await tx.execute(sql`INSERT INTO core.role_permission (role_id, permission_code) VALUES (${nouveau!.id}, ${p})`);
      } else if (base.id) {
        await tx.execute(sql`INSERT INTO core.role_permission (role_id, permission_code)
                             SELECT ${nouveau!.id}, permission_code FROM core.role_permission WHERE role_id = ${base.id}`);
      }
      const periode = b.du || b.au ? ` · ${b.du ? `du ${b.du.split('-').reverse().join('/')}` : ''}${b.au ? ` au ${b.au.split('-').reverse().join('/')}` : ' sans limite'}` : '';
      await journaliser(tx, ctx, { action: 'Création', objetType: 'Droits', objetLibelle: `Rôle · ${b.libelle}`,
        avant: '–', apres: `${base.id ? `À partir de « ${base.libelle_fr} »` : `${b.permissions?.length ?? 0} actions choisies`}${periode}`, ligneId: nouveau!.id, table: 'core.role' });
      return { id: nouveau!.id };
    });
  });

  r.put('/core/roles/:id/permissions', {
    config: { permission: 'core.role.gerer' },
    schema: { tags: ['core'], params: Id, body: z.object({ permissions: z.array(z.string()).max(200) }) },
  }, async (req) => {
    const ctx = exiger(req);
    const voulues = [...new Set(req.body.permissions)];
    const inconnue = voulues.find((p) => !estPermission(p));
    if (inconnue) throw new ErreurMetier('CORE_PERMISSION_INCONNUE', 422, `Permission inconnue : ${inconnue}.`);
    return app.bd.transaction(ctx.compteId, async (tx) => {
      const role = await ligne<{ code: string; libelle_fr: string }>(tx, sql`
        SELECT code, libelle_fr FROM core.role WHERE id = ${req.params.id} AND etablissement_id = ${ctx.etablissementId}`);
      if (!role) throw introuvable('Rôle');
      // Le directeur administre les comptes et les rôles (D-46) : son rôle ne peut pas en perdre le moyen.
      if (role.code === 'directeur' && !(voulues.includes('core.role.gerer') && voulues.includes('core.compte.gerer'))) {
        throw new ErreurMetier('CORE_ADMINISTRATION_REQUISE', 422, 'Le rôle Directeur garde la gestion des comptes et des rôles.');
      }
      const avant = (await lignes<{ permission_code: string }>(tx, sql`SELECT permission_code FROM core.role_permission WHERE role_id = ${req.params.id}`))
        .map((x) => x.permission_code);
      await tx.execute(sql`DELETE FROM core.role_permission WHERE role_id = ${req.params.id}`);
      for (const p of voulues) await tx.execute(sql`INSERT INTO core.role_permission (role_id, permission_code) VALUES (${req.params.id}, ${p})`);
      const libelle = (codes: string[]) => codes.map((c) => PERMISSIONS.find((x) => x.code === c)?.libelleFr ?? c);
      const ajoutees = libelle(voulues.filter((p) => !avant.includes(p)));
      const retirees = libelle(avant.filter((p) => !voulues.includes(p)));
      if (ajoutees.length || retirees.length) {
        await journaliser(tx, ctx, { action: 'Modification', objetType: 'Droits', objetLibelle: `Rôle · ${role.libelle_fr}`,
          avant: retirees.length ? `Retiré : ${retirees.join(', ')}` : '–', apres: ajoutees.length ? `Ajouté : ${ajoutees.join(', ')}` : '–',
          ligneId: req.params.id, table: 'core.role' });
      }
      return { id: req.params.id, permissions: voulues };
    });
  });

  /** Libellé ou période d'un rôle sur mesure (les rôles de l'application gardent leur nom et n'expirent pas). */
  r.patch('/core/roles/:id', {
    config: { permission: 'core.role.gerer' },
    schema: { tags: ['core'], params: Id, body: z.object({ libelle: z.string().trim().min(2).max(60).optional(), ...Periode }) },
  }, async (req) => {
    const ctx = exiger(req);
    const b = req.body;
    if (b.du && b.au && b.au < b.du) throw new ErreurMetier('CORE_PERIODE', 422, 'La fin de la période doit suivre son début.', 'au');
    return app.bd.transaction(ctx.compteId, async (tx) => {
      const role = await ligne<{ systeme: boolean; libelle_fr: string; du: string | null; au: string | null }>(tx, sql`
        SELECT systeme, libelle_fr, du::text, au::text FROM core.role WHERE id = ${req.params.id} AND etablissement_id = ${ctx.etablissementId}`);
      if (!role) throw introuvable('Rôle');
      if (role.systeme) throw new ErreurMetier('CORE_ROLE_SYSTEME', 422, 'Les rôles de l’application gardent leur nom et n’ont pas de période.');
      await tx.execute(sql`UPDATE core.role SET libelle_fr = ${b.libelle ?? role.libelle_fr}, libelle_en = ${b.libelle ?? role.libelle_fr},
                             du = ${b.du === undefined ? role.du : b.du}, au = ${b.au === undefined ? role.au : b.au} WHERE id = ${req.params.id}`);
      await journaliser(tx, ctx, { action: 'Modification', objetType: 'Droits', objetLibelle: `Rôle · ${b.libelle ?? role.libelle_fr}`,
        avant: `${role.du ?? '–'} → ${role.au ?? 'sans limite'}`, apres: `${(b.du === undefined ? role.du : b.du) ?? '–'} → ${(b.au === undefined ? role.au : b.au) ?? 'sans limite'}`,
        ligneId: req.params.id, table: 'core.role' });
      return { ok: true };
    });
  });

  /** Attributions particulières d'un compte : permissions en plus de ses rôles, pour une période définie ou non (D-46). */
  r.get('/core/comptes/:id/permissions', { config: { permission: 'core.compte.gerer' }, schema: { tags: ['core'], params: Id } }, async (req) => {
    const ctx = exiger(req);
    const l = await app.bd.lire<{ id: string; permission_code: string; du: string | null; au: string | null; motif: string | null }>(sql`
      SELECT cp.id, cp.permission_code, cp.du::text, cp.au::text, cp.motif FROM core.compte_permission cp JOIN core.compte c ON c.id = cp.compte_id
       WHERE cp.compte_id = ${req.params.id} AND c.etablissement_id = ${ctx.etablissementId} ORDER BY cp.cree_le`);
    return l.map((x) => ({ id: x.id, code: x.permission_code, libelle: PERMISSIONS.find((p) => p.code === x.permission_code)?.libelleFr ?? x.permission_code,
      du: x.du, au: x.au, motif: x.motif }));
  });

  r.post('/core/comptes/:id/permissions', {
    config: { permission: 'core.compte.gerer' },
    schema: { tags: ['core'], params: Id, body: z.object({ permission: z.string(), motif: z.string().trim().max(200).nullish(), ...Periode }) },
  }, async (req) => {
    const ctx = exiger(req);
    const b = req.body;
    if (!estPermission(b.permission)) throw new ErreurMetier('CORE_PERMISSION_INCONNUE', 422, `Permission inconnue : ${b.permission}.`);
    if (b.du && b.au && b.au < b.du) throw new ErreurMetier('CORE_PERIODE', 422, 'La fin de la période doit suivre son début.', 'au');
    return app.bd.transaction(ctx.compteId, async (tx) => {
      const c = await ligne<{ nom_affiche: string; type: string }>(tx, sql`
        SELECT nom_affiche, type FROM core.compte WHERE id = ${req.params.id} AND etablissement_id = ${ctx.etablissementId}`);
      if (!c) throw introuvable('Compte');
      if (c.type !== 'personnel') throw new ErreurMetier('CORE_COMPTE_FAMILLE', 422, 'Un compte famille ne reçoit pas d’attribution particulière.');
      const x = await ligne<{ id: string }>(tx, sql`
        INSERT INTO core.compte_permission (etablissement_id, compte_id, permission_code, du, au, motif, cree_par)
        VALUES (${ctx.etablissementId}, ${req.params.id}, ${b.permission}, ${b.du ?? null}, ${b.au ?? null}, ${b.motif ?? null}, ${ctx.compteId})
        ON CONFLICT (compte_id, permission_code) DO UPDATE SET du = EXCLUDED.du, au = EXCLUDED.au, motif = EXCLUDED.motif RETURNING id`);
      const lib = PERMISSIONS.find((p) => p.code === b.permission)?.libelleFr ?? b.permission;
      await journaliser(tx, ctx, { action: 'Modification', objetType: 'Droits', objetLibelle: `Attribution · ${c.nom_affiche}`,
        avant: '–', apres: `${lib}${b.du ? ` du ${b.du.split('-').reverse().join('/')}` : ''}${b.au ? ` au ${b.au.split('-').reverse().join('/')}` : ', sans limite'}`,
        ligneId: req.params.id, table: 'core.compte' });
      return { id: x!.id };
    });
  });

  r.delete('/core/comptes/:id/permissions/:pid', {
    config: { permission: 'core.compte.gerer' }, schema: { tags: ['core'], params: z.object({ id: z.uuid(), pid: z.uuid() }) },
  }, async (req) => {
    const ctx = exiger(req);
    return app.bd.transaction(ctx.compteId, async (tx) => {
      const x = await ligne<{ permission_code: string; nom: string }>(tx, sql`
        DELETE FROM core.compte_permission cp USING core.compte c
         WHERE cp.id = ${req.params.pid} AND cp.compte_id = ${req.params.id} AND c.id = cp.compte_id AND c.etablissement_id = ${ctx.etablissementId}
        RETURNING cp.permission_code, c.nom_affiche AS nom`);
      if (!x) throw introuvable('Attribution');
      await journaliser(tx, ctx, { action: 'Modification', objetType: 'Droits', objetLibelle: `Attribution · ${x.nom}`,
        avant: PERMISSIONS.find((p) => p.code === x.permission_code)?.libelleFr ?? x.permission_code, apres: 'Retirée', ligneId: req.params.id, table: 'core.compte' });
      return { ok: true };
    });
  });

  // ------------------------------------------------------------- journal d'audit (CU-04)

  const FiltreJournal = z.object({
    du: z.iso.date().optional(), au: z.iso.date().optional(), utilisateur: z.uuid().optional(),
    objet: z.string().max(40).optional(), action: z.string().max(40).optional(),
    page: z.coerce.number().int().min(1).default(1), taille: z.coerce.number().int().min(1).max(500).default(8),
  });

  const requeteJournal = (etab: string, f: z.infer<typeof FiltreJournal>) => sql`
      FROM core.journal_audit j LEFT JOIN core.compte c ON c.id = j.utilisateur_id
     WHERE j.etablissement_id = ${etab} AND j.nature = 'metier'
       AND (${f.du ?? null}::date IS NULL OR j.horodatage >= ${f.du ?? null}::date)
       AND (${f.au ?? null}::date IS NULL OR j.horodatage < ${f.au ?? null}::date + 1)
       AND (${f.utilisateur ?? null}::uuid IS NULL OR j.utilisateur_id = ${f.utilisateur ?? null}::uuid)
       AND (${f.objet ?? null}::text IS NULL OR j.objet_type = ${f.objet ?? null})
       AND (${f.action ?? null}::text IS NULL OR j.action = ${f.action ?? null})`;

  r.get('/core/journal', { config: { permission: 'core.audit.consulter' }, schema: { tags: ['core'], querystring: FiltreJournal } }, async (req) => {
    const ctx = exiger(req);
    const f = req.query;
    const total = await app.bd.lireUn<{ n: number }>(sql`SELECT count(*)::int AS n ${requeteJournal(ctx.etablissementId, f)}`);
    const rows = await app.bd.lire(sql`
      SELECT j.id, j.horodatage, COALESCE(c.nom_affiche, 'Système') AS utilisateur, j.action, j.objet_type AS "objetType",
             j.objet_libelle AS objet, j.avant_libelle AS avant, j.apres_libelle AS apres
      ${requeteJournal(ctx.etablissementId, f)}
      ORDER BY j.horodatage DESC LIMIT ${f.taille} OFFSET ${(f.page - 1) * f.taille}`);
    const options = await app.bd.lireUn<{ utilisateurs: { id: string; nom: string }[]; objets: string[]; actions: string[] }>(sql`
      SELECT (SELECT COALESCE(json_agg(DISTINCT jsonb_build_object('id', c.id, 'nom', c.nom_affiche)), '[]')
                FROM core.journal_audit j JOIN core.compte c ON c.id = j.utilisateur_id
               WHERE j.etablissement_id = ${ctx.etablissementId} AND j.nature = 'metier') AS utilisateurs,
             (SELECT COALESCE(array_agg(DISTINCT objet_type), '{}') FROM core.journal_audit
               WHERE etablissement_id = ${ctx.etablissementId} AND nature = 'metier' AND objet_type IS NOT NULL) AS objets,
             (SELECT COALESCE(array_agg(DISTINCT action), '{}') FROM core.journal_audit
               WHERE etablissement_id = ${ctx.etablissementId} AND nature = 'metier') AS actions`);
    return { total: total!.n, page: f.page, taille: f.taille, lignes: rows, options };
  });

  r.get('/core/journal/export', { config: { permission: 'core.audit.exporter' }, schema: { tags: ['core'], querystring: FiltreJournal.omit({ page: true, taille: true }) } }, async (req, rep) => {
    const ctx = exiger(req);
    const f = { ...req.query, page: 1, taille: 500 };
    const rows = await app.bd.lire<Record<string, unknown>>(sql`
      SELECT to_char(j.horodatage AT TIME ZONE 'Africa/Douala', 'DD/MM/YYYY HH24:MI') AS "Date", COALESCE(c.nom_affiche, 'Système') AS "Utilisateur",
             j.action AS "Action", j.objet_libelle AS "Objet", COALESCE(j.avant_libelle, '–') AS "Avant", COALESCE(j.apres_libelle, '–') AS "Après"
      ${requeteJournal(ctx.etablissementId, f)} ORDER BY j.horodatage DESC`);
    // Chaque export est lui-même journalisé (conception § 8).
    await app.bd.transaction(ctx.compteId, (tx) => journaliser(tx, ctx, { action: 'Export', objetType: 'Journal',
      objetLibelle: `Export du journal d'audit · ${rows.length} lignes`, avant: '–', apres: 'CSV' }));
    return rep.header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', 'attachment; filename="journal-audit.csv"').send(versCsv(rows));
  });
}

async function verifierRoles(tx: Parameters<typeof lignes>[0], etab: string, ids: string[]): Promise<string[]> {
  const roles = await lignes<{ id: string; libelle_fr: string; code: string }>(tx, sql`
    SELECT id, libelle_fr, code FROM core.role WHERE etablissement_id = ${etab} AND id = ANY(${tableau(ids)}::uuid[]) ORDER BY ordre`);
  if (roles.length !== new Set(ids).size) throw new ErreurMetier('CORE_ROLE_INCONNU', 422, 'Rôle inconnu.');
  if (roles.some((x) => x.code === 'parent')) {
    throw new ErreurMetier('CORE_ROLE_PARENT', 422, 'Le compte parent est créé à l\'inscription (RG-35).');
  }
  return roles.map((x) => x.libelle_fr);
}

async function toutesClasses(app: FastifyInstance, etab: string) {
  return app.bd.lire<ClasseNiveau & { id: string }>(sql`
    SELECT c.id, c.nom, n.rang AS "niveauRang", n.code AS "niveauCode"
      FROM structure.classe c JOIN structure.niveau n ON n.id = c.niveau_id
      JOIN structure.annee_scolaire a ON a.id = c.annee_id AND a.statut = 'ouverte'
     WHERE c.etablissement_id = ${etab}`);
}

async function texteperimetre(app: FastifyInstance, etab: string, c: LigneCompte, classes: (ClasseNiveau & { id: string })[]): Promise<string> {
  if (c.type === 'famille' && c.famille_id) return texteFamille(app.bd, c.famille_id);
  const parties: string[] = [];
  if (c.roles.some((x) => x.perimetre === 'etablissement')) parties.push('Établissement');
  if (c.roles.some((x) => x.perimetre === 'affectations') && c.personnel_id) {
    const p = await perimetreDePersonnel(app.bd, etab, c.personnel_id);
    if (p.classesPrincipal.length) parties.push(p.classesPrincipal.map((k) => k.nom).join(', '));
    const parMatiere = new Map<string, (ClasseNiveau & { id: string })[]>();
    for (const m of p.matieres) {
      const k = classes.find((x) => x.id === m.classeId);
      if (k) parMatiere.set(m.matiereAbrege, [...(parMatiere.get(m.matiereAbrege) ?? []), k]);
    }
    for (const [m, ks] of parMatiere) parties.push(`${m} · ${resumeClasses(ks, classes)}`);
  }
  return parties.join(' ; ') || '–';
}
