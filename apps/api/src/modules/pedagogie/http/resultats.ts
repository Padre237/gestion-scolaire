// CU-29 fusion (RG-36), CU-21 bulletins (RG-25 à RG-27, RG-40), CU-22 conseil de classe.
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { sql, ligne, lignes, type Tx, tableau } from '../../../core/bd.ts';
import { ErreurMetier, interdit, introuvable } from '../../../core/erreurs.ts';
import { exiger } from '../../../core/session.ts';
import type { Contexte } from '../../../core/contexte.ts';
import { journaliser } from '../../../core/audit.ts';
import { emettre } from '../../../core/evenements.ts';
import { perimetreEnseignant } from '../../../core/perimetre.ts';
import { calculerResultats, distinctionProposee, type Distinction } from '../domain/calcul.ts';
import { visibiliteBulletin } from '../../finances/domain/solvabilite.ts';
import { reglesDe, titulaire, titulairesClasse } from '../index.ts';
import { dateFr, pdfBulletins, type ModeleDoc, pdfProcesVerbal } from '@gs/print';
import { baseVerification, exigerAnneeOuverte, habillageImpression } from '../../structure/index.ts';
import { codesVerification } from '../../scolarite/index.ts';

const Uuid = z.uuid();
export const DISTINCTIONS: Record<Distinction, string> = {
  tableau_honneur: 'Tableau d\'honneur', encouragements: 'Encouragements', aucune: 'Aucune', avertissement_travail: 'Avertissement travail',
};
const FIN_ANNEE: Record<string, string> = { admis: 'Admis', redouble: 'Redouble', exclu: 'Exclu' };

const heures = (minutes: number) => `${Math.round((minutes / 60) * 10) / 10} h`.replace('.', ',');

interface Periode { id: string | null; libelle_fr: string; libelle_en: string; ordre: number; tranche_ordre: number | null; date_debut: string; date_fin: string; annee_id: string }

async function lirePeriode(tx: Tx, etab: string, periodeId: string | null, anneeId: string): Promise<Periode> {
  if (!periodeId) {
    const a = await ligne<{ date_debut: string; date_fin: string }>(tx, sql`SELECT date_debut, date_fin FROM structure.annee_scolaire WHERE id = ${anneeId}`);
    return { id: null, libelle_fr: 'Annuel', libelle_en: 'Annual', ordre: 99, tranche_ordre: null, date_debut: a!.date_debut, date_fin: a!.date_fin, annee_id: anneeId };
  }
  const p = await ligne<Periode>(tx, sql`
    SELECT id, libelle_fr, libelle_en, ordre, tranche_ordre, date_debut, date_fin, annee_id FROM structure.periode
     WHERE id = ${periodeId} AND etablissement_id = ${etab}`);
  if (!p) throw introuvable('Période');
  return p;
}

export interface ResultatBulletin {
  eleve: { inscriptionId: string; nom: string; matricule: string; dateNaissance: string; sexe: string };
  matieres: { matiereId: string; libelle: string; abrege: string; coefficient: number; moyenne: number | null; points: number | null; moyenneClasse: number | null; appreciation: string | null }[];
  totalCoefficients: number; totalPoints: number;
  moyenne: number | null; rang: number | null; effectif: number;
  classe: { nom: string; moyenne: number | null; min: number | null; max: number | null };
  absences: { minutes: number; justifiees: number; demiJournees: number; demiJourneesJustifiees: number };
  sanctions: number;
  distinction: Distinction; distinctionSeuil: string;
  appreciationGenerale: string | null; principal: string | null;
  periode: { libelleFr: string; libelleEn: string };
  annee: string;
}

