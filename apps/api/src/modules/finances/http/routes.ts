// CU-10 à CU-17 : grille, échéancier, encaissement, reçu, réduction, annulation, impayés, avis, comptes, relevé.
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { sql, ligne, lignes, type Tx, tableau } from '../../../core/bd.ts';
import { ErreurMetier, interdit, introuvable } from '../../../core/erreurs.ts';
import { exiger } from '../../../core/session.ts';
import type { Contexte } from '../../../core/contexte.ts';
import { journaliser } from '../../../core/audit.ts';
import { emettre } from '../../../core/evenements.ts';
import { versCsv } from '../../../core/csv.ts';
import { anneeOuverteTx, cleCompteur, exigerAnneeOuverte, FORMATS, prochainNumero } from '../../structure/index.ts';
import { formatTelephone, inscription, validerInscription } from '../../scolarite/index.ts';
import { ajouterMouvement, exigerSession, sessionOuverte } from '../../caisse/index.ts';
import { echeancier, MODES } from '../index.ts';
import { repartir } from '../domain/repartir.ts';
import { francsCfaEn, francsCfaFr } from '../domain/montant-lettres.ts';
import { escpRecu, pdfAvis, pdfRecu, pdfTableau, dateFr } from '@gs/print';
import { donneesRecu } from '../recu.ts';

const Uuid = z.uuid();
const Montant = z.number().int().positive().max(100_000_000);
const heureCm = (iso: string) => new Date(new Date(iso).getTime() + 3600_000).toISOString().slice(11, 16);
const jourCm = (iso: string) => new Date(new Date(iso).getTime() + 3600_000).toISOString().slice(0, 10);

