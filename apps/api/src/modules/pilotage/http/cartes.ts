// Tableau de bord personnalisable (D-41) : jusqu'à six cartes par utilisateur, chacune avec son indicateur, son regroupement,
// ses filtres et sa forme (barres, courbe, anneau, tableau). Lectures des vues de reporting et des tables, jamais d'écriture métier.
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { sql, type SQL } from 'drizzle-orm';
import { exiger } from '../../../core/session.ts';
import { ErreurMetier, interdit } from '../../../core/erreurs.ts';
import type { Contexte } from '../../../core/contexte.ts';
import { anneeOuverte } from '../../structure/index.ts';

type Par = 'classe' | 'niveau' | 'section' | 'sexe' | 'jour' | 'mois' | 'mode';
interface Indicateur { libelle: string; unite: string; permissions: string[]; par: Par[]; periode: 'duree' | 'periode' | null }

/** Catalogue des indicateurs ; chacun exige une permission de portée établissement. */
const INDICATEURS: Record<string, Indicateur> = {
  effectifs: { libelle: 'Élèves inscrits', unite: 'élèves', permissions: ['scolarite.eleve.consulter', 'pilotage.tableau.consulter'], par: ['classe', 'niveau', 'section', 'sexe'], periode: null },
  encaissements: { libelle: 'Encaissements', unite: 'FCFA', permissions: ['caisse.consulter', 'pilotage.tableau.consulter'], par: ['jour', 'mois', 'mode', 'classe', 'section'], periode: 'duree' },
  reste_du: { libelle: 'Reste dû', unite: 'FCFA', permissions: ['finances.impaye.consulter', 'pilotage.tableau.consulter'], par: ['classe', 'niveau', 'section'], periode: null },
  recouvrement: { libelle: 'Taux de recouvrement', unite: '%', permissions: ['finances.impaye.consulter', 'pilotage.tableau.consulter'], par: ['classe', 'niveau', 'section'], periode: null },
  absences: { libelle: 'Absences', unite: 'absences', permissions: ['vie_scolaire.dossier.consulter', 'pilotage.tableau.consulter'], par: ['jour', 'mois', 'classe', 'section', 'sexe'], periode: 'duree' },
  moyennes: { libelle: 'Moyenne générale', unite: '/20', permissions: ['pedagogie.bulletin.publier', 'pilotage.statistiques.consulter', 'pilotage.tableau.consulter'], par: ['classe', 'niveau', 'section', 'sexe'], periode: 'periode' },
};
const LIBELLES_PAR: Record<Par, string> = { classe: 'Classe', niveau: 'Niveau', section: 'Section', sexe: 'Sexe', jour: 'Jour', mois: 'Mois', mode: 'Mode de paiement' };
const DUREES = { '7j': 7, '30j': 30, '90j': 90, annee: 400 } as const;
const MODES: Record<string, string> = { especes: 'Espèces', versement_bancaire: 'Versement bancaire', virement: 'Virement', cheque: 'Chèque' };
const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

const Carte = z.object({
  id: z.string().min(1).max(40),
  indicateur: z.enum(Object.keys(INDICATEURS) as [string, ...string[]]),
  par: z.enum(['classe', 'niveau', 'section', 'sexe', 'jour', 'mois', 'mode']),
  forme: z.enum(['barres', 'courbe', 'anneau', 'tableau']),
  section: z.enum(['toutes', 'francophone', 'anglophone']).default('toutes'),
  classeId: z.uuid().nullable().default(null),
  duree: z.enum(['7j', '30j', '90j', 'annee']).default('30j'),
  periodeId: z.uuid().nullable().default(null),
});
type CarteT = z.infer<typeof Carte>;

/** « 125 000 FCFA » (espace fine, comme l'application web). */
const fcfa = (n: number) => `${String(Math.round(Number(n))).replace(/\B(?=(\d{3})+(?!\d))/g, '\u202f')} FCFA`;
const permis = (ctx: Contexte, i: Indicateur) => i.permissions.some((p) => ctx.portee(p) === 'etablissement');
const PAR_DEFAUT: Omit<CarteT, 'id'>[] = [
  { indicateur: 'effectifs', par: 'classe', forme: 'barres', section: 'toutes', classeId: null, duree: '30j', periodeId: null },
  { indicateur: 'encaissements', par: 'jour', forme: 'courbe', section: 'toutes', classeId: null, duree: '30j', periodeId: null },
  { indicateur: 'recouvrement', par: 'classe', forme: 'barres', section: 'toutes', classeId: null, duree: '30j', periodeId: null },
  { indicateur: 'effectifs', par: 'section', forme: 'anneau', section: 'toutes', classeId: null, duree: '30j', periodeId: null },
  { indicateur: 'absences', par: 'jour', forme: 'courbe', section: 'toutes', classeId: null, duree: '30j', periodeId: null },
  { indicateur: 'moyennes', par: 'classe', forme: 'tableau', section: 'toutes', classeId: null, duree: '30j', periodeId: null },
];