/** Calcule les résultats de la classe pour une période (ou l'année) : fonction du moteur, données de la base. */
export async function calculerClasse(tx: Tx, etab: string, classeId: string, periodeId: string | null): Promise<ResultatBulletin[]> {
  const classe = await ligne<{ nom: string; annee_id: string; cycle_id: string; annee: string }>(tx, sql`
    SELECT c.nom, c.annee_id, n.cycle_id, a.libelle AS annee FROM structure.classe c JOIN structure.niveau n ON n.id = c.niveau_id
      JOIN structure.annee_scolaire a ON a.id = c.annee_id WHERE c.id = ${classeId} AND c.etablissement_id = ${etab}`);
  if (!classe) throw introuvable('Classe');
  const periode = await lirePeriode(tx, etab, periodeId, classe.annee_id);
  const regles = await reglesDe(tx, classe.annee_id, classe.cycle_id);
  const programme = await titulairesClasse(tx, classeId);
  const evaluations = await lignes<{ id: string; matiere_id: string; bareme: number }>(tx, sql`
    SELECT e.id, e.matiere_id, e.bareme FROM pedagogie.evaluation e JOIN pedagogie.sequence s ON s.id = e.sequence_id
     WHERE e.classe_id = ${classeId} AND (${periodeId}::uuid IS NULL OR s.periode_id = ${periodeId}::uuid)`);
  const notes = await lignes<{ evaluation_id: string; inscription_id: string; valeur: number | null; statut: 'present' | 'absent' | 'absent_justifie' | 'dispense' }>(tx, sql`
    SELECT n.evaluation_id, n.inscription_id, n.valeur, n.statut FROM pedagogie.note n
     WHERE n.evaluation_id = ANY(${tableau(evaluations.map((e) => e.id))}::uuid[])`);
  const eleves = await lignes<{ id: string; nom: string; prenoms: string; matricule: string; date_naissance: string; sexe: string }>(tx, sql`
    SELECT id, nom, prenoms, matricule, date_naissance, sexe FROM reporting.v_inscription
     WHERE classe_id = ${classeId} AND statut IN ('attente', 'validee') ORDER BY nom, prenoms`);
  const res = calculerResultats(regles,
    programme.map((p) => ({ matiereId: p.matiere_id, coefficient: Number(p.coefficient), ordre: p.ordre })),
    evaluations.map((e) => ({ id: e.id, matiereId: e.matiere_id, bareme: e.bareme })),
    notes.map((n) => ({ evaluationId: n.evaluation_id, inscriptionId: n.inscription_id, valeur: n.valeur === null ? null : Number(n.valeur), statut: n.statut })),
    eleves.map((e) => e.id));
  const appreciations = await lignes<{ inscription_id: string; matiere_id: string | null; texte: string }>(tx, sql`
    SELECT inscription_id, matiere_id, texte FROM pedagogie.appreciation
     WHERE inscription_id = ANY(${tableau(eleves.map((e) => e.id))}::uuid[]) AND (${periodeId}::uuid IS NULL OR periode_id = ${periodeId}::uuid)`);
  const absences = await lignes<{ inscription_id: string; minutes: number; justifiees: number; demi: number; demi_j: number }>(tx, sql`
    SELECT inscription_id, sum(duree_minutes)::int AS minutes, COALESCE(sum(duree_minutes) FILTER (WHERE statut = 'justifiee'), 0)::int AS justifiees,
           count(DISTINCT (jour, debut < '12:00'))::int AS demi,
           count(DISTINCT (jour, debut < '12:00')) FILTER (WHERE statut = 'justifiee')::int AS demi_j
      FROM reporting.v_absence WHERE classe_id = ${classeId} AND jour BETWEEN ${periode.date_debut} AND ${periode.date_fin}
     GROUP BY inscription_id`);
  const sanctions = await lignes<{ inscription_id: string; n: number }>(tx, sql`
    SELECT inscription_id, count(*)::int AS n FROM reporting.v_observation
     WHERE classe_id = ${classeId} AND sanction IS NOT NULL AND survenu_le BETWEEN ${periode.date_debut} AND ${periode.date_fin}
     GROUP BY inscription_id`);
  const decisions = periodeId ? await lignes<{ inscription_id: string; distinction: Distinction | null }>(tx, sql`
    SELECT inscription_id, distinction FROM pedagogie.decision_conseil WHERE periode_id = ${periodeId}`) : [];
  const principal = programme.find((p) => p.principal)?.nom ?? (await ligne<{ nom: string }>(tx, sql`
    SELECT p.nom_affiche AS nom FROM pedagogie.affectation a JOIN personnel.fiche p ON p.id = a.personnel_id WHERE a.classe_id = ${classeId} AND a.principal`))?.nom ?? null;
  return eleves.map((e) => {
    const r = res.eleves.find((x) => x.inscriptionId === e.id)!;
    const abs = absences.find((a) => a.inscription_id === e.id);
    const nbSanctions = sanctions.find((s) => s.inscription_id === e.id)?.n ?? 0;
    const choisie = decisions.find((d) => d.inscription_id === e.id)?.distinction;
    const totalCoef = r.matieres.filter((m) => m.moyenne !== null).reduce((s, m) => s + m.coefficient, 0);
    return {
      eleve: { inscriptionId: e.id, nom: `${e.nom} ${e.prenoms}`, matricule: e.matricule, dateNaissance: e.date_naissance, sexe: e.sexe },
      matieres: r.matieres.map((m) => {
        const p = programme.find((x) => x.matiere_id === m.matiereId)!;
        return { matiereId: m.matiereId, libelle: p.libelle_fr, abrege: p.abrege, coefficient: m.coefficient, moyenne: m.moyenne, points: m.points,
          moyenneClasse: m.moyenneClasse, appreciation: appreciations.find((a) => a.inscription_id === e.id && a.matiere_id === m.matiereId)?.texte ?? null };
      }),
      totalCoefficients: totalCoef,
      totalPoints: Math.round(r.matieres.reduce((s, m) => s + (m.points ?? 0), 0) * 100) / 100,
      moyenne: r.moyenne, rang: r.rang, effectif: res.effectif,
      classe: { nom: classe.nom, moyenne: res.moyenneClasse, min: res.min, max: res.max },
      absences: { minutes: abs?.minutes ?? 0, justifiees: abs?.justifiees ?? 0, demiJournees: abs?.demi ?? 0, demiJourneesJustifiees: abs?.demi_j ?? 0 },
      sanctions: nbSanctions,
      distinction: choisie ?? distinctionProposee(regles, r.moyenne, nbSanctions),
      distinctionSeuil: `Seuil paramétré : ${regles.mentions.tableauHonneur} sur 20 et aucune sanction`,
      appreciationGenerale: appreciations.find((a) => a.inscription_id === e.id && a.matiere_id === null)?.texte ?? null,
      principal,
      periode: { libelleFr: periode.libelle_fr, libelleEn: periode.libelle_en },
      annee: classe.annee,
    };
  });
}

/** Échéancier par inscription, pour la visibilité des bulletins (RG-40) : lecture par la vue de reporting. */
async function echeanciers(tx: Tx, inscriptions: string[]) {
  const l = await lignes<{ inscription_id: string; ordre: number; a_payer: number; verse: number }>(tx, sql`
    SELECT inscription_id, ordre, a_payer, verse FROM reporting.v_echeance WHERE inscription_id = ANY(${tableau(inscriptions)}::uuid[])`);
  const m = new Map<string, { ordre: number; aPayer: number; verse: number }[]>();
  for (const x of l) m.set(x.inscription_id, [...(m.get(x.inscription_id) ?? []), { ordre: x.ordre, aPayer: Number(x.a_payer), verse: Number(x.verse) }]);
  return m;
}

export async function visibilites(tx: Tx, inscriptions: string[], periodeId: string | null, tranche: number | null) {
  const ech = await echeanciers(tx, inscriptions);
  const levees = await lignes<{ inscription_id: string }>(tx, sql`
    SELECT inscription_id FROM pedagogie.levee_blocage WHERE inscription_id = ANY(${tableau(inscriptions)}::uuid[])
       AND periode_id IS NOT DISTINCT FROM ${periodeId}::uuid`);
  const leve = new Set(levees.map((l) => l.inscription_id));
  return new Map(inscriptions.map((i) => [i, visibiliteBulletin(ech.get(i) ?? [], tranche, periodeId === null, leve.has(i))]));
}

