// CU-30 · Établir l'emploi du temps d'une classe (PED-17, RG-37) ; cahier de textes.
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { sql, ligne, lignes, type Tx, type Bd, tableau } from '../../../core/bd.ts';
import { ErreurMetier, interdit, introuvable } from '../../../core/erreurs.ts';
import { exiger } from '../../../core/session.ts';
import type { Contexte } from '../../../core/contexte.ts';
import { journaliser } from '../../../core/audit.ts';
import { perimetreEnseignant } from '../../../core/perimetre.ts';
import { exigerAnneeOuverte } from '../../structure/index.ts';
import { titulaire } from '../index.ts';

const Uuid = z.uuid();
export const JOURS = ['', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];

// Grille horaire par défaut (décision D-16), d'après la maquette Emploi du temps.
const GRILLE_DEFAUT: { debut: string; fin: string; type: 'cours' | 'recreation' | 'pause'; jours: number[] }[] = [
  { debut: '07:30', fin: '08:30', type: 'cours', jours: [1, 2, 3, 4, 5, 6] },
  { debut: '08:30', fin: '09:30', type: 'cours', jours: [1, 2, 3, 4, 5, 6] },
  { debut: '09:30', fin: '10:00', type: 'recreation', jours: [1, 2, 3, 4, 5, 6] },
  { debut: '10:00', fin: '11:00', type: 'cours', jours: [1, 2, 3, 4, 5, 6] },
  { debut: '11:00', fin: '12:00', type: 'cours', jours: [1, 2, 3, 4, 5, 6] },
  { debut: '12:00', fin: '13:00', type: 'pause', jours: [1, 2, 3, 4, 5] },
  { debut: '13:00', fin: '14:00', type: 'cours', jours: [1, 2, 3, 4, 5] },
  { debut: '14:00', fin: '15:00', type: 'cours', jours: [1, 2, 3, 4, 5] },
];

export async function assurerGrille(tx: Tx, etab: string, anneeId: string) {
  const n = await ligne<{ n: number }>(tx, sql`SELECT count(*)::int AS n FROM pedagogie.creneau WHERE annee_id = ${anneeId}`);
  if (n!.n > 0) return;
  for (const c of GRILLE_DEFAUT) {
    await tx.execute(sql`INSERT INTO pedagogie.creneau (etablissement_id, annee_id, debut, fin, type, jours)
                         VALUES (${etab}, ${anneeId}, ${c.debut}, ${c.fin}, ${c.type}, ${tableau(c.jours)}::int[])`);
  }
}

export interface CoursJour { debut: string; fin: string; libelle: string; matiereId: string | null; personnelId: string | null; personnel: string | null; commun: string | null }

/** Cours d'une classe pour un jour, les créneaux consécutifs identiques fusionnés (« 07:30 – 09:30 · Révisions »). */
export async function coursDuJour(bd: Bd | Tx, classeId: string, jour: number): Promise<CoursJour[]> {
  const requete = sql`
    SELECT to_char(cr.debut, 'HH24:MI') AS debut, to_char(cr.fin, 'HH24:MI') AS fin, COALESCE(m.libelle_fr, co.libelle) AS libelle,
           co.matiere_id, co.personnel_id, p.nom_affiche AS personnel,
           (SELECT string_agg(k.nom, ', ') FROM pedagogie.cours x JOIN structure.classe k ON k.id = x.classe_id
             WHERE x.creneau_id = co.creneau_id AND x.jour = co.jour AND x.personnel_id = co.personnel_id AND x.classe_id <> co.classe_id) AS commun
      FROM pedagogie.cours co JOIN pedagogie.creneau cr ON cr.id = co.creneau_id
      LEFT JOIN pedagogie.matiere m ON m.id = co.matiere_id LEFT JOIN personnel.fiche p ON p.id = co.personnel_id
     WHERE co.classe_id = ${classeId} AND co.jour = ${jour} ORDER BY cr.debut`;
  const rows = ('lire' in bd ? await (bd as Bd).lire<CoursJour & { matiere_id: string | null; personnel_id: string | null }>(requete)
    : await lignes<CoursJour & { matiere_id: string | null; personnel_id: string | null }>(bd as Tx, requete));
  const res: CoursJour[] = [];
  for (const r of rows) {
    const prec = res[res.length - 1];
    if (prec && prec.fin === r.debut && prec.libelle === r.libelle && prec.personnelId === r.personnel_id) { prec.fin = r.fin; continue; }
    res.push({ debut: r.debut, fin: r.fin, libelle: r.libelle, matiereId: r.matiere_id, personnelId: r.personnel_id, personnel: r.personnel, commun: r.commun });
  }
  return res;
}

