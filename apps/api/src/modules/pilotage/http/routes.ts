// CU-26 tableau de bord (PIL-01, PIL-02) et statistiques : lectures des vues de reporting seulement (conception § 2).
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { sql, tableau } from '../../../core/bd.ts';
import { exiger } from '../../../core/session.ts';
import { ErreurMetier } from '../../../core/erreurs.ts';
import { journaliser } from '../../../core/audit.ts';
import { versCsv } from '../../../core/csv.ts';
import { anneeOuverte } from '../../structure/index.ts';
import { classesAccessibles, perimetreEnseignant } from '../../../core/perimetre.ts';
import { pdfTableau } from '@gs/print';
import { routesCartes } from './cartes.ts';

export async function routesPilotage(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  await routesCartes(app);

  // E-08 : le même écran pour tous ; chaque bloc n'apparaît qu'avec la permission sur ses données.
  r.get('/pilotage/tableau-de-bord', { config: { unePermissionParmi: ['pilotage.tableau.consulter', 'scolarite.eleve.consulter', 'caisse.consulter', 'finances.impaye.consulter'] }, schema: { tags: ['pilotage'] } }, async (req) => {
    const ctx = exiger(req);
    const annee = await anneeOuverte(app.bd, ctx.etablissementId);
    if (!annee) return { annee: null, blocs: [] };
    const tout = ctx.a('pilotage.tableau.consulter');
    const voitFinances = tout || ctx.a('finances.impaye.consulter') || ctx.a('caisse.consulter');
    const res: Record<string, unknown> = { annee: annee.libelle };
    // Un instituteur ne compte que son périmètre : ses classes, ses appels, ses matières (RG-34).
    const perimetre = tout ? 'toutes' : await classesAccessibles(app.bd, ctx, 'scolarite.eleve.consulter');
    const classesVues = perimetre === 'toutes' ? null : perimetre;
    const enseignant = classesVues ? await perimetreEnseignant(app.bd, ctx) : null;
    if (tout || ctx.a('scolarite.eleve.consulter')) {
      res['effectifs'] = await app.bd.lireUn(sql`
        SELECT (SELECT count(*)::int FROM reporting.v_inscription WHERE annee_id = ${annee.id} AND statut IN ('attente', 'validee')
                   AND (${classesVues === null} OR classe_id = ANY(${tableau(classesVues ?? [])}::uuid[]))) AS eleves,
               (SELECT count(*)::int FROM structure.classe WHERE annee_id = ${annee.id}
                   AND (${classesVues === null} OR id = ANY(${tableau(classesVues ?? [])}::uuid[]))) AS classes`);
    }
    if (voitFinances) {
      res['jour'] = await app.bd.lireUn(sql`
        SELECT COALESCE(sum(montant), 0)::bigint AS montant, count(*)::int AS versements FROM reporting.v_versement
         WHERE etablissement_id = ${ctx.etablissementId} AND statut <> 'annule' AND (encaisse_le AT TIME ZONE 'Africa/Douala')::date = (now() AT TIME ZONE 'Africa/Douala')::date`);
      res['recouvrement'] = await app.bd.lireUn(sql`
        SELECT COALESCE(sum(verse), 0)::bigint AS verse, COALESCE(sum(a_payer), 0)::bigint AS du FROM reporting.v_echeance WHERE annee_id = ${annee.id}`);
      res['echu'] = await app.bd.lireUn(sql`
        SELECT COALESCE(sum(reste), 0)::bigint AS montant, count(DISTINCT inscription_id)::int AS eleves FROM reporting.v_impaye WHERE annee_id = ${annee.id}`);
      res['courbe'] = await app.bd.lire(sql`
        SELECT to_char(j, 'DD') AS jour, j::date AS date, COALESCE(sum(v.montant), 0)::bigint AS montant, count(v.id)::int AS versements
          FROM generate_series((now() AT TIME ZONE 'Africa/Douala')::date - 13, (now() AT TIME ZONE 'Africa/Douala')::date, '1 day') j
          LEFT JOIN reporting.v_versement v ON (v.encaisse_le AT TIME ZONE 'Africa/Douala')::date = j::date AND v.statut <> 'annule' AND v.etablissement_id = ${ctx.etablissementId}
         GROUP BY j ORDER BY j`);
      res['parClasse'] = await app.bd.lire(sql`
        SELECT c.nom AS classe, COALESCE(sum(e.verse), 0)::bigint AS verse, COALESCE(sum(e.a_payer), 0)::bigint AS du, COALESCE(sum(e.reste), 0)::bigint AS reste
          FROM structure.classe c JOIN structure.niveau n ON n.id = c.niveau_id JOIN structure.cycle cy ON cy.id = n.cycle_id
          LEFT JOIN reporting.v_echeance e ON e.classe_id = c.id
         WHERE c.annee_id = ${annee.id} GROUP BY c.id, c.nom, cy.sous_systeme, n.rang ORDER BY cy.sous_systeme DESC, n.rang, c.nom`);
      res['derniers'] = await app.bd.lire(sql`
        SELECT numero_recu AS "numeroRecu", nom || ' ' || prenoms AS eleve, classe, encaisse_le AS "encaisseLe", montant, eleve_id AS "eleveId"
          FROM reporting.v_versement WHERE etablissement_id = ${ctx.etablissementId} AND statut <> 'annule' ORDER BY encaisse_le DESC LIMIT 5`);
    }
    const aTraiter: { code: string; nombre: number }[] = [];
    if (ctx.a('finances.reduction.valider') || ctx.a('caisse.sortie.valider') || ctx.a('scolarite.derogation.valider') || ctx.a('finances.annulation.valider')) {
      const types = [ctx.a('finances.reduction.valider') && 'reduction', ctx.a('scolarite.derogation.valider') && 'derogation', ctx.a('finances.annulation.valider') && 'annulation'].filter(Boolean) as string[];
      const n = await app.bd.lireUn<{ n: number }>(sql`
        SELECT ((SELECT count(*) FROM finances.demande WHERE etablissement_id = ${ctx.etablissementId} AND statut = 'demandee' AND type = ANY(${tableau(types)}::text[]))
              + (SELECT count(*) FROM caisse.sortie WHERE etablissement_id = ${ctx.etablissementId} AND statut = 'demandee' AND ${ctx.a('caisse.sortie.valider')}))::int AS n`);
      aTraiter.push({ code: 'validations', nombre: n!.n });
    }
    if (tout || ctx.a('vie_scolaire.dossier.consulter')) {
      const n = await app.bd.lireUn<{ n: number }>(sql`
        SELECT count(*)::int AS n FROM vie_scolaire.fiche_appel WHERE etablissement_id = ${ctx.etablissementId}
           AND jour = (now() AT TIME ZONE 'Africa/Douala')::date AND statut = 'a_faire' AND debut < '12:00' AND fin <= (now() AT TIME ZONE 'Africa/Douala')::time
           AND (${classesVues === null} OR personnel_id = ${ctx.personnelId ?? null})`);
      aTraiter.push({ code: 'appels', nombre: n!.n });
    }
    if (tout || ctx.a('pedagogie.note.lire')) {
      const s = await app.bd.lireUn<{ id: string; libelle: string; n: number }>(sql`
        SELECT s.id, s.libelle_fr AS libelle,
               (SELECT count(*)::int FROM structure.classe c WHERE c.annee_id = ${annee.id}
                   AND (${classesVues === null} OR c.id = ANY(${tableau(classesVues ?? [])}::uuid[]))
                   AND NOT EXISTS (SELECT 1 FROM pedagogie.evaluation e WHERE e.sequence_id = s.id AND e.classe_id = c.id
                                     AND (${enseignant === null || (enseignant?.classesPrincipal.length ?? 0) > 0} OR e.matiere_id = ANY(${tableau(enseignant?.matieres.map((m) => m.matiereId) ?? [])}::uuid[])))) AS n
          FROM pedagogie.sequence s WHERE s.annee_id = ${annee.id} AND s.statut = 'ouverte' ORDER BY s.numero DESC LIMIT 1`);
      if (s) aTraiter.push({ code: 'notes', nombre: s.n, sequence: s.libelle.toLowerCase() } as never);
    }
    if (tout || ctx.a('communication.sms.envoyer')) {
      const n = await app.bd.lireUn<{ n: number }>(sql`SELECT count(*)::int AS n FROM communication.sms WHERE etablissement_id = ${ctx.etablissementId} AND statut = 'en_attente'`);
      aTraiter.push({ code: 'sms', nombre: n!.n });
    }
    res['aTraiter'] = aTraiter;
    return res;
  });

  const Filtre = z.object({ anneeId: z.uuid().optional(), sousSysteme: z.enum(['francophone', 'anglophone']).optional() });

  async function statistiques(etab: string, f: z.infer<typeof Filtre>) {
    const annees = await app.bd.lire<{ id: string; libelle: string; statut: string }>(sql`
      SELECT id, libelle, statut FROM structure.annee_scolaire WHERE etablissement_id = ${etab} AND statut <> 'preparation' ORDER BY date_debut DESC`);
    const anneeId = f.anneeId ?? annees.find((a) => a.statut === 'ouverte')?.id ?? annees[0]?.id ?? null;
    const ss = f.sousSysteme ?? null;
    const effectifs = await app.bd.lire<{ niveau: string; classes: number; garcons: number; filles: number; total: number; nouveaux: number; redoublants: number }>(sql`
      SELECT n.code AS niveau, count(DISTINCT c.id)::int AS classes,
             count(i.id) FILTER (WHERE i.sexe = 'M')::int AS garcons, count(i.id) FILTER (WHERE i.sexe = 'F')::int AS filles, count(i.id)::int AS total,
             count(i.id) FILTER (WHERE i.type = 'nouvelle')::int AS nouveaux, count(i.id) FILTER (WHERE i.type = 'redoublement')::int AS redoublants
        FROM structure.niveau n JOIN structure.cycle cy ON cy.id = n.cycle_id
        JOIN structure.classe c ON c.niveau_id = n.id AND c.annee_id = ${anneeId}
        LEFT JOIN reporting.v_inscription i ON i.classe_id = c.id AND i.statut IN ('attente', 'validee')
       WHERE n.etablissement_id = ${etab} AND (${ss}::text IS NULL OR cy.sous_systeme = ${ss})
       GROUP BY n.code, n.rang, cy.sous_systeme ORDER BY cy.sous_systeme DESC, n.rang`);
    const sequence = await app.bd.lireUn<{ id: string; libelle: string }>(sql`
      SELECT s.id, s.libelle_fr AS libelle FROM pedagogie.sequence s WHERE s.annee_id = ${anneeId}
         AND EXISTS (SELECT 1 FROM pedagogie.evaluation e JOIN pedagogie.note n ON n.evaluation_id = e.id WHERE e.sequence_id = s.id)
       ORDER BY s.statut = 'fermee' DESC, s.numero DESC LIMIT 1`);
    const resultats = sequence ? await app.bd.lire<{ classe: string; moyenne: number; reussite: number; forte: string; faible: string }>(sql`
      WITH moy AS (
        SELECT n.classe_id, n.inscription_id, n.matiere_id, avg(n.sur_20) AS m FROM reporting.v_note n JOIN pedagogie.evaluation e ON e.id = (SELECT id FROM pedagogie.evaluation WHERE sequence_id = ${sequence.id} AND classe_id = n.classe_id AND matiere_id = n.matiere_id)
         WHERE n.sur_20 IS NOT NULL GROUP BY n.classe_id, n.inscription_id, n.matiere_id),
      eleve AS (SELECT classe_id, inscription_id, avg(m) AS m FROM moy GROUP BY classe_id, inscription_id),
      matiere AS (SELECT classe_id, matiere_id, avg(m) AS m FROM moy GROUP BY classe_id, matiere_id)
      SELECT c.nom AS classe, round(avg(e.m), 2) AS moyenne, round(100.0 * count(*) FILTER (WHERE e.m >= 10) / count(*))::int AS reussite,
             (SELECT COALESCE(mt.abrege_fr, mt.libelle_fr) FROM matiere x JOIN pedagogie.matiere mt ON mt.id = x.matiere_id WHERE x.classe_id = c.id ORDER BY x.m DESC LIMIT 1) AS forte,
             (SELECT COALESCE(mt.abrege_fr, mt.libelle_fr) FROM matiere x JOIN pedagogie.matiere mt ON mt.id = x.matiere_id WHERE x.classe_id = c.id ORDER BY x.m ASC LIMIT 1) AS faible
        FROM eleve e JOIN structure.classe c ON c.id = e.classe_id JOIN structure.niveau nv ON nv.id = c.niveau_id JOIN structure.cycle cy ON cy.id = nv.cycle_id
       WHERE (${ss}::text IS NULL OR cy.sous_systeme = ${ss}) GROUP BY c.id, c.nom, nv.rang, cy.sous_systeme ORDER BY cy.sous_systeme DESC, nv.rang, c.nom`) : [];
    const nbClasses = await app.bd.lireUn<{ n: number }>(sql`SELECT count(*)::int AS n FROM structure.classe WHERE annee_id = ${anneeId}`);
    const resteNiveau = await app.bd.lire<{ niveau: string; reste: number; verse: number; du: number }>(sql`
      SELECT n.code AS niveau, COALESCE(sum(e.reste), 0)::bigint AS reste, COALESCE(sum(e.verse), 0)::bigint AS verse, COALESCE(sum(e.a_payer), 0)::bigint AS du
        FROM structure.niveau n JOIN structure.cycle cy ON cy.id = n.cycle_id JOIN structure.classe c ON c.niveau_id = n.id AND c.annee_id = ${anneeId}
        LEFT JOIN reporting.v_echeance e ON e.classe_id = c.id
       WHERE n.etablissement_id = ${etab} AND (${ss}::text IS NULL OR cy.sous_systeme = ${ss})
       GROUP BY n.code, n.rang, cy.sous_systeme ORDER BY cy.sous_systeme DESC, n.rang`);
    const completude = await app.bd.lireUn(sql`
      SELECT (SELECT s.libelle_fr FROM pedagogie.sequence s WHERE s.annee_id = ${anneeId} AND s.statut <> 'planifiee' AND s.type = 'devoir' ORDER BY s.numero DESC LIMIT 1) AS sequence,
             (SELECT count(DISTINCT e.classe_id)::int FROM pedagogie.evaluation e WHERE e.sequence_id = (SELECT s.id FROM pedagogie.sequence s WHERE s.annee_id = ${anneeId}
                AND s.statut <> 'planifiee' AND s.type = 'devoir' ORDER BY s.numero DESC LIMIT 1)) AS notes,
             (SELECT count(DISTINCT classe_id)::int FROM vie_scolaire.fiche_appel f WHERE f.etablissement_id = ${etab} AND f.jour = (now() AT TIME ZONE 'Africa/Douala')::date
                AND NOT EXISTS (SELECT 1 FROM vie_scolaire.fiche_appel g WHERE g.classe_id = f.classe_id AND g.jour = f.jour AND g.statut = 'a_faire' AND g.fin <= (now() AT TIME ZONE 'Africa/Douala')::time)) AS appels,
             (SELECT count(DISTINCT classe_id)::int FROM vie_scolaire.fiche_appel f WHERE f.etablissement_id = ${etab} AND f.jour = (now() AT TIME ZONE 'Africa/Douala')::date) AS classes_appel,
             (SELECT count(*) FILTER (WHERE cloturee_le IS NOT NULL)::int FROM caisse.session WHERE etablissement_id = ${etab} AND ouverte_le::date = current_date - 1) AS sessions_closes,
             (SELECT count(*)::int FROM caisse.session WHERE etablissement_id = ${etab} AND ouverte_le::date = current_date - 1) AS sessions,
             (SELECT p.libelle_fr FROM structure.periode p WHERE p.annee_id = ${anneeId} ORDER BY (p.statut = 'publiee') DESC, p.ordre LIMIT 1) AS periode,
             (SELECT count(DISTINCT f.classe_id)::int FROM pedagogie.fusion f JOIN structure.periode p ON p.id = f.periode_id WHERE p.annee_id = ${anneeId} AND f.statut = 'publiee'
                AND p.id = (SELECT q.id FROM structure.periode q WHERE q.annee_id = ${anneeId} ORDER BY (q.statut = 'publiee') DESC, q.ordre LIMIT 1)) AS bulletins`);
    const totalDu = resteNiveau.reduce((s, x) => s + Number(x.du), 0);
    const totalVerse = resteNiveau.reduce((s, x) => s + Number(x.verse), 0);
    return { annees, anneeId, sousSysteme: ss, effectifs, sequence: sequence?.libelle ?? null, resultats, nbClasses: nbClasses?.n ?? 0,
      resteNiveau: resteNiveau.map((x) => ({ niveau: x.niveau, reste: Number(x.reste) })),
      resteTotal: resteNiveau.reduce((s, x) => s + Number(x.reste), 0), recouvrement: totalDu ? Math.floor((totalVerse * 100) / totalDu) : null, completude };
  }

  r.get('/pilotage/statistiques', { config: { permission: 'pilotage.statistiques.consulter' }, schema: { tags: ['pilotage'], querystring: Filtre } },
    async (req) => statistiques(exiger(req).etablissementId, req.query));

  r.get('/pilotage/statistiques/document', {
    config: { permission: 'pilotage.statistiques.consulter' }, schema: { tags: ['pilotage'], querystring: Filtre.extend({ format: z.enum(['csv', 'pdf']), section: z.enum(['effectifs', 'tout']).default('tout') }) },
  }, async (req, rep) => {
    const ctx = exiger(req);
    const s = await statistiques(ctx.etablissementId, req.query);
    const lignes = s.effectifs.map((e) => ({ Niveau: e.niveau, Classes: e.classes, Garçons: e.garcons, Filles: e.filles, Total: e.total, Nouveaux: e.nouveaux, Redoublants: e.redoublants }));
    await app.bd.transaction(ctx.compteId, (tx) => journaliser(tx, ctx, { action: 'Export', objetType: 'Pilotage', objetLibelle: 'Statistiques', avant: '–', apres: req.query.format.toUpperCase() }));
    if (req.query.format === 'csv') {
      const tout = req.query.section === 'tout'
        ? [...lignes, ...s.resteNiveau.map((x) => ({ Niveau: x.niveau, 'Reste dû': x.reste })), ...s.resultats.map((x) => ({ Classe: x.classe, Moyenne: x.moyenne, Réussite: `${x.reussite} %`, 'Matière la plus forte': x.forte, 'Matière la plus faible': x.faible }))]
        : lignes;
      return rep.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', 'attachment; filename="statistiques.csv"').send(versCsv(tout as Record<string, unknown>[]));
    }
    const etab = await app.bd.lireUn<{ nom_fr: string; nom_en: string; ville_bp: string | null; telephone: string | null }>(sql`SELECT nom_fr, nom_en, ville_bp, telephone, logo FROM structure.etablissement WHERE id = ${ctx.etablissementId}`);
    const pdf = await pdfTableau({ etablissement: etab!, titre: 'EFFECTIFS PAR NIVEAU, SEXE ET STATUT', sousTitre: s.annees.find((a) => a.id === s.anneeId)?.libelle,
      colonnes: ['Niveau', 'Classes', 'Garçons', 'Filles', 'Total', 'Nouveaux', 'Redoublants'].map((t, i) => ({ titre: t, largeur: i ? 65 : 90, droite: i > 0 })),
      lignes: s.effectifs.map((e) => [e.niveau, e.classes, e.garcons, e.filles, e.total, e.nouveaux, e.redoublants].map(String)) });
    return rep.type('application/pdf').send(Buffer.from(pdf));
  });

  // Rapports pour la tutelle (maquette Statistiques) : en l'absence du modèle officiel, des tableaux A4 aux rubriques usuelles
  // (effectifs par classe, sexe et âge ; instituteurs par statut et par classe ; résultats, absences et recouvrement par classe).
  const RAPPORTS = { rentree: 'FICHE STATISTIQUE DE RENTRÉE', instituteurs: 'ÉTAT DES INSTITUTEURS', trimestre: 'RAPPORT DE FIN DE TRIMESTRE' } as const;
  r.get('/pilotage/rapports/:type', {
    config: { permission: 'pilotage.statistiques.consulter' },
    schema: { tags: ['pilotage'], params: z.object({ type: z.enum(['rentree', 'instituteurs', 'trimestre']) }) },
  }, async (req, rep) => {
    const ctx = exiger(req);
    const etab = ctx.etablissementId;
    const annee = await anneeOuverte(app.bd, etab);
    if (!annee) throw new ErreurMetier('STR_AUCUNE_ANNEE_OUVERTE', 422, 'Aucune année scolaire n\'est ouverte.');
    const identite = await app.bd.lireUn<{ nom_fr: string; nom_en: string; ville_bp: string | null; telephone: string | null }>(sql`
      SELECT nom_fr, nom_en, ville_bp, telephone, logo FROM structure.etablissement WHERE id = ${etab}`);
    const debut = await app.bd.lireUn<{ d: string }>(sql`SELECT date_debut::text AS d FROM structure.annee_scolaire WHERE id = ${annee.id}`);
    let sousTitre = `Année scolaire ${annee.libelle}`;
    let colonnes: { titre: string; largeur: number; droite?: boolean }[] = [];
    let lignes: string[][] = [];
    const n = (x: number | null | undefined) => (x === null || x === undefined ? '–' : String(x));
    if (req.params.type === 'rentree') {
      const AGES = [5, 6, 7, 8, 9, 10, 11, 12];
      const rows = await app.bd.lire<{ classe: string; garcons: number; filles: number; total: number }>(sql`
        SELECT i.classe, count(*) FILTER (WHERE i.sexe = 'M')::int AS garcons, count(*) FILTER (WHERE i.sexe = 'F')::int AS filles, count(*)::int AS total
          FROM reporting.v_inscription i
         WHERE i.etablissement_id = ${etab} AND i.annee_id = ${annee.id} AND i.statut IN ('attente', 'validee')
         GROUP BY i.classe, i.sous_systeme, i.niveau_rang ORDER BY i.sous_systeme DESC, i.niveau_rang, i.classe`);
      const parAge = await app.bd.lire<{ classe: string; age: number; n: number }>(sql`
        SELECT i.classe, LEAST(12, GREATEST(5, date_part('year', age(${debut!.d}::date, i.date_naissance))::int)) AS age, count(*)::int AS n
          FROM reporting.v_inscription i
         WHERE i.etablissement_id = ${etab} AND i.annee_id = ${annee.id} AND i.statut IN ('attente', 'validee') GROUP BY 1, 2`);
      colonnes = [{ titre: 'Classe', largeur: 62 }, { titre: 'G', largeur: 32, droite: true }, { titre: 'F', largeur: 32, droite: true }, { titre: 'Total', largeur: 40, droite: true },
        ...AGES.map((a) => ({ titre: a === 5 ? '5 ans et -' : a === 12 ? '12 ans et +' : `${a} ans`, largeur: a === 5 || a === 12 ? 52 : 40, droite: true }))];
      const totaux = new Array(3 + AGES.length).fill(0) as number[];
      lignes = rows.map((r) => {
        const ages = AGES.map((a) => parAge.find((x) => x.classe === r.classe && x.age === a)?.n ?? 0);
        [r.garcons, r.filles, r.total, ...ages].forEach((v, i) => { totaux[i]! += v; });
        return [r.classe, n(r.garcons), n(r.filles), n(r.total), ...ages.map(n)];
      });
      lignes.push(['Total', ...totaux.map(n)]);
      sousTitre += ` · effectifs par classe, sexe et âge au ${debut!.d.split('-').reverse().join('/')}`;
    } else if (req.params.type === 'instituteurs') {
      const rows = await app.bd.lire<{ nom: string; fonction: string; statut: string; diplome: string | null; affectations: string | null }>(sql`
        SELECT f.nom_affiche AS nom, f.fonction, f.statut, f.diplome,
               string_agg(c.nom || CASE WHEN a.principal THEN ' (principal)' ELSE ' · ' || COALESCE(m.abrege_fr, m.libelle_fr) END, ', ' ORDER BY c.nom) AS affectations
          FROM personnel.fiche f
          LEFT JOIN pedagogie.affectation a ON a.personnel_id = f.id AND a.annee_id = ${annee.id}
          LEFT JOIN structure.classe c ON c.id = a.classe_id LEFT JOIN pedagogie.matiere m ON m.id = a.matiere_id
         WHERE f.etablissement_id = ${etab} AND f.actif AND (f.fonction IN ('instituteur_principal', 'instituteur_matiere') OR a.id IS NOT NULL)
         GROUP BY f.id ORDER BY f.statut, f.nom_affiche`);
      colonnes = [{ titre: 'Nom', largeur: 130 }, { titre: 'Fonction', largeur: 85 }, { titre: 'Statut', largeur: 60 }, { titre: 'Diplôme', largeur: 60 }, { titre: 'Classes et matières', largeur: 180 }];
      const FONCTIONS: Record<string, string> = { instituteur_principal: 'Principal', instituteur_matiere: 'De matière' };
      lignes = rows.map((r) => [r.nom, FONCTIONS[r.fonction] ?? r.fonction, r.statut === 'vacataire' ? 'Vacataire' : 'Permanent', r.diplome ?? '–', r.affectations ?? '–']);
      const perm = rows.filter((r) => r.statut !== 'vacataire').length;
      sousTitre += ` · ${rows.length} instituteurs, dont ${perm} permanents et ${rows.length - perm} vacataires`;
    } else {
      const periode = await app.bd.lireUn<{ id: string; libelle: string }>(sql`
        SELECT p.id, p.libelle_fr AS libelle FROM structure.periode p WHERE p.annee_id = ${annee.id}
         ORDER BY (p.date_debut <= current_date) DESC, p.date_debut DESC LIMIT 1`);
      const rows = await app.bd.lire<{ classe: string; effectif: number; moyenne: number | null; reussite: number | null; heures: number; recouvrement: number | null }>(sql`
        WITH ins AS (SELECT id, classe_id, classe, sous_systeme, niveau_rang FROM reporting.v_inscription
                      WHERE etablissement_id = ${etab} AND annee_id = ${annee.id} AND statut IN ('attente', 'validee'))
        SELECT i.classe, count(DISTINCT i.id)::int AS effectif,
               (SELECT round(avg(b.moyenne), 2) FROM reporting.v_bulletin b JOIN ins j ON j.id = b.inscription_id WHERE j.classe_id = i.classe_id AND b.periode_id = ${periode?.id ?? null}) AS moyenne,
               (SELECT round(100.0 * count(*) FILTER (WHERE b.moyenne >= 10) / NULLIF(count(*), 0))::int FROM reporting.v_bulletin b JOIN ins j ON j.id = b.inscription_id
                 WHERE j.classe_id = i.classe_id AND b.periode_id = ${periode?.id ?? null}) AS reussite,
               COALESCE((SELECT round(sum(a.duree_minutes) / 60.0)::int FROM reporting.v_absence a JOIN structure.periode p ON p.id = ${periode?.id ?? null}
                 WHERE a.classe_id = i.classe_id AND a.jour BETWEEN p.date_debut AND p.date_fin), 0) AS heures,
               (SELECT round(100.0 * sum(e.verse) / NULLIF(sum(e.a_payer), 0))::int FROM reporting.v_echeance e WHERE e.classe_id = i.classe_id AND e.annee_id = ${annee.id}) AS recouvrement
          FROM ins i GROUP BY i.classe_id, i.classe, i.sous_systeme, i.niveau_rang ORDER BY i.sous_systeme DESC, i.niveau_rang, i.classe`);
      colonnes = [{ titre: 'Classe', largeur: 80 }, { titre: 'Effectif', largeur: 60, droite: true }, { titre: 'Moyenne', largeur: 70, droite: true },
        { titre: 'Réussite', largeur: 70, droite: true }, { titre: 'Absences (h)', largeur: 80, droite: true }, { titre: 'Recouvrement', largeur: 85, droite: true }];
      const virgule = (x: number | null) => (x === null ? '–' : x.toFixed(2).replace('.', ','));
      lignes = rows.map((r) => [r.classe, n(r.effectif), virgule(r.moyenne === null ? null : Number(r.moyenne)), r.reussite === null ? '–' : `${r.reussite} %`, n(r.heures),
        r.recouvrement === null ? '–' : `${r.recouvrement} %`]);
      sousTitre += periode ? ` · ${periode.libelle}` : '';
    }
    await app.bd.transaction(ctx.compteId, (tx) => journaliser(tx, ctx, { action: 'Export', objetType: 'Pilotage', objetLibelle: `Rapport · ${RAPPORTS[req.params.type]}`, avant: '–', apres: 'PDF' }));
    const pdf = await pdfTableau({ etablissement: identite!, titre: RAPPORTS[req.params.type], sousTitre, colonnes, lignes });
    return rep.type('application/pdf').header('content-disposition', `inline; filename="rapport-${req.params.type}.pdf"`).send(Buffer.from(pdf));
  });
}
