// CU-14 sessions de caisse (RG-17, RG-18) ; CU-15 sorties de caisse (RG-19) ; budgets par catégorie.
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { sql, ligne, lignes } from '../../../core/bd.ts';
import { ErreurMetier, interdit, introuvable } from '../../../core/erreurs.ts';
import { exiger } from '../../../core/session.ts';
import { journaliser } from '../../../core/audit.ts';
import { anneeOuverteTx, cleCompteur, FORMATS, prochainNumero } from '../../structure/index.ts';
import { ajouterMouvement, exigerSession, sessionOuverte } from '../index.ts';
import { ecartDeCloture, especesAttendues } from '../domain/cloture.ts';

const Uuid = z.uuid();
const Montant = z.number().int().positive().max(100_000_000);
const MODES: Record<string, string> = { especes: 'Espèces', versement_bancaire: 'Versement bancaire', virement: 'Virement', cheque: 'Chèque' };
const OPERATIONS: Record<string, string> = { versement: 'Versement', entree_diverse: 'Entrée diverse', sortie: 'Sortie', annulation: 'Annulation', versement_banque: 'Versement à la banque' };
const CATEGORIES_DEFAUT = ['Fournitures', 'Entretien', 'Eau et électricité', 'Personnel vacataire', 'Sport'];