export async function routesResultats(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const Classe = z.object({ classeId: Uuid, periodeId: Uuid.nullish() });

  async function exigerClasseLisible(ctx: Contexte, classeId: string, permissionLarge: string) {
    if (ctx.portee(permissionLarge) === 'etablissement') return;
    const p = await perimetreEnseignant(app.bd, ctx);
    if (!p.classesPrincipal.some((c) => c.id === classeId)) throw interdit(permissionLarge);
  }

  // ------------------------------------------------------------- fusion (CU-29, RG-36)

  r.get('/pedagogie/fusion', {
    config: { unePermissionParmi: ['pedagogie.fusion.transmettre', 'pedagogie.fusion.valider', 'pedagogie.note.lire'] },
    schema: { tags: ['pedagogie'], querystring: z.object({ classeId: Uuid, periodeId: Uuid }) },
  }, async (req) => {
    const ctx = exiger(req);
    const { classeId, periodeId } = req.query;
    await exigerClasseLisible(ctx, classeId, 'pedagogie.note.lire');
    return app.bd.transaction(null, async (tx) => {
      const periode = await ligne<{ libelle_fr: string; date_debut: string; date_fin: string }>(tx, sql`
        SELECT libelle_fr, date_debut, date_fin FROM structure.periode WHERE id = ${periodeId}`);
      if (!periode) throw introuvable('Période');
      const programme = await titulairesClasse(tx, classeId);
      const resultats = await calculerClasse(tx, ctx.etablissementId, classeId, periodeId);
      const eleves = await lignes<{ id: string; nom: string }>(tx, sql`
        SELECT id, nom || ' ' || prenoms AS nom FROM reporting.v_inscription WHERE classe_id = ${classeId} AND statut IN ('attente', 'validee')`);
      const completude = await lignes<{ matiere_id: string; inscription_id: string; manquantes: number }>(tx, sql`
        SELECT e.matiere_id, i.id AS inscription_id,
               count(*) FILTER (WHERE n.id IS NULL OR (n.statut = 'present' AND n.valeur IS NULL))::int AS manquantes
          FROM pedagogie.evaluation e JOIN pedagogie.sequence s ON s.id = e.sequence_id
          CROSS JOIN reporting.v_inscription i
          LEFT JOIN pedagogie.note n ON n.evaluation_id = e.id AND n.inscription_id = i.id
         WHERE e.classe_id = ${classeId} AND s.periode_id = ${periodeId} AND i.classe_id = ${classeId} AND i.statut IN ('attente', 'validee')
         GROUP BY e.matiere_id, i.id`);
      const matieres = programme.map((p) => {
        const lignesM = completude.filter((c) => c.matiere_id === p.matiere_id);
        const aucunes = lignesM.length === 0;
        const manquants = aucunes ? eleves.map((e) => e.id) : lignesM.filter((c) => c.manquantes > 0).map((c) => c.inscription_id);
        const moyenneClasse = resultats[0]?.matieres.find((m) => m.matiereId === p.matiere_id)?.moyenneClasse ?? null;
        return {
          matiereId: p.matiere_id, matiere: p.libelle_fr, saisiePar: p.personnel_id && p.personnel_id === ctx.personnelId ? 'Vous' : (p.nom ?? '–'),
          role: p.principal ? 'Instituteur principal' : 'Instituteur de matière', estMoi: !!ctx.personnelId && p.personnel_id === ctx.personnelId,
          notes: eleves.length - manquants.length, total: eleves.length, moyenne: moyenneClasse,
          manquants: manquants.map((id) => eleves.find((e) => e.id === id)?.nom ?? ''),
        };
      });
      const fusion = await ligne<{ statut: string; transmise_le: string | null; validee_le: string | null }>(tx, sql`
        SELECT statut, transmise_le, validee_le FROM pedagogie.fusion WHERE classe_id = ${classeId} AND periode_id = ${periodeId}`);
      const releves = await lignes<{ type: string; eleve: string; detail: string; date: string; auteur: string }>(tx, sql`
        SELECT o.type, i.nom || ' ' || i.prenoms AS eleve, o.description AS detail, to_char(o.survenu_le, 'DD/MM') AS date, o.auteur_nom AS auteur
          FROM reporting.v_observation o JOIN reporting.v_inscription i ON i.id = o.inscription_id
         WHERE o.classe_id = ${classeId} AND o.survenu_le BETWEEN ${periode.date_debut} AND ${periode.date_fin}
           AND o.auteur_personnel_id IS DISTINCT FROM ${ctx.personnelId}
        UNION ALL
        SELECT 'absence', i.nom || ' ' || i.prenoms, a.libelle, to_char(a.jour, 'DD/MM'), p.nom_affiche
          FROM reporting.v_absence a JOIN reporting.v_inscription i ON i.id = a.inscription_id JOIN personnel.fiche p ON p.id = a.personnel_id
         WHERE a.classe_id = ${classeId} AND a.jour BETWEEN ${periode.date_debut} AND ${periode.date_fin}
           AND a.personnel_id IS DISTINCT FROM ${ctx.personnelId}
         ORDER BY 4 DESC LIMIT 6`);
      const signalements = await lignes(tx, sql`
        SELECT s.matiere_id AS "matiereId", s.texte, s.statut, c.nom_affiche AS auteur, s.cree_le AS "creeLe"
          FROM pedagogie.signalement s JOIN core.compte c ON c.id = s.auteur
         WHERE s.classe_id = ${classeId} AND s.periode_id = ${periodeId} ORDER BY s.cree_le DESC`);
      return { periode: periode.libelle_fr, matieres, statut: fusion?.statut ?? 'saisie', complet: matieres.every((m) => m.notes === m.total && m.total > 0),
        releves, signalements };
    });
  });

  r.post('/pedagogie/signalements', {
    config: { permission: 'pedagogie.note.signaler' },
    schema: { tags: ['pedagogie'], body: z.object({ classeId: Uuid, periodeId: Uuid, matiereId: Uuid, texte: z.string().trim().min(3).max(500) }) },
  }, async (req) => {
    const ctx = exiger(req);
    const b = req.body;
    await exigerClasseLisible(ctx, b.classeId, 'pedagogie.note.signaler');
    return app.bd.transaction(ctx.compteId, async (tx) => {
      await tx.execute(sql`INSERT INTO pedagogie.signalement (etablissement_id, classe_id, periode_id, matiere_id, texte, auteur)
                           VALUES (${ctx.etablissementId}, ${b.classeId}, ${b.periodeId}, ${b.matiereId}, ${b.texte}, ${ctx.compteId})`);
      return { ok: true };
    });
  });

  r.post('/pedagogie/fusion/calcul', {
    config: { permission: 'pedagogie.fusion.transmettre' }, schema: { tags: ['pedagogie'], body: z.object({ classeId: Uuid, periodeId: Uuid }) },
  }, async (req) => {
    const ctx = exiger(req);
    await exigerClasseLisible(ctx, req.body.classeId, 'pedagogie.fusion.transmettre');
    return app.bd.transaction(ctx.compteId, async (tx) => {
      const n = await enregistrerBrouillons(tx, ctx, req.body.classeId, req.body.periodeId);
      await tx.execute(sql`
        INSERT INTO pedagogie.fusion (etablissement_id, classe_id, periode_id, statut, calculee_le)
        VALUES (${ctx.etablissementId}, ${req.body.classeId}, ${req.body.periodeId}, 'calculee', now())
        ON CONFLICT (classe_id, periode_id) DO UPDATE SET statut = CASE WHEN pedagogie.fusion.statut = 'publiee' THEN 'publiee' ELSE 'calculee' END,
           calculee_le = now()`);
      return { bulletins: n };
    });
  });

  r.post('/pedagogie/fusion/transmission', {
    config: { permission: 'pedagogie.fusion.transmettre' }, schema: { tags: ['pedagogie'], body: z.object({ classeId: Uuid, periodeId: Uuid }) },
  }, async (req) => {
    const ctx = exiger(req);
    const { classeId, periodeId } = req.body;
    await exigerClasseLisible(ctx, classeId, 'pedagogie.fusion.transmettre');
    return app.bd.transaction(ctx.compteId, async (tx) => {
      // RG-36 : le principal transmet une fois toutes les matières de la classe saisies.
      const manque = await ligne<{ n: number }>(tx, sql`
        SELECT count(*)::int AS n FROM pedagogie.programme_niveau pn
          JOIN structure.classe c ON c.niveau_id = pn.niveau_id AND c.annee_id = pn.annee_id AND c.id = ${classeId}
         WHERE NOT EXISTS (SELECT 1 FROM pedagogie.evaluation e JOIN pedagogie.sequence s ON s.id = e.sequence_id
                            WHERE e.classe_id = ${classeId} AND e.matiere_id = pn.matiere_id AND s.periode_id = ${periodeId})
            OR EXISTS (SELECT 1 FROM pedagogie.evaluation e JOIN pedagogie.sequence s ON s.id = e.sequence_id
                        CROSS JOIN scolarite.inscription i
                        LEFT JOIN pedagogie.note n ON n.evaluation_id = e.id AND n.inscription_id = i.id
                       WHERE e.classe_id = ${classeId} AND e.matiere_id = pn.matiere_id AND s.periode_id = ${periodeId}
                         AND i.classe_id = ${classeId} AND i.statut IN ('attente', 'validee')
                         AND (n.id IS NULL OR (n.statut = 'present' AND n.valeur IS NULL)))`);
      if (manque!.n > 0) throw new ErreurMetier('PED_MATIERES_INCOMPLETES', 422, `${manque!.n} matière(s) incomplète(s) : la transmission attend toutes les notes (RG-36).`);
      await enregistrerBrouillons(tx, ctx, classeId, periodeId);
      await tx.execute(sql`
        INSERT INTO pedagogie.fusion (etablissement_id, classe_id, periode_id, statut, calculee_le, transmise_le, transmise_par)
        VALUES (${ctx.etablissementId}, ${classeId}, ${periodeId}, 'transmise', now(), now(), ${ctx.compteId})
        ON CONFLICT (classe_id, periode_id) DO UPDATE SET statut = 'transmise', transmise_le = now(), transmise_par = ${ctx.compteId}`);
      const classe = await ligne<{ nom: string }>(tx, sql`SELECT nom FROM structure.classe WHERE id = ${classeId}`);
      await journaliser(tx, ctx, { action: 'Modification', objetType: 'Note', objetLibelle: `Fusion des notes · ${classe!.nom}`,
        avant: 'Saisie', apres: 'Transmise au préfet', table: 'pedagogie.fusion' });
      return { ok: true };
    });
  });

  // ------------------------------------------------------------- bulletins (CU-21)

  r.get('/pedagogie/bulletins', {
    config: { unePermissionParmi: ['pedagogie.bulletin.calculer', 'pedagogie.bulletin.publier', 'pedagogie.bulletin.apprecier', 'pedagogie.bulletin.lever_blocage', 'pedagogie.note.lire'] },
    schema: { tags: ['pedagogie'], querystring: Classe.extend({ inscriptionId: Uuid.optional() }) },
  }, async (req) => {
    const ctx = exiger(req);
    const { classeId } = req.query;
    const periodeId = req.query.periodeId ?? null;
    if (ctx.portee('pedagogie.note.lire') !== 'etablissement' && !ctx.a('pedagogie.bulletin.lever_blocage')) {
      await exigerClasseLisible(ctx, classeId, 'pedagogie.bulletin.apprecier');
    }
    return app.bd.transaction(null, async (tx) => {
      const resultats = await calculerClasse(tx, ctx.etablissementId, classeId, periodeId);
      const stockes = await lignes<{ inscription_id: string; statut: string; version: number; appreciation_generale: string | null; resultats: ResultatBulletin }>(tx, sql`
        SELECT DISTINCT ON (inscription_id) inscription_id, statut, version, appreciation_generale, resultats FROM pedagogie.bulletin
         WHERE inscription_id = ANY(${tableau(resultats.map((x) => x.eleve.inscriptionId))}::uuid[]) AND periode_id IS NOT DISTINCT FROM ${periodeId}::uuid
           AND statut <> 'remplace'
         ORDER BY inscription_id, (statut = 'brouillon') DESC, version DESC`);
      const periode = periodeId ? await ligne<{ tranche_ordre: number | null }>(tx, sql`SELECT tranche_ordre FROM structure.periode WHERE id = ${periodeId}`) : null;
      const vis = await visibilites(tx, resultats.map((x) => x.eleve.inscriptionId), periodeId, periode?.tranche_ordre ?? null);
      const publies = await lignes<{ inscription_id: string }>(tx, sql`
        SELECT inscription_id FROM pedagogie.bulletin WHERE statut = 'publie' AND periode_id IS NOT DISTINCT FROM ${periodeId}::uuid
           AND inscription_id = ANY(${tableau(resultats.map((x) => x.eleve.inscriptionId))}::uuid[])`);
      const estPublie = new Set(publies.map((p) => p.inscription_id));
      const classement = [...resultats].sort((a, b) => (a.rang ?? 999) - (b.rang ?? 999) || a.eleve.nom.localeCompare(b.eleve.nom))
        .map((x) => ({ inscriptionId: x.eleve.inscriptionId, rang: x.rang, nom: x.eleve.nom, moyenne: x.moyenne }));
      const choisi = req.query.inscriptionId ?? classement[Math.min(2, classement.length - 1)]?.inscriptionId ?? null;
      const detail = choisi ? resultats.find((x) => x.eleve.inscriptionId === choisi) : undefined;
      const st = choisi ? stockes.find((s) => s.inscription_id === choisi) : undefined;
      const fusion = periodeId ? await ligne<{ statut: string }>(tx, sql`SELECT statut FROM pedagogie.fusion WHERE classe_id = ${classeId} AND periode_id = ${periodeId}`) : null;
      const visibles = [...vis.entries()].filter(([i, v]) => estPublie.has(i) && v.visible).length;
      const enAttente = [...vis.entries()].filter(([, v]) => !v.visible).map(([i]) => i);
      return {
        classement, choisi,
        bulletin: detail ? { ...detail, statut: st?.statut === 'publie' ? 'publie' : 'brouillon', version: st?.version ?? 1,
          appreciationGenerale: detail.appreciationGenerale, visibilite: vis.get(detail.eleve.inscriptionId) } : null,
        visibilite: { visibles, enAttente: enAttente.length, tranche: periode?.tranche_ordre ?? null, eleves: enAttente },
        nbBulletins: resultats.length, fusion: fusion?.statut ?? 'saisie', publie: estPublie.size > 0,
      };
    });
  });

  // Bulletins de la classe en PDF (maquette Bulletins, « Imprimer la classe en PDF »).
  r.get('/pedagogie/bulletins/document', {
    config: { unePermissionParmi: ['pedagogie.bulletin.calculer', 'pedagogie.bulletin.publier', 'pedagogie.bulletin.apprecier', 'pedagogie.bulletin.lever_blocage'] },
    schema: { tags: ['pedagogie'], querystring: Classe },
  }, async (req, rep) => {
    const ctx = exiger(req);
    const { classeId } = req.query;
    const periodeId = req.query.periodeId ?? null;
    if (ctx.portee('pedagogie.note.lire') !== 'etablissement' && !ctx.a('pedagogie.bulletin.lever_blocage')) {
      await exigerClasseLisible(ctx, classeId, 'pedagogie.bulletin.apprecier');
    }
    const pdf = await app.bd.transaction(ctx.compteId, async (tx) => {
      const resultats = await calculerClasse(tx, ctx.etablissementId, classeId, periodeId);
      const stockes = await lignes<{ id: string; inscription_id: string; statut: string; version: number }>(tx, sql`
        SELECT DISTINCT ON (inscription_id) id, inscription_id, statut, version FROM pedagogie.bulletin
         WHERE inscription_id = ANY(${tableau(resultats.map((x) => x.eleve.inscriptionId))}::uuid[]) AND periode_id IS NOT DISTINCT FROM ${periodeId}::uuid
           AND statut <> 'remplace' ORDER BY inscription_id, (statut = 'brouillon') DESC, version DESC`);
      const etab = await ligne<{ nom_fr: string; nom_en: string; ville_bp: string | null; telephone: string | null; modeles: { bulletin?: ModeleDoc } | null }>(tx, sql`
        SELECT nom_fr, nom_en, ville_bp, telephone, modeles FROM structure.etablissement WHERE id = ${ctx.etablissementId}`);
      // QR code de vérification sur chaque bulletin publié, logo au centre (D-44).
      const h = await habillageImpression(app.bd, ctx.etablissementId, 'bulletin');
      const publies = stockes.filter((x) => x.statut === 'publie');
      const codes = await codesVerification(tx, ctx.etablissementId, 'bulletin', publies.map((x) => x.id));
      const base = baseVerification(h.adresse, req);
      await journaliser(tx, ctx, { action: 'Export', objetType: 'Bulletin', objetLibelle: `Bulletins · ${resultats[0]?.classe.nom ?? ''} · ${resultats[0]?.periode.libelleFr ?? ''}`,
        avant: '–', apres: `PDF · ${resultats.length} bulletins` });
      return pdfBulletins([...resultats].sort((a, b) => a.eleve.nom.localeCompare(b.eleve.nom)).map((x) => {
        const st = stockes.find((s) => s.inscription_id === x.eleve.inscriptionId);
        return {
          verification: st?.statut === 'publie' && codes.get(st.id) ? `${base}/verifier/${codes.get(st.id)}` : undefined,
          etablissement: etab!.nom_fr, modele: etab!.modeles?.bulletin, periodeFr: x.periode.libelleFr, periodeEn: x.periode.libelleEn, annee: x.annee,
          version: st?.version ?? 1, statut: st?.statut === 'publie' ? 'publie' : 'brouillon',
          eleve: x.eleve.nom, matricule: x.eleve.matricule, classe: x.classe.nom, effectif: x.effectif, naissance: dateFr(x.eleve.dateNaissance),
          matieres: x.matieres.map((m) => ({ libelle: m.libelle, coefficient: m.coefficient, moyenne: m.moyenne, points: m.points, moyenneClasse: m.moyenneClasse, appreciation: m.appreciation })),
          totalCoefficients: x.totalCoefficients, totalPoints: x.totalPoints, moyenne: x.moyenne, rang: x.rang,
          moyenneClasse: x.classe.moyenne, min: x.classe.min, max: x.classe.max,
          absences: `${heures(x.absences.minutes)} dont ${heures(x.absences.justifiees)} justifiées`, distinction: DISTINCTIONS[x.distinction],
          appreciationGenerale: x.appreciationGenerale,
        };
      }), { gabarit: h.gabarit, logo: h.logo, etablissement: { nom_fr: etab!.nom_fr, nom_en: etab!.nom_en, ville_bp: etab!.ville_bp, telephone: etab!.telephone, modeles: etab!.modeles } });
    });
    return rep.type('application/pdf').header('content-disposition', 'inline; filename="bulletins.pdf"').send(Buffer.from(pdf));
  });

  r.post('/pedagogie/bulletins/calcul', {
    config: { permission: 'pedagogie.bulletin.calculer' }, schema: { tags: ['pedagogie'], body: Classe },
  }, async (req) => {
    const ctx = exiger(req);
    return app.bd.transaction(ctx.compteId, async (tx) => ({ bulletins: await enregistrerBrouillons(tx, ctx, req.body.classeId, req.body.periodeId ?? null) }));
  });

  // Publier vaut validation du préfet (décision D-15) ; RG-27 : version figée, la correction crée une nouvelle version.
  r.post('/pedagogie/bulletins/publication', {
    config: { permission: 'pedagogie.bulletin.publier' }, schema: { tags: ['pedagogie'], body: Classe },
  }, async (req) => {
    const ctx = exiger(req);
    const { classeId } = req.body;
    const periodeId = req.body.periodeId ?? null;
    return app.bd.transaction(ctx.compteId, async (tx) => {
      if (periodeId) {
        const fusion = await ligne<{ statut: string }>(tx, sql`SELECT statut FROM pedagogie.fusion WHERE classe_id = ${classeId} AND periode_id = ${periodeId}`);
        if (!fusion || fusion.statut === 'calculee') {
          throw new ErreurMetier('PED_FUSION_NON_TRANSMISE', 422, 'Le principal n\'a pas encore transmis les notes de la classe (RG-36).');
        }
      }
      await enregistrerBrouillons(tx, ctx, classeId, periodeId);
      // L'ancienne version publiée est d'abord remplacée, puis le brouillon devient la version publiée.
      await tx.execute(sql`
        UPDATE pedagogie.bulletin b SET statut = 'remplace'
         WHERE b.statut = 'publie' AND b.periode_id IS NOT DISTINCT FROM ${periodeId}::uuid
           AND b.inscription_id IN (SELECT id FROM scolarite.inscription WHERE classe_id = ${classeId})
           AND EXISTS (SELECT 1 FROM pedagogie.bulletin x WHERE x.inscription_id = b.inscription_id AND x.statut = 'brouillon'
                         AND x.periode_id IS NOT DISTINCT FROM b.periode_id)`);
      const publies = await lignes<{ id: string; inscription_id: string; version: number }>(tx, sql`
        UPDATE pedagogie.bulletin b SET statut = 'publie', publie_le = now(), publie_par = ${ctx.compteId}
         WHERE b.statut = 'brouillon' AND b.periode_id IS NOT DISTINCT FROM ${periodeId}::uuid
           AND b.inscription_id IN (SELECT id FROM scolarite.inscription WHERE classe_id = ${classeId})
        RETURNING id, inscription_id, version`);
      if (periodeId) {
        await tx.execute(sql`UPDATE pedagogie.fusion SET statut = 'publiee', validee_le = COALESCE(validee_le, now()),
                               validee_par = COALESCE(validee_par, ${ctx.compteId}) WHERE classe_id = ${classeId} AND periode_id = ${periodeId}`);
        await tx.execute(sql`UPDATE structure.periode SET statut = 'publiee' WHERE id = ${periodeId} AND statut <> 'publiee'`);
      }
      if (publies.length) await emettre(tx, ctx, 'bulletins.publies', { classeId, periodeId, inscriptionIds: publies.map((p) => p.inscription_id) });
      const classe = await ligne<{ nom: string }>(tx, sql`SELECT nom FROM structure.classe WHERE id = ${classeId}`);
      await journaliser(tx, ctx, { action: 'Modification', objetType: 'Bulletin', objetLibelle: `Bulletins · ${classe!.nom}`,
        avant: 'Brouillon', apres: `Publiés : ${publies.length}${publies.some((p) => p.version > 1) ? ' (nouvelle version)' : ''}` });
      return { publies: publies.length };
    });
  });

  // RG-40 : le directeur lève le blocage pour un élève ; la levée est tracée au journal.
  r.post('/pedagogie/bulletins/levee-blocage', {
    config: { permission: 'pedagogie.bulletin.lever_blocage' },
    schema: { tags: ['pedagogie'], body: z.object({ inscriptionId: Uuid, periodeId: Uuid.nullable(), motif: z.string().trim().max(200).nullish() }) },
  }, async (req) => {
    const ctx = exiger(req);
    const b = req.body;
    return app.bd.transaction(ctx.compteId, async (tx) => {
      const e = await ligne<{ nom: string; eleve_id: string }>(tx, sql`
        SELECT nom || ' ' || prenoms AS nom, eleve_id FROM reporting.v_inscription WHERE id = ${b.inscriptionId} AND etablissement_id = ${ctx.etablissementId}`);
      if (!e) throw introuvable('Élève');
      const p = b.periodeId ? await ligne<{ libelle_fr: string }>(tx, sql`SELECT libelle_fr FROM structure.periode WHERE id = ${b.periodeId}`) : { libelle_fr: 'bulletin annuel' };
      await tx.execute(sql`
        INSERT INTO pedagogie.levee_blocage (etablissement_id, inscription_id, periode_id, motif, leve_par)
        VALUES (${ctx.etablissementId}, ${b.inscriptionId}, ${b.periodeId}, ${b.motif ?? null}, ${ctx.compteId})
        ON CONFLICT (inscription_id, periode_id) DO NOTHING`);
      await journaliser(tx, ctx, { action: 'Levée de blocage', objetType: 'Bulletin', objetLibelle: `Bulletin · ${e.nom} · ${p!.libelle_fr}`,
        avant: 'Masqué au parent', apres: 'Visible', table: 'pedagogie.levee_blocage', eleveId: e.eleve_id });
      return { ok: true };
    });
  });

  // ------------------------------------------------------------- conseil de classe (CU-22)

  r.get('/pedagogie/conseil', {
    config: { unePermissionParmi: ['pedagogie.conseil.gerer', 'pedagogie.conseil.decider', 'pedagogie.note.lire'] },
    schema: { tags: ['pedagogie'], querystring: z.object({ classeId: Uuid, periodeId: Uuid }) },
  }, async (req) => {
    const ctx = exiger(req);
    const { classeId, periodeId } = req.query;
    if (!ctx.a('pedagogie.conseil.gerer') && !ctx.a('pedagogie.conseil.decider')) await exigerClasseLisible(ctx, classeId, 'pedagogie.note.lire');
    return app.bd.transaction(null, async (tx) => {
      const resultats = await calculerClasse(tx, ctx.etablissementId, classeId, periodeId);
      const periode = await ligne<{ ordre: number; annee_id: string }>(tx, sql`SELECT ordre, annee_id FROM structure.periode WHERE id = ${periodeId}`);
      const dernier = await ligne<{ n: number }>(tx, sql`SELECT max(ordre)::int AS n FROM structure.periode WHERE annee_id = ${periode!.annee_id}`);
      const decisions = await lignes<{ inscription_id: string; fin_annee: string | null }>(tx, sql`
        SELECT inscription_id, fin_annee FROM pedagogie.decision_conseil WHERE periode_id = ${periodeId}`);
      const classe = await ligne<{ annee_id: string; cycle_id: string }>(tx, sql`
        SELECT c.annee_id, n.cycle_id FROM structure.classe c JOIN structure.niveau n ON n.id = c.niveau_id WHERE c.id = ${classeId}`);
      const regles = await reglesDe(tx, classe!.annee_id, classe!.cycle_id);
      const moyennes = resultats.filter((x) => x.moyenne !== null);
      const pv = await ligne<{ contenu: string }>(tx, sql`SELECT contenu FROM pedagogie.proces_verbal WHERE classe_id = ${classeId} AND periode_id = ${periodeId}`);
      return {
        stats: {
          moyenne: resultats[0]?.classe.moyenne ?? null,
          reussite: moyennes.length ? Math.round((moyennes.filter((x) => x.moyenne! >= 10).length * 100) / moyennes.length) : null,
          reussis: moyennes.filter((x) => x.moyenne! >= 10).length, effectif: resultats.length,
          absencesMinutes: resultats.reduce((s, x) => s + x.absences.minutes, 0),
          sanctions: resultats.reduce((s, x) => s + x.sanctions, 0), elevesSanctionnes: resultats.filter((x) => x.sanctions > 0).length,
        },
        lignes: [...resultats].sort((a, b) => (a.rang ?? 999) - (b.rang ?? 999)).map((x) => ({
          inscriptionId: x.eleve.inscriptionId, rang: x.rang, nom: x.eleve.nom, moyenne: x.moyenne,
          absences: x.absences.minutes ? heures(x.absences.minutes) : '0', sanctions: x.sanctions, distinction: x.distinction,
          finAnnee: decisions.find((d) => d.inscription_id === x.eleve.inscriptionId)?.fin_annee ?? null,
        })),
        dernierePeriode: periode!.ordre === dernier!.n,
        seuils: regles.mentions,
        procesVerbal: pv?.contenu ?? '',
        distinctions: DISTINCTIONS, finsAnnee: FIN_ANNEE,
      };
    });
  });

  r.put('/pedagogie/conseil/distinctions', {
    config: { permission: 'pedagogie.conseil.gerer' },
    schema: { tags: ['pedagogie'], body: z.object({ classeId: Uuid, periodeId: Uuid,
      items: z.array(z.object({ inscriptionId: Uuid, distinction: z.enum(['tableau_honneur', 'encouragements', 'aucune', 'avertissement_travail']) })) }) },
  }, async (req) => {
    const ctx = exiger(req);
    return app.bd.transaction(ctx.compteId, async (tx) => {
      for (const i of req.body.items) {
        await tx.execute(sql`
          INSERT INTO pedagogie.decision_conseil (etablissement_id, inscription_id, periode_id, distinction, modifie_par)
          VALUES (${ctx.etablissementId}, ${i.inscriptionId}, ${req.body.periodeId}, ${i.distinction}, ${ctx.compteId})
          ON CONFLICT (inscription_id, periode_id) DO UPDATE SET distinction = EXCLUDED.distinction, modifie_par = EXCLUDED.modifie_par, modifie_le = now()`);
      }
      const classe = await ligne<{ nom: string }>(tx, sql`SELECT nom FROM structure.classe WHERE id = ${req.body.classeId}`);
      await journaliser(tx, ctx, { action: 'Modification', objetType: 'Bulletin', objetLibelle: `Conseil de classe · ${classe!.nom} · distinctions`,
        avant: '–', apres: `${req.body.items.length} élèves` });
      await enregistrerBrouillons(tx, ctx, req.body.classeId, req.body.periodeId);
      return { ok: true };
    });
  });

  // E-30 : le directeur enregistre les décisions de fin d'année (CU-22), au conseil de la dernière période.
  r.put('/pedagogie/conseil/decisions', {
    config: { permission: 'pedagogie.conseil.decider' },
    schema: { tags: ['pedagogie'], body: z.object({ classeId: Uuid, periodeId: Uuid,
      items: z.array(z.object({ inscriptionId: Uuid, finAnnee: z.enum(['admis', 'redouble', 'exclu']) })) }) },
  }, async (req) => {
    const ctx = exiger(req);
    return app.bd.transaction(ctx.compteId, async (tx) => {
      const p = await ligne<{ ordre: number; annee_id: string }>(tx, sql`SELECT ordre, annee_id FROM structure.periode WHERE id = ${req.body.periodeId}`);
      const dernier = await ligne<{ n: number }>(tx, sql`SELECT max(ordre)::int AS n FROM structure.periode WHERE annee_id = ${p!.annee_id}`);
      if (p!.ordre !== dernier!.n) throw new ErreurMetier('PED_PAS_FIN_ANNEE', 422, 'Les décisions de fin d\'année se prennent au conseil de la dernière période.');
      for (const i of req.body.items) {
        await tx.execute(sql`
          INSERT INTO pedagogie.decision_conseil (etablissement_id, inscription_id, periode_id, fin_annee, modifie_par)
          VALUES (${ctx.etablissementId}, ${i.inscriptionId}, ${req.body.periodeId}, ${i.finAnnee}, ${ctx.compteId})
          ON CONFLICT (inscription_id, periode_id) DO UPDATE SET fin_annee = EXCLUDED.fin_annee, modifie_par = EXCLUDED.modifie_par, modifie_le = now()`);
      }
      await journaliser(tx, ctx, { action: 'Modification', objetType: 'Bulletin', objetLibelle: 'Décisions de fin d\'année',
        avant: '–', apres: `${req.body.items.length} élèves` });
      return { ok: true };
    });
  });

  // Procès-verbal du conseil de classe (maquette Conseil, bouton « Procès-verbal »).
  r.get('/pedagogie/conseil/document', {
    config: { unePermissionParmi: ['pedagogie.conseil.gerer', 'pedagogie.conseil.decider'] },
    schema: { tags: ['pedagogie'], querystring: z.object({ classeId: Uuid, periodeId: Uuid }) },
  }, async (req, rep) => {
    const ctx = exiger(req);
    const { classeId, periodeId } = req.query;
    const pdf = await app.bd.transaction(ctx.compteId, async (tx) => {
      const resultats = await calculerClasse(tx, ctx.etablissementId, classeId, periodeId);
      const etab = await ligne<{ nom_fr: string; nom_en: string; ville_bp: string | null; telephone: string | null; signataire: string | null }>(tx, sql`
        SELECT nom_fr, nom_en, ville_bp, telephone, signataire FROM structure.etablissement WHERE id = ${ctx.etablissementId}`);
      const pv = await ligne<{ contenu: string }>(tx, sql`SELECT contenu FROM pedagogie.proces_verbal WHERE classe_id = ${classeId} AND periode_id = ${periodeId}`);
      const moyennes = resultats.filter((x) => x.moyenne !== null);
      const reussis = moyennes.filter((x) => x.moyenne! >= 10).length;
      const note = (n: number | null) => (n === null ? '–' : n.toFixed(2).replace('.', ','));
      await journaliser(tx, ctx, { action: 'Export', objetType: 'Bulletin', objetLibelle: `Procès-verbal · ${resultats[0]?.classe.nom ?? ''} · ${resultats[0]?.periode.libelleFr ?? ''}`, avant: '–', apres: 'PDF' });
      return pdfProcesVerbal({ etablissement: etab!, classe: resultats[0]?.classe.nom ?? '', periode: resultats[0]?.periode.libelleFr ?? '', annee: resultats[0]?.annee ?? '',
        stats: [['Moyenne de la classe', `${note(resultats[0]?.classe.moyenne ?? null)} sur 20`],
          ['Taux de réussite', moyennes.length ? `${Math.round((reussis * 100) / moyennes.length)} % (${reussis} élèves sur ${resultats.length} à 10 ou plus)` : '–'],
          ['Absences', `${heures(resultats.reduce((s, x) => s + x.absences.minutes, 0))} sur la période`],
          ['Sanctions', String(resultats.reduce((s, x) => s + x.sanctions, 0))]],
        lignes: [...resultats].sort((a, b) => (a.rang ?? 999) - (b.rang ?? 999))
          .map((x) => [String(x.rang ?? '–'), x.eleve.nom, note(x.moyenne), heures(x.absences.minutes), DISTINCTIONS[x.distinction]]),
        contenu: pv?.contenu ?? '' });
    });
    return rep.type('application/pdf').header('content-disposition', 'inline; filename="proces-verbal.pdf"').send(Buffer.from(pdf));
  });

  r.put('/pedagogie/conseil/proces-verbal', {
    config: { permission: 'pedagogie.conseil.gerer' },
    schema: { tags: ['pedagogie'], body: z.object({ classeId: Uuid, periodeId: Uuid, contenu: z.string().max(20_000) }) },
  }, async (req) => {
    const ctx = exiger(req);
    return app.bd.transaction(ctx.compteId, async (tx) => {
      await tx.execute(sql`
        INSERT INTO pedagogie.proces_verbal (etablissement_id, classe_id, periode_id, contenu, modifie_par)
        VALUES (${ctx.etablissementId}, ${req.body.classeId}, ${req.body.periodeId}, ${req.body.contenu}, ${ctx.compteId})
        ON CONFLICT (classe_id, periode_id) DO UPDATE SET contenu = EXCLUDED.contenu, modifie_par = EXCLUDED.modifie_par, modifie_le = now()`);
      return { ok: true };
    });
  });

  r.post('/pedagogie/evaluations', {
    config: { permission: 'pedagogie.evaluation.creer' },
    schema: { tags: ['pedagogie'], body: z.object({ sequenceId: Uuid, classeId: Uuid, matiereId: Uuid, faitLe: z.iso.date(), bareme: z.number().int().min(1).max(100) }) },
  }, async (req) => {
    const ctx = exiger(req);
    const b = req.body;
    return app.bd.transaction(ctx.compteId, async (tx) => {
      const t = await titulaire(tx, b.classeId, b.matiereId);
      if (t.personnelId !== ctx.personnelId) throw interdit('pedagogie.evaluation.creer');
      const e = await ligne<{ id: string }>(tx, sql`
        INSERT INTO pedagogie.evaluation (etablissement_id, sequence_id, classe_id, matiere_id, fait_le, bareme, cree_par)
        VALUES (${ctx.etablissementId}, ${b.sequenceId}, ${b.classeId}, ${b.matiereId}, ${b.faitLe}, ${b.bareme}, ${ctx.compteId})
        ON CONFLICT (sequence_id, classe_id, matiere_id) DO UPDATE SET fait_le = EXCLUDED.fait_le, bareme = EXCLUDED.bareme RETURNING id`);
      return { id: e!.id };
    });
  });

  r.get('/pedagogie/periodes', { config: { unePermissionParmi: ['pedagogie.note.lire', 'pedagogie.note.saisir', 'pedagogie.bulletin.lever_blocage', 'pedagogie.conseil.gerer'] }, schema: { tags: ['pedagogie'] } }, async (req) => {
    const ctx = exiger(req);
    const annee = await exigerAnneeOuverte(app.bd, ctx.etablissementId);
    return app.bd.lire(sql`
      SELECT id, ordre, libelle_fr AS "libelleFr", libelle_en AS "libelleEn", tranche_ordre AS "trancheOrdre", statut, date_debut AS "dateDebut", date_fin AS "dateFin"
        FROM structure.periode WHERE annee_id = ${annee.id} ORDER BY ordre`);
  });
}

