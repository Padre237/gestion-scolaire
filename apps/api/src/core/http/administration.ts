// CU-03 · Gérer les comptes et les rôles (SOC-06 à SOC-09, ADR-12) ; CU-04 · journal d'audit.
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { estPermission, PERMISSIONS } from '@gs/shared';
import { sql, lignes, ligne, tableau } from '../bd.ts';
import { ErreurMetier, introuvable } from '../erreurs.ts';
import { exiger } from '../session.ts';
import { hacher, motDePasseAleatoire } from '../motdepasse.ts';
import { journaliser } from '../audit.ts';
import { resumeClasses, texteFamille, type ClasseNiveau } from '../perimetre-texte.ts';
import { versCsv } from '../csv.ts';
import { perimetreDePersonnel } from '../perimetre.ts';

const Id = z.object({ id: z.uuid() });

const RoleAttribue = z.object({ roleId: z.uuid(), cycleId: z.uuid().nullish() });

const NouveauCompte = z.object({
  identifiant: z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{3,40}$/, 'Lettres minuscules, chiffres, point, tiret.'),
  nomAffiche: z.string().trim().min(2).max(80),
  personnelId: z.uuid().nullish(),
  roles: z.array(RoleAttribue).min(1),
  motDePasse: z.string().min(8).max(200).optional(),
});

export interface LigneCompte {
  id: string; identifiant: string; nom_affiche: string; type: string; actif: boolean; derniere_activite: string | null;
  personnel_id: string | null; famille_id: string | null; roles: { code: string; libelle: string; perimetre: string }[];
}

export async function routesAdministration(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  // ------------------------------------------------------------- comptes

  r.get('/core/comptes', { config: { permission: 'core.compte.consulter' }, schema: { tags: ['core'] } }, async (req) => {
    const ctx = exiger(req);
    const comptes = await app.bd.lire<LigneCompte>(sql`
      SELECT c.id, c.identifiant, c.nom_affiche, c.type, c.actif, c.derniere_activite, c.personnel_id, c.famille_id,
             COALESCE(json_agg(json_build_object('code', r.code, 'libelle', r.libelle_fr, 'perimetre', r.perimetre_type)
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
        await tx.execute(sql`INSERT INTO core.compte_role (etablissement_id, compte_id, role_id, cycle_id)
                             VALUES (${ctx.etablissementId}, ${c!.id}, ${ro.roleId}, ${ro.cycleId ?? null})`);
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
          await tx.execute(sql`INSERT INTO core.compte_role (etablissement_id, compte_id, role_id, cycle_id)
                               VALUES (${ctx.etablissementId}, ${req.params.id}, ${ro.roleId}, ${ro.cycleId ?? null})`);
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
    return app.bd.transaction(ctx.compteId, async (tx) => {
      const c = await ligne<{ nom_affiche: string; type: string }>(tx, sql`
        UPDATE core.compte SET mot_de_passe = ${empreinte}, echecs = 0, verrouille_jusqua = NULL
         WHERE id = ${req.params.id} AND etablissement_id = ${ctx.etablissementId} RETURNING nom_affiche, type`);
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
      SELECT r.id, r.code, r.libelle_fr AS libelle, r.libelle_en AS "libelleEn", r.systeme, r.perimetre_type AS perimetre,
             COALESCE(array_agg(rp.permission_code ORDER BY rp.permission_code) FILTER (WHERE rp.permission_code IS NOT NULL), '{}') AS permissions
        FROM core.role r LEFT JOIN core.role_permission rp ON rp.role_id = r.id
       WHERE r.etablissement_id = ${ctx.etablissementId}
       GROUP BY r.id ORDER BY r.ordre, r.libelle_fr`);
  });

  r.post('/core/roles', {
    config: { permission: 'core.role.gerer' },
    schema: { tags: ['core'], body: z.object({ depuisRoleId: z.uuid(), libelle: z.string().trim().min(2).max(60), libelleEn: z.string().trim().max(60).optional() }) },
  }, async (req) => {
    const ctx = exiger(req);
    const b = req.body;
    return app.bd.transaction(ctx.compteId, async (tx) => {
      const base = await ligne<{ id: string; perimetre_type: string; libelle_fr: string }>(tx, sql`
        SELECT id, perimetre_type, libelle_fr FROM core.role WHERE id = ${b.depuisRoleId} AND etablissement_id = ${ctx.etablissementId}`);
      if (!base) throw introuvable('Rôle');
      const code = 'perso_' + b.libelle.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 30)
        + '_' + Date.now().toString(36);
      const nouveau = await ligne<{ id: string }>(tx, sql`
        INSERT INTO core.role (etablissement_id, code, libelle_fr, libelle_en, systeme, perimetre_type, cree_depuis, ordre, cree_par)
        VALUES (${ctx.etablissementId}, ${code}, ${b.libelle}, ${b.libelleEn ?? b.libelle}, false, ${base.perimetre_type}, ${base.id}, 50, ${ctx.compteId})
        RETURNING id`);
      await tx.execute(sql`INSERT INTO core.role_permission (role_id, permission_code)
                           SELECT ${nouveau!.id}, permission_code FROM core.role_permission WHERE role_id = ${base.id}`);
      await journaliser(tx, ctx, { action: 'Création', objetType: 'Droits', objetLibelle: `Rôle · ${b.libelle}`,
        avant: '–', apres: `À partir de « ${base.libelle_fr} »`, ligneId: nouveau!.id, table: 'core.role' });
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
      // La secrétaire administre l'application (ADR-12) : elle ne peut pas s'en retirer le moyen.
      if (role.code === 'secretaire' && !(voulues.includes('core.role.gerer') && voulues.includes('core.compte.gerer'))) {
        throw new ErreurMetier('CORE_ADMINISTRATION_REQUISE', 422, 'Le rôle Secrétaire garde la gestion des comptes et des rôles.');
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
