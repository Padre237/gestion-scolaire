// CU-23 appel et justification (RG-38, RG-39) ; CU-24 observations et sanctions (VIE-01 à VIE-03).
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { sql, ligne, lignes, type Tx, tableau } from '../../../core/bd.ts';
import { ErreurMetier, interdit, introuvable } from '../../../core/erreurs.ts';
import { exiger } from '../../../core/session.ts';
import type { Contexte } from '../../../core/contexte.ts';
import { journaliser } from '../../../core/audit.ts';
import { emettre } from '../../../core/evenements.ts';
import { classesAccessibles, perimetreEnseignant } from '../../../core/perimetre.ts';
import { exigerAnneeOuverte } from '../../structure/index.ts';
import { coursDuJour } from '../../pedagogie/http/edt.ts';

const Uuid = z.uuid();
export const TYPES_OBSERVATION: Record<string, string> = {
  comportement: 'Comportement', retard: 'Retard', travail_non_fait: 'Travail non fait', tenue: 'Tenue', felicitations: 'Félicitations',
};
export const maintenantCm = () => new Date(Date.now() + 3600_000); // heure du Cameroun (UTC+1)
export const jourCm = () => maintenantCm().toISOString().slice(0, 10);
const jourSemaine = (iso: string) => ((new Date(`${iso}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;
const minutes = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));

/** RG-38 : chaque jour, une fiche d'appel par classe et par créneau, d'après l'emploi du temps publié. */
export async function assurerFiches(tx: Tx, etab: string, classeId: string, jour: string) {
  // Un emploi du temps déjà publié reste en vigueur pendant qu'une modification attend la validation du préfet.
  const edt = await ligne<{ statut: string; publie_le: string | null }>(tx, sql`SELECT statut, publie_le FROM pedagogie.emploi_du_temps WHERE classe_id = ${classeId}`);
  if (!edt || (edt.statut !== 'publie' && !edt.publie_le)) return;
  const js = jourSemaine(jour);
  if (js > 6) return;
  for (const c of await coursDuJour(tx, classeId, js)) {
    await tx.execute(sql`
      INSERT INTO vie_scolaire.fiche_appel (etablissement_id, classe_id, jour, debut, fin, libelle, personnel_id, cours_commun)
      VALUES (${etab}, ${classeId}, ${jour}, ${c.debut}, ${c.fin}, ${c.libelle}, ${c.personnelId}, ${c.commun ? `cours commun avec ${c.commun}` : null})
      ON CONFLICT (classe_id, jour, debut) DO NOTHING`);
  }
}

export async function routesVieScolaire(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  async function classesVisibles(ctx: Contexte) {
    return classesAccessibles(app.bd, ctx, 'vie_scolaire.dossier.consulter');
  }

  async function lireFiche(ctx: Contexte, ficheId: string) {
    const f = await app.bd.lireUn<{ id: string; classe_id: string; classe: string; jour: string; debut: string; fin: string; libelle: string; personnel_id: string | null;
      personnel: string | null; cours_commun: string | null; statut: string; faite_le: string | null }>(sql`
      SELECT f.id, f.classe_id, c.nom AS classe, f.jour, to_char(f.debut, 'HH24:MI') AS debut, to_char(f.fin, 'HH24:MI') AS fin, f.libelle, f.personnel_id,
             p.nom_affiche AS personnel, f.cours_commun, f.statut, f.faite_le
        FROM vie_scolaire.fiche_appel f JOIN structure.classe c ON c.id = f.classe_id LEFT JOIN personnel.fiche p ON p.id = f.personnel_id
       WHERE f.id = ${ficheId} AND f.etablissement_id = ${ctx.etablissementId}`);
    if (!f) throw introuvable('Fiche d\'appel');
    const eleves = await app.bd.lire<{ inscription_id: string; nom: string; statut: string | null; retard_minutes: number | null }>(sql`
      SELECT i.id AS inscription_id, i.nom || ' ' || i.prenoms AS nom, pr.statut, pr.retard_minutes
        FROM reporting.v_inscription i LEFT JOIN vie_scolaire.presence pr ON pr.inscription_id = i.id AND pr.fiche_id = ${ficheId}
       WHERE i.classe_id = ${f.classe_id} AND i.statut IN ('attente', 'validee') ORDER BY i.nom, i.prenoms`);
    const liste = eleves.map((e, i) => ({ numero: i + 1, inscriptionId: e.inscription_id, nom: e.nom, statut: e.statut ?? 'present', retardMinutes: e.retard_minutes }));
    return {
      id: f.id, classeId: f.classe_id, classe: f.classe, jour: f.jour, debut: f.debut, fin: f.fin, libelle: f.libelle, personnel: f.personnel,
      coursCommun: f.cours_commun, statut: f.statut, faiteLe: f.faite_le,
      modifiable: ctx.a('vie_scolaire.appel.faire') && !!ctx.personnelId && f.personnel_id === ctx.personnelId,
      eleves: liste,
      compteurs: { presents: liste.filter((e) => e.statut === 'present').length, absents: liste.filter((e) => e.statut === 'absent').length,
        retards: liste.filter((e) => e.statut === 'retard').length, minutesRetard: liste.reduce((s, e) => s + (e.retardMinutes ?? 0), 0), total: liste.length },
    };
  }

  r.get('/vie-scolaire/appel', {
    config: { unePermissionParmi: ['vie_scolaire.appel.faire', 'vie_scolaire.dossier.consulter'] },
    schema: { tags: ['vie-scolaire'], querystring: z.object({ classeId: Uuid.optional(), jour: z.iso.date().optional(), ficheId: Uuid.optional() }) },
  }, async (req) => {
    const ctx = exiger(req);
    const annee = await exigerAnneeOuverte(app.bd, ctx.etablissementId);
    const visibles = await classesVisibles(ctx);
    const p = await perimetreEnseignant(app.bd, ctx);
    const classes = await app.bd.lire<{ id: string; nom: string }>(sql`
      SELECT c.id, c.nom FROM structure.classe c JOIN structure.niveau n ON n.id = c.niveau_id
       WHERE c.annee_id = ${annee.id} AND (${visibles === 'toutes'} OR c.id = ANY(${tableau(visibles === 'toutes' ? [] : visibles)}::uuid[])) ORDER BY n.rang, c.nom`);
    const jour = req.query.jour ?? jourCm();
    const classeId = req.query.classeId ?? p.classesPrincipal[0]?.id ?? p.matieres[0]?.classeId ?? classes[0]?.id;
    if (!classeId) return { jour, classes, classeId: null, fiches: [], fiche: null, ecole: null };
    if (visibles !== 'toutes' && !visibles.includes(classeId)) throw interdit('vie_scolaire.dossier.consulter');
    await app.bd.transaction(null, async (tx) => {
      for (const c of classes) await assurerFiches(tx, ctx.etablissementId, c.id, jour);
    });
    const fiches = await app.bd.lire<{ id: string; debut: string; fin: string; libelle: string; personnel: string | null; statut: string; cours_commun: string | null }>(sql`
      SELECT f.id, to_char(f.debut, 'HH24:MI') AS debut, to_char(f.fin, 'HH24:MI') AS fin, f.libelle, p.nom_affiche AS personnel, f.statut, f.cours_commun
        FROM vie_scolaire.fiche_appel f LEFT JOIN personnel.fiche p ON p.id = f.personnel_id WHERE f.classe_id = ${classeId} AND f.jour = ${jour} ORDER BY f.debut`);
    const maintenant = maintenantCm().toISOString().slice(11, 16);
    const enCours = fiches.find((f) => f.debut <= maintenant && maintenant < f.fin) ?? fiches.find((f) => f.statut === 'a_faire') ?? fiches[0];
    const choisie = req.query.ficheId ?? enCours?.id ?? null;
    const ecole = await app.bd.lireUn<{ faites: number; total: number; retard: string | null; nb_retard: number }>(sql`
      SELECT count(*) FILTER (WHERE f.statut = 'faite')::int AS faites, count(*)::int AS total,
             string_agg(DISTINCT c.nom, ', ') FILTER (WHERE f.statut = 'a_faire' AND f.fin < ${maintenant}::time) AS retard,
             count(DISTINCT c.id) FILTER (WHERE f.statut = 'a_faire' AND f.fin < ${maintenant}::time)::int AS nb_retard
        FROM vie_scolaire.fiche_appel f JOIN structure.classe c ON c.id = f.classe_id
       WHERE f.etablissement_id = ${ctx.etablissementId} AND f.jour = ${jour} AND (${jour} < ${jourCm()} OR f.debut <= ${maintenant}::time)`);
    return { jour, classes, classeId, fiches: fiches.map((f) => ({ ...f, coursCommun: f.cours_commun })),
      fiche: choisie ? await lireFiche(ctx, choisie) : null, ecole };
  });

  // Application de l'instituteur : la fiche du créneau en cours, ou la prochaine à faire.
  r.get('/vie-scolaire/appel/mobile', { config: { permission: 'vie_scolaire.appel.faire' }, schema: { tags: ['vie-scolaire'] } }, async (req) => {
    const ctx = exiger(req);
    const jour = jourCm();
    const p = await perimetreEnseignant(app.bd, ctx);
    const classes = [...new Set([...p.classesPrincipal.map((c) => c.id), ...p.matieres.map((m) => m.classeId)])];
    await app.bd.transaction(null, async (tx) => { for (const c of classes) await assurerFiches(tx, ctx.etablissementId, c, jour); });
    const maintenant = maintenantCm().toISOString().slice(11, 16);
    const fiches = await app.bd.lire<{ id: string; debut: string; fin: string; statut: string }>(sql`
      SELECT id, to_char(debut, 'HH24:MI') AS debut, to_char(fin, 'HH24:MI') AS fin, statut FROM vie_scolaire.fiche_appel
       WHERE etablissement_id = ${ctx.etablissementId} AND jour = ${jour} AND personnel_id = ${ctx.personnelId} ORDER BY debut`);
    const f = fiches.find((x) => x.debut <= maintenant && maintenant < x.fin) ?? fiches.find((x) => x.statut === 'a_faire') ?? fiches[fiches.length - 1];
    return { fiche: f ? await lireFiche(ctx, f.id) : null, fiches };
  });

  r.put('/vie-scolaire/appel/:id', {
    config: { permission: 'vie_scolaire.appel.faire' },
    schema: { tags: ['vie-scolaire'], params: z.object({ id: Uuid }), body: z.object({ presences: z.array(z.object({
      inscriptionId: Uuid, statut: z.enum(['present', 'absent', 'retard']), retardMinutes: z.number().int().min(1).max(240).nullish() })).max(200) }) },
  }, async (req) => {
    const ctx = exiger(req);
    return app.bd.transaction(ctx.compteId, async (tx) => {
      const f = await ligne<{ classe_id: string; jour: string; debut: string; fin: string; personnel_id: string | null; libelle: string; classe: string }>(tx, sql`
        SELECT f.classe_id, f.jour, to_char(f.debut, 'HH24:MI') AS debut, to_char(f.fin, 'HH24:MI') AS fin, f.personnel_id, f.libelle, c.nom AS classe
          FROM vie_scolaire.fiche_appel f JOIN structure.classe c ON c.id = f.classe_id WHERE f.id = ${req.params.id} AND f.etablissement_id = ${ctx.etablissementId} FOR UPDATE`);
      if (!f) throw introuvable('Fiche d\'appel');
      // RG-38 : c'est l'instituteur prévu au créneau qui remplit la fiche.
      if (!ctx.personnelId || f.personnel_id !== ctx.personnelId) throw new ErreurMetier('VIE_PAS_VOTRE_CRENEAU', 403, 'Seul l\'instituteur prévu à ce créneau fait l\'appel (RG-38).');
      const duree = minutes(f.fin) - minutes(f.debut);
      const nouvelles: string[] = [];
      for (const p of req.body.presences) {
        const insc = await ligne(tx, sql`SELECT 1 FROM scolarite.inscription WHERE id = ${p.inscriptionId} AND classe_id = ${f.classe_id} AND statut IN ('attente', 'validee')`);
        if (!insc) throw new ErreurMetier('VIE_ELEVE_HORS_CLASSE', 422, 'Élève hors de la classe.');
        await tx.execute(sql`
          INSERT INTO vie_scolaire.presence (etablissement_id, fiche_id, inscription_id, statut, retard_minutes)
          VALUES (${ctx.etablissementId}, ${req.params.id}, ${p.inscriptionId}, ${p.statut}, ${p.statut === 'retard' ? (p.retardMinutes ?? 15) : null})
          ON CONFLICT (fiche_id, inscription_id) DO UPDATE SET statut = EXCLUDED.statut, retard_minutes = EXCLUDED.retard_minutes`);
        if (p.statut === 'absent') {
          const a = await ligne<{ id: string; cree: boolean }>(tx, sql`
            INSERT INTO vie_scolaire.absence (etablissement_id, inscription_id, fiche_id, jour, debut, duree_minutes)
            VALUES (${ctx.etablissementId}, ${p.inscriptionId}, ${req.params.id}, ${f.jour}, ${f.debut}, ${duree})
            ON CONFLICT (fiche_id, inscription_id) DO UPDATE SET duree_minutes = EXCLUDED.duree_minutes RETURNING id, (xmax = 0) AS cree`);
          if (a!.cree) nouvelles.push(a!.id);
        } else {
          // Une absence corrigée disparaît, et son SMS avec elle (maquette Appel).
          const supprimees = await lignes<{ id: string }>(tx, sql`DELETE FROM vie_scolaire.absence WHERE fiche_id = ${req.params.id} AND inscription_id = ${p.inscriptionId} RETURNING id`);
          if (supprimees.length) await emettre(tx, ctx, 'absence.justifiee', { inscriptionId: p.inscriptionId, jour: f.jour });
        }
      }
      await tx.execute(sql`UPDATE vie_scolaire.fiche_appel SET statut = 'faite', faite_le = now(), faite_par = ${ctx.compteId} WHERE id = ${req.params.id}`);
      if (nouvelles.length) await emettre(tx, ctx, 'absence.saisie', { absenceIds: nouvelles, jour: f.jour });
      await journaliser(tx, ctx, { action: 'Création', objetType: 'Appel', objetLibelle: `Appel · ${f.classe} · ${f.jour.split('-').reverse().join('/')} ${f.debut}`,
        avant: '–', apres: `${req.body.presences.filter((x) => x.statut === 'absent').length} absent(s), ${req.body.presences.filter((x) => x.statut === 'retard').length} retard(s)` });
      return { ok: true, absences: nouvelles.length };
    });
  });

  // ------------------------------------------------------------- absences (RG-39)

  r.get('/vie-scolaire/absences', {
    config: { permission: 'vie_scolaire.dossier.consulter' },
    schema: { tags: ['vie-scolaire'], querystring: z.object({ du: z.iso.date().optional(), au: z.iso.date().optional(), inscriptionId: Uuid.optional() }) },
  }, async (req) => {
    const ctx = exiger(req);
    const visibles = await classesVisibles(ctx);
    const au = req.query.au ?? jourCm();
    const du = req.query.du ?? new Date(new Date(`${au}T12:00:00Z`).getTime() - ((jourSemaine(au) - 1) * 86_400_000)).toISOString().slice(0, 10);
    const filtre = sql`(${visibles === 'toutes'} OR a.classe_id = ANY(${tableau(visibles === 'toutes' ? [] : visibles)}::uuid[]))
                       AND (${req.query.inscriptionId ?? null}::uuid IS NULL OR a.inscription_id = ${req.query.inscriptionId ?? null}::uuid)`;
    const absences = await app.bd.lire<{ inscription_id: string; eleve_id: string; eleve: string; classe: string; jour: string; matin: boolean; apres_midi: boolean;
      minutes: number; motif: string | null; demande: string | null; justifiee: boolean }>(sql`
      SELECT a.inscription_id, i.eleve_id, i.nom || ' ' || i.prenoms AS eleve, i.classe, a.jour,
             bool_or(a.debut < '12:00') AS matin, bool_or(a.debut >= '12:00') AS apres_midi, sum(a.duree_minutes)::int AS minutes,
             max(a.motif) AS motif, max(a.demande_parent) AS demande, bool_and(a.statut = 'justifiee') AS justifiee
        FROM reporting.v_absence a JOIN reporting.v_inscription i ON i.id = a.inscription_id
       WHERE a.etablissement_id = ${ctx.etablissementId} AND a.jour BETWEEN ${du} AND ${au} AND ${filtre}
       GROUP BY a.inscription_id, i.eleve_id, i.nom, i.prenoms, i.classe, a.jour ORDER BY a.jour DESC, i.nom`);
    const periode = await app.bd.lireUn<{ libelle_fr: string; date_debut: string; date_fin: string }>(sql`
      SELECT p.libelle_fr, p.date_debut, p.date_fin FROM structure.periode p JOIN structure.annee_scolaire an ON an.id = p.annee_id AND an.statut = 'ouverte'
       WHERE p.etablissement_id = ${ctx.etablissementId} AND ${au}::date BETWEEN p.date_debut AND p.date_fin`);
    const cumul = periode ? await app.bd.lire(sql`
      SELECT i.nom || ' ' || i.prenoms AS eleve, i.classe, sum(a.duree_minutes)::int AS minutes,
             COALESCE(sum(a.duree_minutes) FILTER (WHERE a.statut = 'justifiee'), 0)::int AS justifiees
        FROM reporting.v_absence a JOIN reporting.v_inscription i ON i.id = a.inscription_id
       WHERE a.etablissement_id = ${ctx.etablissementId} AND a.jour BETWEEN ${periode.date_debut} AND ${periode.date_fin} AND ${filtre}
       GROUP BY i.nom, i.prenoms, i.classe ORDER BY 3 DESC LIMIT 3`) : [];
    const observations = await app.bd.lire(sql`
      SELECT o.id, o.type, o.description, o.sanction, o.survenu_le AS "survenuLe", o.auteur_nom AS auteur, i.nom || ' ' || i.prenoms AS eleve, i.classe
        FROM reporting.v_observation o JOIN reporting.v_inscription i ON i.id = o.inscription_id
       WHERE o.etablissement_id = ${ctx.etablissementId} AND (${visibles === 'toutes'} OR o.classe_id = ANY(${tableau(visibles === 'toutes' ? [] : visibles)}::uuid[]))
         AND (${req.query.inscriptionId ?? null}::uuid IS NULL OR o.inscription_id = ${req.query.inscriptionId ?? null}::uuid)
       ORDER BY o.survenu_le DESC, o.id DESC LIMIT 20`);
    return { du, au, periode: periode?.libelle_fr ?? null,
      absences: absences.map((a) => ({ inscriptionId: a.inscription_id, eleveId: a.eleve_id, eleve: a.eleve, classe: a.classe, jour: a.jour,
        moment: a.matin && a.apres_midi ? 'journée' : a.matin ? 'matin' : 'après-midi', minutes: a.minutes,
        motif: a.motif ?? (a.demande ? `Demande du parent : « ${a.demande} »` : null), justifiee: a.justifiee })),
      cumul, observations: observations.map((o) => ({ ...(o as Record<string, unknown>), typeLibelle: TYPES_OBSERVATION[(o as { type: string }).type] })),
      peutJustifier: ctx.a('vie_scolaire.absence.justifier'), types: TYPES_OBSERVATION };
  });

  r.post('/vie-scolaire/absences/justification', {
    config: { permission: 'vie_scolaire.absence.justifier' },
    schema: { tags: ['vie-scolaire'], body: z.object({ inscriptionId: Uuid, jour: z.iso.date(), motif: z.string().trim().min(2).max(200) }) },
  }, async (req) => {
    const ctx = exiger(req);
    const b = req.body;
    // RG-39 : le principal justifie pour sa classe ; le directeur et la secrétaire pour toute l'école.
    const visibles = await classesAccessibles(app.bd, ctx, 'vie_scolaire.absence.justifier');
    return app.bd.transaction(ctx.compteId, async (tx) => {
      const i = await ligne<{ classe_id: string; eleve_id: string; nom: string }>(tx, sql`
        SELECT classe_id, eleve_id, nom || ' ' || prenoms AS nom FROM reporting.v_inscription WHERE id = ${b.inscriptionId} AND etablissement_id = ${ctx.etablissementId}`);
      if (!i) throw introuvable('Élève');
      if (visibles !== 'toutes' && !visibles.includes(i.classe_id)) throw interdit('vie_scolaire.absence.justifier');
      const n = await lignes(tx, sql`
        UPDATE vie_scolaire.absence SET statut = 'justifiee', motif = ${b.motif}, justifiee_par = ${ctx.compteId}, justifiee_le = now()
         WHERE inscription_id = ${b.inscriptionId} AND jour = ${b.jour} AND statut = 'non_justifiee' RETURNING id`);
      if (!n.length) throw new ErreurMetier('VIE_RIEN_A_JUSTIFIER', 422, 'Aucune absence non justifiée ce jour-là.');
      await emettre(tx, ctx, 'absence.justifiee', { inscriptionId: b.inscriptionId, jour: b.jour });
      await journaliser(tx, ctx, { action: 'Modification', objetType: 'Absence', objetLibelle: `Absence · ${i.nom} · ${b.jour.split('-').reverse().join('/')}`,
        avant: 'Non justifiée', apres: `Justifiée : ${b.motif}`, eleveId: i.eleve_id });
      return { ok: true };
    });
  });

  // ------------------------------------------------------------- observations et sanctions (CU-24)

  r.post('/vie-scolaire/observations', {
    config: { permission: 'vie_scolaire.observation.creer' },
    schema: { tags: ['vie-scolaire'], body: z.object({ inscriptionId: Uuid, type: z.enum(['comportement', 'retard', 'travail_non_fait', 'tenue', 'felicitations']),
      description: z.string().trim().min(3).max(500), sanction: z.string().trim().max(120).nullish(), matiereId: Uuid.nullish(), survenuLe: z.iso.date().optional() }) },
  }, async (req) => {
    const ctx = exiger(req);
    const b = req.body;
    if (b.sanction && !ctx.a('vie_scolaire.sanction.decider')) throw interdit('vie_scolaire.sanction.decider');
    const visibles = await classesAccessibles(app.bd, ctx, 'vie_scolaire.observation.creer');
    return app.bd.transaction(ctx.compteId, async (tx) => {
      const i = await ligne<{ classe_id: string; eleve_id: string; nom: string }>(tx, sql`
        SELECT classe_id, eleve_id, nom || ' ' || prenoms AS nom FROM reporting.v_inscription WHERE id = ${b.inscriptionId} AND etablissement_id = ${ctx.etablissementId}`);
      if (!i) throw introuvable('Élève');
      if (visibles !== 'toutes' && !visibles.includes(i.classe_id)) throw interdit('vie_scolaire.observation.creer');
      const o = await ligne<{ id: string }>(tx, sql`
        INSERT INTO vie_scolaire.observation (etablissement_id, inscription_id, type, description, sanction, matiere_id, survenu_le, auteur)
        VALUES (${ctx.etablissementId}, ${b.inscriptionId}, ${b.type}, ${b.description}, ${b.sanction ?? null}, ${b.matiereId ?? null},
                ${b.survenuLe ?? jourCm()}, ${ctx.compteId}) RETURNING id`);
      await journaliser(tx, ctx, { action: 'Création', objetType: 'Discipline', objetLibelle: `${TYPES_OBSERVATION[b.type]} · ${i.nom}`,
        avant: '–', apres: b.sanction ? `Sanction : ${b.sanction}` : b.description.slice(0, 60), eleveId: i.eleve_id, ligneId: o!.id, table: 'vie_scolaire.observation' });
      return { id: o!.id };
    });
  });
}