/** Enregistre (ou remplace) les bulletins en brouillon de la classe ; un bulletin publié reste figé (RG-27). */
/** Texte canonique (clés triées) : jsonb ne conserve pas l'ordre des clés, la comparaison doit en être indépendante. */
const canonique = (v: unknown): string => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x)
  ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : x));

export async function enregistrerBrouillons(tx: Tx, ctx: Contexte, classeId: string, periodeId: string | null): Promise<number> {
  const resultats = await calculerClasse(tx, ctx.etablissementId, classeId, periodeId);
  // Versions publiée et brouillon de toute la classe, lues en une requête ; seuls les bulletins qui changent sont réécrits
  // (calcul, transmission et publication enregistrent tour à tour les mêmes brouillons).
  const existants = await lignes<{ inscription_id: string; statut: string; version: number; resultats: ResultatBulletin }>(tx, sql`
    SELECT inscription_id, statut, version, resultats FROM pedagogie.bulletin
     WHERE inscription_id = ANY(${tableau(resultats.map((r) => r.eleve.inscriptionId))}::uuid[])
       AND periode_id IS NOT DISTINCT FROM ${periodeId}::uuid AND statut IN ('publie', 'brouillon')`);
  const version = (id: string, statut: string) => existants.find((b) => b.inscription_id === id && b.statut === statut);
  for (const r of resultats) {
    const publie = version(r.eleve.inscriptionId, 'publie');
    const brouillon = version(r.eleve.inscriptionId, 'brouillon');
    const texte = canonique(r);
    // Brouillon déjà à jour : rien à réécrire.
    if (brouillon && canonique(brouillon.resultats) === texte) continue;
    if (brouillon) {
      await tx.execute(sql`DELETE FROM pedagogie.bulletin WHERE inscription_id = ${r.eleve.inscriptionId}
                             AND periode_id IS NOT DISTINCT FROM ${periodeId}::uuid AND statut = 'brouillon'`);
    }
    // Rien n'a changé depuis la publication : pas de nouvelle version.
    if (publie && canonique(publie.resultats) === texte) continue;
    await tx.execute(sql`
      INSERT INTO pedagogie.bulletin (etablissement_id, inscription_id, periode_id, version, statut, resultats, moyenne, rang, effectif, appreciation_generale)
      VALUES (${ctx.etablissementId}, ${r.eleve.inscriptionId}, ${periodeId}, ${(publie?.version ?? 0) + 1}, 'brouillon', ${JSON.stringify(r)}::jsonb,
              ${r.moyenne}, ${r.rang}, ${r.effectif}, ${r.appreciationGenerale})`);
  }
  return resultats.length;
}
