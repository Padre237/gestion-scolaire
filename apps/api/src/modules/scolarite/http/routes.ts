// CU-06 à CU-09 : élèves, responsables, inscription, changement de classe, départ, listes (SCO-01 à SCO-11).
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { sql, ligne, tableau, type Tx } from '../../../core/bd.ts';
import { ErreurMetier, interdit, introuvable } from '../../../core/erreurs.ts';
import { exiger } from '../../../core/session.ts';
import type { Contexte } from '../../../core/contexte.ts';
import { journaliser } from '../../../core/audit.ts';
import { emettre } from '../../../core/evenements.ts';
import { classesAccessibles } from '../../../core/perimetre.ts';
import { hacher, motDePasseAleatoire } from '../../../core/motdepasse.ts';
import { versCsv } from '../../../core/csv.ts';
import { classeInfo, cleCompteur, exigerAnneeOuverte, FORMATS, prochainNumero, anneeOuverteTx } from '../../structure/index.ts';
import { chiffres, formatTelephone, inscription } from '../index.ts';
import '../index.ts';
import { pdfCartesScolaires, pdfCertificat, pdfFicheInscription, pdfListeClasse, pdfTableau } from '@gs/print';
import { joindrePieces, preparerRenseignements, renseignementsLisibles, routesFormulaire } from './formulaire.ts';
import { routesFiche } from './fiche.ts';

const Uuid = z.uuid();
const LIENS: Record<string, string> = { mere: 'Mère', pere: 'Père', tuteur: 'Tuteur' };

const Responsable = z.object({
  nom: z.string().trim().min(2).max(80),
  lien: z.enum(['mere', 'pere', 'tuteur']),
  telephone: z.string().trim().transform(chiffres).pipe(z.string().regex(/^\d{8,12}$/, 'Numéro incomplet')),
  langue: z.enum(['fr', 'en']),
  payeur: z.boolean(),
  recoitSms: z.boolean(),
});

const NouvelEleve = z.object({
  nom: z.string().trim().min(1).max(60).transform((s) => s.toUpperCase()),
  prenoms: z.string().trim().min(1).max(80),
  sexe: z.enum(['M', 'F']),
  dateNaissance: z.iso.date(),
  lieuNaissance: z.string().trim().max(80).nullish(),
  photo: z.string().max(7_100_000).nullish(),
});