export async function routesCaisse(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  async function totaux(sessionId: string) {
    const t = await app.bd.lireUn<{ scolarite: number; nb_versements: number; autres: number; nb_autres: number; sorties: number; nb_sorties: number;
      entrees_especes: number; sorties_especes: number; bancaires: number; nb_bancaires: number; virements: number; nb_virements: number; cheques: number; nb_cheques: number }>(sql`
      SELECT COALESCE(sum(montant) FILTER (WHERE nature = 'versement'), 0)::bigint AS scolarite,
             count(*) FILTER (WHERE nature = 'versement')::int AS nb_versements,
             COALESCE(sum(montant) FILTER (WHERE nature = 'entree_diverse'), 0)::bigint AS autres,
             count(*) FILTER (WHERE nature = 'entree_diverse')::int AS nb_autres,
             COALESCE(sum(montant) FILTER (WHERE sens = 'sortie'), 0)::bigint AS sorties,
             count(*) FILTER (WHERE sens = 'sortie')::int AS nb_sorties,
             COALESCE(sum(montant) FILTER (WHERE sens = 'entree' AND mode = 'especes'), 0)::bigint AS entrees_especes,
             COALESCE(sum(montant) FILTER (WHERE sens = 'sortie' AND mode = 'especes'), 0)::bigint AS sorties_especes,
             COALESCE(sum(montant) FILTER (WHERE mode = 'versement_bancaire' AND sens = 'entree'), 0)::bigint AS bancaires,
             count(*) FILTER (WHERE mode = 'versement_bancaire' AND sens = 'entree')::int AS nb_bancaires,
             COALESCE(sum(montant) FILTER (WHERE mode = 'virement'), 0)::bigint AS virements, count(*) FILTER (WHERE mode = 'virement')::int AS nb_virements,
             COALESCE(sum(montant) FILTER (WHERE mode = 'cheque'), 0)::bigint AS cheques, count(*) FILTER (WHERE mode = 'cheque')::int AS nb_cheques
        FROM caisse.mouvement WHERE session_id = ${sessionId}`);
    return Object.fromEntries(Object.entries(t!).map(([k, v]) => [k, Number(v)])) as Record<string, number>;
  }

  r.get('/caisse/journee', { config: { unePermissionParmi: ['caisse.session.gerer', 'caisse.consulter'] }, schema: { tags: ['caisse'], querystring: z.object({ sessionId: Uuid.optional() }) } }, async (req) => {
    const ctx = exiger(req);
    const s = await app.bd.lireUn<{ id: string; caisse: string; ouverte_le: string; cloturee_le: string | null; fonds_initial: number; caissier: string; caissier_id: string;
      montant_compte: number | null; ecart: number | null; motif_ecart: string | null }>(sql`
      SELECT s.id, s.caisse, s.ouverte_le, s.cloturee_le, s.fonds_initial, c.nom_affiche AS caissier, s.caissier_id, s.montant_compte, s.ecart, s.motif_ecart
        FROM caisse.session s JOIN core.compte c ON c.id = s.caissier_id
       WHERE s.etablissement_id = ${ctx.etablissementId}
         AND (${req.query.sessionId ?? null}::uuid IS NOT NULL AND s.id = ${req.query.sessionId ?? null}::uuid
              OR ${req.query.sessionId ?? null}::uuid IS NULL AND (s.caissier_id = ${ctx.compteId} OR ${!ctx.a('caisse.session.gerer')}))
       ORDER BY (s.cloturee_le IS NULL) DESC, s.ouverte_le DESC LIMIT 1`);
    const autres = ctx.a('caisse.consulter') ? await app.bd.lire(sql`
      SELECT s.id, s.caisse, s.ouverte_le AS "ouverteLe", c.nom_affiche AS caissier FROM caisse.session s JOIN core.compte c ON c.id = s.caissier_id
       WHERE s.etablissement_id = ${ctx.etablissementId} AND s.cloturee_le IS NULL ORDER BY s.ouverte_le`) : [];
    if (!s) return { session: null, ouvrable: ctx.a('caisse.session.gerer'), sessionsOuvertes: autres };
    const t = await totaux(s.id);
    const operations = await app.bd.lire<{ horodatage: string; nature: string; libelle: string; mode: string; montant: number; sens: string }>(sql`
      SELECT horodatage, nature, libelle, mode, montant, sens FROM caisse.mouvement WHERE session_id = ${s.id} ORDER BY horodatage`);
    const attendues = especesAttendues(Number(s.fonds_initial), t['entrees_especes']!, t['sorties_especes']!);
    return {
      session: { id: s.id, caisse: s.caisse, ouverteLe: s.ouverte_le, clotureeLe: s.cloturee_le, fondsInitial: Number(s.fonds_initial), caissier: s.caissier,
        estMienne: s.caissier_id === ctx.compteId, montantCompte: s.montant_compte, ecart: s.ecart, motifEcart: s.motif_ecart },
      kpi: { scolarite: t['scolarite'], nbVersements: t['nb_versements'], autres: t['autres'], nbAutres: t['nb_autres'], sorties: t['sorties'], nbSorties: t['nb_sorties'], attendues },
      operations: [
        { horodatage: s.ouverte_le, operation: 'Ouverture', libelle: 'Fonds initial', mode: 'Espèces', montant: Number(s.fonds_initial) },
        ...operations.map((o) => ({ horodatage: o.horodatage, operation: OPERATIONS[o.nature], libelle: o.libelle, mode: MODES[o.mode] ?? o.mode,
          montant: o.sens === 'sortie' ? -Number(o.montant) : Number(o.montant) })),
      ],
      cloture: { especes: attendues, bancaires: t['bancaires'], nbBancaires: t['nb_bancaires'], virements: t['virements'], nbVirements: t['nb_virements'],
        cheques: t['cheques'], nbCheques: t['nb_cheques'] },
      sessionsOuvertes: autres,
    };
  });

  r.post('/caisse/sessions', {
    config: { permission: 'caisse.session.gerer' },
    schema: { tags: ['caisse'], body: z.object({ caisse: z.enum(['principale', 'ape']), fondsInitial: z.number().int().min(0).max(100_000_000) }) },
  }, async (req) => {
    const ctx = exiger(req);
    return app.bd.transaction(ctx.compteId, async (tx) => {
      if (await sessionOuverte(tx, ctx.compteId)) throw new ErreurMetier('CAI_SESSION_DEJA_OUVERTE', 422, 'Votre session de caisse est déjà ouverte.');
      const veille = await ligne(tx, sql`SELECT 1 FROM caisse.session WHERE caissier_id = ${ctx.compteId} AND cloturee_le IS NULL AND ouverte_le::date < current_date`);
      if (veille) throw new ErreurMetier('CAI_SESSION_VEILLE', 422, 'Une session de la veille est restée ouverte : le directeur doit la clôturer (CU-14).');
      const s = await ligne<{ id: string }>(tx, sql`
        INSERT INTO caisse.session (etablissement_id, caisse, caissier_id, fonds_initial, cree_par)
        VALUES (${ctx.etablissementId}, ${req.body.caisse}, ${ctx.compteId}, ${req.body.fondsInitial}, ${ctx.compteId}) RETURNING id`);
      await journaliser(tx, ctx, { action: 'Création', objetType: 'Caisse', objetLibelle: `Session · caisse ${req.body.caisse === 'ape' ? 'APE' : 'principale'}`,
        avant: '–', apres: `Ouverte · fonds initial ${req.body.fondsInitial.toLocaleString('fr-FR')} FCFA`, ligneId: s!.id, table: 'caisse.session' });
      return { id: s!.id };
    });
  });

  r.post('/caisse/sessions/:id/cloture', {
    config: { unePermissionParmi: ['caisse.session.gerer', 'caisse.session.forcer'] },
    schema: { tags: ['caisse'], params: z.object({ id: Uuid }), body: z.object({ montantCompte: z.number().int().min(0).max(100_000_000), motifEcart: z.string().trim().max(200).nullish() }) },
  }, async (req) => {
    const ctx = exiger(req);
    return app.bd.transaction(ctx.compteId, async (tx) => {
      const s = await ligne<{ caissier_id: string; fonds_initial: number; cloturee_le: string | null; caisse: string }>(tx, sql`
        SELECT caissier_id, fonds_initial, cloturee_le, caisse FROM caisse.session WHERE id = ${req.params.id} AND etablissement_id = ${ctx.etablissementId} FOR UPDATE`);
      if (!s) throw introuvable('Session');
      if (s.cloturee_le) throw new ErreurMetier('CAI_SESSION_CLOTUREE', 422, 'Une session clôturée ne se modifie plus.');
      // Chaque personne clôture sa session ; le directeur seul force la clôture d'une autre (CU-14).
      if (s.caissier_id !== ctx.compteId && !ctx.a('caisse.session.forcer')) throw interdit('caisse.session.forcer');
      const t = await ligne<{ e: number; s: number }>(tx, sql`
        SELECT COALESCE(sum(montant) FILTER (WHERE sens = 'entree' AND mode = 'especes'), 0)::bigint AS e,
               COALESCE(sum(montant) FILTER (WHERE sens = 'sortie' AND mode = 'especes'), 0)::bigint AS s FROM caisse.mouvement WHERE session_id = ${req.params.id}`);
      const ecart = ecartDeCloture(req.body.montantCompte, Number(s.fonds_initial), Number(t!.e), Number(t!.s), req.body.motifEcart);
      await tx.execute(sql`UPDATE caisse.session SET cloturee_le = now(), montant_compte = ${req.body.montantCompte}, ecart = ${ecart},
                           motif_ecart = ${req.body.motifEcart ?? null} WHERE id = ${req.params.id}`);
      await journaliser(tx, ctx, { action: 'Modification', objetType: 'Caisse', objetLibelle: `Clôture · caisse ${s.caisse === 'ape' ? 'APE' : 'principale'}${s.caissier_id !== ctx.compteId ? ' · forcée' : ''}`,
        avant: 'Ouverte', apres: `Clôturée · écart ${ecart.toLocaleString('fr-FR')} FCFA`, ligneId: req.params.id, table: 'caisse.session' });
      return { ecart };
    });
  });

  r.post('/caisse/entrees', {
    config: { permission: 'caisse.entree.enregistrer' }, schema: { tags: ['caisse'], body: z.object({ libelle: z.string().trim().min(3).max(120), montant: Montant }) },
  }, async (req) => {
    const ctx = exiger(req);
    return app.bd.transaction(ctx.compteId, async (tx) => {
      const s = await exigerSession(tx, ctx.compteId);
      await ajouterMouvement(tx, ctx.etablissementId, { sessionId: s.id, sens: 'entree', nature: 'entree_diverse', mode: 'especes', montant: req.body.montant, libelle: req.body.libelle, par: ctx.compteId });
      await journaliser(tx, ctx, { action: 'Création', objetType: 'Caisse', objetLibelle: `Entrée diverse · ${req.body.libelle}`, avant: '–', apres: `${req.body.montant.toLocaleString('fr-FR')} FCFA` });
      return { ok: true };
    });
  });

  r.post('/caisse/depots', {
    config: { permission: 'caisse.banque.verser' },
    schema: { tags: ['caisse'], body: z.object({ montant: Montant, banque: z.string().trim().min(2).max(80), bordereau: z.string().trim().min(2).max(40), deposeLe: z.iso.date() }) },
  }, async (req) => {
    const ctx = exiger(req);
    const b = req.body;
    return app.bd.transaction(ctx.compteId, async (tx) => {
      const s = await exigerSession(tx, ctx.compteId);
      const d = await ligne<{ id: string }>(tx, sql`
        INSERT INTO caisse.depot_banque (etablissement_id, session_id, montant, banque, bordereau, depose_le, saisi_par)
        VALUES (${ctx.etablissementId}, ${s.id}, ${b.montant}, ${b.banque}, ${b.bordereau}, ${b.deposeLe}, ${ctx.compteId}) RETURNING id`);
      await ajouterMouvement(tx, ctx.etablissementId, { sessionId: s.id, sens: 'sortie', nature: 'versement_banque', mode: 'especes', montant: b.montant,
        depotId: d!.id, par: ctx.compteId, libelle: `Versement à la banque · bordereau ${b.bordereau}` });
      await journaliser(tx, ctx, { action: 'Création', objetType: 'Caisse', objetLibelle: `Versement à la banque · bordereau ${b.bordereau}`, avant: '–', apres: `${b.montant.toLocaleString('fr-FR')} FCFA` });
      return { id: d!.id };
    });
  });

  // ------------------------------------------------------------- sorties et budgets (RG-19)

  async function assurerCategories(etab: string) {
    await app.bd.transaction(null, async (tx) => {
      const n = await ligne<{ n: number }>(tx, sql`SELECT count(*)::int AS n FROM caisse.categorie WHERE etablissement_id = ${etab}`);
      if (n!.n) return;
      let o = 0;
      for (const c of CATEGORIES_DEFAUT) await tx.execute(sql`INSERT INTO caisse.categorie (etablissement_id, libelle, ordre) VALUES (${etab}, ${c}, ${++o})`);
    });
  }

  r.get('/caisse/sorties', {
    config: { unePermissionParmi: ['caisse.sortie.demander', 'caisse.sortie.valider', 'caisse.sortie.decaisser', 'caisse.consulter'] }, schema: { tags: ['caisse'] },
  }, async (req) => {
    const ctx = exiger(req);
    await assurerCategories(ctx.etablissementId);
    const tous = ctx.a('caisse.consulter') || ctx.a('caisse.sortie.valider') || ctx.a('caisse.sortie.decaisser');
    const sorties = await app.bd.lire(sql`
      SELECT s.id, s.numero, s.demande_le AS "demandeLe", s.objet, c.nom_affiche AS demandeur, cat.libelle AS categorie, s.montant, s.statut,
             s.piece_nom AS piece, s.motif, s.motif_decision AS "motifDecision"
        FROM caisse.sortie s JOIN core.compte c ON c.id = s.demandeur JOIN caisse.categorie cat ON cat.id = s.categorie_id
       WHERE s.etablissement_id = ${ctx.etablissementId} AND (${tous} OR s.demandeur = ${ctx.compteId})
       ORDER BY s.demande_le DESC LIMIT 50`);
    const periode = await app.bd.lireUn<{ id: string; libelle_fr: string; date_debut: string; date_fin: string }>(sql`
      SELECT p.id, p.libelle_fr, p.date_debut, p.date_fin FROM structure.periode p JOIN structure.annee_scolaire a ON a.id = p.annee_id AND a.statut = 'ouverte'
       WHERE p.etablissement_id = ${ctx.etablissementId} AND current_date <= p.date_fin + 30 ORDER BY p.ordre LIMIT 1`);
    const budgets = periode ? await app.bd.lire<{ id: string; libelle: string; budget: number | null; consomme: number }>(sql`
      SELECT c.id, c.libelle, b.montant AS budget,
             COALESCE((SELECT sum(s.montant) FROM caisse.sortie s WHERE s.categorie_id = c.id AND s.statut IN ('validee', 'decaissee')
                        AND s.demande_le::date BETWEEN ${periode.date_debut} AND ${periode.date_fin}), 0)::bigint AS consomme
        FROM caisse.categorie c LEFT JOIN caisse.budget b ON b.categorie_id = c.id AND b.periode_id = ${periode.id}
       WHERE c.etablissement_id = ${ctx.etablissementId} ORDER BY c.ordre, c.libelle`) : [];
    return { periode: periode ? { id: periode.id, libelle: periode.libelle_fr } : null, sorties,
      budgets: budgets.map((b) => ({ ...b, consomme: Number(b.consomme), budget: b.budget === null ? null : Number(b.budget),
        pourcentage: b.budget ? Math.round((Number(b.consomme) * 100) / Number(b.budget)) : null })),
      categories: budgets.map((b) => ({ id: b.id, libelle: b.libelle })) };
  });

  r.post('/caisse/sorties', {
    config: { permission: 'caisse.sortie.demander' },
    schema: { tags: ['caisse'], body: z.object({ objet: z.string().trim().min(3).max(120), categorieId: Uuid, montant: Montant, motif: z.string().trim().min(3).max(200) }) },
  }, async (req) => {
    const ctx = exiger(req);
    const b = req.body;
    return app.bd.transaction(ctx.compteId, async (tx) => {
      const cat = await ligne(tx, sql`SELECT 1 FROM caisse.categorie WHERE id = ${b.categorieId} AND etablissement_id = ${ctx.etablissementId}`);
      if (!cat) throw introuvable('Catégorie');
      const annee = await anneeOuverteTx(tx, ctx.etablissementId);
      const numero = FORMATS.sortie(annee.annee_civile, await prochainNumero(tx, ctx.etablissementId, cleCompteur.sortie(annee.annee_civile)));
      const s = await ligne<{ id: string }>(tx, sql`
        INSERT INTO caisse.sortie (etablissement_id, numero, objet, categorie_id, montant, motif, demandeur)
        VALUES (${ctx.etablissementId}, ${numero}, ${b.objet}, ${b.categorieId}, ${b.montant}, ${b.motif}, ${ctx.compteId}) RETURNING id`);
      await journaliser(tx, ctx, { action: 'Demande', objetType: 'Sortie de caisse', objetLibelle: `Sortie ${numero} · ${b.objet}`, avant: '–',
        apres: `${b.montant.toLocaleString('fr-FR')} FCFA`, ligneId: s!.id, table: 'caisse.sortie' });
      return { id: s!.id, numero };
    });
  });

  r.post('/caisse/sorties/:id/decision', {
    config: { permission: 'caisse.sortie.valider' },
    schema: { tags: ['caisse'], params: z.object({ id: Uuid }), body: z.object({ decision: z.enum(['validee', 'refusee']), motif: z.string().trim().max(200).nullish() }) },
  }, async (req) => {
    const ctx = exiger(req);
    return app.bd.transaction(ctx.compteId, async (tx) => {
      const s = await ligne<{ statut: string; demandeur: string; numero: string; objet: string; montant: number }>(tx, sql`
        SELECT statut, demandeur, numero, objet, montant FROM caisse.sortie WHERE id = ${req.params.id} AND etablissement_id = ${ctx.etablissementId} FOR UPDATE`);
      if (!s) throw introuvable('Sortie');
      if (s.statut !== 'demandee') throw new ErreurMetier('CAI_DEJA_DECIDEE', 422, 'Cette demande a déjà été traitée.');
      // RG-19 : le directeur ne valide pas sa propre demande.
      if (s.demandeur === ctx.compteId) throw new ErreurMetier('CORE_SEPARATION_DES_TACHES', 403, 'Vous ne pouvez pas valider votre propre demande (RG-19).');
      await tx.execute(sql`UPDATE caisse.sortie SET statut = ${req.body.decision}, decideur = ${ctx.compteId}, decide_le = now(), motif_decision = ${req.body.motif ?? null}
                           WHERE id = ${req.params.id}`);
      await journaliser(tx, ctx, { action: req.body.decision === 'validee' ? 'Validation' : 'Refus', objetType: 'Sortie de caisse',
        objetLibelle: `Sortie ${s.numero} · ${s.objet}`, avant: 'À valider', apres: req.body.decision === 'validee' ? 'Validée' : 'Refusée',
        ligneId: req.params.id, table: 'caisse.sortie' });
      return { ok: true };
    });
  });

  r.post('/caisse/sorties/:id/decaissement', {
    config: { permission: 'caisse.sortie.decaisser' }, schema: { tags: ['caisse'], params: z.object({ id: Uuid }) },
  }, async (req) => {
    const ctx = exiger(req);
    return app.bd.transaction(ctx.compteId, async (tx) => {
      const s = await ligne<{ statut: string; numero: string; objet: string; montant: number }>(tx, sql`
        SELECT statut, numero, objet, montant FROM caisse.sortie WHERE id = ${req.params.id} AND etablissement_id = ${ctx.etablissementId} FOR UPDATE`);
      if (!s) throw introuvable('Sortie');
      if (s.statut !== 'validee') throw new ErreurMetier('CAI_SORTIE_NON_VALIDEE', 422, 'Seule une sortie validée par le directeur se décaisse (RG-19).');
      const session = await exigerSession(tx, ctx.compteId);
      await tx.execute(sql`UPDATE caisse.sortie SET statut = 'decaissee', session_id = ${session.id}, decaisse_le = now(), decaisse_par = ${ctx.compteId} WHERE id = ${req.params.id}`);
      await ajouterMouvement(tx, ctx.etablissementId, { sessionId: session.id, sens: 'sortie', nature: 'sortie', mode: 'especes', montant: Number(s.montant),
        sortieId: req.params.id, par: ctx.compteId, libelle: `${s.numero} · ${s.objet}` });
      await journaliser(tx, ctx, { action: 'Modification', objetType: 'Sortie de caisse', objetLibelle: `Sortie ${s.numero} · ${s.objet}`, avant: 'Validée', apres: 'Décaissée',
        ligneId: req.params.id, table: 'caisse.sortie' });
      return { ok: true };
    });
  });

  r.put('/caisse/sorties/:id/piece', {
    config: { permission: 'caisse.sortie.decaisser' }, bodyLimit: 4_000_000,
    schema: { tags: ['caisse'], params: z.object({ id: Uuid }), body: z.object({ nom: z.string().trim().min(2).max(60), base64: z.string().max(3_000_000), type: z.string().max(60) }) },
  }, async (req) => {
    const ctx = exiger(req);
    return app.bd.transaction(ctx.compteId, async (tx) => {
      const s = await ligne<{ statut: string; numero: string }>(tx, sql`SELECT statut, numero FROM caisse.sortie WHERE id = ${req.params.id} AND etablissement_id = ${ctx.etablissementId}`);
      if (!s) throw introuvable('Sortie');
      if (s.statut !== 'decaissee') throw new ErreurMetier('CAI_PIECE_APRES_DECAISSEMENT', 422, 'La pièce justificative se joint après le décaissement.');
      await tx.execute(sql`UPDATE caisse.sortie SET piece_nom = ${req.body.nom}, piece = ${Buffer.from(req.body.base64, 'base64')}, piece_type = ${req.body.type} WHERE id = ${req.params.id}`);
      await journaliser(tx, ctx, { action: 'Modification', objetType: 'Sortie de caisse', objetLibelle: `Sortie ${s.numero} · pièce justificative`, avant: '–', apres: req.body.nom });
      return { ok: true };
    });
  });

  r.get('/caisse/sorties/:id/piece', {
    config: { unePermissionParmi: ['caisse.sortie.decaisser', 'caisse.sortie.valider', 'caisse.consulter'] }, schema: { tags: ['caisse'], params: z.object({ id: Uuid }) },
  }, async (req, rep) => {
    const ctx = exiger(req);
    const s = await app.bd.lireUn<{ piece: Buffer | null; piece_type: string | null; piece_nom: string | null }>(sql`
      SELECT piece, piece_type, piece_nom FROM caisse.sortie WHERE id = ${req.params.id} AND etablissement_id = ${ctx.etablissementId}`);
    if (!s?.piece) throw introuvable('Pièce');
    return rep.type(s.piece_type ?? 'application/octet-stream').header('content-disposition', `inline; filename="${s.piece_nom}"`).send(s.piece);
  });

  r.post('/caisse/categories', {
    config: { permission: 'caisse.categorie.gerer' },
    schema: { tags: ['caisse'], body: z.object({ libelle: z.string().trim().min(2).max(60), budget: z.number().int().min(0).max(100_000_000).nullish() }) },
  }, async (req) => {
    const ctx = exiger(req);
    return app.bd.transaction(ctx.compteId, async (tx) => {
      const c = await ligne<{ id: string }>(tx, sql`
        INSERT INTO caisse.categorie (etablissement_id, libelle, ordre)
        VALUES (${ctx.etablissementId}, ${req.body.libelle}, (SELECT COALESCE(max(ordre), 0) + 1 FROM caisse.categorie WHERE etablissement_id = ${ctx.etablissementId}))
        ON CONFLICT (etablissement_id, libelle) DO UPDATE SET libelle = EXCLUDED.libelle RETURNING id`);
      if (req.body.budget !== undefined && req.body.budget !== null) await fixerBudget(tx, ctx.etablissementId, c!.id, req.body.budget);
      return { id: c!.id };
    });
  });

  r.put('/caisse/categories/:id/budget', {
    config: { permission: 'caisse.categorie.gerer' },
    schema: { tags: ['caisse'], params: z.object({ id: Uuid }), body: z.object({ montant: z.number().int().min(0).max(100_000_000) }) },
  }, async (req) => {
    const ctx = exiger(req);
    return app.bd.transaction(ctx.compteId, async (tx) => {
      const c = await ligne<{ libelle: string }>(tx, sql`SELECT libelle FROM caisse.categorie WHERE id = ${req.params.id} AND etablissement_id = ${ctx.etablissementId}`);
      if (!c) throw introuvable('Catégorie');
      await fixerBudget(tx, ctx.etablissementId, req.params.id, req.body.montant);
      await journaliser(tx, ctx, { action: 'Modification', objetType: 'Sortie de caisse', objetLibelle: `Budget · ${c.libelle}`, avant: '–', apres: `${req.body.montant.toLocaleString('fr-FR')} FCFA` });
      return { ok: true };
    });
  });
}

async function fixerBudget(tx: Parameters<typeof lignes>[0], etab: string, categorieId: string, montant: number) {
  const p = await ligne<{ id: string }>(tx, sql`
    SELECT p.id FROM structure.periode p JOIN structure.annee_scolaire a ON a.id = p.annee_id AND a.statut = 'ouverte'
     WHERE p.etablissement_id = ${etab} AND current_date <= p.date_fin + 30 ORDER BY p.ordre LIMIT 1`);
  if (!p) throw new ErreurMetier('STR_AUCUNE_PERIODE', 422, 'Aucune période en cours.');
  await tx.execute(sql`INSERT INTO caisse.budget (etablissement_id, categorie_id, periode_id, montant) VALUES (${etab}, ${categorieId}, ${p.id}, ${montant})
                       ON CONFLICT (categorie_id, periode_id) DO UPDATE SET montant = EXCLUDED.montant`);
}
