// CU-19 · Ouvrir ou fermer une période de saisie ; CU-20 · Saisir les notes (RG-22, RG-23, RG-24, RG-34).
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { sql, ligne, lignes, type Tx } from '../../../core/bd.ts';
import { ErreurMetier, interdit, introuvable } from '../../../core/erreurs.ts';
import { exiger } from '../../../core/session.ts';
import type { Contexte } from '../../../core/contexte.ts';
import { journaliser } from '../../../core/audit.ts';
import { perimetreEnseignant } from '../../../core/perimetre.ts';
import { exigerAnneeOuverte } from '../../structure/index.ts';
import { titulaire, titulairesClasse } from '../index.ts';

const Uuid = z.uuid();
const JOURS = ['', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];

export const libelleStatutSequence = (s: { statut: string; saisie_jusqua: string | null }) =>
  s.statut === 'ouverte' && (!s.saisie_jusqua || s.saisie_jusqua >= aujourdhui()) ? 'ouverte' : s.statut === 'planifiee' ? 'a_venir' : 'fermee';

export const aujourdhui = () => new Date(Date.now() + 3600_000).toISOString().slice(0, 10); // heure du Cameroun (UTC+1)

/** Crée, pour chaque période de l'année, ses séquences et sa composition (décision D-13). */
export async function assurerSequences(tx: Tx, etab: string, anneeId: string) {
  const periodes = await lignes<{ id: string; ordre: number; sequences: string | null; libelle_fr: string; date_fin: string }>(tx, sql`
    SELECT id, ordre, sequences, libelle_fr, date_fin FROM structure.periode WHERE annee_id = ${anneeId} ORDER BY ordre`);
  for (const p of periodes) {
    const numeros = (p.sequences ?? '').match(/\d+/g)?.map(Number) ?? [];
    for (const n of numeros) {
      await tx.execute(sql`
        INSERT INTO pedagogie.sequence (etablissement_id, annee_id, periode_id, numero, libelle_fr, type)
        VALUES (${etab}, ${anneeId}, ${p.id}, ${n}, ${`Séquence ${n}`}, 'devoir') ON CONFLICT DO NOTHING`);
    }
    await tx.execute(sql`
      INSERT INTO pedagogie.sequence (etablissement_id, annee_id, periode_id, numero, libelle_fr, type, prevue_le)
      VALUES (${etab}, ${anneeId}, ${p.id}, 0, ${`Composition du ${p.libelle_fr}`}, 'composition', ${p.date_fin}::date - 4)
      ON CONFLICT DO NOTHING`);
  }
}