const lundi = (d = new Date()) => {
  const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const j = (x.getUTCDay() + 6) % 7;
  x.setUTCDate(x.getUTCDate() - j);
  return x.toISOString().slice(0, 10);
};

export async function routesEdt(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  async function peutPlacer(ctx: Contexte, classeId: string) {
    if (!ctx.a('pedagogie.edt.placer')) return false;
    const p = await perimetreEnseignant(app.bd, ctx);
    return p.classesPrincipal.some((c) => c.id === classeId);
  }

  r.get('/pedagogie/edt', {
    config: { permission: 'pedagogie.edt.consulter' },
    schema: { tags: ['pedagogie'], querystring: z.object({ classeId: Uuid.optional(), personnelId: Uuid.optional() }) },
  }, async (req) => {
    const ctx = exiger(req);
    const annee = await exigerAnneeOuverte(app.bd, ctx.etablissementId);
    await app.bd.transaction(ctx.compteId, (tx) => assurerGrille(tx, ctx.etablissementId, annee.id));
    const classes = await app.bd.lire<{ id: string; nom: string }>(sql`
      SELECT c.id, c.nom FROM structure.classe c JOIN structure.niveau n ON n.id = c.niveau_id
       WHERE c.annee_id = ${annee.id} ORDER BY n.rang, c.nom`);
    const instituteurs = await app.bd.lire<{ id: string; nom: string }>(sql`
      SELECT DISTINCT p.id, p.nom_affiche AS nom FROM personnel.fiche p JOIN pedagogie.affectation a ON a.personnel_id = p.id AND a.annee_id = ${annee.id}
       ORDER BY 2`);
    const creneaux = await app.bd.lire<{ id: string; debut: string; fin: string; type: string; jours: number[] }>(sql`
      SELECT id, to_char(debut, 'HH24:MI') AS debut, to_char(fin, 'HH24:MI') AS fin, type, jours FROM pedagogie.creneau
       WHERE annee_id = ${annee.id} ORDER BY debut`);
    const groupes = await app.bd.lire(sql`SELECT libelle_fr AS libelle FROM pedagogie.groupe_matiere WHERE etablissement_id = ${ctx.etablissementId} ORDER BY ordre`);
    const p = await perimetreEnseignant(app.bd, ctx);
    const classeId = req.query.personnelId ? null : (req.query.classeId ?? p.classesPrincipal[0]?.id ?? p.matieres[0]?.classeId ?? classes[0]?.id ?? null);
    const base = { classes, instituteurs, creneaux, groupes, semaine: lundi(), classeId, personnelId: req.query.personnelId ?? null };
    if (req.query.personnelId) {
      const cours = await app.bd.lire(sql`
        SELECT co.jour, co.creneau_id AS "creneauId", COALESCE(m.abrege_fr, m.libelle_fr, co.libelle) AS libelle, g.libelle_fr AS groupe, k.nom AS classe
          FROM pedagogie.cours co JOIN structure.classe k ON k.id = co.classe_id
          LEFT JOIN pedagogie.matiere m ON m.id = co.matiere_id LEFT JOIN pedagogie.groupe_matiere g ON g.id = m.groupe_id
         WHERE co.personnel_id = ${req.query.personnelId} AND k.annee_id = ${annee.id}`);
      const nom = instituteurs.find((i) => i.id === req.query.personnelId)?.nom ?? '';
      return { ...base, titre: nom, cours, equipe: null, etat: null, conflits: [], peutPlacer: false, seances: [] };
    }
    if (!classeId) return { ...base, titre: '', cours: [], equipe: null, etat: null, conflits: [], peutPlacer: false, seances: [] };
    const classe = classes.find((c) => c.id === classeId);
    const cours = await app.bd.lire(sql`
      SELECT co.jour, co.creneau_id AS "creneauId", COALESCE(m.abrege_fr, m.libelle_fr, co.libelle) AS libelle, co.matiere_id AS "matiereId",
             g.libelle_fr AS groupe, p.nom_affiche AS instituteur
        FROM pedagogie.cours co LEFT JOIN pedagogie.matiere m ON m.id = co.matiere_id
        LEFT JOIN pedagogie.groupe_matiere g ON g.id = m.groupe_id LEFT JOIN personnel.fiche p ON p.id = co.personnel_id
       WHERE co.classe_id = ${classeId}`);
    const principal = await app.bd.lireUn<{ nom: string }>(sql`
      SELECT p.nom_affiche AS nom FROM pedagogie.affectation a JOIN personnel.fiche p ON p.id = a.personnel_id WHERE a.classe_id = ${classeId} AND a.principal`);
    const exceptions = await app.bd.lire<{ matiere: string; nom: string }>(sql`
      SELECT COALESCE(m.abrege_fr, m.libelle_fr) AS matiere, p.nom_affiche AS nom FROM pedagogie.affectation a
        JOIN pedagogie.matiere m ON m.id = a.matiere_id JOIN personnel.fiche p ON p.id = a.personnel_id
       WHERE a.classe_id = ${classeId} AND NOT a.principal`);
    const etat = await app.bd.lireUn<{ statut: string; place_le: string | null; place_par: string | null; renvoi_motif: string | null; publie_le: string | null }>(sql`
      SELECT e.statut, to_char(e.place_le, 'DD/MM') AS place_le, c.nom_affiche AS place_par, e.renvoi_motif, to_char(e.publie_le, 'DD/MM') AS publie_le
        FROM pedagogie.emploi_du_temps e LEFT JOIN core.compte c ON c.id = e.place_par WHERE e.classe_id = ${classeId}`);
    // RG-37 : un instituteur peut figurer sur deux classes au même créneau ; on le signale sans bloquer.
    const conflits = await app.bd.lire<{ jour: number; debut: string; instituteur: string; matiere: string; autres: string }>(sql`
      SELECT co.jour, to_char(cr.debut, 'HH24:MI') AS debut, p.nom_affiche AS instituteur, COALESCE(m.libelle_fr, co.libelle) AS matiere,
             string_agg(k.nom, ', ') AS autres
        FROM pedagogie.cours co JOIN pedagogie.creneau cr ON cr.id = co.creneau_id JOIN personnel.fiche p ON p.id = co.personnel_id
        LEFT JOIN pedagogie.matiere m ON m.id = co.matiere_id
        JOIN pedagogie.cours x ON x.creneau_id = co.creneau_id AND x.jour = co.jour AND x.personnel_id = co.personnel_id AND x.classe_id <> co.classe_id
        JOIN structure.classe k ON k.id = x.classe_id
       WHERE co.classe_id = ${classeId}
       GROUP BY co.jour, cr.debut, p.nom_affiche, m.libelle_fr, co.libelle ORDER BY co.jour, cr.debut`);
    const aujourdhui = new Date(Date.now() + 3600_000).toISOString().slice(0, 10);
    const seances = await app.bd.lire(sql`
      SELECT to_char(s.heure, 'HH24:MI') AS heure, s.libelle, s.contenu, s.devoir, s.devoir_pour AS "devoirPour"
        FROM pedagogie.seance s WHERE s.classe_id = ${classeId} AND s.fait_le = ${aujourdhui} ORDER BY s.heure`);
    return {
      ...base, titre: classe?.nom ?? '', cours,
      equipe: { principal: principal?.nom ?? null, exceptions },
      etat: etat ?? { statut: 'brouillon', place_le: null, place_par: null, renvoi_motif: null, publie_le: null },
      conflits: conflits.map((c) => ({ ...c, jourLibelle: JOURS[c.jour] })),
      peutPlacer: await peutPlacer(ctx, classeId), seances, aujourdhui,
    };
  });

  r.put('/pedagogie/edt/creneaux', {
    config: { permission: 'pedagogie.edt.grille' },
    schema: { tags: ['pedagogie'], body: z.object({ creneaux: z.array(z.object({
      debut: z.string().regex(/^\d{2}:\d{2}$/), fin: z.string().regex(/^\d{2}:\d{2}$/),
      type: z.enum(['cours', 'recreation', 'pause']), jours: z.array(z.number().int().min(1).max(6)).min(1) })).min(1).max(20) }) },
  }, async (req) => {
    const ctx = exiger(req);
    const annee = await exigerAnneeOuverte(app.bd, ctx.etablissementId);
    return app.bd.transaction(ctx.compteId, async (tx) => {
      const utilises = await ligne<{ n: number }>(tx, sql`
        SELECT count(*)::int AS n FROM pedagogie.cours co JOIN pedagogie.creneau cr ON cr.id = co.creneau_id WHERE cr.annee_id = ${annee.id}`);
      if (utilises!.n > 0) throw new ErreurMetier('PED_GRILLE_UTILISEE', 422, 'Des cours sont déjà placés : retirez-les avant de changer la grille horaire.');
      await tx.execute(sql`DELETE FROM pedagogie.creneau WHERE annee_id = ${annee.id}`);
      for (const c of req.body.creneaux) {
        if (c.fin <= c.debut) throw new ErreurMetier('PED_CRENEAU', 422, `Créneau ${c.debut} : la fin doit suivre le début.`);
        await tx.execute(sql`INSERT INTO pedagogie.creneau (etablissement_id, annee_id, debut, fin, type, jours)
                             VALUES (${ctx.etablissementId}, ${annee.id}, ${c.debut}, ${c.fin}, ${c.type}, ${tableau(c.jours)}::int[])`);
      }
      await journaliser(tx, ctx, { action: 'Modification', objetType: 'Emploi du temps', objetLibelle: 'Grille horaire de l\'école',
        avant: '–', apres: `${req.body.creneaux.length} créneaux` });
      return { ok: true };
    });
  });

  r.put('/pedagogie/edt/cours', {
    config: { permission: 'pedagogie.edt.placer' },
    schema: { tags: ['pedagogie'], body: z.object({ classeId: Uuid, jour: z.number().int().min(1).max(6), creneauId: Uuid,
      matiereId: Uuid.nullable(), libelle: z.string().trim().max(40).nullable() }) },
  }, async (req) => {
    const ctx = exiger(req);
    const b = req.body;
    if (!(await peutPlacer(ctx, b.classeId))) throw interdit('pedagogie.edt.placer');
    return app.bd.transaction(ctx.compteId, async (tx) => {
      const cr = await ligne<{ type: string; jours: number[] }>(tx, sql`SELECT type, jours FROM pedagogie.creneau WHERE id = ${b.creneauId}`);
      if (!cr || cr.type !== 'cours' || !cr.jours.includes(b.jour)) throw new ErreurMetier('PED_CRENEAU_INDISPONIBLE', 422, 'Ce créneau n\'accueille pas de cours ce jour-là.');
      const etat = await ligne<{ statut: string }>(tx, sql`SELECT statut FROM pedagogie.emploi_du_temps WHERE classe_id = ${b.classeId}`);
      if (etat?.statut === 'soumis') throw new ErreurMetier('PED_EDT_SOUMIS', 422, 'L\'emploi du temps attend la validation du préfet.');
      if (!b.matiereId && !b.libelle) {
        await tx.execute(sql`DELETE FROM pedagogie.cours WHERE classe_id = ${b.classeId} AND creneau_id = ${b.creneauId} AND jour = ${b.jour}`);
      } else {
        const t = b.matiereId ? await titulaire(tx, b.classeId, b.matiereId) : await titulaire(tx, b.classeId, '00000000-0000-0000-0000-000000000000');
        await tx.execute(sql`
          INSERT INTO pedagogie.cours (etablissement_id, classe_id, creneau_id, jour, matiere_id, libelle, personnel_id, cree_par)
          VALUES (${ctx.etablissementId}, ${b.classeId}, ${b.creneauId}, ${b.jour}, ${b.matiereId}, ${b.matiereId ? null : b.libelle}, ${t.personnelId}, ${ctx.compteId})
          ON CONFLICT (classe_id, creneau_id, jour) DO UPDATE SET matiere_id = EXCLUDED.matiere_id, libelle = EXCLUDED.libelle,
             personnel_id = EXCLUDED.personnel_id, modifie_le = now()`);
      }
      // Toute modification après publication repasse par la validation du préfet.
      await tx.execute(sql`
        INSERT INTO pedagogie.emploi_du_temps (etablissement_id, classe_id, statut, place_le, place_par)
        VALUES (${ctx.etablissementId}, ${b.classeId}, 'brouillon', now(), ${ctx.compteId})
        ON CONFLICT (classe_id) DO UPDATE SET statut = 'brouillon', place_le = now(), place_par = ${ctx.compteId}, modifie_le = now()`);
      return { ok: true };
    });
  });

  r.post('/pedagogie/edt/:classeId/soumission', {
    config: { permission: 'pedagogie.edt.placer' }, schema: { tags: ['pedagogie'], params: z.object({ classeId: Uuid }) },
  }, async (req) => {
    const ctx = exiger(req);
    if (!(await peutPlacer(ctx, req.params.classeId))) throw interdit('pedagogie.edt.placer');
    return app.bd.transaction(ctx.compteId, async (tx) => {
      await tx.execute(sql`
        INSERT INTO pedagogie.emploi_du_temps (etablissement_id, classe_id, statut, place_le, place_par)
        VALUES (${ctx.etablissementId}, ${req.params.classeId}, 'soumis', now(), ${ctx.compteId})
        ON CONFLICT (classe_id) DO UPDATE SET statut = 'soumis', place_le = now(), place_par = ${ctx.compteId}, renvoi_motif = NULL, modifie_le = now()`);
      return { ok: true };
    });
  });

  const decision = (publier: boolean) => async (req: { params: { classeId: string }; body: { motif?: string | null } } & Parameters<typeof exiger>[0]) => {
    const ctx = exiger(req);
    return app.bd.transaction(ctx.compteId, async (tx) => {
      const classe = await ligne<{ nom: string }>(tx, sql`SELECT nom FROM structure.classe WHERE id = ${req.params.classeId} AND etablissement_id = ${ctx.etablissementId}`);
      if (!classe) throw introuvable('Classe');
      const n = await ligne<{ n: number }>(tx, sql`SELECT count(*)::int AS n FROM pedagogie.cours WHERE classe_id = ${req.params.classeId}`);
      if (publier && n!.n === 0) throw new ErreurMetier('PED_EDT_VIDE', 422, 'Aucun cours n\'est placé pour cette classe.');
      if (!publier && !req.body.motif?.trim()) throw new ErreurMetier('PED_MOTIF_REQUIS', 422, 'Indiquez au principal ce qui est à revoir.', 'motif');
      await tx.execute(publier
        ? sql`INSERT INTO pedagogie.emploi_du_temps (etablissement_id, classe_id, statut, publie_le, publie_par)
              VALUES (${ctx.etablissementId}, ${req.params.classeId}, 'publie', now(), ${ctx.compteId})
              ON CONFLICT (classe_id) DO UPDATE SET statut = 'publie', publie_le = now(), publie_par = ${ctx.compteId}, renvoi_motif = NULL, modifie_le = now()`
        : sql`UPDATE pedagogie.emploi_du_temps SET statut = 'brouillon', renvoi_motif = ${req.body.motif ?? null}, modifie_le = now()
               WHERE classe_id = ${req.params.classeId}`);
      await journaliser(tx, ctx, { action: 'Modification', objetType: 'Emploi du temps', objetLibelle: `Emploi du temps · ${classe.nom}`,
        avant: 'Soumis', apres: publier ? 'Publié' : `Renvoyé au principal : ${req.body.motif}` });
      return { ok: true };
    });
  };
  const Motif = z.object({ motif: z.string().trim().max(300).nullish() });
  r.post('/pedagogie/edt/:classeId/publication', { config: { permission: 'pedagogie.edt.valider' }, schema: { tags: ['pedagogie'], params: z.object({ classeId: Uuid }), body: Motif } }, decision(true));
  r.post('/pedagogie/edt/:classeId/renvoi', { config: { permission: 'pedagogie.edt.valider' }, schema: { tags: ['pedagogie'], params: z.object({ classeId: Uuid }), body: Motif } }, decision(false));

  // ------------------------------------------------------------- cahier de textes

  r.post('/pedagogie/seances', {
    config: { permission: 'pedagogie.cahier.ecrire' },
    schema: { tags: ['pedagogie'], body: z.object({ classeId: Uuid, faitLe: z.iso.date(), heure: z.string().regex(/^\d{2}:\d{2}$/),
      matiereId: Uuid.nullish(), libelle: z.string().trim().min(2).max(60), contenu: z.string().trim().min(2).max(1000),
      devoir: z.string().trim().max(500).nullish(), devoirPour: z.iso.date().nullish() }) },
  }, async (req) => {
    const ctx = exiger(req);
    const b = req.body;
    const p = await perimetreEnseignant(app.bd, ctx);
    const permis = p.classesPrincipal.some((c) => c.id === b.classeId) || p.matieres.some((m) => m.classeId === b.classeId && (!b.matiereId || m.matiereId === b.matiereId));
    if (!permis) throw interdit('pedagogie.cahier.ecrire');
    return app.bd.transaction(ctx.compteId, async (tx) => {
      const s = await ligne<{ id: string }>(tx, sql`
        INSERT INTO pedagogie.seance (etablissement_id, classe_id, fait_le, heure, matiere_id, libelle, contenu, devoir, devoir_pour, auteur)
        VALUES (${ctx.etablissementId}, ${b.classeId}, ${b.faitLe}, ${b.heure}, ${b.matiereId ?? null}, ${b.libelle}, ${b.contenu},
                ${b.devoir ?? null}, ${b.devoirPour ?? null}, ${ctx.compteId}) RETURNING id`);
      return { id: s!.id };
    });
  });
}