export async function routesCartes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const LECTURE = { unePermissionParmi: ['pilotage.tableau.consulter', 'scolarite.eleve.consulter', 'caisse.consulter', 'finances.impaye.consulter'] };

  /** Cartes de l'utilisateur (ou cartes par défaut), catalogue des indicateurs qu'il peut voir, classes et périodes pour les filtres. */
  r.get('/pilotage/cartes', { config: LECTURE, schema: { tags: ['pilotage'] } }, async (req) => {
    const ctx = exiger(req);
    const annee = await anneeOuverte(app.bd, ctx.etablissementId);
    const catalogue = Object.entries(INDICATEURS).filter(([, i]) => permis(ctx, i))
      .map(([code, i]) => ({ code, libelle: i.libelle, unite: i.unite, periode: i.periode, par: i.par.map((p) => ({ code: p, libelle: LIBELLES_PAR[p] })) }));
    const pref = await app.bd.lireUn<{ valeur: CarteT[] }>(sql`SELECT valeur FROM core.preference WHERE compte_id = ${ctx.compteId} AND cle = 'tableau_de_bord'`);
    const codes = new Set(catalogue.map((c) => c.code));
    const cartes = (pref?.valeur ?? PAR_DEFAUT.map((c, i) => ({ ...c, id: `c${i + 1}` }))).filter((c) => codes.has(c.indicateur));
    const classes = annee ? await app.bd.lire(sql`
      SELECT c.id, c.nom, cy.sous_systeme AS section FROM structure.classe c JOIN structure.niveau n ON n.id = c.niveau_id JOIN structure.cycle cy ON cy.id = n.cycle_id
       WHERE c.annee_id = ${annee.id} ORDER BY cy.sous_systeme DESC, n.rang, c.nom`) : [];
    const periodes = annee ? await app.bd.lire(sql`SELECT id, libelle_fr AS libelle FROM structure.periode WHERE annee_id = ${annee.id} ORDER BY ordre`) : [];
    return { personnalise: !!pref?.valeur, cartes, catalogue, classes, periodes };
  });

  r.put('/pilotage/cartes', { config: LECTURE, schema: { tags: ['pilotage'], body: z.object({ cartes: z.array(Carte).max(6) }) } }, async (req) => {
    const ctx = exiger(req);
    for (const c of req.body.cartes) {
      const i = INDICATEURS[c.indicateur]!;
      if (!permis(ctx, i)) throw interdit(i.permissions[0]!);
      if (!i.par.includes(c.par)) throw new ErreurMetier('PIL_REGROUPEMENT', 422, `« ${i.libelle} » ne se regroupe pas par ${LIBELLES_PAR[c.par].toLowerCase()}.`, 'par');
    }
    await app.bd.transaction(ctx.compteId, async (tx) => {
      await tx.execute(sql`
        INSERT INTO core.preference (compte_id, etablissement_id, cle, valeur) VALUES (${ctx.compteId}, ${ctx.etablissementId}, 'tableau_de_bord', ${JSON.stringify(req.body.cartes)}::jsonb)
        ON CONFLICT (compte_id, cle) DO UPDATE SET valeur = EXCLUDED.valeur`);
    });
    return { ok: true };
  });

  /** Retour aux cartes par défaut. */
  r.delete('/pilotage/cartes', { config: LECTURE, schema: { tags: ['pilotage'] } }, async (req) => {
    const ctx = exiger(req);
    await app.bd.transaction(ctx.compteId, async (tx) => {
      await tx.execute(sql`UPDATE core.preference SET valeur = 'null'::jsonb WHERE compte_id = ${ctx.compteId} AND cle = 'tableau_de_bord'`);
    });
    return { ok: true };
  });

  /** Chiffres clés en tête du tableau de bord : chacun n'apparaît qu'avec la permission de son indicateur. */
  r.get('/pilotage/chiffres', { config: LECTURE, schema: { tags: ['pilotage'] } }, async (req) => {
    const ctx = exiger(req);
    const etab = ctx.etablissementId;
    const annee = await anneeOuverte(app.bd, etab);
    if (!annee) return { chiffres: [] };
    const chiffres: { code: string; libelle: string; valeur: number; unite: string; detail: string }[] = [];
    const actives = sql`i.annee_id = ${annee.id} AND i.etablissement_id = ${etab} AND i.statut IN ('attente', 'validee')`;
    const jour = sql`(now() AT TIME ZONE 'Africa/Douala')::date`;
    if (permis(ctx, INDICATEURS.effectifs!)) {
      const e = (await app.bd.lireUn<{ n: number; f: number }>(sql`
        SELECT count(*)::int AS n, count(*) FILTER (WHERE e.sexe = 'F')::int AS f
          FROM scolarite.inscription i JOIN scolarite.eleve e ON e.id = i.eleve_id WHERE ${actives}`))!;
      chiffres.push({ code: 'eleves', libelle: 'Élèves inscrits', valeur: e.n, unite: 'élèves', detail: `${e.f} filles · ${e.n - e.f} garçons` });
    }
    if (permis(ctx, INDICATEURS.encaissements!)) {
      const v = (await app.bd.lireUn<{ mois: number; jour: number }>(sql`
        SELECT COALESCE(sum(v.montant) FILTER (WHERE date_trunc('month', (v.encaisse_le AT TIME ZONE 'Africa/Douala')::date) = date_trunc('month', ${jour})), 0)::bigint AS mois,
               COALESCE(sum(v.montant) FILTER (WHERE (v.encaisse_le AT TIME ZONE 'Africa/Douala')::date = ${jour}), 0)::bigint AS jour
          FROM finances.versement v WHERE v.etablissement_id = ${etab} AND v.statut = 'valide'
           AND v.encaisse_le >= date_trunc('month', ${jour}) - interval '1 day'`))!;
      chiffres.push({ code: 'encaisse', libelle: 'Encaissé ce mois', valeur: Number(v.mois), unite: 'FCFA', detail: `aujourd’hui : ${fcfa(v.jour)}` });
    }
    if (permis(ctx, INDICATEURS.recouvrement!)) {
      const s = (await app.bd.lireUn<{ taux: number | null; reste: number }>(sql`
        SELECT round(100.0 * sum(s.verse) / nullif(sum(s.a_payer), 0))::int AS taux, COALESCE(sum(s.reste), 0)::bigint AS reste
          FROM scolarite.inscription i JOIN reporting.v_solde s ON s.inscription_id = i.id WHERE ${actives}`))!;
      chiffres.push({ code: 'recouvrement', libelle: 'Taux de recouvrement', valeur: s.taux ?? 0, unite: '%', detail: `reste dû : ${fcfa(s.reste)}` });
    }
    if (permis(ctx, INDICATEURS.absences!)) {
      const a = (await app.bd.lireUn<{ absents: number; faites: number; classes: number }>(sql`
        SELECT (SELECT count(DISTINCT a.inscription_id)::int FROM vie_scolaire.absence a WHERE a.etablissement_id = ${etab} AND a.jour = ${jour}) AS absents,
               (SELECT count(DISTINCT f.classe_id)::int FROM vie_scolaire.fiche_appel f WHERE f.etablissement_id = ${etab} AND f.jour = ${jour} AND f.statut = 'faite') AS faites,
               (SELECT count(*)::int FROM structure.classe c WHERE c.annee_id = ${annee.id}) AS classes`))!;
      chiffres.push({ code: 'absents', libelle: 'Absents aujourd’hui', valeur: a.absents, unite: 'élèves',
        detail: a.faites ? `appel fait dans ${a.faites} classe${a.faites > 1 ? 's' : ''} sur ${a.classes}` : 'aucun appel fait aujourd’hui' });
    }
    return { chiffres };
  });

  /** Données d'une carte : une série de points { libellé, valeur } dans l'unité de l'indicateur. */
  r.get('/pilotage/cartes/donnees', { config: LECTURE, schema: { tags: ['pilotage'], querystring: Carte.omit({ id: true, forme: true }) } }, async (req) => {
    const ctx = exiger(req);
    const q = req.query;
    const i = INDICATEURS[q.indicateur]!;
    if (!permis(ctx, i)) throw interdit(i.permissions[0]!);
    if (!i.par.includes(q.par)) throw new ErreurMetier('PIL_REGROUPEMENT', 422, `« ${i.libelle} » ne se regroupe pas par ${LIBELLES_PAR[q.par].toLowerCase()}.`, 'par');
    const annee = await anneeOuverte(app.bd, ctx.etablissementId);
    if (!annee) return { unite: i.unite, points: [], sous: 'Aucune année scolaire ouverte' };
    const etab = ctx.etablissementId;
    const section = q.section === 'toutes' ? sql`true` : sql`cy.sous_systeme = ${q.section}`;
    const classe = q.classeId ? sql`c.id = ${q.classeId}` : sql`true`;
    const jours = DUREES[q.duree];
    const depuis = sql`(now() AT TIME ZONE 'Africa/Douala')::date - ${jours - 1}::int`;
    // Clé et libellé de regroupement ; ordre d'affichage (rang du niveau pour les classes).
    const groupe: Record<Par, { cle: SQL; libelle: SQL; ordre: SQL }> = {
      classe: { cle: sql`c.id::text`, libelle: sql`c.nom`, ordre: sql`min(cy.sous_systeme) DESC, min(n.rang), c.nom` },
      niveau: { cle: sql`n.code`, libelle: sql`n.code`, ordre: sql`min(cy.sous_systeme) DESC, min(n.rang)` },
      section: { cle: sql`cy.sous_systeme`, libelle: sql`CASE cy.sous_systeme WHEN 'francophone' THEN 'Francophone' ELSE 'Anglophone' END`, ordre: sql`cy.sous_systeme DESC` },
      sexe: { cle: sql`e.sexe`, libelle: sql`CASE e.sexe WHEN 'M' THEN 'Garçons' ELSE 'Filles' END`, ordre: sql`e.sexe DESC` },
      jour: { cle: sql`d::date::text`, libelle: sql`to_char(d, 'DD/MM')`, ordre: sql`min(d)` },
      mois: { cle: sql`to_char(d, 'YYYY-MM')`, libelle: sql`to_char(d, 'YYYY-MM')`, ordre: sql`min(d)` },
      mode: { cle: sql`v.mode`, libelle: sql`v.mode`, ordre: sql`sum(v.montant) DESC` },
    };
    const g = groupe[q.par];
    const base = sql`FROM scolarite.inscription i JOIN scolarite.eleve e ON e.id = i.eleve_id JOIN structure.classe c ON c.id = i.classe_id
                     JOIN structure.niveau n ON n.id = c.niveau_id JOIN structure.cycle cy ON cy.id = n.cycle_id`;
    const actives = sql`i.annee_id = ${annee.id} AND i.etablissement_id = ${etab} AND i.statut IN ('attente', 'validee') AND ${section} AND ${classe}`;
    let lignes: { cle: string; libelle: string; valeur: number | null }[] = [];
    let sous = '';
    switch (q.indicateur) {
      case 'effectifs':
        lignes = await app.bd.lire(sql`SELECT ${g.cle} AS cle, ${g.libelle} AS libelle, count(*)::int AS valeur ${base} WHERE ${actives} GROUP BY 1, 2 ORDER BY ${g.ordre}`);
        sous = `Année ${annee.libelle}`;
        break;
      case 'reste_du':
      case 'recouvrement': {
        const valeur = q.indicateur === 'reste_du' ? sql`sum(s.reste)::bigint` : sql`round(100.0 * sum(s.verse) / nullif(sum(s.a_payer), 0))::int`;
        lignes = await app.bd.lire(sql`SELECT ${g.cle} AS cle, ${g.libelle} AS libelle, ${valeur} AS valeur ${base} JOIN reporting.v_solde s ON s.inscription_id = i.id
                                       WHERE ${actives} GROUP BY 1, 2 ORDER BY ${g.ordre}`);
        sous = `Année ${annee.libelle}`;
        break;
      }
      case 'encaissements': {
        const jourV = sql`(v.encaisse_le AT TIME ZONE 'Africa/Douala')::date`;
        const filtre = sql`v.etablissement_id = ${etab} AND v.statut = 'valide' AND ${jourV} >= ${depuis} AND ${section} AND ${classe}`;
        const joint = sql`FROM finances.versement v JOIN scolarite.inscription i ON i.id = v.inscription_id JOIN structure.classe c ON c.id = i.classe_id
                          JOIN structure.niveau n ON n.id = c.niveau_id JOIN structure.cycle cy ON cy.id = n.cycle_id`;
        if (q.par === 'jour' || q.par === 'mois') {
          // Tous les jours d'ouverture de la caisse (dimanche exclu), même sans encaissement ; le jour en cours dès son premier encaissement.
          lignes = await app.bd.lire(sql`
            WITH v AS (SELECT ${jourV} AS jv, sum(v.montant)::bigint AS m ${joint} WHERE ${filtre} GROUP BY 1)
            SELECT ${g.cle} AS cle, ${g.libelle} AS libelle, COALESCE(sum(v.m), 0)::bigint AS valeur
              FROM generate_series(${depuis}, (now() AT TIME ZONE 'Africa/Douala')::date, interval '1 day') AS d LEFT JOIN v ON v.jv = d::date
             WHERE extract(isodow FROM d) <> 7 AND (d::date < (now() AT TIME ZONE 'Africa/Douala')::date OR v.m IS NOT NULL)
             GROUP BY 1, 2 ORDER BY ${g.ordre}`);
        } else {
          lignes = await app.bd.lire(sql`SELECT ${g.cle} AS cle, ${g.libelle} AS libelle, sum(v.montant)::bigint AS valeur ${joint} WHERE ${filtre} GROUP BY 1, 2 ORDER BY ${g.ordre}`);
        }
        break;
      }
      case 'absences': {
        const filtre = sql`a.etablissement_id = ${etab} AND a.jour >= ${depuis} AND ${section} AND ${classe}`;
        const joint = sql`FROM vie_scolaire.absence a JOIN scolarite.inscription i ON i.id = a.inscription_id JOIN scolarite.eleve e ON e.id = i.eleve_id
                          JOIN structure.classe c ON c.id = i.classe_id JOIN structure.niveau n ON n.id = c.niveau_id JOIN structure.cycle cy ON cy.id = n.cycle_id`;
        if (q.par === 'jour' || q.par === 'mois') {
          // Jours de classe seulement (un appel fait ou une absence notée) : pas de faux zéro les jours sans école ni pour la journée en cours.
          lignes = await app.bd.lire(sql`
            WITH a AS (SELECT a.jour AS ja, count(*)::int AS n ${joint} WHERE ${filtre} GROUP BY 1)
            SELECT ${g.cle} AS cle, ${g.libelle} AS libelle, COALESCE(sum(a.n), 0)::int AS valeur
              FROM generate_series(${depuis}, (now() AT TIME ZONE 'Africa/Douala')::date, interval '1 day') AS d LEFT JOIN a ON a.ja = d::date
             WHERE a.n IS NOT NULL OR (d::date < (now() AT TIME ZONE 'Africa/Douala')::date
                   AND EXISTS (SELECT 1 FROM vie_scolaire.fiche_appel f WHERE f.etablissement_id = ${etab} AND f.jour = d::date AND f.statut = 'faite'))
             GROUP BY 1, 2 ORDER BY ${g.ordre}`);
        } else {
          lignes = await app.bd.lire(sql`SELECT ${g.cle} AS cle, ${g.libelle} AS libelle, count(*)::int AS valeur ${joint} WHERE ${filtre} GROUP BY 1, 2 ORDER BY ${g.ordre}`);
        }
        break;
      }
      case 'moyennes': {
        // Période choisie, sinon la dernière période dont des bulletins sont publiés.
        const periode = q.periodeId ?? (await app.bd.lireUn<{ id: string }>(sql`
          SELECT p.id FROM structure.periode p WHERE p.annee_id = ${annee.id}
             AND EXISTS (SELECT 1 FROM pedagogie.bulletin b WHERE b.periode_id = p.id AND b.statut = 'publie') ORDER BY p.ordre DESC LIMIT 1`))?.id;
        if (!periode) return { unite: i.unite, points: [], sous: 'Aucun bulletin publié cette année' };
        sous = (await app.bd.lireUn<{ l: string }>(sql`SELECT libelle_fr AS l FROM structure.periode WHERE id = ${periode}`))?.l ?? '';
        lignes = await app.bd.lire(sql`SELECT ${g.cle} AS cle, ${g.libelle} AS libelle, round(avg(b.moyenne)::numeric, 2)::float AS valeur ${base}
                                       JOIN pedagogie.bulletin b ON b.inscription_id = i.id AND b.periode_id = ${periode} AND b.statut = 'publie'
                                       WHERE ${actives} GROUP BY 1, 2 ORDER BY ${g.ordre}`);
        break;
      }
    }
    if (q.par === 'mode') lignes = lignes.map((l) => ({ ...l, libelle: MODES[l.libelle] ?? l.libelle }));
    if (q.par === 'mois') lignes = lignes.map((l) => ({ ...l, libelle: `${MOIS[Number(l.libelle.slice(5, 7)) - 1]} ${l.libelle.slice(0, 4)}` }));
    if (i.periode === 'duree') sous = { '7j': '7 derniers jours', '30j': '30 derniers jours', '90j': '3 derniers mois', annee: 'Depuis la rentrée' }[q.duree];
    return { unite: i.unite, sous, points: lignes.map((l) => ({ cle: l.cle, libelle: l.libelle, valeur: l.valeur === null ? null : Number(l.valeur) })) };
  });
}