export async function routesNotes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  // perimetreEnseignant a besoin de la base : on fournit app.bd au module.
  const perimetreCtx = (ctx: Contexte) => perimetreEnseignant(app.bd, ctx);

  const accesBd = async (tx: Tx, ctx: Contexte, classeId: string, matiereId: string, sequence: { statut: string; saisie_jusqua: string | null } | null) => {
    const t = await titulaire(tx, classeId, matiereId);
    const estTitulaire = !!ctx.personnelId && t.personnelId === ctx.personnelId;
    let lecture = ctx.portee('pedagogie.note.lire') === 'etablissement' || estTitulaire;
    if (!lecture && ctx.portee('pedagogie.note.lire') === 'affectations') {
      lecture = (await perimetreCtx(ctx)).classesPrincipal.some((c) => c.id === classeId);
    }
    let ecriture = ctx.a('pedagogie.note.saisir') && estTitulaire;
    let raison: string | null = null;
    if (!estTitulaire) raison = t.nom ? `Saisie par ${t.nom}` : 'Aucun instituteur affecté';
    else if (!sequence || libelleStatutSequence(sequence) !== 'ouverte') { ecriture = false; raison = 'Saisie fermée'; }
    return { lecture, ecriture, raison, titulaire: t };
  };

  // ------------------------------------------------------------- séquences (CU-19)

  r.get('/pedagogie/sequences', {
    config: { unePermissionParmi: ['pedagogie.note.lire', 'pedagogie.note.saisir', 'pedagogie.periode.ouvrir'] }, schema: { tags: ['pedagogie'] },
  }, async (req) => {
    const ctx = exiger(req);
    const annee = await exigerAnneeOuverte(app.bd, ctx.etablissementId);
    await app.bd.transaction(ctx.compteId, (tx) => assurerSequences(tx, ctx.etablissementId, annee.id));
    const periodes = await app.bd.lire<{ id: string; ordre: number; libelle_fr: string; libelle_en: string }>(sql`
      SELECT id, ordre, libelle_fr, libelle_en FROM structure.periode WHERE annee_id = ${annee.id} ORDER BY ordre`);
    const sequences = await app.bd.lire<{ id: string; periode_id: string; numero: number; libelle_fr: string; type: string; statut: string; saisie_jusqua: string | null; prevue_le: string | null }>(sql`
      SELECT id, periode_id, numero, libelle_fr, type, statut, saisie_jusqua, prevue_le FROM pedagogie.sequence
       WHERE annee_id = ${annee.id} ORDER BY (type = 'composition'), numero`);
    return periodes.map((p) => ({ id: p.id, ordre: p.ordre, libelleFr: p.libelle_fr, libelleEn: p.libelle_en,
      sequences: sequences.filter((s) => s.periode_id === p.id).map((s) => ({ id: s.id, numero: s.numero, libelle: s.libelle_fr, type: s.type,
        statut: libelleStatutSequence(s), saisieJusqua: s.saisie_jusqua, prevueLe: s.prevue_le })) }));
  });

  const changerSequence = (action: 'ouverture' | 'fermeture' | 'deverrouillage') => async (
    req: { params: { id: string }; body: { jusqua?: string | null; motif?: string | null } } & Parameters<typeof exiger>[0]) => {
    const ctx = exiger(req);
    return app.bd.transaction(ctx.compteId, async (tx) => {
      const s = await ligne<{ libelle_fr: string; statut: string; saisie_jusqua: string | null }>(tx, sql`
        SELECT libelle_fr, statut, saisie_jusqua FROM pedagogie.sequence WHERE id = ${req.params.id} AND etablissement_id = ${ctx.etablissementId}`);
      if (!s) throw introuvable('Séquence');
      const avant = libelleStatutSequence(s);
      if (action === 'deverrouillage' && avant !== 'fermee') throw new ErreurMetier('PED_DEJA_OUVERTE', 422, 'La saisie n\'est pas fermée.');
      if (action === 'deverrouillage' && !req.body.motif?.trim()) throw new ErreurMetier('PED_MOTIF_REQUIS', 422, 'Un déverrouillage exige un motif.', 'motif');
      if (action !== 'fermeture' && (!req.body.jusqua || req.body.jusqua < aujourdhui())) {
        throw new ErreurMetier('PED_DATE_FERMETURE', 422, 'Indiquez une date de fermeture à venir.', 'jusqua');
      }
      if (action === 'fermeture') {
        await tx.execute(sql`UPDATE pedagogie.sequence SET statut = 'fermee' WHERE id = ${req.params.id}`);
      } else {
        await tx.execute(sql`UPDATE pedagogie.sequence SET statut = 'ouverte', saisie_jusqua = ${req.body.jusqua!} WHERE id = ${req.params.id}`);
      }
      await journaliser(tx, ctx, { action: 'Modification', objetType: 'Note',
        objetLibelle: `Saisie · ${s.libelle_fr}${action === 'deverrouillage' ? ` · déverrouillage : ${req.body.motif}` : ''}`,
        avant: avant === 'ouverte' ? `Ouverte jusqu'au ${s.saisie_jusqua}` : avant === 'fermee' ? 'Fermée' : 'À venir',
        apres: action === 'fermeture' ? 'Fermée' : `Ouverte jusqu'au ${req.body.jusqua}`, ligneId: req.params.id, table: 'pedagogie.sequence' });
      return { ok: true };
    });
  };
  const Corps = z.object({ jusqua: z.iso.date().nullish(), motif: z.string().trim().max(200).nullish() });
  r.post('/pedagogie/sequences/:id/ouverture', { config: { permission: 'pedagogie.periode.ouvrir' }, schema: { tags: ['pedagogie'], params: z.object({ id: Uuid }), body: Corps } }, changerSequence('ouverture'));
  r.post('/pedagogie/sequences/:id/fermeture', { config: { permission: 'pedagogie.periode.ouvrir' }, schema: { tags: ['pedagogie'], params: z.object({ id: Uuid }), body: Corps } }, changerSequence('fermeture'));
  r.post('/pedagogie/sequences/:id/deverrouillage', { config: { permission: 'pedagogie.periode.deverrouiller' }, schema: { tags: ['pedagogie'], params: z.object({ id: Uuid }), body: Corps } }, changerSequence('deverrouillage'));

  // ------------------------------------------------------------- options de l'écran de saisie

  r.get('/pedagogie/saisie/options', {
    config: { unePermissionParmi: ['pedagogie.note.lire', 'pedagogie.note.saisir'] }, schema: { tags: ['pedagogie'] },
  }, async (req) => {
    const ctx = exiger(req);
    const annee = await exigerAnneeOuverte(app.bd, ctx.etablissementId);
    const p = await perimetreCtx(ctx);
    const toutes = ctx.portee('pedagogie.note.lire') === 'etablissement';
    const classes = await app.bd.lire<{ id: string; nom: string }>(sql`
      SELECT c.id, c.nom FROM structure.classe c JOIN structure.niveau n ON n.id = c.niveau_id
       WHERE c.annee_id = ${annee.id} ORDER BY n.rang, c.nom`);
    const resultat = [];
    for (const c of classes) {
      const estPrincipal = p.classesPrincipal.some((k) => k.id === c.id);
      const sesMatieres = p.matieres.filter((m) => m.classeId === c.id).map((m) => m.matiereId);
      if (!toutes && !estPrincipal && !sesMatieres.length) continue;
      const tit = await app.bd.transaction(null, (tx) => titulairesClasse(tx, c.id));
      const matieres = tit.filter((m) => toutes || estPrincipal || sesMatieres.includes(m.matiere_id))
        .map((m) => ({ id: m.matiere_id, libelle: m.libelle_fr, saisiePar: m.principal ? 'Principal' : m.nom }));
      resultat.push({ id: c.id, nom: c.nom, matieres });
    }
    return { classes: resultat };
  });

  // ------------------------------------------------------------- grille de saisie

  const Requete = z.object({ classeId: Uuid, matiereId: Uuid, sequenceId: Uuid });

  r.get('/pedagogie/saisie', {
    config: { unePermissionParmi: ['pedagogie.note.lire', 'pedagogie.note.saisir'] }, schema: { tags: ['pedagogie'], querystring: Requete },
  }, async (req) => {
    const ctx = exiger(req);
    const { classeId, matiereId, sequenceId } = req.query;
    return app.bd.transaction(null, async (tx) => {
      const seq = await ligne<{ id: string; periode_id: string; libelle_fr: string; type: string; statut: string; saisie_jusqua: string | null; numero: number }>(tx, sql`
        SELECT id, periode_id, libelle_fr, type, statut, saisie_jusqua, numero FROM pedagogie.sequence WHERE id = ${sequenceId} AND etablissement_id = ${ctx.etablissementId}`);
      if (!seq) throw introuvable('Séquence');
      const a = await accesBd(tx, ctx, classeId, matiereId, seq);
      if (!a.lecture) throw interdit('pedagogie.note.lire');
      const classe = await ligne<{ nom: string }>(tx, sql`SELECT nom FROM structure.classe WHERE id = ${classeId}`);
      const matiere = await ligne<{ libelle_fr: string; abrege: string }>(tx, sql`
        SELECT libelle_fr, COALESCE(abrege_fr, libelle_fr) AS abrege FROM pedagogie.matiere WHERE id = ${matiereId}`);
      const evaluation = await ligne<{ id: string; fait_le: string; bareme: number }>(tx, sql`
        SELECT id, fait_le, bareme FROM pedagogie.evaluation WHERE sequence_id = ${sequenceId} AND classe_id = ${classeId} AND matiere_id = ${matiereId}`);
      const eleves = await lignes<{ inscription_id: string; nom: string; valeur: number | null; statut: string | null; remarque: string | null; saisie_par: string | null }>(tx, sql`
        SELECT i.id AS inscription_id, i.nom || ' ' || i.prenoms AS nom, n.valeur, n.statut, n.remarque, n.saisie_par
          FROM reporting.v_inscription i
          LEFT JOIN pedagogie.note n ON n.inscription_id = i.id AND n.evaluation_id = ${evaluation?.id ?? null}
         WHERE i.classe_id = ${classeId} AND i.statut IN ('attente', 'validee')
         ORDER BY i.nom, i.prenoms`);
      const notees = eleves.filter((e) => e.statut && (e.statut !== 'present' || e.valeur !== null));
      const valeurs = eleves.filter((e) => e.statut === 'present' && e.valeur !== null).map((e) => (Number(e.valeur) * 20) / (evaluation?.bareme ?? 20));
      const appreciations = await lignes<{ inscription_id: string; texte: string }>(tx, sql`
        SELECT inscription_id, texte FROM pedagogie.appreciation WHERE periode_id = ${seq.periode_id} AND matiere_id = ${matiereId}`);
      // Avancement de toutes les matières de la classe pour cette séquence (le principal suit tout, RG-34).
      const avancement = (await titulairesClasse(tx, classeId)).map((m) => ({ matiereId: m.matiere_id, matiere: m.abrege, libelle: m.libelle_fr, saisiePar: m.principal ? 'Principal' : m.nom }));
      const comptes = await lignes<{ matiere_id: string; n: number }>(tx, sql`
        SELECT e.matiere_id, count(n.*) FILTER (WHERE n.statut <> 'present' OR n.valeur IS NOT NULL)::int AS n
          FROM pedagogie.evaluation e LEFT JOIN pedagogie.note n ON n.evaluation_id = e.id
         WHERE e.sequence_id = ${sequenceId} AND e.classe_id = ${classeId} GROUP BY e.matiere_id`);
      const evaluations = await lignes<{ id: string; libelle_fr: string; type: string; statut: string; saisie_jusqua: string | null; prevue_le: string | null; n: number }>(tx, sql`
        SELECT s.id, s.libelle_fr, s.type, s.statut, s.saisie_jusqua, s.prevue_le,
               (SELECT count(*)::int FROM pedagogie.evaluation e JOIN pedagogie.note n ON n.evaluation_id = e.id
                 WHERE e.sequence_id = s.id AND e.classe_id = ${classeId} AND e.matiere_id = ${matiereId}
                   AND (n.statut <> 'present' OR n.valeur IS NOT NULL)) AS n
          FROM pedagogie.sequence s WHERE s.periode_id = ${seq.periode_id} ORDER BY (s.type = 'composition'), s.numero`);
      return {
        classe: classe!.nom, matiere: matiere!.libelle_fr, matiereAbrege: matiere!.abrege,
        sequence: { id: seq.id, libelle: seq.libelle_fr, type: seq.type, statut: libelleStatutSequence(seq), saisieJusqua: seq.saisie_jusqua, periodeId: seq.periode_id },
        evaluation: evaluation ? { id: evaluation.id, faitLe: evaluation.fait_le, bareme: evaluation.bareme } : null,
        bareme: evaluation?.bareme ?? 20,
        modifiable: a.ecriture, raison: a.raison, saisiePar: a.titulaire.nom,
        eleves: eleves.map((e, i) => ({ numero: i + 1, inscriptionId: e.inscription_id, nom: e.nom, valeur: e.valeur, statut: e.statut ?? 'present',
          remarque: e.remarque, appreciation: appreciations.find((x) => x.inscription_id === e.inscription_id)?.texte ?? null,
          modifiable: a.ecriture && (!e.saisie_par || e.saisie_par === ctx.compteId) })),
        stats: { saisies: notees.length, total: eleves.length,
          moyenne: valeurs.length ? Math.round((valeurs.reduce((s, v) => s + v, 0) / valeurs.length) * 100) / 100 : null,
          max: valeurs.length ? Math.max(...valeurs) : null, min: valeurs.length ? Math.min(...valeurs) : null },
        manquants: eleves.filter((e) => !e.statut || (e.statut === 'present' && e.valeur === null)).map((e) => e.nom),
        avancement: avancement.map((m) => ({ ...m, notes: comptes.find((c) => c.matiere_id === m.matiereId)?.n ?? 0, total: eleves.length })),
        evaluations: evaluations.map((s) => ({ id: s.id, libelle: s.type === 'composition' ? s.libelle_fr : `${s.libelle_fr} · devoir`,
          statut: libelleStatutSequence(s), saisieJusqua: s.saisie_jusqua, prevueLe: s.prevue_le, notes: s.n, total: eleves.length })),
      };
    });
  });

  const Note = z.object({
    inscriptionId: Uuid, valeur: z.number().min(0).max(100).nullable(),
    statut: z.enum(['present', 'absent', 'absent_justifie', 'dispense']), remarque: z.string().trim().max(200).nullish(),
    appreciation: z.string().trim().max(300).nullish(),
  });

  r.put('/pedagogie/saisie', {
    config: { permission: 'pedagogie.note.saisir' },
    schema: { tags: ['pedagogie'], body: Requete.extend({ faitLe: z.iso.date().optional(), bareme: z.number().int().min(1).max(100).optional(), notes: z.array(Note).max(200) }) },
  }, async (req) => {
    const ctx = exiger(req);
    const b = req.body;
    return app.bd.transaction(ctx.compteId, async (tx) => {
      const seq = await ligne<{ id: string; periode_id: string; libelle_fr: string; statut: string; saisie_jusqua: string | null }>(tx, sql`
        SELECT id, periode_id, libelle_fr, statut, saisie_jusqua FROM pedagogie.sequence WHERE id = ${b.sequenceId} AND etablissement_id = ${ctx.etablissementId}`);
      if (!seq) throw introuvable('Séquence');
      const a = await accesBd(tx, ctx, b.classeId, b.matiereId, seq);
      if (!a.ecriture) {
        if (a.raison === 'Saisie fermée') throw new ErreurMetier('PED_SAISIE_FERMEE', 422, 'La saisie est fermée ; un déverrouillage du préfet est nécessaire.');
        throw interdit('pedagogie.note.saisir');
      }
      let ev = await ligne<{ id: string; bareme: number }>(tx, sql`
        SELECT id, bareme FROM pedagogie.evaluation WHERE sequence_id = ${b.sequenceId} AND classe_id = ${b.classeId} AND matiere_id = ${b.matiereId}`);
      if (!ev) {
        // Première note de la séquence : l'évaluation se crée d'elle-même (décision D-14).
        ev = await ligne<{ id: string; bareme: number }>(tx, sql`
          INSERT INTO pedagogie.evaluation (etablissement_id, sequence_id, classe_id, matiere_id, fait_le, bareme, cree_par)
          VALUES (${ctx.etablissementId}, ${b.sequenceId}, ${b.classeId}, ${b.matiereId}, ${b.faitLe ?? new Date().toISOString().slice(0, 10)}, ${b.bareme ?? 20}, ${ctx.compteId})
          RETURNING id, bareme`);
      }
      const matiere = await ligne<{ libelle_fr: string }>(tx, sql`SELECT libelle_fr FROM pedagogie.matiere WHERE id = ${b.matiereId}`);
      const inscrits = new Set((await lignes<{ id: string }>(tx, sql`
        SELECT id FROM scolarite.inscription WHERE classe_id = ${b.classeId} AND statut IN ('attente', 'validee')`)).map((x) => x.id));
      let enregistrees = 0;
      for (const [i, n] of b.notes.entries()) {
        if (!inscrits.has(n.inscriptionId)) throw new ErreurMetier('PED_ELEVE_HORS_CLASSE', 422, 'Élève hors de la classe.', `notes.${i}`);
        if (n.statut === 'present' && n.valeur !== null && n.valeur > ev!.bareme) {
          throw new ErreurMetier('PED_NOTE_HORS_BAREME', 422, `La note doit être comprise entre 0 et ${ev!.bareme} (RG-23).`, `notes.${i}.valeur`);
        }
        const valeur = n.statut === 'present' ? n.valeur : null;
        const existante = await ligne<{ id: string; valeur: number | null; statut: string; saisie_par: string; nom: string }>(tx, sql`
          SELECT n.id, n.valeur, n.statut, n.saisie_par, i.nom || ' ' || i.prenoms AS nom
            FROM pedagogie.note n JOIN reporting.v_inscription i ON i.id = n.inscription_id
           WHERE n.evaluation_id = ${ev!.id} AND n.inscription_id = ${n.inscriptionId}`);
        if (existante) {
          if (existante.saisie_par !== ctx.compteId) throw new ErreurMetier('PED_NOTE_D_UN_AUTRE', 403, 'Seul l\'auteur d\'une note peut la modifier (RG-22).', `notes.${i}`);
          if (Number(existante.valeur) !== Number(valeur) || existante.statut !== n.statut || (n.remarque ?? null) !== null) {
            await tx.execute(sql`UPDATE pedagogie.note SET valeur = ${valeur}, statut = ${n.statut}, remarque = ${n.remarque ?? null}
                                 WHERE id = ${existante.id}`);
            if (existante.valeur !== null && Number(existante.valeur) !== Number(valeur)) {
              await journaliser(tx, ctx, { action: 'Modification', objetType: 'Note',
                objetLibelle: `Note · ${existante.nom} · ${matiere!.libelle_fr.toLowerCase()}, ${seq.libelle_fr.toLowerCase()}`,
                avant: String(existante.valeur).replace('.', ','), apres: valeur === null ? n.statut : String(valeur).replace('.', ','),
                ligneId: existante.id, table: 'pedagogie.note' });
            }
          }
        } else if (valeur !== null || n.statut !== 'present') {
          await tx.execute(sql`
            INSERT INTO pedagogie.note (etablissement_id, evaluation_id, inscription_id, valeur, statut, remarque, saisie_par)
            VALUES (${ctx.etablissementId}, ${ev!.id}, ${n.inscriptionId}, ${valeur}, ${n.statut}, ${n.remarque ?? null}, ${ctx.compteId})`);
        }
        if (n.appreciation !== undefined) {
          if (n.appreciation) {
            await tx.execute(sql`
              INSERT INTO pedagogie.appreciation (etablissement_id, periode_id, inscription_id, matiere_id, texte, auteur)
              VALUES (${ctx.etablissementId}, ${seq.periode_id}, ${n.inscriptionId}, ${b.matiereId}, ${n.appreciation}, ${ctx.compteId})
              ON CONFLICT (periode_id, inscription_id, matiere_id) DO UPDATE SET texte = EXCLUDED.texte, auteur = EXCLUDED.auteur, modifie_le = now()`);
          }
        }
        enregistrees++;
      }
      return { evaluationId: ev!.id, enregistrees };
    });
  });

  // ------------------------------------------------------------- vue de l'instituteur de matière

  r.get('/pedagogie/mes-classes', { config: { permission: 'pedagogie.note.saisir' }, schema: { tags: ['pedagogie'] } }, async (req) => {
    const ctx = exiger(req);
    const annee = await exigerAnneeOuverte(app.bd, ctx.etablissementId);
    const p = await perimetreCtx(ctx);
    const sequence = await sequenceCourante(app, annee.id);
    const res = [];
    for (const m of p.matieres) {
      const cours = await app.bd.lire<{ jour: number; debut: string; commun: boolean }>(sql`
        SELECT co.jour, to_char(cr.debut, 'HH24:MI') AS debut,
               EXISTS (SELECT 1 FROM pedagogie.cours x WHERE x.creneau_id = co.creneau_id AND x.jour = co.jour AND x.personnel_id = co.personnel_id
                         AND x.classe_id <> co.classe_id) AS commun
          FROM pedagogie.cours co JOIN pedagogie.creneau cr ON cr.id = co.creneau_id
         WHERE co.classe_id = ${m.classeId} AND co.matiere_id = ${m.matiereId} ORDER BY co.jour, cr.debut LIMIT 1`);
      const etat = sequence ? await app.bd.lireUn<{ n: number; total: number }>(sql`
        SELECT (SELECT count(*)::int FROM pedagogie.evaluation e JOIN pedagogie.note n ON n.evaluation_id = e.id
                 WHERE e.sequence_id = ${sequence.id} AND e.classe_id = ${m.classeId} AND e.matiere_id = ${m.matiereId}
                   AND (n.statut <> 'present' OR n.valeur IS NOT NULL)) AS n,
               (SELECT count(*)::int FROM scolarite.inscription WHERE classe_id = ${m.classeId} AND statut IN ('attente', 'validee')) AS total`) : null;
      const c = cours[0];
      res.push({ classeId: m.classeId, classe: m.classeNom, matiereId: m.matiereId, matiere: m.matiereAbrege,
        creneau: c ? `${JOURS[c.jour]} ${c.debut}${c.commun ? ' · cours commun' : ''}` : null,
        notes: etat?.n ?? 0, total: etat?.total ?? 0 });
    }
    return { sequence, classes: res };
  });

  r.get('/pedagogie/sequence-courante', { config: { unePermissionParmi: ['pedagogie.note.lire', 'pedagogie.note.saisir'] }, schema: { tags: ['pedagogie'] } }, async (req) => {
    const ctx = exiger(req);
    const annee = await exigerAnneeOuverte(app.bd, ctx.etablissementId);
    return { sequence: await sequenceCourante(app, annee.id) };
  });

  // Appréciation générale du principal (bulletin) : matière NULL.
  r.put('/pedagogie/appreciations', {
    config: { unePermissionParmi: ['pedagogie.bulletin.apprecier', 'pedagogie.note.saisir'] },
    schema: { tags: ['pedagogie'], body: z.object({ periodeId: Uuid, inscriptionId: Uuid, matiereId: Uuid.nullable(), texte: z.string().trim().max(600) }) },
  }, async (req) => {
    const ctx = exiger(req);
    const b = req.body;
    return app.bd.transaction(ctx.compteId, async (tx) => {
      const insc = await ligne<{ classe_id: string }>(tx, sql`SELECT classe_id FROM scolarite.inscription WHERE id = ${b.inscriptionId} AND etablissement_id = ${ctx.etablissementId}`);
      if (!insc) throw introuvable('Inscription');
      if (b.matiereId === null) {
        const p = await perimetreCtx(ctx);
        if (!ctx.a('pedagogie.bulletin.apprecier') || !p.classesPrincipal.some((c) => c.id === insc.classe_id)) throw interdit('pedagogie.bulletin.apprecier');
      } else {
        const t = await titulaire(tx, insc.classe_id, b.matiereId);
        if (t.personnelId !== ctx.personnelId) throw interdit('pedagogie.note.saisir');
      }
      await tx.execute(sql`
        INSERT INTO pedagogie.appreciation (etablissement_id, periode_id, inscription_id, matiere_id, texte, auteur)
        VALUES (${ctx.etablissementId}, ${b.periodeId}, ${b.inscriptionId}, ${b.matiereId}, ${b.texte}, ${ctx.compteId})
        ON CONFLICT (periode_id, inscription_id, matiere_id) DO UPDATE SET texte = EXCLUDED.texte, auteur = EXCLUDED.auteur, modifie_le = now()`);
      return { ok: true };
    });
  });
}