export async function routesScolarite(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  await routesFormulaire(app);

  const filtreClasses = async (ctx: Contexte) => classesAccessibles(app.bd, ctx, 'scolarite.eleve.consulter');

  // ------------------------------------------------------------- liste et recherche (SCO-05)

  const Filtre = z.object({
    q: z.string().trim().max(60).optional(), classeId: Uuid.optional(), situation: z.enum(['a_jour', 'en_retard', 'solde']).optional(),
    page: z.coerce.number().int().min(1).default(1), taille: z.coerce.number().int().min(1).max(1000).default(12),
  });

  const requeteListe = (etab: string, anneeId: string, classes: 'toutes' | string[], f: z.infer<typeof Filtre>) => sql`
      FROM reporting.v_inscription i
      JOIN reporting.v_solde s ON s.inscription_id = i.id
      LEFT JOIN LATERAL (
        SELECT r.nom, r.telephone FROM scolarite.eleve_responsable er JOIN scolarite.responsable r ON r.id = er.responsable_id
         WHERE er.eleve_id = i.eleve_id ORDER BY er.payeur DESC, er.ordre LIMIT 1) p ON true
     WHERE i.etablissement_id = ${etab} AND i.annee_id = ${anneeId} AND i.statut IN ('attente', 'validee')
       AND (${classes === 'toutes'} OR i.classe_id = ANY(${tableau(classes === 'toutes' ? [] : classes)}::uuid[]))
       AND (${f.classeId ?? null}::uuid IS NULL OR i.classe_id = ${f.classeId ?? null}::uuid)
       AND (${f.q ?? null}::text IS NULL
            OR core.sans_accent(i.nom || ' ' || i.prenoms) LIKE '%' || core.sans_accent(${f.q ?? ''}) || '%'
            OR core.sans_accent(i.prenoms || ' ' || i.nom) LIKE '%' || core.sans_accent(${f.q ?? ''}) || '%'
            OR lower(i.matricule) = lower(${f.q ?? ''})
            OR (length(regexp_replace(${f.q ?? ''}, '\\D', '', 'g')) >= 3 AND EXISTS (
                  SELECT 1 FROM scolarite.eleve_responsable er JOIN scolarite.responsable r ON r.id = er.responsable_id
                   WHERE er.eleve_id = i.eleve_id AND r.telephone LIKE '%' || regexp_replace(${f.q ?? ''}, '\\D', '', 'g') || '%')))
       AND (${f.situation ?? null}::text IS NULL
            OR (${f.situation ?? null} = 'solde' AND s.reste = 0)
            OR (${f.situation ?? null} = 'en_retard' AND s.echu > 0)
            OR (${f.situation ?? null} = 'a_jour' AND s.reste > 0 AND s.echu = 0))`;

  r.get('/scolarite/eleves', { config: { permission: 'scolarite.eleve.consulter' }, schema: { tags: ['scolarite'], querystring: Filtre } }, async (req) => {
    const ctx = exiger(req);
    const f = req.query;
    const annee = await exigerAnneeOuverte(app.bd, ctx.etablissementId);
    const classes = await filtreClasses(ctx);
    const total = await app.bd.lireUn<{ n: number }>(sql`SELECT count(*)::int AS n ${requeteListe(ctx.etablissementId, annee.id, classes, f)}`);
    const lignesL = await app.bd.lire(sql`
      SELECT i.id AS "inscriptionId", i.eleve_id AS "eleveId", i.matricule, i.nom || ' ' || i.prenoms AS nom, i.classe, i.sexe,
             i.date_naissance AS "dateNaissance", p.nom AS payeur, p.telephone AS "payeurTelephone",
             CASE WHEN s.reste = 0 THEN 'solde' WHEN s.echu > 0 THEN 'en_retard' ELSE 'a_jour' END AS situation, s.reste AS "resteDu"
      ${requeteListe(ctx.etablissementId, annee.id, classes, f)}
      ORDER BY i.nom, i.prenoms LIMIT ${f.taille} OFFSET ${(f.page - 1) * f.taille}`);
    const listeClasses = await app.bd.lire(sql`
      SELECT c.id, c.nom FROM structure.classe c JOIN structure.niveau n ON n.id = c.niveau_id
       WHERE c.annee_id = ${annee.id} AND (${classes === 'toutes'} OR c.id = ANY(${tableau(classes === 'toutes' ? [] : classes)}::uuid[]))
       ORDER BY n.rang, c.nom`);
    return { annee: annee.libelle, total: total!.n, page: f.page, taille: f.taille,
      lignes: lignesL.map((l) => ({ ...(l as Record<string, unknown>), payeurTelephone: formatTelephone((l as { payeurTelephone: string | null }).payeurTelephone) })),
      classes: listeClasses };
  });

  r.get('/scolarite/eleves/export', { config: { permission: 'scolarite.eleve.exporter' }, schema: { tags: ['scolarite'], querystring: Filtre.omit({ page: true, taille: true }).extend({ format: z.enum(['csv', 'pdf']).default('csv') }) } }, async (req, rep) => {
    const ctx = exiger(req);
    const annee = await exigerAnneeOuverte(app.bd, ctx.etablissementId);
    const rows = await app.bd.lire<Record<string, unknown>>(sql`
      SELECT i.matricule AS "Matricule", i.nom || ' ' || i.prenoms AS "Nom et prénoms", i.classe AS "Classe", i.sexe AS "Sexe",
             to_char(i.date_naissance, 'DD/MM/YYYY') AS "Né(e) le", p.nom AS "Responsable payeur", p.telephone AS "Téléphone",
             CASE WHEN s.reste = 0 THEN 'Soldé' WHEN s.echu > 0 THEN 'En retard' ELSE 'À jour' END AS "Situation", s.reste AS "Reste dû"
      ${requeteListe(ctx.etablissementId, annee.id, 'toutes', { ...req.query, page: 1, taille: 1000 })} ORDER BY i.nom, i.prenoms`);
    await app.bd.transaction(ctx.compteId, (tx) => journaliser(tx, ctx, { action: 'Export', objetType: 'Élève',
      objetLibelle: `Export de la liste des élèves · ${rows.length} lignes`, avant: '–', apres: req.query.format.toUpperCase() }));
    if (req.query.format === 'pdf') {
      const etab = await app.bd.lireUn<{ nom_fr: string; nom_en: string; ville_bp: string | null; telephone: string | null }>(sql`
        SELECT nom_fr, nom_en, ville_bp, telephone FROM structure.etablissement WHERE id = ${ctx.etablissementId}`);
      const cles = ['Matricule', 'Nom et prénoms', 'Classe', 'Sexe', 'Né(e) le', 'Responsable payeur', 'Situation', 'Reste dû'];
      const pdf = await pdfTableau({ etablissement: etab!, titre: `ÉLÈVES INSCRITS EN ${annee.libelle}`, sousTitre: `${rows.length} élèves`,
        colonnes: cles.map((c, i) => ({ titre: c, largeur: [70, 170, 60, 35, 70, 150, 70, 70][i]!, droite: i === 7 })),
        lignes: rows.map((r) => cles.map((c) => String(r[c] ?? ''))) });
      return rep.type('application/pdf').header('content-disposition', 'inline; filename="eleves.pdf"').send(Buffer.from(pdf));
    }
    return rep.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', 'attachment; filename="eleves.csv"').send(versCsv(rows));
  });

  // Recherche globale Ctrl K (conception § 10)
  r.get('/scolarite/recherche', { config: { permission: 'scolarite.eleve.consulter' }, schema: { tags: ['scolarite'], querystring: z.object({ q: z.string().trim().min(1).max(60) }) } }, async (req) => {
    const ctx = exiger(req);
    const annee = await exigerAnneeOuverte(app.bd, ctx.etablissementId);
    const classes = await filtreClasses(ctx);
    return app.bd.lire(sql`
      SELECT i.id AS "inscriptionId", i.eleve_id AS "eleveId", i.matricule, i.nom || ' ' || i.prenoms AS nom, i.classe
      ${requeteListe(ctx.etablissementId, annee.id, classes, { q: req.query.q, page: 1, taille: 8 })}
      ORDER BY similarity(core.sans_accent(i.nom || ' ' || i.prenoms), core.sans_accent(${req.query.q})) DESC, i.nom LIMIT 8`);
  });

  // ------------------------------------------------------------- fiche élève

  async function exigerEleveAccessible(ctx: Contexte, eleveId: string) {
    const classes = await filtreClasses(ctx);
    if (classes === 'toutes') return;
    const i = await app.bd.lireUn(sql`
      SELECT 1 FROM scolarite.inscription WHERE eleve_id = ${eleveId} AND statut IN ('attente', 'validee') AND classe_id = ANY(${tableau(classes)}::uuid[])`);
    if (!i) throw interdit('scolarite.eleve.consulter');
  }
  await routesFiche(app, exigerEleveAccessible);

  r.get('/scolarite/eleves/:id', { config: { permission: 'scolarite.eleve.consulter' }, schema: { tags: ['scolarite'], params: z.object({ id: Uuid }) } }, async (req) => {
    const ctx = exiger(req);
    await exigerEleveAccessible(ctx, req.params.id);
    const e = await app.bd.lireUn<Record<string, unknown>>(sql`
      SELECT e.id, e.matricule, e.nom, e.prenoms, e.sexe, e.date_naissance AS "dateNaissance", e.lieu_naissance AS "lieuNaissance",
             e.photo IS NOT NULL AS "aPhoto", e.famille_id AS "familleId", e.renseignements
        FROM scolarite.eleve e WHERE e.id = ${req.params.id} AND e.etablissement_id = ${ctx.etablissementId}`);
    if (!e) throw introuvable('Élève');
    // Réponses brutes (formulaire de mise à jour) et lisibles, bloc par bloc (fiche).
    e['renseignementsBruts'] = e['renseignements'] ?? {};
    e['renseignements'] = await renseignementsLisibles((q) => app.bd.lire(q), ctx.etablissementId, (e['renseignements'] ?? {}) as Record<string, unknown>);
    const insc = await app.bd.lireUn<Record<string, unknown>>(sql`
      SELECT i.id, i.classe_id AS "classeId", c.nom AS classe, cy.sous_systeme AS "sousSysteme", i.type, i.tarif, i.statut,
             i.inscrit_le AS "inscritLe", a.libelle AS annee
        FROM scolarite.inscription i JOIN structure.classe c ON c.id = i.classe_id JOIN structure.niveau n ON n.id = c.niveau_id
        JOIN structure.cycle cy ON cy.id = n.cycle_id JOIN structure.annee_scolaire a ON a.id = i.annee_id
       WHERE i.eleve_id = ${req.params.id} ORDER BY (i.statut IN ('attente', 'validee')) DESC, i.inscrit_le DESC LIMIT 1`);
    const responsables = await app.bd.lire<{ id: string; nom: string; lien: string; telephone: string; langue: string; payeur: boolean; recoit_sms: boolean }>(sql`
      SELECT r.id, r.nom, er.lien, r.telephone, r.langue, er.payeur, er.recoit_sms
        FROM scolarite.eleve_responsable er JOIN scolarite.responsable r ON r.id = er.responsable_id
       WHERE er.eleve_id = ${req.params.id} ORDER BY er.payeur DESC, er.ordre`);
    // Contacts des parents : visibles pour l'instituteur de matière aussi (RG-34).
    return { ...e, inscription: insc ?? null,
      responsables: responsables.map((x) => ({ id: x.id, nom: x.nom, lien: x.lien, lienLibelle: LIENS[x.lien], telephone: formatTelephone(x.telephone),
        langue: x.langue, payeur: x.payeur, recoitSms: x.recoit_sms })) };
  });

  r.get('/scolarite/eleves/:id/photo', { config: { permission: 'scolarite.eleve.consulter' }, schema: { tags: ['scolarite'], params: z.object({ id: Uuid }) } }, async (req, rep) => {
    const ctx = exiger(req);
    await exigerEleveAccessible(ctx, req.params.id);
    const e = await app.bd.lireUn<{ photo: Buffer | null }>(sql`SELECT photo FROM scolarite.eleve WHERE id = ${req.params.id} AND etablissement_id = ${ctx.etablissementId}`);
    if (!e?.photo) throw introuvable('Photo');
    return rep.type(e.photo[0] === 0x89 ? 'image/png' : 'image/jpeg').send(e.photo);
  });

  // Photos jointes au dossier (formulaire d'inscription, D-42).
  r.get('/scolarite/eleves/:id/pieces/:piece', {
    config: { permission: 'scolarite.eleve.consulter' }, schema: { tags: ['scolarite'], params: z.object({ id: Uuid, piece: Uuid }) },
  }, async (req, rep) => {
    const ctx = exiger(req);
    await exigerEleveAccessible(ctx, req.params.id);
    const p = await app.bd.lireUn<{ type_mime: string; contenu: Buffer }>(sql`
      SELECT type_mime, contenu FROM scolarite.piece_eleve WHERE id = ${req.params.piece} AND eleve_id = ${req.params.id} AND etablissement_id = ${ctx.etablissementId}`);
    if (!p) throw introuvable('Pièce');
    return rep.type(p.type_mime).header('cache-control', 'private, max-age=3600').send(p.contenu);
  });

  r.get('/scolarite/eleves/:id/historique', { config: { permission: 'scolarite.eleve.consulter' }, schema: { tags: ['scolarite'], params: z.object({ id: Uuid }) } }, async (req) => {
    const ctx = exiger(req);
    await exigerEleveAccessible(ctx, req.params.id);
    return app.bd.lire(sql`
      SELECT j.action, j.objet_type AS "objetType", j.objet_libelle AS objet, j.avant_libelle AS avant, j.apres_libelle AS apres,
             j.horodatage, COALESCE(c.nom_affiche, 'Système') AS utilisateur
        FROM core.journal_audit j LEFT JOIN core.compte c ON c.id = j.utilisateur_id
       WHERE j.eleve_id = ${req.params.id} AND j.etablissement_id = ${ctx.etablissementId} AND j.nature = 'metier'
       ORDER BY j.horodatage DESC LIMIT 20`);
  });

  // Résumé pour l'instituteur de matière (maquette Instituteur-matiere, RG-34).
  r.get('/scolarite/inscriptions/:id/resume', {
    config: { permission: 'scolarite.eleve.consulter' },
    schema: { tags: ['scolarite'], params: z.object({ id: Uuid }), querystring: z.object({ matiereExclue: Uuid.optional() }) },
  }, async (req) => {
    const ctx = exiger(req);
    const i = await app.bd.lireUn<{ eleve_id: string; nom: string; classe: string; date_naissance: string; classe_id: string; sexe: string }>(sql`
      SELECT eleve_id, nom || ' ' || prenoms AS nom, classe, date_naissance, classe_id, sexe FROM reporting.v_inscription
       WHERE id = ${req.params.id} AND etablissement_id = ${ctx.etablissementId}`);
    if (!i) throw introuvable('Élève');
    await exigerEleveAccessible(ctx, i.eleve_id);
    const payeur = await app.bd.lireUn<{ nom: string; telephone: string }>(sql`
      SELECT r.nom, r.telephone FROM scolarite.eleve_responsable er JOIN scolarite.responsable r ON r.id = er.responsable_id
       WHERE er.eleve_id = ${i.eleve_id} ORDER BY er.payeur DESC LIMIT 1`);
    const sanctions = await app.bd.lireUn<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM reporting.v_observation o
        JOIN structure.periode p ON o.survenu_le BETWEEN p.date_debut AND p.date_fin AND current_date BETWEEN p.date_debut AND p.date_fin
       WHERE o.inscription_id = ${req.params.id} AND o.sanction IS NOT NULL`);
    const moyenne = await app.bd.lireUn<{ m: number | null }>(sql`
      SELECT round(avg(n.sur_20), 2) AS m FROM reporting.v_note n
        JOIN structure.periode p ON p.id = n.periode_id AND current_date BETWEEN p.date_debut AND p.date_fin + 30
       WHERE n.inscription_id = ${req.params.id} AND (${req.query.matiereExclue ?? null}::uuid IS NULL OR n.matiere_id <> ${req.query.matiereExclue ?? null}::uuid)`);
    // Suivi de la fiche : moyenne de la dernière séquence notée, absences de la période (en demi-journées, E-33).
    const seq = await app.bd.lireUn<{ libelle: string; m: number }>(sql`
      SELECT s.libelle_fr AS libelle, round(avg(n.sur_20), 2) AS m FROM reporting.v_note n
        JOIN pedagogie.sequence s ON s.periode_id = n.periode_id AND s.numero = n.sequence AND s.type = n.type_sequence
       WHERE n.inscription_id = ${req.params.id} AND n.sur_20 IS NOT NULL
       GROUP BY s.id, s.libelle_fr, s.numero ORDER BY s.numero DESC LIMIT 1`);
    const abs = await app.bd.lireUn<{ n: number }>(sql`
      SELECT count(DISTINCT (jour, debut < '12:00'))::int AS n FROM reporting.v_absence WHERE inscription_id = ${req.params.id}`);
    return { eleveId: i.eleve_id, nom: i.nom, classe: i.classe, sexe: i.sexe, dateNaissance: i.date_naissance,
      responsable: payeur ? `${payeur.nom} · ${formatTelephone(payeur.telephone)}` : null,
      sanctions: sanctions?.n ?? 0, moyenneAutres: moyenne?.m ?? null,
      sequence: seq?.libelle ?? null, moyenneSequence: seq?.m ?? null, absencesDemiJournees: abs?.n ?? 0 };
  });

  // ------------------------------------------------------------- inscription (CU-06, CU-07)

  // RG-09 : nom, prénoms et date de naissance proches déclenchent une alerte.
  r.get('/scolarite/doublons', {
    config: { permission: 'scolarite.inscription.creer' },
    schema: { tags: ['scolarite'], querystring: z.object({ nom: z.string().trim().min(1), prenoms: z.string().trim().min(1), dateNaissance: z.iso.date() }) },
  }, async (req) => {
    const ctx = exiger(req);
    const q = req.query;
    return app.bd.lire(sql`
      SELECT e.id, e.nom, e.prenoms, e.matricule, e.date_naissance AS "dateNaissance", c.nom AS classe
        FROM scolarite.eleve e
        LEFT JOIN scolarite.inscription i ON i.eleve_id = e.id AND i.statut IN ('attente', 'validee')
        LEFT JOIN structure.classe c ON c.id = i.classe_id
       WHERE e.etablissement_id = ${ctx.etablissementId} AND e.date_naissance = ${q.dateNaissance}
         AND similarity(core.sans_accent(e.nom || ' ' || e.prenoms), core.sans_accent(${q.nom} || ' ' || ${q.prenoms})) > 0.45
       ORDER BY similarity(core.sans_accent(e.nom || ' ' || e.prenoms), core.sans_accent(${q.nom} || ' ' || ${q.prenoms})) DESC LIMIT 3`);
  });

  r.get('/scolarite/familles/telephone/:telephone', {
    config: { permission: 'scolarite.inscription.creer' }, schema: { tags: ['scolarite'], params: z.object({ telephone: z.string().max(30) }) },
  }, async (req) => {
    const ctx = exiger(req);
    const tel = chiffres(req.params.telephone);
    const f = await app.bd.lireUn<{ famille_id: string; compte: boolean }>(sql`
      SELECT r.famille_id, EXISTS (SELECT 1 FROM core.compte c WHERE c.famille_id = r.famille_id) AS compte
        FROM scolarite.responsable r WHERE r.etablissement_id = ${ctx.etablissementId} AND r.telephone = ${tel} LIMIT 1`);
    if (!f) return { famille: null };
    const enfants = await app.bd.lire(sql`
      SELECT e.nom || ' ' || e.prenoms AS nom, e.prenoms, c.nom AS classe FROM scolarite.eleve e
        LEFT JOIN scolarite.inscription i ON i.eleve_id = e.id AND i.statut IN ('attente', 'validee') LEFT JOIN structure.classe c ON c.id = i.classe_id
       WHERE e.famille_id = ${f.famille_id}`);
    return { famille: { id: f.famille_id, compte: f.compte, telephone: formatTelephone(tel), enfants } };
  });

  const CorpsInscription = z.object({
    eleveId: Uuid.optional(), eleve: NouvelEleve.optional(),
    responsables: z.array(Responsable).min(1).max(4).optional(),
    classeId: Uuid, type: z.enum(['nouvelle', 'reinscription', 'redoublement']), tarif: z.enum(['nouveau', 'ancien']),
    doublonEcarte: z.boolean().default(false),
    /** Réponses aux champs du formulaire d'inscription (D-42) : { code: valeur } ; une photo est { base64, nom }. */
    renseignements: z.record(z.string(), z.unknown()).default({}),
  });
  type Inscription = Omit<z.infer<typeof CorpsInscription>, 'renseignements'> & { renseignements?: Record<string, unknown>; matricule?: string | null };

  /** Inscription d'un élève (CU-06, CU-07) : commune à l'écran Inscription et à l'import (écran Données, import:csv). */
  async function inscrire(tx: Tx, ctx: Contexte, b: Inscription, options: { formulaire?: boolean } = {}) {
    if (!b.eleveId && (!b.eleve || !b.responsables)) throw new ErreurMetier('SCO_ELEVE_REQUIS', 422, 'Identité et responsables requis pour un nouvel élève.');
    if (b.responsables && b.responsables.filter((x) => x.payeur).length !== 1) {
      throw new ErreurMetier('SCO_UN_PAYEUR', 422, 'Il faut exactement un payeur principal (RG-08).', 'responsables');
    }
    const annee = await anneeOuverteTx(tx, ctx.etablissementId);
    const classe = await classeInfo(tx, b.classeId, ctx.etablissementId);
    if (!classe || classe.annee_id !== annee.id) throw new ErreurMetier('SCO_CLASSE_HORS_ANNEE', 422, 'La classe doit appartenir à l\'année ouverte (RG-06).', 'classeId');
    const grille = await ligne<{ n: number }>(tx, sql`
      SELECT count(l.*)::int AS n FROM finances.grille_frais g JOIN finances.ligne_grille l ON l.grille_id = g.id
       WHERE g.annee_id = ${annee.id} AND g.niveau_id = ${classe.niveau_id} AND g.statut_eleve = ${b.tarif}`);
    if (!grille!.n) throw new ErreurMetier('SCO_GRILLE_ABSENTE', 422, `Aucune grille des frais pour le niveau ${classe.niveau_code} (CU-07).`, 'classeId');
    let eleveId = b.eleveId;
    let familleId: string;
    let compteFamille: { cree: boolean; telephone: string; motDePasse?: string } | null = null;
    let matricule: string;
    if (eleveId) {
      const e = await ligne<{ famille_id: string; matricule: string }>(tx, sql`SELECT famille_id, matricule FROM scolarite.eleve WHERE id = ${eleveId} AND etablissement_id = ${ctx.etablissementId}`);
      if (!e) throw introuvable('Élève');
      familleId = e.famille_id;
      matricule = e.matricule; // RG-04 : le matricule ne change jamais
    } else {
      const ev = b.eleve!;
      if (!b.doublonEcarte) {
        const d = await ligne<{ nom: string }>(tx, sql`
          SELECT nom || ' ' || prenoms AS nom FROM scolarite.eleve WHERE etablissement_id = ${ctx.etablissementId}
             AND date_naissance = ${ev.dateNaissance} AND core.sans_accent(nom) = core.sans_accent(${ev.nom})
             AND core.sans_accent(prenoms) = core.sans_accent(${ev.prenoms})`);
        if (d) throw new ErreurMetier('SCO_DOUBLON', 409, `Un élève identique existe déjà : ${d.nom} (RG-09).`);
      }
      const payeur = b.responsables!.find((x) => x.payeur)!;
      const existante = await ligne<{ famille_id: string }>(tx, sql`
        SELECT famille_id FROM scolarite.responsable WHERE etablissement_id = ${ctx.etablissementId}
           AND telephone = ANY(${tableau(b.responsables!.map((x) => x.telephone))}::text[])
         ORDER BY (telephone = ${payeur.telephone}) DESC LIMIT 1`);
      if (existante) {
        familleId = existante.famille_id;
      } else {
        familleId = (await ligne<{ id: string }>(tx, sql`
          INSERT INTO scolarite.famille (etablissement_id, nom, cree_par) VALUES (${ctx.etablissementId}, ${ev.nom}, ${ctx.compteId}) RETURNING id`))!.id;
      }
      if (b.matricule) {
        // Import d'un élève déjà connu de l'école : il garde le matricule de son année d'entrée (RG-04).
        const pris = await ligne(tx, sql`SELECT 1 FROM scolarite.eleve WHERE etablissement_id = ${ctx.etablissementId} AND matricule = ${b.matricule}`);
        if (pris) throw new ErreurMetier('SCO_MATRICULE_PRIS', 409, `Le matricule ${b.matricule} est déjà attribué.`, 'matricule');
        matricule = b.matricule;
      } else {
        const numero = await prochainNumero(tx, ctx.etablissementId, cleCompteur.matricule(annee.annee_civile, classe.code_section));
        matricule = FORMATS.matricule(annee.annee_civile, classe.code_section, numero);
      }
      const photo = ev.photo ? Buffer.from(ev.photo, 'base64') : null;
      // Formulaire configuré par l'établissement : contrôlé et écrit avec la fiche, pour une inscription faite à l'écran (pas pour l'import).
      const rens = options.formulaire ? await preparerRenseignements(tx, ctx.etablissementId, b.renseignements ?? {}) : { valeurs: {}, pieces: [] };
      eleveId = (await ligne<{ id: string }>(tx, sql`
        INSERT INTO scolarite.eleve (etablissement_id, matricule, nom, prenoms, sexe, date_naissance, lieu_naissance, photo, famille_id, renseignements, cree_par)
        VALUES (${ctx.etablissementId}, ${matricule}, ${ev.nom}, ${ev.prenoms}, ${ev.sexe}, ${ev.dateNaissance}, ${ev.lieuNaissance ?? null},
                ${photo}, ${familleId}, ${JSON.stringify(rens.valeurs)}::jsonb, ${ctx.compteId}) RETURNING id`))!.id;
      await joindrePieces(tx, ctx, eleveId, rens.pieces);
      let ordre = 1;
      for (const resp of b.responsables!) {
        let rid = (await ligne<{ id: string }>(tx, sql`
          SELECT id FROM scolarite.responsable WHERE famille_id = ${familleId} AND telephone = ${resp.telephone}`))?.id;
        if (!rid) {
          rid = (await ligne<{ id: string }>(tx, sql`
            INSERT INTO scolarite.responsable (etablissement_id, famille_id, nom, telephone, langue, cree_par)
            VALUES (${ctx.etablissementId}, ${familleId}, ${resp.nom}, ${resp.telephone}, ${resp.langue}, ${ctx.compteId}) RETURNING id`))!.id;
        }
        await tx.execute(sql`INSERT INTO scolarite.eleve_responsable (eleve_id, responsable_id, lien, payeur, recoit_sms, ordre)
                             VALUES (${eleveId}, ${rid}, ${resp.lien}, ${resp.payeur}, ${resp.recoitSms}, ${ordre++})`);
      }
      // RG-35 : un compte par famille, créé à l'inscription ; le mot de passe est imprimé sur la fiche.
      const compte = await ligne<{ identifiant: string }>(tx, sql`SELECT identifiant FROM core.compte WHERE famille_id = ${familleId}`);
      if (compte) {
        compteFamille = { cree: false, telephone: formatTelephone(compte.identifiant) };
      } else {
        const motDePasse = motDePasseAleatoire(8);
        const c = await ligne<{ id: string }>(tx, sql`
          INSERT INTO core.compte (etablissement_id, identifiant, nom_affiche, mot_de_passe, type, famille_id, cree_par)
          VALUES (${ctx.etablissementId}, ${payeur.telephone}, ${`Famille ${ev.nom}`}, ${await hacher(motDePasse)}, 'famille', ${familleId}, ${ctx.compteId})
          RETURNING id`);
        await tx.execute(sql`INSERT INTO core.compte_role (etablissement_id, compte_id, role_id)
                             SELECT ${ctx.etablissementId}, ${c!.id}, id FROM core.role WHERE etablissement_id = ${ctx.etablissementId} AND code = 'parent'`);
        compteFamille = { cree: true, telephone: formatTelephone(payeur.telephone), motDePasse };
      }
    }
    // RG-05 : au plus une inscription active par année (index unique) ; RG-06 : effectif maximal.
    const actif = await ligne(tx, sql`SELECT 1 FROM scolarite.inscription WHERE eleve_id = ${eleveId} AND annee_id = ${annee.id} AND statut IN ('attente', 'validee')`);
    if (actif) throw new ErreurMetier('SCO_DEJA_INSCRIT', 409, 'Cet élève a déjà une inscription active cette année (RG-05) : changez-le de classe.');
    const effectif = await ligne<{ n: number }>(tx, sql`SELECT count(*)::int AS n FROM scolarite.inscription WHERE classe_id = ${b.classeId} AND statut IN ('attente', 'validee')`);
    const pleine = effectif!.n >= classe.effectif_max;
    const insc = await ligne<{ id: string }>(tx, sql`
      INSERT INTO scolarite.inscription (etablissement_id, annee_id, eleve_id, classe_id, type, tarif, statut, cree_par)
      VALUES (${ctx.etablissementId}, ${annee.id}, ${eleveId}, ${b.classeId}, ${b.type}, ${b.tarif}, 'attente', ${ctx.compteId}) RETURNING id`);
    await emettre(tx, ctx, 'inscription.creee', { inscriptionId: insc!.id, eleveId: eleveId!, classeId: b.classeId, niveauId: classe.niveau_id, anneeId: annee.id, tarif: b.tarif });
    const nom = b.eleve ? `${b.eleve.nom} ${b.eleve.prenoms}` : (await ligne<{ n: string }>(tx, sql`SELECT nom || ' ' || prenoms AS n FROM scolarite.eleve WHERE id = ${eleveId}`))!.n;
    if (pleine) {
      await tx.execute(sql`
        INSERT INTO finances.demande (etablissement_id, type, inscription_id, objet, motif, demandeur)
        VALUES (${ctx.etablissementId}, 'derogation', ${insc!.id}, ${`dépassement d'effectif (${classe.effectif_max} places)`},
                ${`Classe ${classe.nom} complète : ${effectif!.n} élèves sur ${classe.effectif_max}`}, ${ctx.compteId})`);
    }
    await journaliser(tx, ctx, { action: 'Création', objetType: 'Élève', objetLibelle: `Inscription · ${nom}`,
      avant: '–', apres: `Inscription en ${classe.nom}${pleine ? ' · dérogation demandée' : ''}`, eleveId, ligneId: insc!.id, table: 'scolarite.inscription' });
    return { inscriptionId: insc!.id, eleveId, matricule, classe: classe.nom, compteFamille, derogationDemandee: pleine };
  }

  r.post('/scolarite/inscriptions', {
    config: { permission: 'scolarite.inscription.creer' },
    bodyLimit: 40_000_000,
    schema: { tags: ['scolarite'], body: CorpsInscription },
  }, async (req) => {
    const ctx = exiger(req);
    return app.bd.transaction(ctx.compteId, (tx) => inscrire(tx, ctx, req.body, { formulaire: true }));
  });

  // ------------------------------------------------------------- import (écran Données, commande import:csv, IMPORT.md)

  const LigneImport = z.object({
    ligne: z.number().int().min(1), matricule: z.string().trim().max(20).nullish(),
    nom: z.string().trim().max(60).default(''), prenoms: z.string().trim().max(80).default(''), sexe: z.string().trim().max(10).default(''),
    dateNaissance: z.string().trim().max(20).default(''), lieuNaissance: z.string().trim().max(80).nullish(), classe: z.string().trim().max(40).default(''),
    type: z.string().trim().max(20).nullish(), responsable: z.string().trim().max(80).default(''), lien: z.string().trim().max(20).nullish(),
    telephone: z.string().trim().max(30).default(''), langue: z.string().trim().max(10).nullish(),
    responsable2: z.string().trim().max(80).nullish(), lien2: z.string().trim().max(20).nullish(), telephone2: z.string().trim().max(30).nullish(),
  });

  const sansAccent = (x: string) => x.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  const sexeDe = (x: string) => /^(m|g|h|garcon|garçon|masculin|male|boy)$/i.test(x.trim()) ? 'M' : /^(f|fille|feminin|féminin|female|girl)$/i.test(x.trim()) ? 'F' : null;
  const lienDe = (x: string | null | undefined): 'mere' | 'pere' | 'tuteur' => {
    const v = sansAccent(x ?? '');
    return v.startsWith('pere') || v === 'father' ? 'pere' : v.startsWith('mere') || v === 'mother' || !v ? 'mere' : 'tuteur';
  };
  const dateDe = (x: string): string | null => {
    const fr = x.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
    const iso = x.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const [a, mo, j] = fr ? [Number(fr[3]), Number(fr[2]), Number(fr[1])] : iso ? [Number(iso[1]), Number(iso[2]), Number(iso[3])] : [0, 0, 0];
    if (!a || !mo || !j) return null;
    const d = new Date(Date.UTC(a, mo - 1, j));
    if (d.getUTCFullYear() !== a || d.getUTCMonth() !== mo - 1 || d.getUTCDate() !== j) return null;
    return d.toISOString().slice(0, 10);
  };

  r.post('/scolarite/import', {
    config: { permission: 'scolarite.import.executer' }, bodyLimit: 6_000_000,
    schema: { tags: ['scolarite'], body: z.object({ essai: z.boolean(), lignes: z.array(LigneImport).min(1).max(3000) }) },
  }, async (req) => {
    const ctx = exiger(req);
    const annee = await exigerAnneeOuverte(app.bd, ctx.etablissementId);
    const classes = await app.bd.lire<{ id: string; nom: string }>(sql`SELECT id, nom FROM structure.classe WHERE annee_id = ${annee.id}`);
    const existants = await app.bd.lire<{ nom: string; naissance: string; matricule: string }>(sql`
      SELECT nom || ' ' || prenoms AS nom, date_naissance::text AS naissance, matricule FROM scolarite.eleve WHERE etablissement_id = ${ctx.etablissementId}`);
    const matricules = new Set(existants.map((x) => x.matricule));
    const parCle = new Map(existants.map((e) => [`${sansAccent(e.nom)}|${e.naissance}`, e.matricule]));
    const erreurs: { ligne: number; champ: string; valeur: string; probleme: string }[] = [];
    const valides: { ligne: number; corps: Inscription; nom: string }[] = [];
    const vusFichier = new Map<string, number>();
    for (const l of req.body.lignes) {
      const err = (champ: string, valeur: string, probleme: string) => erreurs.push({ ligne: l.ligne, champ, valeur, probleme });
      const avant = erreurs.length;
      // « Names » peut porter nom et prénoms ensemble : le premier mot est le nom.
      let nom = l.nom, prenoms = l.prenoms;
      if (!prenoms && /[\s,]/.test(nom)) { const [n, ...p] = nom.split(/[\s,]+/).filter(Boolean); nom = n ?? ''; prenoms = p.join(' '); }
      if (!nom || !prenoms) err('Nom et prénoms', `${l.nom} ${l.prenoms}`.trim(), 'Nom ou prénoms manquants');
      const sexe = sexeDe(l.sexe);
      if (!sexe) err('Sexe', l.sexe, 'Sexe non reconnu (M ou F)');
      const naissance = dateDe(l.dateNaissance);
      if (!naissance) err('Date de naissance', l.dateNaissance, l.dateNaissance ? 'Date impossible' : 'Date manquante');
      const classe = classes.find((c) => sansAccent(c.nom) === sansAccent(l.classe));
      if (!classe) err('Classe', l.classe, `Classe inconnue en ${annee.libelle}`);
      const tel = chiffres(l.telephone);
      if (!/^\d{8,12}$/.test(tel)) err('Téléphone', l.telephone, 'Numéro incomplet');
      const tel2 = l.telephone2 ? chiffres(l.telephone2) : null;
      if (tel2 && !/^\d{8,12}$/.test(tel2)) err('Téléphone 2', l.telephone2 ?? '', 'Numéro incomplet');
      if (!l.responsable || l.responsable.length < 2) err('Responsable', l.responsable, 'Responsable manquant');
      const matricule = l.matricule?.toUpperCase().replace(/\s/g, '') || null;
      if (matricule && !/^\d{2}[A-Z]{2,4}\d{4}$/.test(matricule)) err('Matricule', l.matricule ?? '', 'Matricule mal formé (ex. 25FR0012)');
      else if (matricule && matricules.has(matricule)) err('Matricule', matricule, 'Matricule déjà attribué');
      if (nom && prenoms && naissance) {
        const cle = `${sansAccent(nom + ' ' + prenoms)}|${naissance}`;
        const deja = parCle.get(cle);
        if (deja) err('Nom et prénoms', `${nom.toUpperCase()} ${prenoms}`, `Doublon probable avec ${deja}`);
        else if (vusFichier.has(cle)) err('Nom et prénoms', `${nom.toUpperCase()} ${prenoms}`, `Doublon dans le fichier (ligne ${vusFichier.get(cle)})`);
        else vusFichier.set(cle, l.ligne);
      }
      if (erreurs.length > avant) continue;
      const t = sansAccent(l.type ?? '');
      const type = t.startsWith('red') ? 'redoublement' : t.startsWith('nouv') || t === 'new' ? 'nouvelle' : t || matricule ? 'reinscription' : 'nouvelle';
      const langue = /^(en|anglais|english)$/i.test(l.langue ?? '') ? 'en' : 'fr';
      const responsables: z.infer<typeof Responsable>[] = [{ nom: l.responsable, lien: lienDe(l.lien), telephone: tel, langue, payeur: true, recoitSms: true }];
      if (l.responsable2 && tel2 && tel2 !== tel) responsables.push({ nom: l.responsable2, lien: lienDe(l.lien2), telephone: tel2, langue, payeur: false, recoitSms: false });
      valides.push({ ligne: l.ligne, nom: `${nom.toUpperCase()} ${prenoms}`, corps: {
        eleve: { nom: nom.toUpperCase(), prenoms, sexe: sexe!, dateNaissance: naissance!, lieuNaissance: l.lieuNaissance || null },
        responsables, classeId: classe!.id, type, tarif: type === 'nouvelle' ? 'nouveau' : 'ancien', doublonEcarte: true, matricule } });
      if (matricule) matricules.add(matricule);
    }
    if (req.body.essai) return { essai: true, lues: req.body.lignes.length, valides: valides.length, erreurs, importes: 0 };
    let importes = 0;
    for (const v of valides) {
      try {
        await app.bd.transaction(ctx.compteId, (tx) => inscrire(tx, ctx, v.corps));
        importes++;
      } catch (e) {
        erreurs.push({ ligne: v.ligne, champ: 'Inscription', valeur: v.nom, probleme: (e as Error).message });
      }
    }
    await app.bd.transaction(ctx.compteId, (tx) => journaliser(tx, ctx, { action: 'Import', objetType: 'Élève',
      objetLibelle: `Import d'élèves et de responsables · ${req.body.lignes.length} lignes lues`, avant: '–', apres: `${importes} importées, ${erreurs.length} rejetées` }));
    return { essai: false, lues: req.body.lignes.length, valides: valides.length, erreurs: erreurs.sort((a, b) => a.ligne - b.ligne), importes };
  });

  r.get('/scolarite/matricule-suivant', {
    config: { permission: 'scolarite.inscription.creer' }, schema: { tags: ['scolarite'], querystring: z.object({ classeId: Uuid }) },
  }, async (req) => {
    const ctx = exiger(req);
    const annee = await exigerAnneeOuverte(app.bd, ctx.etablissementId);
    const c = await classeInfo(app.bd, req.query.classeId, ctx.etablissementId);
    if (!c) throw introuvable('Classe');
    const v = await app.bd.lireUn<{ valeur: number }>(sql`SELECT valeur FROM core.compteur WHERE etablissement_id = ${ctx.etablissementId}
                                                         AND cle = ${cleCompteur.matricule(annee.annee_civile, c.code_section)}`);
    return { matricule: FORMATS.matricule(annee.annee_civile, c.code_section, (v?.valeur ?? 0) + 1) };
  });

  // Fiche d'inscription avec le mot de passe du compte famille (ECARTS E-23) : le mot de passe vient du client, il n'est pas stocké.
  r.post('/scolarite/inscriptions/:id/fiche', {
    config: { permission: 'scolarite.inscription.creer' },
    schema: { tags: ['scolarite'], params: z.object({ id: Uuid }), body: z.object({ motDePasse: z.string().max(40).nullish() }) },
  }, async (req, rep) => {
    const ctx = exiger(req);
    const d = await app.bd.lireUn<Record<string, string>>(sql`
      SELECT e.id AS eleve_id, e.nom, e.prenoms, e.sexe, e.matricule, to_char(e.date_naissance, 'DD/MM/YYYY') AS naissance, COALESCE(e.lieu_naissance, '') AS lieu,
             e.renseignements,
             c.nom AS classe, a.libelle AS annee, et.nom_fr, et.nom_en, COALESCE(et.ville_bp, '') AS ville_bp, COALESCE(et.telephone, '') AS telephone,
             COALESCE(co.identifiant, '') AS identifiant
        FROM scolarite.inscription i JOIN scolarite.eleve e ON e.id = i.eleve_id JOIN structure.classe c ON c.id = i.classe_id
        JOIN structure.annee_scolaire a ON a.id = i.annee_id JOIN structure.etablissement et ON et.id = i.etablissement_id
        LEFT JOIN core.compte co ON co.famille_id = e.famille_id
       WHERE i.id = ${req.params.id} AND i.etablissement_id = ${ctx.etablissementId}`);
    if (!d) throw introuvable('Inscription');
    const responsables = await app.bd.lire<{ nom: string; lien: string; telephone: string; payeur: boolean }>(sql`
      SELECT r.nom, er.lien, r.telephone, er.payeur FROM scolarite.eleve_responsable er JOIN scolarite.responsable r ON r.id = er.responsable_id
       WHERE er.eleve_id = ${d['eleve_id']} ORDER BY er.payeur DESC, er.ordre`);
    const blocs = await renseignementsLisibles((q) => app.bd.lire(q), ctx.etablissementId, (d['renseignements'] ?? {}) as unknown as Record<string, unknown>);
    const pdf = await pdfFicheInscription({ ...d, telephoneConnexion: formatTelephone(d['identifiant'] ?? ''), motDePasse: req.body.motDePasse ?? null,
      responsables: responsables.map((x) => ({ nom: x.nom, lien: LIENS[x.lien] ?? x.lien, telephone: formatTelephone(x.telephone), payeur: x.payeur })),
      blocs: blocs.map((b) => ({ libelle: b.libelle, lignes: b.lignes.map((l) => ({ libelle: l.libelle, valeur: l.valeur })) })) } as never);
    return rep.type('application/pdf').header('content-disposition', `inline; filename="fiche-${d['matricule']}.pdf"`).send(Buffer.from(pdf));
  });

  // ------------------------------------------------------------- responsables

  r.post('/scolarite/eleves/:id/responsables', {
    config: { permission: 'scolarite.responsable.gerer' }, schema: { tags: ['scolarite'], params: z.object({ id: Uuid }), body: Responsable },
  }, async (req) => {
    const ctx = exiger(req);
    const b = req.body;
    return app.bd.transaction(ctx.compteId, async (tx) => {
      const e = await ligne<{ famille_id: string; nom: string }>(tx, sql`
        SELECT famille_id, nom || ' ' || prenoms AS nom FROM scolarite.eleve WHERE id = ${req.params.id} AND etablissement_id = ${ctx.etablissementId}`);
      if (!e) throw introuvable('Élève');
      if (b.payeur) await tx.execute(sql`UPDATE scolarite.eleve_responsable SET payeur = false WHERE eleve_id = ${req.params.id}`);
      let rid = (await ligne<{ id: string }>(tx, sql`SELECT id FROM scolarite.responsable WHERE famille_id = ${e.famille_id} AND telephone = ${b.telephone}`))?.id;
      if (!rid) {
        rid = (await ligne<{ id: string }>(tx, sql`
          INSERT INTO scolarite.responsable (etablissement_id, famille_id, nom, telephone, langue, cree_par)
          VALUES (${ctx.etablissementId}, ${e.famille_id}, ${b.nom}, ${b.telephone}, ${b.langue}, ${ctx.compteId}) RETURNING id`))!.id;
      }
      await tx.execute(sql`
        INSERT INTO scolarite.eleve_responsable (eleve_id, responsable_id, lien, payeur, recoit_sms, ordre)
        VALUES (${req.params.id}, ${rid}, ${b.lien}, ${b.payeur}, ${b.recoitSms},
                (SELECT COALESCE(max(ordre), 0) + 1 FROM scolarite.eleve_responsable WHERE eleve_id = ${req.params.id}))
        ON CONFLICT (eleve_id, responsable_id) DO UPDATE SET lien = EXCLUDED.lien, payeur = EXCLUDED.payeur, recoit_sms = EXCLUDED.recoit_sms`);
      const payeurs = await ligne<{ n: number }>(tx, sql`SELECT count(*)::int AS n FROM scolarite.eleve_responsable WHERE eleve_id = ${req.params.id} AND payeur`);
      if (payeurs!.n !== 1) throw new ErreurMetier('SCO_UN_PAYEUR', 422, 'Il faut exactement un payeur principal (RG-08).', 'payeur');
      await journaliser(tx, ctx, { action: 'Modification', objetType: 'Élève', objetLibelle: `Responsable · ${e.nom}`,
        avant: '–', apres: `${b.nom} (${LIENS[b.lien]})`, eleveId: req.params.id });
      return { id: rid };
    });
  });

  // ------------------------------------------------------------- changement de classe et départ (CU-08)

  r.post('/scolarite/inscriptions/:id/changement-classe', {
    config: { permission: 'scolarite.inscription.changer_classe' },
    schema: { tags: ['scolarite'], params: z.object({ id: Uuid }), body: z.object({ classeId: Uuid, motif: z.string().trim().max(200).nullish() }) },
  }, async (req) => {
    const ctx = exiger(req);
    return app.bd.transaction(ctx.compteId, async (tx) => {
      const i = await inscription(tx, req.params.id, ctx.etablissementId);
      if (!i || !['attente', 'validee'].includes(i.statut)) throw introuvable('Inscription active');
      const cible = await classeInfo(tx, req.body.classeId, ctx.etablissementId);
      const source = await classeInfo(tx, i.classe_id, ctx.etablissementId);
      if (!cible || cible.annee_id !== source!.annee_id) throw new ErreurMetier('SCO_CLASSE_HORS_ANNEE', 422, 'Classe de destination invalide.', 'classeId');
      if (cible.niveau_id !== source!.niveau_id) throw new ErreurMetier('SCO_AUTRE_NIVEAU', 422, 'Le changement de classe se fait dans le même niveau ; l\'échéancier reste celui du niveau.', 'classeId');
      const effectif = await ligne<{ n: number }>(tx, sql`SELECT count(*)::int AS n FROM scolarite.inscription WHERE classe_id = ${cible.id} AND statut IN ('attente', 'validee')`);
      if (effectif!.n >= cible.effectif_max) throw new ErreurMetier('SCO_CLASSE_PLEINE', 422, `La classe ${cible.nom} est complète (RG-06).`, 'classeId');
      await tx.execute(sql`UPDATE scolarite.inscription SET classe_id = ${cible.id} WHERE id = ${i.id}`);
      await tx.execute(sql`INSERT INTO scolarite.mouvement (etablissement_id, annee_id, inscription_id, survenu_le, type, classe_avant_id, classe_apres_id, motif, cree_par)
                           VALUES (${ctx.etablissementId}, ${cible.annee_id}, ${i.id}, current_date, 'changement_classe', ${i.classe_id}, ${cible.id}, ${req.body.motif ?? null}, ${ctx.compteId})`);
      await journaliser(tx, ctx, { action: 'Modification', objetType: 'Élève', objetLibelle: `Élève · ${i.nom} ${i.prenoms} · classe`,
        avant: i.classe, apres: cible.nom, eleveId: i.eleve_id, ligneId: i.id, table: 'scolarite.inscription' });
      return { ok: true };
    });
  });

  r.post('/scolarite/inscriptions/:id/depart', {
    config: { permission: 'scolarite.inscription.radier' },
    schema: { tags: ['scolarite'], params: z.object({ id: Uuid }), body: z.object({ type: z.enum(['transfert', 'abandon', 'exclusion']), motif: z.string().trim().min(2).max(200) }) },
  }, async (req) => {
    const ctx = exiger(req);
    return app.bd.transaction(ctx.compteId, async (tx) => {
      const i = await inscription(tx, req.params.id, ctx.etablissementId);
      if (!i || !['attente', 'validee'].includes(i.statut)) throw introuvable('Inscription active');
      const annee = await anneeOuverteTx(tx, ctx.etablissementId);
      const exeat = req.body.type === 'transfert' ? FORMATS.exeat(annee.annee_civile, await prochainNumero(tx, ctx.etablissementId, cleCompteur.exeat(annee.annee_civile))) : null;
      await tx.execute(sql`UPDATE scolarite.inscription SET statut = 'sortie' WHERE id = ${i.id}`);
      const libelle = { transfert: 'transfert vers un autre établissement', abandon: 'abandon', exclusion: 'exclusion' }[req.body.type];
      await tx.execute(sql`INSERT INTO scolarite.mouvement (etablissement_id, annee_id, inscription_id, survenu_le, type, classe_avant_id, motif, piece, cree_par)
                           VALUES (${ctx.etablissementId}, ${annee.id}, ${i.id}, current_date, 'depart', ${i.classe_id}, ${`${libelle} · ${req.body.motif}`}, ${exeat}, ${ctx.compteId})`);
      await journaliser(tx, ctx, { action: 'Modification', objetType: 'Élève', objetLibelle: `Départ · ${i.nom} ${i.prenoms}`,
        avant: i.classe, apres: `Départ · ${libelle}${exeat ? ` · ${exeat}` : ''}`, eleveId: i.eleve_id, ligneId: i.id, table: 'scolarite.inscription' });
      return { exeat };
    });
  });

  // ------------------------------------------------------------- classes (maquette Classes)

  r.get('/scolarite/classes', { config: { permission: 'scolarite.eleve.consulter' }, schema: { tags: ['scolarite'] } }, async (req) => {
    const ctx = exiger(req);
    const annee = await exigerAnneeOuverte(app.bd, ctx.etablissementId);
    const classes = await filtreClasses(ctx);
    const rows = await app.bd.lire(sql`
      SELECT c.id, c.nom, c.effectif_max AS "effectifMax", cy.sous_systeme AS "sousSysteme", n.id AS "niveauId", n.code AS "niveauCode",
             cy.libelle AS cycle, cy.ordre_enseignement AS "ordreEnseignement",
             (SELECT count(*)::int FROM reporting.v_inscription i WHERE i.classe_id = c.id AND i.statut IN ('attente', 'validee')) AS effectif
        FROM structure.classe c JOIN structure.niveau n ON n.id = c.niveau_id JOIN structure.cycle cy ON cy.id = n.cycle_id
       WHERE c.annee_id = ${annee.id} AND (${classes === 'toutes'} OR c.id = ANY(${tableau(classes === 'toutes' ? [] : classes)}::uuid[]))
       ORDER BY cy.sous_systeme DESC, n.rang, c.nom`);
    return { annee: annee.libelle, classes: rows };
  });

  r.get('/scolarite/classes/:id', { config: { permission: 'scolarite.eleve.consulter' }, schema: { tags: ['scolarite'], params: z.object({ id: Uuid }) } }, async (req) => {
    const ctx = exiger(req);
    const classes = await filtreClasses(ctx);
    if (classes !== 'toutes' && !classes.includes(req.params.id)) throw interdit('scolarite.eleve.consulter');
    const c = await app.bd.lireUn<{ nom: string; effectif_max: number; sous_systeme: string; ordre_enseignement: string; annee_id: string }>(sql`
      SELECT c.nom, c.effectif_max, cy.sous_systeme, cy.ordre_enseignement, c.annee_id FROM structure.classe c
        JOIN structure.niveau n ON n.id = c.niveau_id JOIN structure.cycle cy ON cy.id = n.cycle_id
       WHERE c.id = ${req.params.id} AND c.etablissement_id = ${ctx.etablissementId}`);
    if (!c) throw introuvable('Classe');
    const principal = await app.bd.lireUn<{ nom: string }>(sql`
      SELECT p.nom_affiche AS nom FROM pedagogie.affectation a JOIN personnel.fiche p ON p.id = a.personnel_id WHERE a.classe_id = ${req.params.id} AND a.principal`);
    const eleves = await app.bd.lire<{ inscriptionId: string; eleveId: string; matricule: string; nom: string; sexe: string; type: string }>(sql`
      SELECT i.id AS "inscriptionId", i.eleve_id AS "eleveId", i.matricule, i.nom || ' ' || i.prenoms AS nom, i.sexe, i.type
        FROM reporting.v_inscription i WHERE i.classe_id = ${req.params.id} AND i.statut IN ('attente', 'validee') ORDER BY i.nom, i.prenoms`);
    const statut = (e: { sexe: string; type: string }) => e.type === 'redoublement' ? (e.sexe === 'F' ? 'Redoublante' : 'Redoublant')
      : e.type === 'nouvelle' ? (e.sexe === 'F' ? 'Nouvelle' : 'Nouveau') : (e.sexe === 'F' ? 'Ancienne' : 'Ancien');
    const mouvements = await app.bd.lire(sql`
      SELECT m.survenu_le AS date, e.nom || ' ' || e.prenoms AS eleve, m.type, ca.nom AS avant, cp.nom AS apres, m.motif, m.piece,
             COALESCE(co.nom_affiche, '–') AS auteur
        FROM scolarite.mouvement m JOIN scolarite.inscription i ON i.id = m.inscription_id JOIN scolarite.eleve e ON e.id = i.eleve_id
        LEFT JOIN structure.classe ca ON ca.id = m.classe_avant_id LEFT JOIN structure.classe cp ON cp.id = m.classe_apres_id
        LEFT JOIN core.compte co ON co.id = m.cree_par
       WHERE m.classe_avant_id = ${req.params.id} OR m.classe_apres_id = ${req.params.id} ORDER BY m.survenu_le DESC, m.cree_le DESC`);
    return {
      nom: c.nom, sousSysteme: c.sous_systeme, ordreEnseignement: c.ordre_enseignement, principal: principal?.nom ?? null,
      effectif: eleves.length, effectifMax: c.effectif_max,
      garcons: eleves.filter((e) => e.sexe === 'M').length, filles: eleves.filter((e) => e.sexe === 'F').length,
      nouveaux: eleves.filter((e) => e.type === 'nouvelle').length, anciens: eleves.filter((e) => e.type === 'reinscription').length,
      redoublants: eleves.filter((e) => e.type === 'redoublement').length,
      eleves: eleves.map((e, i) => ({ numero: i + 1, inscriptionId: e.inscriptionId, eleveId: e.eleveId, matricule: e.matricule, nom: e.nom, sexe: e.sexe, statut: statut(e) })),
      mouvements: mouvements.map((m) => {
        const x = m as { date: string; eleve: string; type: string; avant: string | null; apres: string | null; motif: string | null; piece: string | null; auteur: string };
        return { date: x.date, eleve: x.eleve, auteur: x.auteur, piece: x.piece ?? '–',
          mouvement: x.type === 'changement_classe' ? `Changement de classe : ${x.avant} vers ${x.apres}` : `Départ · ${x.motif ?? ''}` };
      }),
    };
  });

  r.get('/scolarite/classes/:id/document', {
    config: { permission: 'scolarite.eleve.consulter' },
    schema: { tags: ['scolarite'], params: z.object({ id: Uuid }), querystring: z.object({ type: z.enum(['liste', 'certificats', 'cartes', 'csv']) }) },
  }, async (req, rep) => {
    const ctx = exiger(req);
    if (req.query.type !== 'liste' && !ctx.a('scolarite.document.imprimer') && !ctx.a('scolarite.eleve.exporter')) throw interdit('scolarite.document.imprimer');
    const etab = await app.bd.lireUn<{ nom_fr: string; nom_en: string; ville_bp: string | null; telephone: string | null; signataire: string | null }>(sql`
      SELECT nom_fr, nom_en, ville_bp, telephone, signataire, modeles FROM structure.etablissement WHERE id = ${ctx.etablissementId}`);
    const c = await app.bd.lireUn<{ nom: string; annee: string }>(sql`
      SELECT c.nom, a.libelle AS annee FROM structure.classe c JOIN structure.annee_scolaire a ON a.id = c.annee_id WHERE c.id = ${req.params.id} AND c.etablissement_id = ${ctx.etablissementId}`);
    if (!c) throw introuvable('Classe');
    const eleves = await app.bd.lire<{ matricule: string; nom: string; prenoms: string; sexe: string; naissance: string; lieu: string | null }>(sql`
      SELECT i.matricule, i.nom, i.prenoms, i.sexe, to_char(i.date_naissance, 'DD/MM/YYYY') AS naissance, e.lieu_naissance AS lieu
        FROM reporting.v_inscription i JOIN scolarite.eleve e ON e.id = i.eleve_id
       WHERE i.classe_id = ${req.params.id} AND i.statut IN ('attente', 'validee') ORDER BY i.nom, i.prenoms`);
    if (req.query.type === 'csv') {
      return rep.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', `attachment; filename="classe-${c.nom}.csv"`)
        .send(versCsv(eleves.map((e, i) => ({ 'N°': i + 1, Matricule: e.matricule, Nom: e.nom, Prénoms: e.prenoms, Sexe: e.sexe, 'Né(e) le': e.naissance }))));
    }
    if (req.query.type === 'cartes') {
      const photos = await app.bd.lire<{ matricule: string; photo: Buffer | null }>(sql`
        SELECT e.matricule, e.photo FROM scolarite.inscription i JOIN scolarite.eleve e ON e.id = i.eleve_id
         WHERE i.classe_id = ${req.params.id} AND i.statut IN ('attente', 'validee')`);
      const logo = await app.bd.lireUn<{ logo: Buffer | null }>(sql`SELECT logo FROM structure.etablissement WHERE id = ${ctx.etablissementId}`);
      const parMatricule = new Map(photos.map((x) => [x.matricule, x.photo]));
      const cartes = await pdfCartesScolaires({ etablissement: etab!, classe: c.nom, annee: c.annee, logo: logo?.logo ?? null,
        eleves: eleves.map((e) => ({ ...e, photo: parMatricule.get(e.matricule) ?? null })) });
      return rep.type('application/pdf').header('content-disposition', `inline; filename="cartes-${c.nom}.pdf"`).send(Buffer.from(cartes));
    }
    const pdf = req.query.type === 'liste'
      ? await pdfListeClasse({ etablissement: etab!, classe: c.nom, annee: c.annee, eleves })
      : await pdfCertificat({ etablissement: etab!, classe: c.nom, annee: c.annee, eleves });
    return rep.type('application/pdf').header('content-disposition', `inline; filename="${req.query.type}-${c.nom}.pdf"`).send(Buffer.from(pdf));
  });

  r.get('/scolarite/eleves/:id/certificat', {
    config: { permission: 'scolarite.document.imprimer' }, schema: { tags: ['scolarite'], params: z.object({ id: Uuid }) },
  }, async (req, rep) => {
    const ctx = exiger(req);
    const etab = await app.bd.lireUn<{ nom_fr: string; nom_en: string; ville_bp: string | null; telephone: string | null; signataire: string | null }>(sql`
      SELECT nom_fr, nom_en, ville_bp, telephone, signataire, modeles FROM structure.etablissement WHERE id = ${ctx.etablissementId}`);
    const e = await app.bd.lireUn<{ matricule: string; nom: string; prenoms: string; sexe: string; naissance: string; lieu: string | null; classe: string; annee: string }>(sql`
      SELECT i.matricule, i.nom, i.prenoms, i.sexe, to_char(i.date_naissance, 'DD/MM/YYYY') AS naissance, el.lieu_naissance AS lieu, i.classe, i.annee
        FROM reporting.v_inscription i JOIN scolarite.eleve el ON el.id = i.eleve_id
       WHERE i.eleve_id = ${req.params.id} AND i.etablissement_id = ${ctx.etablissementId} AND i.statut IN ('attente', 'validee')`);
    if (!e) throw introuvable('Inscription active');
    const pdf = await pdfCertificat({ etablissement: etab!, classe: e.classe, annee: e.annee, eleves: [e] });
    return rep.type('application/pdf').header('content-disposition', `inline; filename="certificat-${e.matricule}.pdf"`).send(Buffer.from(pdf));
  });
}
