// CU-18 · Paramétrer matières, coefficients et affectations (PED-01 à PED-04, RG-02, RG-34).
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { sql, ligne, lignes } from '../../../core/bd.ts';
import { ErreurMetier, introuvable } from '../../../core/erreurs.ts';
import { exiger } from '../../../core/session.ts';
import { journaliser } from '../../../core/audit.ts';
import { exigerAnneeOuverte } from '../../structure/index.ts';
import { classesAnnee, classesEtMatieres } from '../../personnel/http/routes.ts';
import { titulairesClasse } from '../index.ts';
import { surEvenement } from '../../../core/evenements.ts';
import { codeMatiere, GROUPES_MATIERES, programmeDuNiveau } from '@gs/shared';

// Programme de la nouvelle année : celui de l'année précédente, sinon le programme préinstallé de chaque niveau (lot 1, D-40).
surEvenement('annee.creee', async (tx, ctx, d) => {
  const compte = ctx?.compteId ?? null;
  const etab = (await ligne<{ etablissement_id: string }>(tx, sql`SELECT etablissement_id FROM structure.annee_scolaire WHERE id = ${d.anneeId}`))!.etablissement_id;
  if (d.precedenteId) {
    const r = await tx.execute(sql`
      INSERT INTO pedagogie.programme_niveau (etablissement_id, annee_id, niveau_id, matiere_id, coefficient, bareme, ordre_bulletin, cree_par)
      SELECT etablissement_id, ${d.anneeId}, niveau_id, matiere_id, coefficient, bareme, ordre_bulletin, ${compte}
        FROM pedagogie.programme_niveau WHERE annee_id = ${d.precedenteId}
      ON CONFLICT (annee_id, niveau_id, matiere_id) DO NOTHING`);
    if ((r.rowCount ?? 0) > 0) return;
  }
  const niveaux = await lignes<{ id: string; code: string; sous_systeme: 'francophone' | 'anglophone'; ordre: string }>(tx, sql`
    SELECT n.id, n.code, cy.sous_systeme, cy.ordre_enseignement AS ordre FROM structure.niveau n JOIN structure.cycle cy ON cy.id = n.cycle_id
     WHERE n.etablissement_id = ${etab}`);
  if (!niveaux.length) return;
  const groupes = new Map<string, string>();
  for (const [i, [fr, en]] of GROUPES_MATIERES.entries()) {
    const g = await ligne<{ id: string }>(tx, sql`SELECT id FROM pedagogie.groupe_matiere WHERE etablissement_id = ${etab} AND libelle_fr = ${fr}`)
      ?? await ligne<{ id: string }>(tx, sql`INSERT INTO pedagogie.groupe_matiere (etablissement_id, libelle_fr, libelle_en, ordre, cree_par)
                                             VALUES (${etab}, ${fr}, ${en}, ${i + 1}, ${compte}) RETURNING id`);
    groupes.set(fr, g!.id);
  }
  for (const n of niveaux) {
    for (const [i, m] of programmeDuNiveau(n.code, n.sous_systeme, n.ordre).entries()) {
      const mat = await ligne<{ id: string }>(tx, sql`
        INSERT INTO pedagogie.matiere (etablissement_id, code, libelle_fr, libelle_en, abrege_fr, abrege_en, groupe_id, cree_par)
        VALUES (${etab}, ${codeMatiere(m.libelleFr)}, ${m.libelleFr}, ${m.libelleEn}, ${m.abregeFr}, ${m.abregeEn}, ${groupes.get(m.groupe) ?? null}, ${compte})
        ON CONFLICT (etablissement_id, code) DO UPDATE SET code = EXCLUDED.code RETURNING id`);
      await tx.execute(sql`
        INSERT INTO pedagogie.programme_niveau (etablissement_id, annee_id, niveau_id, matiere_id, coefficient, bareme, ordre_bulletin, cree_par)
        VALUES (${etab}, ${d.anneeId}, ${n.id}, ${mat!.id}, ${m.coefficient}, 20, ${i + 1}, ${compte})
        ON CONFLICT (annee_id, niveau_id, matiere_id) DO NOTHING`);
    }
  }
});