/** Séquence en cours : la dernière ouverte, sinon la dernière fermée, sinon la première prévue. */
export async function sequenceCourante(app: FastifyInstance, anneeId: string) {
  const s = await app.bd.lire<{ id: string; periode_id: string; numero: number; libelle_fr: string; type: string; statut: string; saisie_jusqua: string | null }>(sql`
    SELECT s.id, s.periode_id, s.numero, s.libelle_fr, s.type, s.statut, s.saisie_jusqua
      FROM pedagogie.sequence s JOIN structure.periode p ON p.id = s.periode_id
     WHERE s.annee_id = ${anneeId} ORDER BY p.ordre, (s.type = 'composition'), s.numero`);
  const etiquette = (x: (typeof s)[number]) => ({ id: x.id, periodeId: x.periode_id, libelle: x.libelle_fr, type: x.type, statut: libelleStatutSequence(x), saisieJusqua: x.saisie_jusqua });
  const ouvertes = s.filter((x) => libelleStatutSequence(x) === 'ouverte');
  if (ouvertes.length) return etiquette(ouvertes[ouvertes.length - 1]!);
  const fermees = s.filter((x) => libelleStatutSequence(x) === 'fermee');
  if (fermees.length) return etiquette(fermees[fermees.length - 1]!);
  return s[0] ? etiquette(s[0]) : null;
}