export async function routesFinances(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  // ------------------------------------------------------------- grille des frais (CU-10, RG-02, RG-07)

  r.get('/finances/grille', {
    config: { permission: 'finances.grille.consulter' },
    schema: { tags: ['finances'], querystring: z.object({ anneeId: Uuid.optional(), tarif: z.enum(['nouveau', 'ancien']).default('nouveau') }) },
  }, async (req) => {
    const ctx = exiger(req);
    const annees = await app.bd.lire<{ id: string; libelle: string; statut: string }>(sql`
      SELECT id, libelle, statut FROM structure.annee_scolaire WHERE etablissement_id = ${ctx.etablissementId} AND statut <> 'cloturee' ORDER BY date_debut`);
    const anneeId = req.query.anneeId ?? annees.find((a) => a.statut === 'ouverte')?.id ?? annees[0]?.id;
    if (!anneeId) return { annees, anneeId: null, tarif: req.query.tarif, dates: [], niveaux: [], rubriques: [], suivante: null };
    const niveaux = await app.bd.lire<{ id: string; code: string }>(sql`
      SELECT n.id, n.code FROM structure.niveau n JOIN structure.cycle cy ON cy.id = n.cycle_id
       WHERE n.etablissement_id = ${ctx.etablissementId} ORDER BY cy.sous_systeme DESC, n.rang`);
    const lignesG = await app.bd.lire<{ niveau_id: string; ordre: number; montant: number; date_limite: string }>(sql`
      SELECT g.niveau_id, l.ordre, l.montant, l.date_limite FROM finances.grille_frais g JOIN finances.ligne_grille l ON l.grille_id = g.id
       WHERE g.annee_id = ${anneeId} AND g.statut_eleve = ${req.query.tarif}`);
    const annee = annees.find((a) => a.id === anneeId)!;
    const debut = Number(annee.libelle.slice(0, 4));
    const datesDefaut = [`${debut}-09-07`, `${debut}-09-30`, `${debut}-11-30`, `${debut + 1}-01-31`];
    const dates = [1, 2, 3, 4].map((o, i) => lignesG.find((l) => l.ordre === o)?.date_limite ?? datesDefaut[i]!);
    const rubriques = await app.bd.lire(sql`
      SELECT id, code, libelle_fr AS libelle, obligatoire, precision_fr AS precision, caisse FROM finances.rubrique
       WHERE etablissement_id = ${ctx.etablissementId} ORDER BY ordre`);
    const suivante = annees.find((a) => a.libelle > annee.libelle) ?? null;
    return {
      annees, anneeId, tarif: req.query.tarif, dates, rubriques, suivante,
      niveaux: niveaux.filter((n) => true).map((n) => {
        const m = [1, 2, 3, 4].map((o) => lignesG.find((l) => l.niveau_id === n.id && l.ordre === o)?.montant ?? null);
        return { niveauId: n.id, code: n.code, montants: m, total: m.some((x) => x !== null) ? m.reduce((s: number, x) => s + (x ?? 0), 0) : null };
      }),
    };
  });

  r.put('/finances/grille', {
    config: { permission: 'finances.grille.modifier' },
    schema: { tags: ['finances'], body: z.object({
      anneeId: Uuid, tarif: z.enum(['nouveau', 'ancien']), dates: z.array(z.iso.date()).length(4),
      lignes: z.array(z.object({ niveauId: Uuid, montants: z.array(z.number().int().min(0).max(10_000_000).nullable()).length(4) })),
    }) },
  }, async (req) => {
    const ctx = exiger(req);
    const b = req.body;
    return app.bd.transaction(ctx.compteId, async (tx) => {
      const annee = await ligne<{ libelle: string; statut: string }>(tx, sql`SELECT libelle, statut FROM structure.annee_scolaire WHERE id = ${b.anneeId} AND etablissement_id = ${ctx.etablissementId}`);
      if (!annee) throw introuvable('Année');
      if (annee.statut === 'cloturee') throw new ErreurMetier('FIN_ANNEE_CLOTUREE', 422, 'Une année clôturée est en lecture seule (RG-01).');
      const rub = await assurerRubriques(tx, ctx.etablissementId);
      const libelles = [['Inscription', 'Registration'], ['Tranche 1', 'Instalment 1'], ['Tranche 2', 'Instalment 2'], ['Tranche 3', 'Instalment 3']];
      let n = 0;
      for (const l of b.lignes) {
        if (l.montants.every((m) => m === null)) continue;
        const g = await ligne<{ id: string }>(tx, sql`
          INSERT INTO finances.grille_frais (etablissement_id, annee_id, niveau_id, statut_eleve, cree_par)
          VALUES (${ctx.etablissementId}, ${b.anneeId}, ${l.niveauId}, ${b.tarif}, ${ctx.compteId})
          ON CONFLICT (annee_id, niveau_id, statut_eleve) DO UPDATE SET modifie_le = now() RETURNING id`);
        for (let i = 0; i < 4; i++) {
          await tx.execute(sql`
            INSERT INTO finances.ligne_grille (etablissement_id, grille_id, rubrique_id, libelle_fr, libelle_en, ordre, montant, date_limite, cree_par)
            VALUES (${ctx.etablissementId}, ${g!.id}, ${i === 0 ? rub.inscription : rub.scolarite}, ${libelles[i]![0]!}, ${libelles[i]![1]!}, ${i + 1},
                    ${l.montants[i] ?? 0}, ${b.dates[i]!}, ${ctx.compteId})
            ON CONFLICT (grille_id, ordre) DO UPDATE SET montant = EXCLUDED.montant, date_limite = EXCLUDED.date_limite`);
        }
        n++;
      }
      await journaliser(tx, ctx, { action: 'Modification', objetType: 'Grille des frais',
        objetLibelle: `Grille ${annee.libelle} · ${b.tarif === 'nouveau' ? 'nouveaux' : 'anciens'} élèves`, avant: '–', apres: `${n} niveaux` });
      return { niveaux: n };
    });
  });

  r.post('/finances/grille/copie', {
    config: { permission: 'finances.grille.modifier' }, schema: { tags: ['finances'], body: z.object({ deAnneeId: Uuid, versAnneeId: Uuid }) },
  }, async (req) => {
    const ctx = exiger(req);
    const { deAnneeId, versAnneeId } = req.body;
    return app.bd.transaction(ctx.compteId, async (tx) => {
      const vers = await ligne<{ libelle: string; statut: string }>(tx, sql`SELECT libelle, statut FROM structure.annee_scolaire WHERE id = ${versAnneeId} AND etablissement_id = ${ctx.etablissementId}`);
      if (!vers || vers.statut === 'cloturee') throw new ErreurMetier('FIN_ANNEE_CIBLE', 422, 'Année de destination invalide.');
      const grilles = await lignes<{ id: string; niveau_id: string; statut_eleve: string }>(tx, sql`SELECT id, niveau_id, statut_eleve FROM finances.grille_frais WHERE annee_id = ${deAnneeId}`);
      for (const g of grilles) {
        const ng = await ligne<{ id: string }>(tx, sql`
          INSERT INTO finances.grille_frais (etablissement_id, annee_id, niveau_id, statut_eleve, cree_par)
          VALUES (${ctx.etablissementId}, ${versAnneeId}, ${g.niveau_id}, ${g.statut_eleve}, ${ctx.compteId})
          ON CONFLICT (annee_id, niveau_id, statut_eleve) DO UPDATE SET modifie_le = now() RETURNING id`);
        await tx.execute(sql`
          INSERT INTO finances.ligne_grille (etablissement_id, grille_id, rubrique_id, libelle_fr, libelle_en, ordre, montant, date_limite, cree_par)
          SELECT etablissement_id, ${ng!.id}, rubrique_id, libelle_fr, libelle_en, ordre, montant, (date_limite + interval '1 year')::date, ${ctx.compteId}
            FROM finances.ligne_grille WHERE grille_id = ${g.id}
          ON CONFLICT (grille_id, ordre) DO UPDATE SET montant = EXCLUDED.montant, date_limite = EXCLUDED.date_limite`);
      }
      await journaliser(tx, ctx, { action: 'Création', objetType: 'Grille des frais', objetLibelle: `Grille copiée vers ${vers.libelle}`, avant: '–', apres: `${grilles.length} grilles` });
      return { grilles: grilles.length };
    });
  });

  r.post('/finances/rubriques', {
    config: { permission: 'finances.grille.modifier' },
    schema: { tags: ['finances'], body: z.object({ libelleFr: z.string().trim().min(2).max(40), libelleEn: z.string().trim().min(2).max(40),
      obligatoire: z.boolean(), precision: z.string().trim().max(60).nullish(), caisse: z.enum(['principale', 'ape']).default('principale') }) },
  }, async (req) => {
    const ctx = exiger(req);
    const b = req.body;
    return app.bd.transaction(ctx.compteId, async (tx) => {
      const code = b.libelleFr.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_');
      const x = await ligne<{ id: string }>(tx, sql`
        INSERT INTO finances.rubrique (etablissement_id, code, libelle_fr, libelle_en, obligatoire, precision_fr, caisse, ordre, cree_par)
        VALUES (${ctx.etablissementId}, ${code}, ${b.libelleFr}, ${b.libelleEn}, ${b.obligatoire}, ${b.precision ?? null}, ${b.caisse},
                (SELECT COALESCE(max(ordre), 0) + 1 FROM finances.rubrique WHERE etablissement_id = ${ctx.etablissementId}), ${ctx.compteId}) RETURNING id`);
      await journaliser(tx, ctx, { action: 'Création', objetType: 'Grille des frais', objetLibelle: `Rubrique · ${b.libelleFr}`, avant: '–', apres: b.obligatoire ? 'Obligatoire' : 'Facultatif' });
      return { id: x!.id };
    });
  });

  // ------------------------------------------------------------- échéancier et versements (CU-12)

  async function exigerInscription(tx: Tx, ctx: Contexte, id: string) {
    const i = await inscription(tx, id, ctx.etablissementId);
    if (!i) throw introuvable('Inscription');
    return i;
  }

  r.get('/finances/inscriptions/:id/echeancier', {
    config: { unePermissionParmi: ['finances.recu.consulter', 'finances.versement.encaisser', 'finances.impaye.consulter'] },
    schema: { tags: ['finances'], params: z.object({ id: Uuid }) },
  }, async (req) => {
    const ctx = exiger(req);
    return app.bd.transaction(null, async (tx) => {
      const i = await exigerInscription(tx, ctx, req.params.id);
      const l = await echeancier(tx, req.params.id);
      const versements = await lignes(tx, sql`
        SELECT v.id, v.numero_recu AS "numeroRecu", v.encaisse_le AS "encaisseLe", v.montant, v.mode, v.statut, v.motif_annulation AS "motifAnnulation",
               v.banque, v.bordereau, c.nom_affiche AS caissier
          FROM finances.versement v JOIN core.compte c ON c.id = v.caissier_id WHERE v.inscription_id = ${req.params.id} ORDER BY v.encaisse_le DESC`);
      const seuil = await ligne<{ seuil: number | null }>(tx, sql`SELECT seuil_reduction AS seuil FROM structure.etablissement WHERE id = ${ctx.etablissementId}`);
      const demandes = await lignes(tx, sql`
        SELECT d.id, d.type, d.statut, d.montant, d.objet, d.motif, d.demande_le AS "demandeLe" FROM finances.demande d
         WHERE d.inscription_id = ${req.params.id} AND d.statut = 'demandee'`);
      const aPayer = l.reduce((s, x) => s + Number(x.a_payer), 0);
      const verse = l.reduce((s, x) => s + Number(x.verse), 0);
      return {
        inscription: { id: i.id, statut: i.statut, eleve: `${i.nom} ${i.prenoms}`, matricule: i.matricule, classe: i.classe, eleveId: i.eleve_id },
        lignes: l.map((x) => ({ id: x.id, ordre: x.ordre, libelleFr: x.libelle_fr, libelleEn: x.libelle_en, prix: Number(x.prix_unitaire), reduction: Number(x.reduction),
          motifReduction: x.motif_reduction, aPayer: Number(x.a_payer), verse: Number(x.verse), reste: Number(x.reste), dateLimite: x.date_limite })),
        totaux: { aPayer, verse, reste: aPayer - verse, pourcentage: aPayer ? Math.floor((verse * 100) / aPayer) : 100 },
        versements: versements.map((v) => ({ ...(v as Record<string, unknown>), modeLibelle: MODES[(v as { mode: string }).mode]?.fr })),
        seuilReduction: seuil?.seuil ?? null, demandes,
      };
    });
  });

  r.post('/finances/versements', {
    config: { permission: 'finances.versement.encaisser' },
    schema: { tags: ['finances'], headers: z.object({ 'idempotency-key': z.string().min(8).max(100) }).passthrough(),
      body: z.object({ inscriptionId: Uuid, montant: Montant, mode: z.enum(['especes', 'versement_bancaire', 'virement', 'cheque']),
        banque: z.string().trim().max(80).nullish(), bordereau: z.string().trim().max(40).nullish(), dateBordereau: z.iso.date().nullish(),
        ligneReleveId: Uuid.nullish() }) },
  }, async (req) => {
    const ctx = exiger(req);
    const b = req.body;
    const cle = req.headers['idempotency-key'] as string;
    // Conception § 9.1 : l'encaissement tient en une seule transaction.
    return app.bd.transaction(ctx.compteId, async (tx) => {
      const deja = await ligne<{ id: string; numero_recu: string }>(tx, sql`
        SELECT id, numero_recu FROM finances.versement WHERE etablissement_id = ${ctx.etablissementId} AND cle_idempotence = ${cle}`);
      if (deja) return { id: deja.id, numeroRecu: deja.numero_recu, repete: true };
      if (b.mode === 'versement_bancaire' && (!b.banque || !b.bordereau || !b.dateBordereau)) {
        throw new ErreurMetier('FIN_BORDEREAU_INCOMPLET', 422, 'Banque, numéro et date du bordereau sont exigés (RG-13).', 'bordereau');
      }
      if (b.mode === 'versement_bancaire') {
        const pris = await ligne(tx, sql`SELECT 1 FROM finances.versement WHERE etablissement_id = ${ctx.etablissementId} AND mode = 'versement_bancaire'
                                          AND banque = ${b.banque!} AND bordereau = ${b.bordereau!} AND statut <> 'annule'`);
        if (pris) throw new ErreurMetier('FIN_BORDEREAU_DEJA_ENREGISTRE', 409, 'Ce bordereau est déjà enregistré pour cette banque (RG-13).', 'bordereau');
      }
      const session = b.mode === 'especes' ? await exigerSession(tx, ctx.compteId) : await sessionOuverte(tx, ctx.compteId);
      const i = await exigerInscription(tx, ctx, b.inscriptionId);
      if (!['attente', 'validee'].includes(i.statut)) throw new ErreurMetier('FIN_INSCRIPTION_INACTIVE', 422, 'Inscription inactive.');
      const l = await echeancier(tx, b.inscriptionId, true);
      const parts = repartir(b.montant, l.map((x) => ({ id: x.id, ordre: x.ordre, reste: Number(x.reste) })));
      const annee = await anneeOuverteTx(tx, ctx.etablissementId);
      const numero = FORMATS.recu(annee.annee_civile, await prochainNumero(tx, ctx.etablissementId, cleCompteur.recu(annee.annee_civile)));
      const v = await ligne<{ id: string; encaisse_le: string }>(tx, sql`
        INSERT INTO finances.versement (etablissement_id, annee_id, inscription_id, numero_recu, montant, mode, banque, bordereau, date_bordereau,
                                        caissier_id, cle_idempotence, cree_par)
        VALUES (${ctx.etablissementId}, ${annee.id}, ${b.inscriptionId}, ${numero}, ${b.montant}, ${b.mode}, ${b.banque ?? null}, ${b.bordereau ?? null},
                ${b.dateBordereau ?? null}, ${ctx.compteId}, ${cle}, ${ctx.compteId}) RETURNING id, encaisse_le`);
      for (const p of parts) {
        await tx.execute(sql`INSERT INTO finances.imputation (etablissement_id, versement_id, ligne_echeance_id, montant)
                             VALUES (${ctx.etablissementId}, ${v!.id}, ${p.ligneId}, ${p.montant})`);
      }
      if (session) {
        await ajouterMouvement(tx, ctx.etablissementId, { sessionId: session.id, sens: 'entree', nature: 'versement', mode: b.mode, montant: b.montant,
          versementId: v!.id, par: ctx.compteId,
          libelle: `${numero} · ${i.nom} ${i.prenoms} · ${i.classe}${b.bordereau ? ` · bordereau ${b.bordereau}` : ''}` });
      }
      if (b.ligneReleveId) {
        await tx.execute(sql`UPDATE finances.ligne_releve SET versement_id = ${v!.id}, reference = COALESCE(reference, ${b.bordereau ?? numero})
                             WHERE id = ${b.ligneReleveId} AND etablissement_id = ${ctx.etablissementId}`);
      }
      await journaliser(tx, ctx, { action: 'Création', objetType: 'Versement', objetLibelle: `Versement ${numero}`, avant: '–',
        apres: `${b.montant.toLocaleString('fr-FR')} FCFA · ${MODES[b.mode]!.fr.toLowerCase()}`, eleveId: i.eleve_id, ligneId: v!.id, table: 'finances.versement' });
      await emettre(tx, ctx, 'versement.enregistre', { versementId: v!.id, inscriptionId: b.inscriptionId, montant: b.montant });
      return { id: v!.id, numeroRecu: numero, repartition: parts, repete: false };
    });
  });

  // Numéro du prochain reçu, affiché sous l'encaissement (maquette Encaissement) ; attribué seulement à l'enregistrement.
  r.get('/finances/recu-suivant', { config: { permission: 'finances.versement.encaisser' }, schema: { tags: ['finances'] } }, async (req) => {
    const ctx = exiger(req);
    const annee = await exigerAnneeOuverte(app.bd, ctx.etablissementId);
    const v = await app.bd.lireUn<{ valeur: number }>(sql`SELECT valeur FROM core.compteur WHERE etablissement_id = ${ctx.etablissementId}
                                                         AND cle = ${cleCompteur.recu(annee.annee_civile)}`);
    return { numero: FORMATS.recu(annee.annee_civile, (v?.valeur ?? 0) + 1) };
  });

  // RG-21 : toute réimpression porte la mention « Duplicata ».
  r.get('/finances/versements/:id/recu', {
    config: { unePermissionParmi: ['finances.recu.consulter', 'finances.recu.imprimer'] },
    schema: { tags: ['finances'], params: z.object({ id: Uuid }), querystring: z.object({ format: z.enum(['json', 'pdf', 'escp']).default('json') }) },
  }, async (req, rep) => {
    const ctx = exiger(req);
    if (req.query.format !== 'json' && !ctx.a('finances.recu.imprimer')) throw interdit('finances.recu.imprimer');
    return app.bd.transaction(ctx.compteId, async (tx) => {
      const d = await donneesRecu(tx, ctx.etablissementId, req.params.id);
      if (req.query.format === 'json') return d;
      await journaliser(tx, ctx, { action: d.duplicata ? 'Modification' : 'Création', objetType: 'Reçu',
        objetLibelle: `Impression du reçu ${d.numero}${d.duplicata ? ' · duplicata' : ''}`, avant: '–', apres: req.query.format.toUpperCase(),
        ligneId: req.params.id, table: 'finances.versement' });
      if (req.query.format === 'escp') return rep.type('application/octet-stream').header('content-disposition', `attachment; filename="${d.numero}.prn"`).send(escpRecu(d, 2));
      return rep.type('application/pdf').header('content-disposition', `inline; filename="${d.numero}.pdf"`).send(Buffer.from(await pdfRecu(d, d.duplicata ? 1 : 2)));
    });
  });

  // CU-13, RG-16 : l'économe demande puis valide l'annulation, même de son propre versement (E-17).
  r.post('/finances/versements/:id/annulation', {
    config: { permission: 'finances.versement.annuler' },
    schema: { tags: ['finances'], params: z.object({ id: Uuid }), body: z.object({ motif: z.string().trim().min(3).max(200) }) },
  }, async (req) => {
    const ctx = exiger(req);
    return app.bd.transaction(ctx.compteId, async (tx) => {
      const v = await ligne<{ statut: string; numero_recu: string; inscription_id: string; montant: number }>(tx, sql`
        SELECT statut, numero_recu, inscription_id, montant FROM finances.versement WHERE id = ${req.params.id} AND etablissement_id = ${ctx.etablissementId} FOR UPDATE`);
      if (!v) throw introuvable('Versement');
      if (v.statut !== 'valide') throw new ErreurMetier('FIN_DEJA_ANNULE', 422, v.statut === 'annule' ? 'Ce versement est déjà annulé.' : 'Une annulation est déjà demandée.');
      await tx.execute(sql`UPDATE finances.versement SET statut = 'annulation_demandee', motif_annulation = ${req.body.motif} WHERE id = ${req.params.id}`);
      const i = await inscription(tx, v.inscription_id, ctx.etablissementId);
      const d = await ligne<{ id: string }>(tx, sql`
        INSERT INTO finances.demande (etablissement_id, type, inscription_id, versement_id, montant, objet, motif, demandeur)
        VALUES (${ctx.etablissementId}, 'annulation', ${v.inscription_id}, ${req.params.id}, ${v.montant}, ${`reçu ${v.numero_recu}`}, ${req.body.motif}, ${ctx.compteId})
        RETURNING id`);
      await journaliser(tx, ctx, { action: 'Demande', objetType: 'Reçu', objetLibelle: `Annulation · reçu ${v.numero_recu} · ${i!.nom} ${i!.prenoms}`,
        avant: 'Valide', apres: 'Annulation demandée', eleveId: i!.eleve_id, ligneId: req.params.id, table: 'finances.versement' });
      return { demandeId: d!.id };
    });
  });

  // ------------------------------------------------------------- réductions (CU-11, RG-11)

  r.post('/finances/reductions', {
    config: { unePermissionParmi: ['finances.reduction.accorder', 'finances.reduction.demander'] },
    schema: { tags: ['finances'], body: z.object({ ligneEcheanceId: Uuid, montant: z.number().int().min(0).max(10_000_000), motif: z.string().trim().min(2).max(120) }) },
  }, async (req) => {
    const ctx = exiger(req);
    const b = req.body;
    return app.bd.transaction(ctx.compteId, async (tx) => {
      const l = await ligne<{ inscription_id: string; prix_unitaire: number; reduction: number; libelle_fr: string }>(tx, sql`
        SELECT inscription_id, prix_unitaire, reduction, libelle_fr FROM finances.ligne_echeance WHERE id = ${b.ligneEcheanceId} AND etablissement_id = ${ctx.etablissementId}`);
      if (!l) throw introuvable('Ligne d\'échéance');
      if (b.montant > Number(l.prix_unitaire)) throw new ErreurMetier('FIN_REDUCTION_SUPERIEURE_AU_PRIX', 422, 'La réduction ne dépasse pas le prix (RG-11).', 'montant');
      const verse = (await echeancier(tx, l.inscription_id, true)).find((x) => x.id === b.ligneEcheanceId)!.verse;
      if (Number(l.prix_unitaire) - b.montant < Number(verse)) {
        throw new ErreurMetier('FIN_REDUCTION_SUPERIEURE_AU_RESTE', 422, 'La réduction ferait passer le reste sous zéro (RG-10) : annulez d\'abord un versement.', 'montant');
      }
      const etab = await ligne<{ seuil: number | null }>(tx, sql`SELECT seuil_reduction AS seuil FROM structure.etablissement WHERE id = ${ctx.etablissementId}`);
      const seuil = etab?.seuil ?? 0;
      const i = await inscription(tx, l.inscription_id, ctx.etablissementId);
      const tranche = l.libelle_fr.toLowerCase();
      if (b.montant <= seuil && ctx.a('finances.reduction.accorder')) {
        await tx.execute(sql`UPDATE finances.ligne_echeance SET reduction = ${b.montant}, motif_reduction = ${b.motif} WHERE id = ${b.ligneEcheanceId}`);
        await journaliser(tx, ctx, { action: 'Création', objetType: 'Réduction', objetLibelle: `Réduction · ${i!.nom} ${i!.prenoms} · ${tranche}`,
          avant: String(Number(l.reduction)), apres: `${b.montant.toLocaleString('fr-FR')} FCFA · ${b.motif.toLowerCase()}`, eleveId: i!.eleve_id,
          ligneId: b.ligneEcheanceId, table: 'finances.ligne_echeance' });
        await emettre(tx, ctx, 'reduction.appliquee', { inscriptionId: l.inscription_id });
        return { appliquee: true, demandeId: null };
      }
      // Au-delà du seuil fixé par l'établissement, la réduction attend la validation du directeur (RG-11, FIN-06).
      if (!ctx.a('finances.reduction.demander')) throw interdit('finances.reduction.demander');
      const d = await ligne<{ id: string }>(tx, sql`
        INSERT INTO finances.demande (etablissement_id, type, inscription_id, ligne_echeance_id, montant, objet, motif, demandeur)
        VALUES (${ctx.etablissementId}, 'reduction', ${l.inscription_id}, ${b.ligneEcheanceId}, ${b.montant}, ${tranche}, ${b.motif}, ${ctx.compteId}) RETURNING id`);
      await journaliser(tx, ctx, { action: 'Demande', objetType: 'Réduction', objetLibelle: `Réduction · ${i!.nom} ${i!.prenoms} · ${tranche}`,
        avant: String(Number(l.reduction)), apres: `${b.montant.toLocaleString('fr-FR')} FCFA`, eleveId: i!.eleve_id, ligneId: d!.id, table: 'finances.demande' });
      return { appliquee: false, demandeId: d!.id };
    });
  });

  // Dérogation : inscription sans premier versement, ou classe complète (RG-06).
  r.post('/finances/derogations', {
    config: { permission: 'scolarite.derogation.demander' },
    schema: { tags: ['finances'], body: z.object({ inscriptionId: Uuid, motif: z.string().trim().min(3).max(200) }) },
  }, async (req) => {
    const ctx = exiger(req);
    return app.bd.transaction(ctx.compteId, async (tx) => {
      const i = await exigerInscription(tx, ctx, req.body.inscriptionId);
      if (i.statut !== 'attente') throw new ErreurMetier('FIN_INSCRIPTION_DEJA_VALIDEE', 422, 'Cette inscription est déjà validée.');
      const d = await ligne<{ id: string }>(tx, sql`
        INSERT INTO finances.demande (etablissement_id, type, inscription_id, objet, motif, demandeur)
        VALUES (${ctx.etablissementId}, 'derogation', ${i.id}, 'inscription sans premier versement', ${req.body.motif}, ${ctx.compteId}) RETURNING id`);
      await journaliser(tx, ctx, { action: 'Demande', objetType: 'Dérogation', objetLibelle: `Dérogation · ${i.nom} ${i.prenoms}`,
        avant: '–', apres: 'En attente de validation', eleveId: i.eleve_id, ligneId: d!.id, table: 'finances.demande' });
      return { demandeId: d!.id };
    });
  });

  // ------------------------------------------------------------- à valider (maquette Validations)

  r.get('/finances/validations', {
    config: { unePermissionParmi: ['finances.reduction.valider', 'scolarite.derogation.valider', 'caisse.sortie.valider', 'finances.annulation.valider',
      'finances.reduction.demander', 'scolarite.derogation.demander', 'caisse.sortie.demander'] },
    schema: { tags: ['finances'] },
  }, async (req) => {
    const ctx = exiger(req);
    const types: string[] = [];
    if (ctx.a('finances.reduction.valider')) types.push('reduction');
    if (ctx.a('scolarite.derogation.valider')) types.push('derogation');
    if (ctx.a('finances.annulation.valider')) types.push('annulation');
    const seuil = await app.bd.lireUn<{ seuil: number | null }>(sql`SELECT seuil_reduction AS seuil FROM structure.etablissement WHERE id = ${ctx.etablissementId}`);
    const demandes = await app.bd.lire(sql`
      SELECT d.id, d.type, d.statut, d.montant, d.objet, d.motif, d.demande_le AS "demandeLe", c.nom_affiche AS demandeur, d.demandeur AS "demandeurId",
             e.nom || ' ' || e.prenoms AS eleve, cl.nom AS classe, i.id AS "inscriptionId", e.id AS "eleveId", cl.effectif_max AS "effectifMax",
             (SELECT (l.prix_unitaire - l.reduction)::int FROM finances.ligne_echeance l WHERE l.inscription_id = i.id AND l.ordre = 1) AS "versementMinimal"
        FROM finances.demande d JOIN core.compte c ON c.id = d.demandeur
        LEFT JOIN scolarite.inscription i ON i.id = d.inscription_id LEFT JOIN scolarite.eleve e ON e.id = i.eleve_id
        LEFT JOIN structure.classe cl ON cl.id = i.classe_id
       WHERE d.etablissement_id = ${ctx.etablissementId} AND d.statut = 'demandee'
         AND (d.type = ANY(${tableau(types)}::text[]) OR d.demandeur = ${ctx.compteId})
       ORDER BY d.demande_le`);
    const sorties = ctx.a('caisse.sortie.valider') || ctx.a('caisse.sortie.demander') ? await app.bd.lire(sql`
      SELECT s.id, s.numero, s.objet, s.montant, s.motif, s.demande_le AS "demandeLe", c.nom_affiche AS demandeur, s.demandeur AS "demandeurId",
             cat.libelle AS categorie,
             (SELECT COALESCE(round(100.0 * sum(x.montant) FILTER (WHERE x.statut IN ('validee', 'decaissee')) / NULLIF(max(b.montant), 0)), 0)::int
                FROM caisse.sortie x LEFT JOIN caisse.budget b ON b.categorie_id = x.categorie_id
                 AND b.periode_id = (SELECT p.id FROM structure.periode p JOIN structure.annee_scolaire a ON a.id = p.annee_id AND a.statut = 'ouverte'
                                       WHERE current_date BETWEEN p.date_debut AND p.date_fin + 30 ORDER BY p.ordre LIMIT 1)
               WHERE x.categorie_id = s.categorie_id) AS "budgetConsomme"
        FROM caisse.sortie s JOIN core.compte c ON c.id = s.demandeur JOIN caisse.categorie cat ON cat.id = s.categorie_id
       WHERE s.etablissement_id = ${ctx.etablissementId} AND s.statut = 'demandee'
         AND (${ctx.a('caisse.sortie.valider')} OR s.demandeur = ${ctx.compteId})
       ORDER BY s.demande_le`) : [];
    const annulations = await app.bd.lire(sql`
      SELECT d.id, d.objet, d.motif, d.montant, d.decide_le AS "decideLe", e.nom || ' ' || e.prenoms AS eleve, c.nom_affiche AS decideur
        FROM finances.demande d JOIN scolarite.inscription i ON i.id = d.inscription_id JOIN scolarite.eleve e ON e.id = i.eleve_id
        LEFT JOIN core.compte c ON c.id = d.decideur
       WHERE d.etablissement_id = ${ctx.etablissementId} AND d.type = 'annulation' AND d.statut = 'validee'
       ORDER BY d.decide_le DESC LIMIT 5`);
    const decisions = await app.bd.lire(sql`
      SELECT * FROM (
        SELECT d.type, d.objet, d.montant, d.statut, d.decide_le AS "decideLe", c.nom_affiche AS decideur, e.nom || ' ' || e.prenoms AS eleve, NULL AS numero
          FROM finances.demande d JOIN core.compte c ON c.id = d.decideur
          LEFT JOIN scolarite.inscription i ON i.id = d.inscription_id LEFT JOIN scolarite.eleve e ON e.id = i.eleve_id
         WHERE d.etablissement_id = ${ctx.etablissementId} AND d.decideur = ${ctx.compteId} AND d.type <> 'annulation'
        UNION ALL
        SELECT 'sortie', s.objet, s.montant, CASE WHEN s.statut = 'refusee' THEN 'refusee' ELSE 'validee' END, s.decide_le, c.nom_affiche, NULL, s.numero
          FROM caisse.sortie s JOIN core.compte c ON c.id = s.decideur
         WHERE s.etablissement_id = ${ctx.etablissementId} AND s.decideur = ${ctx.compteId}) x
       ORDER BY "decideLe" DESC LIMIT 6`);
    return { seuilReduction: seuil?.seuil ?? null, demandes, sorties, annulations, decisions,
      peut: { reduction: ctx.a('finances.reduction.valider'), derogation: ctx.a('scolarite.derogation.valider'),
        annulation: ctx.a('finances.annulation.valider'), sortie: ctx.a('caisse.sortie.valider') } };
  });

  r.post('/finances/demandes/:id/decision', {
    config: { unePermissionParmi: ['finances.reduction.valider', 'scolarite.derogation.valider', 'finances.annulation.valider'] },
    schema: { tags: ['finances'], params: z.object({ id: Uuid }), body: z.object({ decision: z.enum(['validee', 'refusee']), motif: z.string().trim().max(200).nullish() }) },
  }, async (req) => {
    const ctx = exiger(req);
    const { decision, motif } = req.body;
    return app.bd.transaction(ctx.compteId, async (tx) => {
      const d = await ligne<{ type: string; statut: string; inscription_id: string; ligne_echeance_id: string | null; versement_id: string | null;
        montant: number | null; objet: string; motif: string; demandeur: string }>(tx, sql`
        SELECT type, statut, inscription_id, ligne_echeance_id, versement_id, montant, objet, motif, demandeur FROM finances.demande
         WHERE id = ${req.params.id} AND etablissement_id = ${ctx.etablissementId} FOR UPDATE`);
      if (!d) throw introuvable('Demande');
      if (d.statut !== 'demandee') throw new ErreurMetier('FIN_DEJA_DECIDEE', 422, 'Cette demande a déjà été traitée.');
      const permission = { reduction: 'finances.reduction.valider', derogation: 'scolarite.derogation.valider', annulation: 'finances.annulation.valider' }[d.type]!;
      if (!ctx.a(permission)) throw interdit(permission);
      // Séparation des tâches pour réductions et dérogations ; RG-16 permet à l'économe de valider sa propre annulation (E-17).
      if (d.type !== 'annulation' && d.demandeur === ctx.compteId) {
        throw new ErreurMetier('CORE_SEPARATION_DES_TACHES', 403, 'Vous ne pouvez pas valider votre propre demande.');
      }
      const i = await inscription(tx, d.inscription_id, ctx.etablissementId);
      await tx.execute(sql`UPDATE finances.demande SET statut = ${decision}, decideur = ${ctx.compteId}, decide_le = now(), motif_decision = ${motif ?? null}
                           WHERE id = ${req.params.id}`);
      const eleve = `${i!.nom} ${i!.prenoms}`;
      if (d.type === 'reduction') {
        if (decision === 'validee') {
          const l = await ligne<{ prix_unitaire: number; reduction: number }>(tx, sql`SELECT prix_unitaire, reduction FROM finances.ligne_echeance WHERE id = ${d.ligne_echeance_id}`);
          const verse = (await echeancier(tx, d.inscription_id, true)).find((x) => x.id === d.ligne_echeance_id)!.verse;
          if (Number(l!.prix_unitaire) - Number(d.montant) < Number(verse)) throw new ErreurMetier('FIN_REDUCTION_SUPERIEURE_AU_RESTE', 422, 'La réduction dépasse désormais le reste dû (RG-10).');
          await tx.execute(sql`UPDATE finances.ligne_echeance SET reduction = ${d.montant}, motif_reduction = ${d.motif} WHERE id = ${d.ligne_echeance_id}`);
          await emettre(tx, ctx, 'reduction.appliquee', { inscriptionId: d.inscription_id });
        }
        await journaliser(tx, ctx, { action: decision === 'validee' ? 'Validation' : 'Refus', objetType: 'Réduction',
          objetLibelle: `Réduction · ${eleve} · ${d.objet}`, avant: 'Demandée', apres: decision === 'validee' ? `${Number(d.montant).toLocaleString('fr-FR')} FCFA · ${d.motif.toLowerCase()}` : `Refusée${motif ? ` : ${motif}` : ''}`,
          eleveId: i!.eleve_id, ligneId: req.params.id, table: 'finances.demande' });
      } else if (d.type === 'derogation') {
        if (decision === 'validee') await validerInscription(tx, d.inscription_id, 'dérogation du directeur', ctx);
        await journaliser(tx, ctx, { action: decision === 'validee' ? 'Validation' : 'Refus', objetType: 'Dérogation', objetLibelle: `Dérogation · ${eleve}`,
          avant: 'En attente de validation', apres: decision === 'validee' ? 'Accordée' : 'Refusée', eleveId: i!.eleve_id, ligneId: req.params.id, table: 'finances.demande' });
      } else {
        const v = await ligne<{ numero_recu: string; mode: string; montant: number }>(tx, sql`SELECT numero_recu, mode, montant FROM finances.versement WHERE id = ${d.versement_id} FOR UPDATE`);
        if (decision === 'validee') {
          // RG-16 : libère les imputations ; pour des espèces, sortie compensatoire dans la session du jour.
          if (v!.mode === 'especes') {
            const s = await exigerSession(tx, ctx.compteId);
            await ajouterMouvement(tx, ctx.etablissementId, { sessionId: s.id, sens: 'sortie', nature: 'annulation', mode: 'especes', montant: Number(v!.montant),
              versementId: d.versement_id, par: ctx.compteId, libelle: `Annulation ${v!.numero_recu} · ${eleve}` });
          }
          await tx.execute(sql`UPDATE finances.versement SET statut = 'annule' WHERE id = ${d.versement_id}`);
          await tx.execute(sql`INSERT INTO core.notification (etablissement_id, role_code, type, texte, objet_id)
                               VALUES (${ctx.etablissementId}, 'directeur', 'annulation', ${`Annulation ${v!.numero_recu} · ${eleve} · ${Number(v!.montant).toLocaleString('fr-FR')} FCFA · ${d.motif}`}, ${d.versement_id})`);
          await emettre(tx, ctx, 'versement.annule', { versementId: d.versement_id!, inscriptionId: d.inscription_id });
        } else {
          await tx.execute(sql`UPDATE finances.versement SET statut = 'valide' WHERE id = ${d.versement_id}`);
        }
        await journaliser(tx, ctx, { action: decision === 'validee' ? 'Annulation' : 'Refus', objetType: 'Reçu',
          objetLibelle: `Reçu ${v!.numero_recu}${decision === 'validee' ? ' · notifiée au directeur' : ''}`, avant: 'Valide',
          apres: decision === 'validee' ? 'Annulé' : 'Valide', eleveId: i!.eleve_id, ligneId: d.versement_id, table: 'finances.versement' });
      }
      return { ok: true };
    });
  });

  // ------------------------------------------------------------- impayés (CU-16, CU-17)

  const FiltreImpayes = z.object({
    niveauId: Uuid.optional(), classeId: Uuid.optional(), echeance: z.coerce.number().int().min(1).max(10).optional(),
    retard: z.coerce.number().int().min(0).max(365).default(0), page: z.coerce.number().int().min(1).default(1),
    taille: z.coerce.number().int().min(1).max(1000).default(10),
  });

  const requeteImpayes = (etab: string, f: z.infer<typeof FiltreImpayes>) => sql`
    WITH dues AS (
      SELECT i.inscription_id, i.ordre, i.libelle_fr, i.reste, i.date_limite, i.jours_retard
        FROM reporting.v_impaye i JOIN scolarite.inscription s ON s.id = i.inscription_id
        JOIN structure.classe c ON c.id = s.classe_id
       WHERE i.etablissement_id = ${etab} AND (${f.classeId ?? null}::uuid IS NULL OR s.classe_id = ${f.classeId ?? null}::uuid)
         AND (${f.niveauId ?? null}::uuid IS NULL OR c.niveau_id = ${f.niveauId ?? null}::uuid)
         AND (${f.echeance ?? null}::int IS NULL OR i.ordre = ${f.echeance ?? null}::int)
    ), parEleve AS (
      SELECT inscription_id, string_agg(libelle_fr, ', ' ORDER BY ordre) AS echeances, sum(reste)::bigint AS montant, max(jours_retard)::int AS jours,
             min(date_limite) AS depuis
        FROM dues GROUP BY inscription_id HAVING max(jours_retard) > ${f.retard}
    )`;

  r.get('/finances/impayes', { config: { permission: 'finances.impaye.consulter' }, schema: { tags: ['finances'], querystring: FiltreImpayes } }, async (req) => {
    const ctx = exiger(req);
    const f = req.query;
    const annee = await exigerAnneeOuverte(app.bd, ctx.etablissementId);
    const kpi = await app.bd.lireUn<{ montant: number; eleves: number; jours: number | null; ligne: string | null; date: string | null }>(sql`
      ${requeteImpayes(ctx.etablissementId, f)}
      SELECT COALESCE(sum(montant), 0)::bigint AS montant, count(*)::int AS eleves, max(jours)::int AS jours,
             (SELECT lower(libelle_fr) FROM dues ORDER BY jours_retard DESC LIMIT 1) AS ligne,
             (SELECT date_limite FROM dues ORDER BY jours_retard DESC LIMIT 1) AS date FROM parEleve`);
    const inscrits = await app.bd.lireUn<{ n: number }>(sql`SELECT count(*)::int AS n FROM scolarite.inscription WHERE annee_id = ${annee.id} AND statut IN ('attente', 'validee')`);
    const relances = await app.bd.lireUn<{ n: number; depuis: string | null }>(sql`
      SELECT count(*)::int AS n, min(relance_le)::date AS depuis FROM finances.relance r JOIN scolarite.inscription i ON i.id = r.inscription_id
       WHERE r.etablissement_id = ${ctx.etablissementId} AND i.annee_id = ${annee.id}`);
    const rows = await app.bd.lire(sql`
      ${requeteImpayes(ctx.etablissementId, f)}
      SELECT p.inscription_id AS "inscriptionId", i.eleve_id AS "eleveId", i.nom || ' ' || i.prenoms AS eleve, i.classe, p.echeances, p.montant, p.jours,
             pay.nom AS payeur, pay.telephone, rel.canal AS "relanceCanal", rel.relance_le AS "relanceLe"
        FROM parEleve p JOIN reporting.v_inscription i ON i.id = p.inscription_id
        LEFT JOIN LATERAL (SELECT r.nom, r.telephone FROM scolarite.eleve_responsable er JOIN scolarite.responsable r ON r.id = er.responsable_id
                            WHERE er.eleve_id = i.eleve_id ORDER BY er.payeur DESC LIMIT 1) pay ON true
        LEFT JOIN LATERAL (SELECT canal, relance_le FROM finances.relance WHERE inscription_id = p.inscription_id ORDER BY relance_le DESC LIMIT 1) rel ON true
       ORDER BY i.nom, i.prenoms LIMIT ${f.taille} OFFSET ${(f.page - 1) * f.taille}`);
    const niveaux = await app.bd.lire(sql`SELECT n.id, n.code FROM structure.niveau n JOIN structure.cycle cy ON cy.id = n.cycle_id
                                           WHERE n.etablissement_id = ${ctx.etablissementId} ORDER BY cy.sous_systeme DESC, n.rang`);
    const classes = await app.bd.lire(sql`SELECT c.id, c.nom, c.niveau_id AS "niveauId" FROM structure.classe c JOIN structure.niveau n ON n.id = c.niveau_id
                                           WHERE c.annee_id = ${annee.id} ORDER BY n.rang, c.nom`);
    return {
      kpi: { montant: Number(kpi!.montant), eleves: kpi!.eleves, inscrits: inscrits!.n, jours: kpi!.jours, ligne: kpi!.ligne, date: kpi!.date,
        relances: relances!.n, relancesDepuis: relances!.depuis },
      lignes: rows.map((x) => ({ ...(x as Record<string, unknown>), telephone: formatTelephone((x as { telephone: string | null }).telephone) })),
      total: kpi!.eleves, page: f.page, taille: f.taille, niveaux, classes,
    };
  });

  r.get('/finances/impayes/export', { config: { permission: 'finances.impaye.consulter' }, schema: { tags: ['finances'], querystring: FiltreImpayes.omit({ page: true, taille: true }) } }, async (req, rep) => {
    const ctx = exiger(req);
    const rows = await app.bd.lire<Record<string, unknown>>(sql`
      ${requeteImpayes(ctx.etablissementId, { ...req.query, page: 1, taille: 1000 })}
      SELECT i.nom || ' ' || i.prenoms AS "Élève", i.classe AS "Classe", p.echeances AS "Échéances dépassées", p.montant AS "En retard",
             p.jours || ' jours' AS "Depuis", pay.nom AS "Responsable payeur", pay.telephone AS "Téléphone"
        FROM parEleve p JOIN reporting.v_inscription i ON i.id = p.inscription_id
        LEFT JOIN LATERAL (SELECT r.nom, r.telephone FROM scolarite.eleve_responsable er JOIN scolarite.responsable r ON r.id = er.responsable_id
                            WHERE er.eleve_id = i.eleve_id ORDER BY er.payeur DESC LIMIT 1) pay ON true ORDER BY i.nom`);
    await app.bd.transaction(ctx.compteId, (tx) => journaliser(tx, ctx, { action: 'Export', objetType: 'Impayés', objetLibelle: `Export des impayés · ${rows.length} lignes`, avant: '–', apres: 'CSV' }));
    return rep.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', 'attachment; filename="impayes.csv"').send(versCsv(rows));
  });

  r.post('/finances/avis', {
    config: { permission: 'finances.avis.emettre' }, schema: { tags: ['finances'], body: z.object({ inscriptionIds: z.array(Uuid).min(1).max(500) }) },
  }, async (req, rep) => {
    const ctx = exiger(req);
    const pdf = await app.bd.transaction(ctx.compteId, async (tx) => {
      const annee = await anneeOuverteTx(tx, ctx.etablissementId);
      const e = await ligne<{ nom_fr: string; nom_en: string; ville_bp: string | null; telephone: string | null; banque: string | null; numero_compte: string | null }>(tx, sql`
        SELECT nom_fr, nom_en, ville_bp, telephone, banque, numero_compte, modeles FROM structure.etablissement WHERE id = ${ctx.etablissementId}`);
      const avis = [];
      for (const id of req.body.inscriptionIds) {
        const i = await exigerInscription(tx, ctx, id);
        const l = await echeancier(tx, id);
        const reste = l.reduce((s, x) => s + Number(x.reste), 0);
        if (reste === 0) continue;
        const numero = FORMATS.avis(annee.annee_civile, await prochainNumero(tx, ctx.etablissementId, cleCompteur.avis(annee.annee_civile)));
        await tx.execute(sql`INSERT INTO finances.avis (etablissement_id, numero, inscription_id, montant_du, emis_par)
                             VALUES (${ctx.etablissementId}, ${numero}, ${id}, ${reste}, ${ctx.compteId})`);
        await tx.execute(sql`INSERT INTO finances.relance (etablissement_id, inscription_id, canal, par) VALUES (${ctx.etablissementId}, ${id}, 'avis', ${ctx.compteId})`);
        const payeur = await ligne<{ nom: string }>(tx, sql`SELECT r.nom FROM scolarite.eleve_responsable er JOIN scolarite.responsable r ON r.id = er.responsable_id
                                                            WHERE er.eleve_id = ${i.eleve_id} ORDER BY er.payeur DESC LIMIT 1`);
        const auj = new Date().toISOString().slice(0, 10);
        avis.push({ etablissement: e!, numero, date: dateFr(auj), eleve: `${i.nom} ${i.prenoms}`, matricule: i.matricule, classe: i.classe, payeur: payeur?.nom ?? '',
          lignes: l.map((x) => ({ libelle: x.libelle_fr, aPayer: Number(x.a_payer), verse: Number(x.verse), reste: Number(x.reste), dateLimite: dateFr(x.date_limite), echue: x.date_limite < auj && Number(x.reste) > 0 })) });
        await journaliser(tx, ctx, { action: 'Création', objetType: 'Avis de paiement', objetLibelle: `Avis ${numero} · ${i.nom} ${i.prenoms}`, avant: '–',
          apres: `${reste.toLocaleString('fr-FR')} FCFA`, eleveId: i.eleve_id });
      }
      if (!avis.length) throw new ErreurMetier('FIN_RIEN_A_RECLAMER', 422, 'Aucun reste dû pour les élèves choisis.');
      return pdfAvis(avis);
    });
    return rep.type('application/pdf').header('content-disposition', 'inline; filename="avis-de-paiement.pdf"').send(Buffer.from(pdf));
  });

  // ------------------------------------------------------------- état des comptes (CU-16)

  const FiltreComptes = z.object({ du: z.iso.date().optional(), au: z.iso.date().optional(), caisse: z.enum(['principale', 'ape']).optional() });

  async function etatComptes(etab: string, f: z.infer<typeof FiltreComptes>) {
    const au = f.au ?? new Date(Date.now() + 3600_000).toISOString().slice(0, 10);
    const du = f.du ?? `${au.slice(0, 8)}01`;
    const caisses = await app.bd.lire<{ caisse: string; initial: number; recettes: number; depenses: number; banque: number; nb_depenses: number; nb_banque: number }>(sql`
      SELECT c.caisse,
             COALESCE((SELECT fonds_initial FROM caisse.session s WHERE s.etablissement_id = ${etab} AND s.caisse = c.caisse
                        AND s.ouverte_le::date >= ${du} ORDER BY s.ouverte_le LIMIT 1), 0)::bigint AS initial,
             COALESCE(sum(m.montant) FILTER (WHERE m.sens = 'entree'), 0)::bigint AS recettes,
             COALESCE(sum(m.montant) FILTER (WHERE m.nature = 'sortie'), 0)::bigint AS depenses,
             COALESCE(sum(m.montant) FILTER (WHERE m.nature = 'versement_banque'), 0)::bigint AS banque,
             count(*) FILTER (WHERE m.nature = 'sortie')::int AS nb_depenses, count(*) FILTER (WHERE m.nature = 'versement_banque')::int AS nb_banque
        FROM (VALUES ('principale'), ('ape')) c(caisse)
        LEFT JOIN caisse.session s ON s.caisse = c.caisse AND s.etablissement_id = ${etab}
        LEFT JOIN caisse.mouvement m ON m.session_id = s.id AND m.horodatage::date BETWEEN ${du} AND ${au} AND m.nature <> 'annulation'
       WHERE (${f.caisse ?? null}::text IS NULL OR c.caisse = ${f.caisse ?? null})
       GROUP BY c.caisse ORDER BY c.caisse DESC`);
    const parCaisse = caisses.map((c) => ({ caisse: c.caisse, initial: Number(c.initial), recettes: Number(c.recettes), depenses: Number(c.depenses),
      banque: Number(c.banque), solde: Number(c.initial) + Number(c.recettes) - Number(c.depenses) - Number(c.banque) }));
    const somme = (k: 'initial' | 'recettes' | 'depenses' | 'banque' | 'solde') => parCaisse.reduce((s, c) => s + c[k], 0);
    const rubriques = await app.bd.lire<{ libelle: string; montant: number }>(sql`
      SELECT CASE WHEN l.ordre = 1 THEN 'Inscription' WHEN r.caisse = 'ape' THEN 'APE' ELSE 'Scolarité (tranches)' END AS libelle, sum(im.montant)::bigint AS montant
        FROM finances.imputation im JOIN finances.versement v ON v.id = im.versement_id AND v.statut <> 'annule'
        JOIN finances.ligne_echeance l ON l.id = im.ligne_echeance_id LEFT JOIN finances.rubrique r ON r.id = l.rubrique_id
       WHERE v.etablissement_id = ${etab} AND v.encaisse_le::date BETWEEN ${du} AND ${au}
       GROUP BY 1
      UNION ALL
      SELECT 'Autres entrées', COALESCE(sum(m.montant), 0)::bigint FROM caisse.mouvement m
       WHERE m.etablissement_id = ${etab} AND m.nature = 'entree_diverse' AND m.horodatage::date BETWEEN ${du} AND ${au}`);
    const categories = await app.bd.lire<{ libelle: string; montant: number }>(sql`
      SELECT c.libelle, sum(s.montant)::bigint AS montant FROM caisse.sortie s JOIN caisse.categorie c ON c.id = s.categorie_id
       WHERE s.etablissement_id = ${etab} AND s.statut = 'decaissee' AND s.decaisse_le::date BETWEEN ${du} AND ${au} GROUP BY c.libelle ORDER BY 2 DESC`);
    const depots = await app.bd.lire(sql`
      SELECT d.depose_le AS date, d.montant, d.banque, d.bordereau, s.caisse, c.nom_affiche AS "saisiPar"
        FROM caisse.depot_banque d JOIN caisse.session s ON s.id = d.session_id JOIN core.compte c ON c.id = d.saisi_par
       WHERE d.etablissement_id = ${etab} AND d.depose_le BETWEEN ${du} AND ${au} ORDER BY d.depose_le DESC`);
    const ordre = ['Scolarité (tranches)', 'Inscription', 'APE', 'Autres entrées'];
    return {
      du, au,
      kpi: { recettes: somme('recettes'), depenses: somme('depenses'), nbDepenses: caisses.reduce((s, c) => s + c.nb_depenses, 0),
        banque: somme('banque'), nbBordereaux: caisses.reduce((s, c) => s + c.nb_banque, 0), solde: somme('solde') },
      parCaisse, total: { initial: somme('initial'), recettes: somme('recettes'), depenses: somme('depenses'), banque: somme('banque'), solde: somme('solde') },
      rubriques: rubriques.map((x) => ({ libelle: x.libelle, montant: Number(x.montant) })).filter((x) => x.montant > 0)
        .sort((a, b) => ordre.indexOf(a.libelle) - ordre.indexOf(b.libelle)),
      categories: categories.map((x) => ({ libelle: x.libelle, montant: Number(x.montant) })), depots,
    };
  }

  r.get('/finances/comptes', { config: { permission: 'finances.comptes.consulter' }, schema: { tags: ['finances'], querystring: FiltreComptes } },
    async (req) => etatComptes(exiger(req).etablissementId, req.query));

  /** Export comptable : chaque mouvement de caisse en écriture équilibrée (plan SYSCOHADA), à réimputer par le comptable si besoin. */
  const COMPTES_CHARGES: [RegExp, string, string][] = [
    [/fourniture|papeterie|craie|cahier/i, '605', 'Autres achats'], [/entretien|réparation|nettoyage/i, '624', 'Entretien et réparations'],
    [/eau|électricité|electricite|énergie/i, '605', 'Autres achats'], [/vacataire|personnel/i, '637', 'Personnel extérieur'],
    [/transport|déplacement/i, '618', 'Transports'], [/téléphone|internet|communication/i, '628', 'Télécommunications'],
  ];
  async function ecritures(ctx: { etablissementId: string; compteId: string }, du: string, au: string, caisse: string | null) {
    const mouvements = await app.bd.lire<{ jour: string; caisse: string; sens: string; nature: string; mode: string; libelle: string; montant: number; categorie: string | null }>(sql`
      SELECT to_char(m.horodatage AT TIME ZONE 'Africa/Douala', 'DD/MM/YYYY') AS jour, m.caisse, m.sens, m.nature, m.mode, m.libelle, m.montant, c.libelle AS categorie
        FROM reporting.v_journal_caisse m
        LEFT JOIN caisse.mouvement x ON x.id = m.id LEFT JOIN caisse.sortie s ON s.id = x.sortie_id LEFT JOIN caisse.categorie c ON c.id = s.categorie_id
       WHERE m.etablissement_id = ${ctx.etablissementId} AND (m.horodatage AT TIME ZONE 'Africa/Douala')::date BETWEEN ${du}::date AND ${au}::date
         AND (${caisse}::text IS NULL OR m.caisse = ${caisse}) ORDER BY m.horodatage`);
    const lignes: Record<string, string | number>[] = [];
    const ecrire = (jour: string, journal: string, piece: string, libelle: string, debit: [string, string], credit: [string, string], montant: number) => {
      lignes.push({ Date: jour, Journal: journal, Compte: debit[0], 'Intitulé du compte': debit[1], Libellé: libelle, Pièce: piece, Débit: montant, Crédit: '' });
      lignes.push({ Date: jour, Journal: journal, Compte: credit[0], 'Intitulé du compte': credit[1], Libellé: libelle, Pièce: piece, Débit: '', Crédit: montant });
    };
    const CAISSE: [string, string] = ['571', 'Caisse'];
    const BANQUE: [string, string] = ['521', 'Banque'];
    const CHEQUES: [string, string] = ['513', 'Chèques à encaisser'];
    const SCOLARITE: [string, string] = ['706', 'Services vendus (frais de scolarité)'];
    for (const m of mouvements) {
      const piece = m.libelle.match(/\b[RSAE]\d{4}-\d+\b/)?.[0] ?? m.libelle.match(/bordereau\s+(\S+)/)?.[1] ?? '';
      const libelle = m.libelle.replace(/^Annulation\s+/, 'Annulation · ');
      if (m.nature === 'versement') {
        const debit = m.mode === 'especes' ? CAISSE : m.mode === 'cheque' ? CHEQUES : BANQUE;
        ecrire(m.jour, m.mode === 'especes' ? 'CA' : 'BQ', piece, libelle, debit, SCOLARITE, m.montant);
      } else if (m.nature === 'entree_diverse') ecrire(m.jour, 'CA', piece, libelle, CAISSE, ['758', 'Produits divers'], m.montant);
      else if (m.nature === 'annulation') ecrire(m.jour, 'CA', piece, libelle, SCOLARITE, CAISSE, m.montant);
      else if (m.nature === 'versement_banque') ecrire(m.jour, 'CA', piece, libelle, BANQUE, CAISSE, m.montant);
      else {
        const charge = COMPTES_CHARGES.find(([re]) => re.test(`${m.categorie ?? ''} ${m.libelle}`));
        ecrire(m.jour, 'CA', piece, m.categorie ? `${libelle} · ${m.categorie}` : libelle, charge ? [charge[1], charge[2]] : ['638', 'Autres charges externes'], CAISSE, m.montant);
      }
    }
    await app.bd.transaction(ctx.compteId, (tx) => journaliser(tx, ctx as never, { action: 'Export', objetType: 'Comptes',
      objetLibelle: `Écritures comptables du ${dateFr(du)} au ${dateFr(au)}`, avant: '–', apres: `${mouvements.length} opérations` }));
    return versCsv(lignes.length ? lignes : [{ Date: '', Journal: '', Compte: '', 'Intitulé du compte': '', Libellé: 'Aucune opération sur la période', Pièce: '', Débit: '', Crédit: '' }]);
  }

  r.get('/finances/comptes/document', {
    config: { permission: 'finances.comptes.consulter' }, schema: { tags: ['finances'], querystring: FiltreComptes.extend({ format: z.enum(['csv', 'pdf', 'ecritures']) }) },
  }, async (req, rep) => {
    const ctx = exiger(req);
    const e = await etatComptes(ctx.etablissementId, req.query);
    if (req.query.format === 'ecritures') return rep.header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="ecritures-${e.du}-${e.au}.csv"`).send(await ecritures(ctx, e.du, e.au, req.query.caisse ?? null));
    const lignesC = e.parCaisse.map((c) => [c.caisse === 'principale' ? 'Caisse principale' : 'Caisse APE', ...[c.initial, c.recettes, c.depenses, c.banque, c.solde].map((n) => n.toLocaleString('fr-FR'))]);
    await app.bd.transaction(ctx.compteId, (tx) => journaliser(tx, ctx, { action: 'Export', objetType: 'Comptes', objetLibelle: `État des comptes du ${dateFr(e.du)} au ${dateFr(e.au)}`, avant: '–', apres: req.query.format.toUpperCase() }));
    if (req.query.format === 'csv') {
      return rep.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', 'attachment; filename="etat-des-comptes.csv"')
        .send(versCsv(e.parCaisse.map((c) => ({ Caisse: c.caisse, 'Solde initial': c.initial, Recettes: c.recettes, Dépenses: c.depenses, 'Versé à la banque': c.banque, Solde: c.solde }))));
    }
    const etab = await app.bd.lireUn<{ nom_fr: string; nom_en: string; ville_bp: string | null; telephone: string | null }>(sql`SELECT nom_fr, nom_en, ville_bp, telephone FROM structure.etablissement WHERE id = ${ctx.etablissementId}`);
    const pdf = await pdfTableau({ etablissement: etab!, titre: 'ÉTAT DES COMPTES', sousTitre: `Du ${dateFr(e.du)} au ${dateFr(e.au)}`,
      colonnes: [{ titre: 'Caisse', largeur: 130 }, ...['Solde initial', 'Recettes', 'Dépenses', 'Versé à la banque', 'Solde'].map((t) => ({ titre: t, largeur: 75, droite: true }))],
      lignes: [...lignesC, ['Total', ...[e.total.initial, e.total.recettes, e.total.depenses, e.total.banque, e.total.solde].map((n) => n.toLocaleString('fr-FR'))]] });
    return rep.type('application/pdf').send(Buffer.from(pdf));
  });

  // ------------------------------------------------------------- relevé bancaire (E-27)

  r.get('/finances/releve', {
    config: { permission: 'finances.releve.gerer' }, schema: { tags: ['finances'], querystring: z.object({ mois: z.string().regex(/^\d{4}-\d{2}$/).optional() }) },
  }, async (req) => {
    const ctx = exiger(req);
    const e = await app.bd.lireUn<{ banque: string | null; numero_compte: string | null }>(sql`SELECT banque, numero_compte FROM structure.etablissement WHERE id = ${ctx.etablissementId}`);
    const mois = req.query.mois ?? new Date(Date.now() + 3600_000).toISOString().slice(0, 7);
    const releves = await app.bd.lire<{ mois: string }>(sql`SELECT to_char(mois, 'YYYY-MM') AS mois FROM finances.releve WHERE etablissement_id = ${ctx.etablissementId} ORDER BY mois DESC`);
    const rel = await app.bd.lireUn<{ id: string; importe_le: string }>(sql`
      SELECT id, importe_le FROM finances.releve WHERE etablissement_id = ${ctx.etablissementId} AND to_char(mois, 'YYYY-MM') = ${mois}`);
    const lignesR = rel ? await app.bd.lire<{ id: string; opere_le: string; libelle: string; montant: number; reference: string | null;
      v_numero: string | null; v_eleve: string | null; v_montant: number | null; v_eleve_id: string | null; v_bordereau: string | null; d_montant: number | null; d_caisse: string | null; d_bordereau: string | null }>(sql`
      SELECT l.id, l.opere_le, l.libelle, l.montant, l.reference,
             v.numero_recu AS v_numero, e.nom || ' ' || e.prenoms AS v_eleve, v.montant AS v_montant, e.id AS v_eleve_id, v.bordereau AS v_bordereau,
             d.montant AS d_montant, s.caisse AS d_caisse, d.bordereau AS d_bordereau
        FROM finances.ligne_releve l
        LEFT JOIN finances.versement v ON v.id = COALESCE(l.versement_id, (SELECT x.id FROM finances.versement x WHERE x.etablissement_id = l.etablissement_id
                    AND x.bordereau = l.reference AND x.statut <> 'annule' LIMIT 1))
        LEFT JOIN scolarite.inscription i ON i.id = v.inscription_id LEFT JOIN scolarite.eleve e ON e.id = i.eleve_id
        LEFT JOIN caisse.depot_banque d ON d.id = COALESCE(l.depot_id, (SELECT y.id FROM caisse.depot_banque y WHERE y.etablissement_id = l.etablissement_id AND y.bordereau = l.reference LIMIT 1))
        LEFT JOIN caisse.session s ON s.id = d.session_id
       WHERE l.releve_id = ${rel.id} ORDER BY l.ordre`) : [];
    const lignes2 = lignesR.map((l) => {
      const attendu = l.v_montant ?? l.d_montant;
      const etat = attendu === null ? 'sans_bordereau' : Number(attendu) === Number(l.montant) ? 'rapproche' : 'ecart';
      return { id: l.id, date: l.opere_le, libelle: l.libelle, montant: Number(l.montant), etat, ecart: attendu === null ? null : Number(attendu) - Number(l.montant),
        recu: l.v_numero, eleve: l.v_eleve, eleveId: l.v_eleve_id, montantRecu: l.v_montant === null ? null : Number(l.v_montant),
        bordereau: l.v_bordereau ?? l.d_bordereau ?? l.reference, depot: l.d_caisse ? `Versement de la caisse ${l.d_caisse === 'ape' ? 'APE' : 'principale'}` : null };
    });
    const cpt = (et: string) => lignes2.filter((l) => l.etat === et);
    return { banque: e?.banque ?? null, numeroCompte: e?.numero_compte ?? null, mois, mois_disponibles: releves.map((x) => x.mois),
      importeLe: rel?.importe_le ?? null, lignes: lignes2,
      pointage: { rapprochees: cpt('rapproche').length, sansBordereau: cpt('sans_bordereau').length,
        montantSansBordereau: cpt('sans_bordereau').reduce((s, l) => s + l.montant, 0), ecarts: cpt('ecart').length,
        montantEcarts: cpt('ecart').reduce((s, l) => s + Math.abs(l.ecart ?? 0), 0) } };
  });

  r.get('/finances/releve/export', {
    config: { permission: 'finances.releve.gerer' }, schema: { tags: ['finances'], querystring: z.object({ mois: z.string().regex(/^\d{4}-\d{2}$/) }) },
  }, async (req, rep) => {
    const ctx = exiger(req);
    const rows = await app.bd.lire<Record<string, unknown>>(sql`
      SELECT to_char(l.opere_le, 'DD/MM/YYYY') AS "Date", l.libelle AS "Libellé", l.montant AS "Montant", COALESCE(l.reference, '') AS "Référence",
             COALESCE(v.numero_recu, '') AS "Reçu"
        FROM finances.ligne_releve l JOIN finances.releve r ON r.id = l.releve_id
        LEFT JOIN finances.versement v ON v.id = l.versement_id
       WHERE r.etablissement_id = ${ctx.etablissementId} AND to_char(r.mois, 'YYYY-MM') = ${req.query.mois} ORDER BY l.ordre`);
    await app.bd.transaction(ctx.compteId, (tx) => journaliser(tx, ctx, { action: 'Export', objetType: 'Relevé bancaire', objetLibelle: `Relevé de ${req.query.mois}`, avant: '–', apres: 'CSV' }));
    return rep.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', `attachment; filename="releve-${req.query.mois}.csv"`).send(versCsv(rows));
  });

  // Format du relevé importé : CSV « date;libellé;montant;référence » (décision D-19).
  r.post('/finances/releve', {
    config: { permission: 'finances.releve.gerer' }, bodyLimit: 3_000_000,
    schema: { tags: ['finances'], body: z.object({ mois: z.string().regex(/^\d{4}-\d{2}$/), csv: z.string().min(1).max(2_000_000) }) },
  }, async (req) => {
    const ctx = exiger(req);
    const lignesCsv = req.body.csv.replace(/^﻿/, '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const donnees = lignesCsv.filter((l, i) => !(i === 0 && /date/i.test(l)));
    const analysees = donnees.map((l, i) => {
      const [date, libelle, montant, reference] = l.split(';').map((x) => x?.trim() ?? '');
      const d = /^\d{2}\/\d{2}\/\d{4}$/.test(date ?? '') ? date!.split('/').reverse().join('-') : date;
      const m = Number((montant ?? '').replace(/[\s  ]/g, ''));
      if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d) || !libelle || !Number.isInteger(m) || m <= 0) {
        throw new ErreurMetier('FIN_RELEVE_LIGNE_INVALIDE', 422, `Ligne ${i + 1} invalide : date;libellé;montant;référence attendus.`, 'csv');
      }
      return { date: d, libelle, montant: m, reference: reference || null };
    });
    return app.bd.transaction(ctx.compteId, async (tx) => {
      const e = await ligne<{ banque: string | null }>(tx, sql`SELECT banque FROM structure.etablissement WHERE id = ${ctx.etablissementId}`);
      const rel = await ligne<{ id: string }>(tx, sql`
        INSERT INTO finances.releve (etablissement_id, banque, mois, importe_par) VALUES (${ctx.etablissementId}, ${e?.banque ?? 'Banque'}, ${`${req.body.mois}-01`}, ${ctx.compteId})
        ON CONFLICT (etablissement_id, banque, mois) DO UPDATE SET importe_le = now(), importe_par = ${ctx.compteId} RETURNING id`);
      const deja = await ligne<{ n: number }>(tx, sql`SELECT count(*)::int AS n FROM finances.ligne_releve WHERE releve_id = ${rel!.id}`);
      let ordre = deja!.n;
      for (const l of analysees) {
        await tx.execute(sql`INSERT INTO finances.ligne_releve (etablissement_id, releve_id, ordre, opere_le, libelle, montant, reference)
                             VALUES (${ctx.etablissementId}, ${rel!.id}, ${++ordre}, ${l.date}, ${l.libelle}, ${l.montant}, ${l.reference})`);
      }
      await journaliser(tx, ctx, { action: 'Création', objetType: 'Relevé bancaire', objetLibelle: `Relevé de ${req.body.mois}`, avant: '–', apres: `${analysees.length} lignes importées` });
      return { lignes: analysees.length };
    });
  });
}

async function assurerRubriques(tx: Tx, etab: string) {
  const defaut: [string, string, string, boolean, string | null, string][] = [
    ['inscription', 'Inscription', 'Registration', true, null, 'principale'],
    ['scolarite', 'Scolarité', 'Tuition', true, '3 tranches', 'principale'],
    ['ape', 'APE', 'PTA', true, 'caisse APE', 'ape'],
    ['examen', 'Examen', 'Examination', false, 'CM2 et Class 6', 'principale'],
    ['tenue', 'Tenue', 'Uniform', false, null, 'principale'],
    ['transport', 'Transport', 'Transport', false, null, 'principale'],
    ['cantine', 'Cantine', 'Canteen', false, null, 'principale'],
  ];
  let ordre = 0;
  for (const [code, fr, en, obl, prec, caisse] of defaut) {
    await tx.execute(sql`INSERT INTO finances.rubrique (etablissement_id, code, libelle_fr, libelle_en, obligatoire, precision_fr, caisse, ordre)
                         VALUES (${etab}, ${code}, ${fr}, ${en}, ${obl}, ${prec}, ${caisse}, ${++ordre}) ON CONFLICT (etablissement_id, code) DO NOTHING`);
  }
  const r = await lignes<{ id: string; code: string }>(tx, sql`SELECT id, code FROM finances.rubrique WHERE etablissement_id = ${etab} AND code IN ('inscription', 'scolarite')`);
  return { inscription: r.find((x) => x.code === 'inscription')!.id, scolarite: r.find((x) => x.code === 'scolarite')!.id };
}

export { assurerRubriques };