export async function routesParametrage(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get('/pedagogie/parametrage', {
    config: { permission: 'pedagogie.programme.consulter' },
    schema: { tags: ['pedagogie'], querystring: z.object({ niveauId: z.uuid().optional() }) },
  }, async (req) => {
    const ctx = exiger(req);
    const annee = await exigerAnneeOuverte(app.bd, ctx.etablissementId);
    const niveaux = await app.bd.lire<{ id: string; code: string; sous_systeme: string; ordre_enseignement: string }>(sql`
      SELECT n.id, n.code, cy.sous_systeme, cy.ordre_enseignement FROM structure.niveau n JOIN structure.cycle cy ON cy.id = n.cycle_id
       WHERE n.etablissement_id = ${ctx.etablissementId}
         AND EXISTS (SELECT 1 FROM structure.classe c WHERE c.niveau_id = n.id AND c.annee_id = ${annee.id})
       ORDER BY cy.sous_systeme DESC, n.rang`);
    const niveauId = req.query.niveauId ?? niveaux[0]?.id;
    const groupes = await app.bd.lire(sql`
      SELECT id, libelle_fr AS "libelleFr", libelle_en AS "libelleEn" FROM pedagogie.groupe_matiere
       WHERE etablissement_id = ${ctx.etablissementId} ORDER BY ordre, libelle_fr`);
    if (!niveauId) return { niveaux, niveauId: null, groupes, matieres: [], equipes: [], disponibles: [], instituteurs: [] };
    const reglage = await app.bd.lireUn<{ mode_evaluation: string; filiere: string | null }>(sql`
      SELECT mode_evaluation, filiere FROM pedagogie.niveau_annee WHERE annee_id = ${annee.id} AND niveau_id = ${niveauId}`);
    const programme = await app.bd.lire<{ matiere_id: string; libelle_fr: string; libelle_en: string; groupe: string | null; coefficient: number; bareme: number; ordre: number }>(sql`
      SELECT m.id AS matiere_id, m.libelle_fr, m.libelle_en, g.libelle_fr AS groupe, pn.coefficient, pn.bareme, pn.ordre_bulletin AS ordre
        FROM pedagogie.programme_niveau pn JOIN pedagogie.matiere m ON m.id = pn.matiere_id
        LEFT JOIN pedagogie.groupe_matiere g ON g.id = m.groupe_id
       WHERE pn.annee_id = ${annee.id} AND pn.niveau_id = ${niveauId} ORDER BY pn.ordre_bulletin`);
    const classes = await app.bd.lire<{ id: string; nom: string }>(sql`
      SELECT id, nom FROM structure.classe WHERE niveau_id = ${niveauId} AND annee_id = ${annee.id} ORDER BY nom`);
    const toutes = await classesAnnee(app.bd, ctx.etablissementId);
    // Instituteur de chaque matière, classe par classe (affiché tel quel si toutes les classes ont le même).
    const parClasse = await app.bd.transaction(null, async (tx) => {
      const res: Record<string, Awaited<ReturnType<typeof titulairesClasse>>> = {};
      for (const c of classes) res[c.id] = await titulairesClasse(tx, c.id);
      return res;
    });
    const matieres = programme.map((p) => {
      const noms = classes.map((c) => ({ classe: c.nom, nom: parClasse[c.id]!.find((t) => t.matiere_id === p.matiere_id)?.nom ?? null }));
      const distincts = [...new Set(noms.map((n) => n.nom))];
      const instituteur = distincts.length <= 1 ? (distincts[0] ?? null) : noms.map((n) => `${n.classe} : ${n.nom ?? '–'}`).join(' · ');
      return { matiereId: p.matiere_id, libelleFr: p.libelle_fr, libelleEn: p.libelle_en, groupe: p.groupe, coefficient: p.coefficient, bareme: p.bareme, ordre: p.ordre, instituteur };
    });
    const equipes = [];
    for (const c of classes) {
      const principal = await app.bd.lireUn<{ id: string; personnel_id: string; nom: string }>(sql`
        SELECT a.id, a.personnel_id, p.nom_affiche AS nom FROM pedagogie.affectation a JOIN personnel.fiche p ON p.id = a.personnel_id
         WHERE a.classe_id = ${c.id} AND a.principal`);
      const exceptions = await app.bd.lire<{ id: string; matiere_id: string; matiere: string; personnel_id: string; nom: string; statut: string }>(sql`
        SELECT a.id, a.matiere_id, m.libelle_fr AS matiere, a.personnel_id, p.nom_affiche AS nom, p.statut
          FROM pedagogie.affectation a JOIN pedagogie.matiere m ON m.id = a.matiere_id JOIN personnel.fiche p ON p.id = a.personnel_id
          LEFT JOIN pedagogie.programme_niveau pn ON pn.matiere_id = m.id AND pn.niveau_id = ${niveauId} AND pn.annee_id = ${annee.id}
         WHERE a.classe_id = ${c.id} AND NOT a.principal ORDER BY pn.ordre_bulletin`);
      const texteExceptions = principal ? await classesEtMatieres(app.bd, ctx.etablissementId, principal.personnel_id, toutes) : '';
      const lignesEx = [];
      for (const e of exceptions) {
        const t = await classesEtMatieres(app.bd, ctx.etablissementId, e.personnel_id, toutes);
        const propre = t.split(' ; ').find((x) => x.startsWith(e.matiere) || x.toLowerCase().includes(e.matiere.toLowerCase())) ?? t;
        lignesEx.push({ affectationId: e.id, matiereId: e.matiere_id, matiere: e.matiere, personnelId: e.personnel_id, nom: e.nom, statut: e.statut,
          classes: propre.includes(' · ') ? propre.split(' · ').slice(1).join(' · ') : propre });
      }
      const sauf = texteExceptions.split(' ; ').find((x) => x.startsWith(c.nom + ' ·'));
      equipes.push({ classeId: c.id, classe: c.nom,
        principal: principal ? { affectationId: principal.id, personnelId: principal.personnel_id, nom: principal.nom } : null,
        couverture: sauf ? sauf.replace(`${c.nom} · `, '').replace('toutes matières', 'toutes les matières').replace(' sauf ', ', sauf ') : null,
        exceptions: lignesEx });
    }
    const disponibles = await app.bd.lire(sql`
      SELECT m.id, m.libelle_fr AS "libelleFr", m.libelle_en AS "libelleEn" FROM pedagogie.matiere m
       WHERE m.etablissement_id = ${ctx.etablissementId}
         AND NOT EXISTS (SELECT 1 FROM pedagogie.programme_niveau pn WHERE pn.matiere_id = m.id AND pn.niveau_id = ${niveauId} AND pn.annee_id = ${annee.id})
       ORDER BY m.libelle_fr`);
    const instituteurs = await app.bd.lire(sql`
      SELECT id, nom_affiche AS nom, fonction, statut FROM personnel.fiche
       WHERE etablissement_id = ${ctx.etablissementId} AND actif AND fonction IN ('instituteur_principal', 'instituteur_matiere', 'autre')
       ORDER BY nom_affiche`);
    return { niveaux, niveauId, modeEvaluation: reglage?.mode_evaluation ?? 'notes_sur_20', filiere: reglage?.filiere ?? null, groupes,
      matieres, totalCoefficients: matieres.reduce((s, m) => s + Number(m.coefficient), 0), equipes, disponibles, instituteurs };
  });

  r.put('/pedagogie/parametrage', {
    config: { permission: 'pedagogie.programme.modifier' },
    schema: { tags: ['pedagogie'], body: z.object({
      niveauId: z.uuid(), modeEvaluation: z.enum(['notes_sur_20', 'competences']), filiere: z.string().trim().max(60).nullish(),
      lignes: z.array(z.object({ matiereId: z.uuid(), coefficient: z.number().positive().max(20), bareme: z.number().int().min(1).max(100), ordre: z.number().int().min(1) })),
    }) },
  }, async (req) => {
    const ctx = exiger(req);
    const b = req.body;
    if (b.modeEvaluation === 'competences') {
      throw new ErreurMetier('PED_MODE_NON_DISPONIBLE', 422, 'L\'établissement évalue par des notes sur 20 : l\'évaluation par compétences n\'est pas en vigueur.', 'modeEvaluation');
    }
    const annee = await exigerAnneeOuverte(app.bd, ctx.etablissementId);
    return app.bd.transaction(ctx.compteId, async (tx) => {
      await tx.execute(sql`
        INSERT INTO pedagogie.niveau_annee (etablissement_id, annee_id, niveau_id, mode_evaluation, filiere, cree_par)
        VALUES (${ctx.etablissementId}, ${annee.id}, ${b.niveauId}, ${b.modeEvaluation}, ${b.filiere ?? null}, ${ctx.compteId})
        ON CONFLICT (annee_id, niveau_id) DO UPDATE SET mode_evaluation = EXCLUDED.mode_evaluation, filiere = EXCLUDED.filiere`);
      const niveau = await ligne<{ code: string }>(tx, sql`SELECT code FROM structure.niveau WHERE id = ${b.niveauId} AND etablissement_id = ${ctx.etablissementId}`);
      if (!niveau) throw introuvable('Niveau');
      for (const l of b.lignes) {
        await tx.execute(sql`
          INSERT INTO pedagogie.programme_niveau (etablissement_id, annee_id, niveau_id, matiere_id, coefficient, bareme, ordre_bulletin, cree_par)
          VALUES (${ctx.etablissementId}, ${annee.id}, ${b.niveauId}, ${l.matiereId}, ${l.coefficient}, ${l.bareme}, ${l.ordre}, ${ctx.compteId})
          ON CONFLICT (annee_id, niveau_id, matiere_id) DO UPDATE SET coefficient = EXCLUDED.coefficient, bareme = EXCLUDED.bareme,
             ordre_bulletin = EXCLUDED.ordre_bulletin`);
      }
      await journaliser(tx, ctx, { action: 'Modification', objetType: 'Matière', objetLibelle: `Matières du niveau ${niveau.code} · ${annee.libelle}`,
        avant: '–', apres: `${b.lignes.length} matières, coefficients ${b.lignes.reduce((s, l) => s + l.coefficient, 0)}` });
      return { ok: true };
    });
  });

  r.post('/pedagogie/matieres', {
    config: { permission: 'pedagogie.programme.modifier' },
    schema: { tags: ['pedagogie'], body: z.object({
      libelleFr: z.string().trim().min(2).max(80), libelleEn: z.string().trim().min(2).max(80),
      abregeFr: z.string().trim().max(30).nullish(), abregeEn: z.string().trim().max(30).nullish(), groupeId: z.uuid().nullish(),
      niveauId: z.uuid().optional(), coefficient: z.number().positive().max(20).default(1), bareme: z.number().int().min(1).max(100).default(20),
    }) },
  }, async (req) => {
    const ctx = exiger(req);
    const b = req.body;
    return app.bd.transaction(ctx.compteId, async (tx) => {
      const code = codeMatiere(b.libelleFr);
      const m = await ligne<{ id: string }>(tx, sql`
        INSERT INTO pedagogie.matiere (etablissement_id, code, libelle_fr, libelle_en, abrege_fr, abrege_en, groupe_id, cree_par)
        VALUES (${ctx.etablissementId}, ${code}, ${b.libelleFr}, ${b.libelleEn}, ${b.abregeFr ?? null}, ${b.abregeEn ?? null}, ${b.groupeId ?? null}, ${ctx.compteId})
        ON CONFLICT (etablissement_id, code) DO UPDATE SET libelle_en = EXCLUDED.libelle_en RETURNING id`);
      if (b.niveauId) {
        const annee = await exigerAnneeOuverte(app.bd, ctx.etablissementId);
        const ordre = await ligne<{ n: number }>(tx, sql`
          SELECT COALESCE(max(ordre_bulletin), 0)::int + 1 AS n FROM pedagogie.programme_niveau WHERE annee_id = ${annee.id} AND niveau_id = ${b.niveauId}`);
        await tx.execute(sql`
          INSERT INTO pedagogie.programme_niveau (etablissement_id, annee_id, niveau_id, matiere_id, coefficient, bareme, ordre_bulletin, cree_par)
          VALUES (${ctx.etablissementId}, ${annee.id}, ${b.niveauId}, ${m!.id}, ${b.coefficient}, ${b.bareme}, ${ordre!.n}, ${ctx.compteId})
          ON CONFLICT (annee_id, niveau_id, matiere_id) DO NOTHING`);
      }
      await journaliser(tx, ctx, { action: 'Création', objetType: 'Matière', objetLibelle: `Matière · ${b.libelleFr}`,
        avant: '–', apres: `${b.libelleEn}${b.niveauId ? `, coefficient ${b.coefficient}` : ''}`, ligneId: m!.id, table: 'pedagogie.matiere' });
      return { id: m!.id };
    });
  });

  r.get('/pedagogie/matieres', { config: { unePermissionParmi: ['pedagogie.programme.consulter', 'pedagogie.note.saisir', 'pedagogie.edt.consulter'] }, schema: { tags: ['pedagogie'] } }, async (req) => {
    const ctx = exiger(req);
    return app.bd.lire(sql`
      SELECT m.id, m.libelle_fr AS "libelleFr", m.libelle_en AS "libelleEn", COALESCE(m.abrege_fr, m.libelle_fr) AS abrege, g.libelle_fr AS groupe
        FROM pedagogie.matiere m LEFT JOIN pedagogie.groupe_matiere g ON g.id = m.groupe_id
       WHERE m.etablissement_id = ${ctx.etablissementId} ORDER BY m.libelle_fr`);
  });

  r.post('/pedagogie/groupes', {
    config: { permission: 'pedagogie.programme.modifier' },
    schema: { tags: ['pedagogie'], body: z.object({ libelleFr: z.string().trim().min(2).max(60), libelleEn: z.string().trim().min(2).max(60) }) },
  }, async (req) => {
    const ctx = exiger(req);
    return app.bd.transaction(ctx.compteId, async (tx) => {
      const g = await ligne<{ id: string }>(tx, sql`
        INSERT INTO pedagogie.groupe_matiere (etablissement_id, libelle_fr, libelle_en, ordre, cree_par)
        VALUES (${ctx.etablissementId}, ${req.body.libelleFr}, ${req.body.libelleEn},
                (SELECT COALESCE(max(ordre), 0) + 1 FROM pedagogie.groupe_matiere WHERE etablissement_id = ${ctx.etablissementId}), ${ctx.compteId})
        RETURNING id`);
      await journaliser(tx, ctx, { action: 'Création', objetType: 'Matière', objetLibelle: `Groupe · ${req.body.libelleFr}`, avant: '–', apres: req.body.libelleEn });
      return { id: g!.id };
    });
  });

  r.patch('/pedagogie/matieres/:id', {
    config: { permission: 'pedagogie.programme.modifier' },
    schema: { tags: ['pedagogie'], params: z.object({ id: z.uuid() }), body: z.object({ groupeId: z.uuid().nullish(), libelleFr: z.string().trim().min(2).max(80).optional(), libelleEn: z.string().trim().min(2).max(80).optional() }) },
  }, async (req) => {
    const ctx = exiger(req);
    const b = req.body;
    return app.bd.transaction(ctx.compteId, async (tx) => {
      const m = await ligne<{ libelle_fr: string; libelle_en: string; groupe_id: string | null }>(tx, sql`
        SELECT libelle_fr, libelle_en, groupe_id FROM pedagogie.matiere WHERE id = ${req.params.id} AND etablissement_id = ${ctx.etablissementId}`);
      if (!m) throw introuvable('Matière');
      await tx.execute(sql`UPDATE pedagogie.matiere SET libelle_fr = ${b.libelleFr ?? m.libelle_fr}, libelle_en = ${b.libelleEn ?? m.libelle_en},
                           groupe_id = ${b.groupeId === undefined ? m.groupe_id : b.groupeId} WHERE id = ${req.params.id}`);
      return { ok: true };
    });
  });

  // RG-34 : un seul principal par classe ; une matière confiée à un instituteur de matière prime sur le principal.
  r.put('/pedagogie/affectations', {
    config: { permission: 'pedagogie.affectation.gerer' },
    schema: { tags: ['pedagogie'], body: z.object({ classeId: z.uuid(), matiereId: z.uuid().nullable(), personnelId: z.uuid() }) },
  }, async (req) => {
    const ctx = exiger(req);
    const b = req.body;
    return app.bd.transaction(ctx.compteId, async (tx) => {
      const classe = await ligne<{ nom: string; annee_id: string }>(tx, sql`
        SELECT nom, annee_id FROM structure.classe WHERE id = ${b.classeId} AND etablissement_id = ${ctx.etablissementId}`);
      if (!classe) throw introuvable('Classe');
      const perso = await ligne<{ nom_affiche: string }>(tx, sql`
        SELECT nom_affiche FROM personnel.fiche WHERE id = ${b.personnelId} AND etablissement_id = ${ctx.etablissementId} AND actif`);
      if (!perso) throw introuvable('Fiche du personnel');
      let matiere = 'toutes les matières (principal)';
      if (b.matiereId) {
        const m = await ligne<{ libelle_fr: string }>(tx, sql`SELECT libelle_fr FROM pedagogie.matiere WHERE id = ${b.matiereId} AND etablissement_id = ${ctx.etablissementId}`);
        if (!m) throw introuvable('Matière');
        matiere = m.libelle_fr;
        const principal = await ligne<{ personnel_id: string }>(tx, sql`SELECT personnel_id FROM pedagogie.affectation WHERE classe_id = ${b.classeId} AND principal`);
        if (principal?.personnel_id === b.personnelId) {
          // Rendre la matière au principal revient à supprimer l'exception.
          await tx.execute(sql`DELETE FROM pedagogie.affectation WHERE classe_id = ${b.classeId} AND matiere_id = ${b.matiereId} AND NOT principal`);
        } else {
          await tx.execute(sql`DELETE FROM pedagogie.affectation WHERE classe_id = ${b.classeId} AND matiere_id = ${b.matiereId} AND NOT principal`);
          await tx.execute(sql`
            INSERT INTO pedagogie.affectation (etablissement_id, annee_id, classe_id, matiere_id, personnel_id, principal, cree_par)
            VALUES (${ctx.etablissementId}, ${classe.annee_id}, ${b.classeId}, ${b.matiereId}, ${b.personnelId}, false, ${ctx.compteId})`);
        }
      } else {
        await tx.execute(sql`DELETE FROM pedagogie.affectation WHERE classe_id = ${b.classeId} AND principal`);
        await tx.execute(sql`
          INSERT INTO pedagogie.affectation (etablissement_id, annee_id, classe_id, matiere_id, personnel_id, principal, cree_par)
          VALUES (${ctx.etablissementId}, ${classe.annee_id}, ${b.classeId}, NULL, ${b.personnelId}, true, ${ctx.compteId})`);
      }
      await journaliser(tx, ctx, { action: 'Modification', objetType: 'Droits', objetLibelle: `Affectation · ${classe.nom} · ${matiere}`,
        avant: '–', apres: perso.nom_affiche, table: 'pedagogie.affectation' });
      return { ok: true };
    });
  });

  r.delete('/pedagogie/affectations/:id', {
    config: { permission: 'pedagogie.affectation.gerer' }, schema: { tags: ['pedagogie'], params: z.object({ id: z.uuid() }) },
  }, async (req) => {
    const ctx = exiger(req);
    return app.bd.transaction(ctx.compteId, async (tx) => {
      const a = await lignes<{ id: string }>(tx, sql`
        DELETE FROM pedagogie.affectation WHERE id = ${req.params.id} AND etablissement_id = ${ctx.etablissementId} AND NOT principal RETURNING id`);
      if (!a.length) throw introuvable('Affectation');
      await journaliser(tx, ctx, { action: 'Modification', objetType: 'Droits', objetLibelle: 'Affectation retirée', avant: 'Instituteur de matière', apres: 'Principal' });
      return { ok: true };
    });
  });
}
