// CU-02 · Paramétrer l'établissement, l'année et les classes (SOC-01 à SOC-04).
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { sql, ligne, lignes, type Tx } from '../../../core/bd.ts';
import { ErreurMetier, introuvable } from '../../../core/erreurs.ts';
import { exiger } from '../../../core/session.ts';
import { journaliser } from '../../../core/audit.ts';
import { anneeOuverte, cleCompteur, FORMATS, numeroSuivant } from '../index.ts';

const Id = z.object({ id: z.uuid() });
const Date_ = z.iso.date();

// Niveaux créés avec un cycle (décision D-10).
export const NIVEAUX_TYPES: Record<string, { code: string; libelle: string }[]> = {
  'francophone:maternelle': [{ code: 'PS', libelle: 'Petite section' }, { code: 'MS', libelle: 'Moyenne section' }, { code: 'GS', libelle: 'Grande section' }],
  'anglophone:maternelle': [{ code: 'Nursery 1', libelle: 'Nursery 1' }, { code: 'Nursery 2', libelle: 'Nursery 2' }],
  'francophone:primaire': ['SIL', 'CP', 'CE1', 'CE2', 'CM1', 'CM2'].map((c) => ({ code: c, libelle: c })),
  'anglophone:primaire': [1, 2, 3, 4, 5, 6].map((i) => ({ code: `Class ${i}`, libelle: `Class ${i}` })),
  'francophone:secondaire': ['6e', '5e', '4e', '3e', '2nde', '1re', 'Tle'].map((c) => ({ code: c, libelle: c })),
  'anglophone:secondaire': ['Form 1', 'Form 2', 'Form 3', 'Form 4', 'Form 5', 'Lower Sixth', 'Upper Sixth'].map((c) => ({ code: c, libelle: c })),
};
const RANG_BASE: Record<string, number> = { maternelle: 0, primaire: 10, secondaire: 20 };
export const LIBELLE_CYCLE: Record<string, string> = {
  'francophone:maternelle': 'maternelle', 'anglophone:maternelle': 'nursery',
  'francophone:primaire': 'primaire', 'anglophone:primaire': 'primary',
  'francophone:secondaire': 'secondaire', 'anglophone:secondaire': 'secondary',
};

const Identite = z.object({
  nomFr: z.string().trim().min(2).max(120),
  nomEn: z.string().trim().min(2).max(120),
  devise: z.string().trim().max(160).nullish(),
  villeBp: z.string().trim().max(120).nullish(),
  telephone: z.string().trim().max(60).nullish(),
  signataire: z.string().trim().max(120).nullish(),
  banque: z.string().trim().max(120).nullish(),
  numeroCompte: z.string().trim().max(60).nullish(),
  seuilReduction: z.number().int().min(0).max(100_000_000).nullish(),
});

export async function routesStructure(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get('/structure/etablissement', { config: { permission: 'structure.consulter' }, schema: { tags: ['structure'] } }, async (req) => {
    const ctx = exiger(req);
    const e = await app.bd.lireUn<Record<string, unknown>>(sql`
      SELECT id, nom_fr AS "nomFr", nom_en AS "nomEn", devise, ville_bp AS "villeBp", telephone, signataire, banque,
             numero_compte AS "numeroCompte", seuil_reduction AS "seuilReduction",
             logo IS NOT NULL AS "aLogo", cachet IS NOT NULL AS "aCachet", signature IS NOT NULL AS "aSignature", version
        FROM structure.etablissement WHERE id = ${ctx.etablissementId}`);
    const annees = await app.bd.lire(sql`
      SELECT id, libelle, date_debut AS "dateDebut", date_fin AS "dateFin", statut
        FROM structure.annee_scolaire WHERE etablissement_id = ${ctx.etablissementId} ORDER BY date_debut`);
    const ouverte = await anneeOuverte(app.bd, ctx.etablissementId);
    const preparee = await app.bd.lireUn<{ id: string }>(sql`
      SELECT id FROM structure.annee_scolaire WHERE etablissement_id = ${ctx.etablissementId} AND statut = 'preparation' ORDER BY date_debut LIMIT 1`);
    const anneePeriodes = ouverte?.id ?? preparee?.id ?? null;
    const periodes = anneePeriodes ? await app.bd.lire(sql`
      SELECT id, ordre, libelle_fr AS "libelleFr", libelle_en AS "libelleEn", date_debut AS "dateDebut", date_fin AS "dateFin",
             sequences, tranche_ordre AS "trancheOrdre", statut, version
        FROM structure.periode WHERE annee_id = ${anneePeriodes} ORDER BY ordre`) : [];
    const cycles = await app.bd.lire<{ id: string; sous_systeme: string; ordre_enseignement: string; libelle: string; code_section: string }>(sql`
      SELECT id, sous_systeme, ordre_enseignement, libelle, code_section FROM structure.cycle
       WHERE etablissement_id = ${ctx.etablissementId} ORDER BY sous_systeme DESC, ordre, ordre_enseignement`);
    const classes = await app.bd.lire<{ id: string; nom: string; cycle_id: string; niveau_id: string; effectif_max: number; effectif: number }>(sql`
      SELECT c.id, c.nom, n.cycle_id, c.niveau_id, c.effectif_max,
             (SELECT count(*)::int FROM reporting.v_inscription i WHERE i.classe_id = c.id AND i.statut IN ('attente', 'validee')) AS effectif
        FROM structure.classe c JOIN structure.niveau n ON n.id = c.niveau_id
       WHERE c.etablissement_id = ${ctx.etablissementId} AND c.annee_id = ${anneePeriodes}
       ORDER BY n.rang, c.nom`);
    const niveaux = await app.bd.lire(sql`
      SELECT id, cycle_id AS "cycleId", code, libelle, rang FROM structure.niveau WHERE etablissement_id = ${ctx.etablissementId} ORDER BY rang`);
    const annee = ouverte?.annee_civile ?? new Date().getFullYear();
    const numerotation = [
      { document: 'Matricule', format: 'Année d’entrée + section + ordre',
        prochain: cycles[0] ? FORMATS.matricule(annee, cycles[0].code_section,
          await numeroSuivant(app.bd, ctx.etablissementId, cleCompteur.matricule(annee, cycles[0].code_section))) : '–' },
      { document: 'Reçu', format: 'R + année + 6 chiffres', prochain: FORMATS.recu(annee, await numeroSuivant(app.bd, ctx.etablissementId, cleCompteur.recu(annee))) },
      { document: 'Avis de paiement', format: 'A + année + 6 chiffres', prochain: FORMATS.avis(annee, await numeroSuivant(app.bd, ctx.etablissementId, cleCompteur.avis(annee))) },
      { document: 'Exeat', format: 'E + année + 4 chiffres', prochain: FORMATS.exeat(annee, await numeroSuivant(app.bd, ctx.etablissementId, cleCompteur.exeat(annee))) },
    ];
    return {
      identite: e,
      annees,
      anneePeriodes,
      periodes,
      cycles: cycles.map((c) => ({
        id: c.id, sousSysteme: c.sous_systeme, ordreEnseignement: c.ordre_enseignement, libelle: c.libelle, codeSection: c.code_section,
        classes: classes.filter((k) => k.cycle_id === c.id).map((k) => ({ id: k.id, nom: k.nom, niveauId: k.niveau_id, effectifMax: k.effectif_max, effectif: k.effectif })),
      })),
      niveaux,
      numerotation,
    };
  });

  r.put('/structure/etablissement', {
    config: { permission: 'structure.etablissement.modifier' }, schema: { tags: ['structure'], body: Identite },
  }, async (req) => {
    const ctx = exiger(req);
    const b = req.body;
    return app.bd.transaction(ctx.compteId, async (tx) => {
      const avant = await ligne<{ nom_fr: string; seuil_reduction: number | null }>(tx, sql`
        SELECT nom_fr, seuil_reduction FROM structure.etablissement WHERE id = ${ctx.etablissementId}`);
      await tx.execute(sql`
        UPDATE structure.etablissement SET nom_fr = ${b.nomFr}, nom_en = ${b.nomEn}, devise = ${b.devise ?? null},
               ville_bp = ${b.villeBp ?? null}, telephone = ${b.telephone ?? null}, signataire = ${b.signataire ?? null},
               banque = ${b.banque ?? null}, numero_compte = ${b.numeroCompte ?? null}, seuil_reduction = ${b.seuilReduction ?? null}
         WHERE id = ${ctx.etablissementId}`);
      await journaliser(tx, ctx, { action: 'Modification', objetType: 'Établissement', objetLibelle: `Établissement · ${b.nomFr}`,
        avant: avant!.seuil_reduction !== (b.seuilReduction ?? null) ? `Seuil de réduction : ${avant!.seuil_reduction ?? '–'}` : avant!.nom_fr,
        apres: avant!.seuil_reduction !== (b.seuilReduction ?? null) ? `Seuil de réduction : ${b.seuilReduction ?? '–'}` : b.nomFr,
        ligneId: ctx.etablissementId, table: 'structure.etablissement' });
      return { ok: true };
    });
  });

  // Logo, cachet, signature : image PNG ou JPEG en base64, 1 Mo au plus.
  r.put('/structure/etablissement/images/:type', {
    config: { permission: 'structure.etablissement.modifier' },
    bodyLimit: 2_000_000,
    schema: { tags: ['structure'], params: z.object({ type: z.enum(['logo', 'cachet', 'signature']) }), body: z.object({ base64: z.string().max(1_400_000) }) },
  }, async (req) => {
    const ctx = exiger(req);
    const octets = Buffer.from(req.body.base64, 'base64');
    const png = octets.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const jpeg = octets[0] === 0xff && octets[1] === 0xd8;
    if (!png && !jpeg) throw new ErreurMetier('STR_IMAGE_INVALIDE', 422, 'Image PNG ou JPEG attendue.');
    await app.bd.transaction(ctx.compteId, (tx) => tx.execute(
      req.params.type === 'logo' ? sql`UPDATE structure.etablissement SET logo = ${octets} WHERE id = ${ctx.etablissementId}`
        : req.params.type === 'cachet' ? sql`UPDATE structure.etablissement SET cachet = ${octets} WHERE id = ${ctx.etablissementId}`
          : sql`UPDATE structure.etablissement SET signature = ${octets} WHERE id = ${ctx.etablissementId}`));
    return { ok: true };
  });

  r.get('/structure/etablissement/images/:type', {
    config: { permission: 'structure.consulter' },
    schema: { tags: ['structure'], params: z.object({ type: z.enum(['logo', 'cachet', 'signature']) }) },
  }, async (req, rep) => {
    const ctx = exiger(req);
    const e = await app.bd.lireUn<{ img: Buffer | null }>(
      req.params.type === 'logo' ? sql`SELECT logo AS img FROM structure.etablissement WHERE id = ${ctx.etablissementId}`
        : req.params.type === 'cachet' ? sql`SELECT cachet AS img FROM structure.etablissement WHERE id = ${ctx.etablissementId}`
          : sql`SELECT signature AS img FROM structure.etablissement WHERE id = ${ctx.etablissementId}`);
    if (!e?.img) throw introuvable('Image');
    return rep.type(e.img[0] === 0x89 ? 'image/png' : 'image/jpeg').send(e.img);
  });

  // ------------------------------------------------------------- années et périodes (RG-01, SOC-04)

  r.post('/structure/annees', {
    config: { permission: 'structure.annee.gerer' },
    schema: { tags: ['structure'], body: z.object({ libelle: z.string().regex(/^\d{4}\/\d{4}$/), dateDebut: Date_, dateFin: Date_, ouvrir: z.boolean().default(false) }) },
  }, async (req) => {
    const ctx = exiger(req);
    const b = req.body;
    if (b.dateFin <= b.dateDebut) throw new ErreurMetier('STR_DATES', 422, 'La fin doit suivre le début.', 'dateFin');
    return app.bd.transaction(ctx.compteId, async (tx) => {
      const a = await ligne<{ id: string }>(tx, sql`
        INSERT INTO structure.annee_scolaire (etablissement_id, libelle, date_debut, date_fin, statut, cree_par)
        VALUES (${ctx.etablissementId}, ${b.libelle}, ${b.dateDebut}, ${b.dateFin}, 'preparation', ${ctx.compteId}) RETURNING id`);
      await creerPeriodesParDefaut(tx, ctx.etablissementId, a!.id, b.dateDebut, b.dateFin);
      await journaliser(tx, ctx, { action: 'Création', objetType: 'Année scolaire', objetLibelle: `Année ${b.libelle}`,
        avant: '–', apres: 'En préparation', ligneId: a!.id, table: 'structure.annee_scolaire' });
      if (b.ouvrir) await ouvrirAnnee(tx, ctx, a!.id);
      return { id: a!.id };
    });
  });

  r.post('/structure/annees/:id/ouverture', {
    config: { permission: 'structure.annee.gerer' }, schema: { tags: ['structure'], params: Id },
  }, async (req) => {
    const ctx = exiger(req);
    return app.bd.transaction(ctx.compteId, async (tx) => { await ouvrirAnnee(tx, ctx, req.params.id); return { ok: true }; });
  });

  r.put('/structure/periodes/:id', {
    config: { permission: 'structure.periode.modifier' },
    schema: { tags: ['structure'], params: Id, body: z.object({
      libelleFr: z.string().trim().min(2).max(60), libelleEn: z.string().trim().min(2).max(60), dateDebut: Date_, dateFin: Date_,
      sequences: z.string().trim().max(30).nullish(), trancheOrdre: z.number().int().min(1).max(10).nullish() }) },
  }, async (req) => {
    const ctx = exiger(req);
    const b = req.body;
    if (b.dateFin <= b.dateDebut) throw new ErreurMetier('STR_DATES', 422, 'La fin doit suivre le début.', 'dateFin');
    return app.bd.transaction(ctx.compteId, async (tx) => {
      const p = await ligne<{ id: string }>(tx, sql`
        UPDATE structure.periode SET libelle_fr = ${b.libelleFr}, libelle_en = ${b.libelleEn}, date_debut = ${b.dateDebut},
               date_fin = ${b.dateFin}, sequences = ${b.sequences ?? null}, tranche_ordre = ${b.trancheOrdre ?? null}
         WHERE id = ${req.params.id} AND etablissement_id = ${ctx.etablissementId} RETURNING id`);
      if (!p) throw introuvable('Période');
      await journaliser(tx, ctx, { action: 'Modification', objetType: 'Période', objetLibelle: `Période · ${b.libelleFr}`,
        avant: '–', apres: `${b.dateDebut} → ${b.dateFin}, tranche ${b.trancheOrdre ?? '–'}`, ligneId: p.id, table: 'structure.periode' });
      return { ok: true };
    });
  });

  // ------------------------------------------------------------- cycles, niveaux, classes (RG-03)

  r.post('/structure/cycles', {
    config: { permission: 'structure.classe.gerer' },
    schema: { tags: ['structure'], body: z.object({
      sousSysteme: z.enum(['francophone', 'anglophone']), ordreEnseignement: z.enum(['maternelle', 'primaire', 'secondaire']) }) },
  }, async (req) => {
    const ctx = exiger(req);
    const { sousSysteme, ordreEnseignement } = req.body;
    const cle = `${sousSysteme}:${ordreEnseignement}`;
    return app.bd.transaction(ctx.compteId, async (tx) => {
      const c = await ligne<{ id: string }>(tx, sql`
        INSERT INTO structure.cycle (etablissement_id, sous_systeme, ordre_enseignement, libelle, code_section, ordre, cree_par)
        VALUES (${ctx.etablissementId}, ${sousSysteme}, ${ordreEnseignement}, ${LIBELLE_CYCLE[cle]!},
                ${sousSysteme === 'francophone' ? 'FR' : 'ANG'}, ${RANG_BASE[ordreEnseignement]!}, ${ctx.compteId}) RETURNING id`);
      let rang = RANG_BASE[ordreEnseignement]! + 1;
      for (const n of NIVEAUX_TYPES[cle]!) {
        await tx.execute(sql`INSERT INTO structure.niveau (etablissement_id, cycle_id, code, libelle, rang, cree_par)
                             VALUES (${ctx.etablissementId}, ${c!.id}, ${n.code}, ${n.libelle}, ${rang++}, ${ctx.compteId})`);
      }
      await journaliser(tx, ctx, { action: 'Création', objetType: 'Classe', objetLibelle: `Cycle · ${sousSysteme} · ${LIBELLE_CYCLE[cle]}`,
        avant: '–', apres: NIVEAUX_TYPES[cle]!.map((n) => n.code).join(', '), ligneId: c!.id, table: 'structure.cycle' });
      return { id: c!.id };
    });
  });

  r.post('/structure/classes', {
    config: { permission: 'structure.classe.gerer' },
    schema: { tags: ['structure'], body: z.object({ niveauId: z.uuid(), nom: z.string().trim().min(1).max(40), effectifMax: z.number().int().min(1).max(200), anneeId: z.uuid().optional() }) },
  }, async (req) => {
    const ctx = exiger(req);
    const b = req.body;
    return app.bd.transaction(ctx.compteId, async (tx) => {
      const annee = b.anneeId ?? (await ligne<{ id: string }>(tx, sql`
        SELECT id FROM structure.annee_scolaire WHERE etablissement_id = ${ctx.etablissementId} AND statut IN ('ouverte', 'preparation')
         ORDER BY (statut = 'ouverte') DESC, date_debut LIMIT 1`))?.id;
      if (!annee) throw new ErreurMetier('STR_AUCUNE_ANNEE', 422, 'Créez d\'abord une année scolaire.');
      const niveau = await ligne(tx, sql`SELECT id FROM structure.niveau WHERE id = ${b.niveauId} AND etablissement_id = ${ctx.etablissementId}`);
      if (!niveau) throw introuvable('Niveau');
      const c = await ligne<{ id: string }>(tx, sql`
        INSERT INTO structure.classe (etablissement_id, annee_id, niveau_id, nom, effectif_max, cree_par)
        VALUES (${ctx.etablissementId}, ${annee}, ${b.niveauId}, ${b.nom}, ${b.effectifMax}, ${ctx.compteId}) RETURNING id`);
      await journaliser(tx, ctx, { action: 'Création', objetType: 'Classe', objetLibelle: `Classe · ${b.nom}`,
        avant: '–', apres: `${b.effectifMax} places`, ligneId: c!.id, table: 'structure.classe' });
      return { id: c!.id };
    });
  });

  r.patch('/structure/classes/:id', {
    config: { permission: 'structure.classe.gerer' },
    schema: { tags: ['structure'], params: Id, body: z.object({ nom: z.string().trim().min(1).max(40).optional(), effectifMax: z.number().int().min(1).max(200).optional() }) },
  }, async (req) => {
    const ctx = exiger(req);
    const b = req.body;
    return app.bd.transaction(ctx.compteId, async (tx) => {
      const avant = await ligne<{ nom: string; effectif_max: number }>(tx, sql`
        SELECT nom, effectif_max FROM structure.classe WHERE id = ${req.params.id} AND etablissement_id = ${ctx.etablissementId}`);
      if (!avant) throw introuvable('Classe');
      await tx.execute(sql`UPDATE structure.classe SET nom = ${b.nom ?? avant.nom}, effectif_max = ${b.effectifMax ?? avant.effectif_max}
                           WHERE id = ${req.params.id}`);
      await journaliser(tx, ctx, { action: 'Modification', objetType: 'Classe', objetLibelle: `Classe · ${b.nom ?? avant.nom}`,
        avant: `${avant.nom}, ${avant.effectif_max} places`, apres: `${b.nom ?? avant.nom}, ${b.effectifMax ?? avant.effectif_max} places`,
        ligneId: req.params.id, table: 'structure.classe' });
      return { ok: true };
    });
  });

  r.get('/structure/niveaux', { config: { unePermissionParmi: ['structure.consulter', 'scolarite.eleve.consulter', 'finances.grille.consulter', 'pedagogie.programme.consulter'] }, schema: { tags: ['structure'] } }, async (req) => {
    const ctx = exiger(req);
    return app.bd.lire(sql`
      SELECT n.id, n.code, n.libelle, n.rang, n.cycle_id AS "cycleId", cy.sous_systeme AS "sousSysteme", cy.ordre_enseignement AS "ordreEnseignement"
        FROM structure.niveau n JOIN structure.cycle cy ON cy.id = n.cycle_id
       WHERE n.etablissement_id = ${ctx.etablissementId} ORDER BY cy.sous_systeme DESC, n.rang`);
  });
}

async function creerPeriodesParDefaut(tx: Tx, etab: string, anneeId: string, debut: string, fin: string) {
  // Trois trimestres d'égale durée ; trimestre n rattaché à la tranche n (ECARTS E-21). Modifiables ensuite.
  const d0 = new Date(debut + 'T00:00:00Z').getTime();
  const d1 = new Date(fin + 'T00:00:00Z').getTime();
  const pas = (d1 - d0) / 3;
  const jour = (t: number) => new Date(t).toISOString().slice(0, 10);
  const libelles = [['1er trimestre', 'First term'], ['2e trimestre', 'Second term'], ['3e trimestre', 'Third term']];
  for (let i = 0; i < 3; i++) {
    const db = jour(d0 + i * pas + (i ? 86_400_000 : 0));
    const df = i === 2 ? fin : jour(d0 + (i + 1) * pas);
    await tx.execute(sql`
      INSERT INTO structure.periode (etablissement_id, annee_id, ordre, libelle_fr, libelle_en, date_debut, date_fin, sequences, tranche_ordre)
      VALUES (${etab}, ${anneeId}, ${i + 1}, ${libelles[i]![0]!}, ${libelles[i]![1]!}, ${db}, ${df}, ${`${2 * i + 1} et ${2 * i + 2}`}, ${i + 1})`);
  }
}

async function ouvrirAnnee(tx: Tx, ctx: { compteId: string; etablissementId: string }, anneeId: string) {
  const ouverte = await ligne<{ libelle: string }>(tx, sql`
    SELECT libelle FROM structure.annee_scolaire WHERE etablissement_id = ${ctx.etablissementId} AND statut = 'ouverte'`);
  if (ouverte) {
    throw new ErreurMetier('STR_ANNEE_DEJA_OUVERTE', 422, `L'année ${ouverte.libelle} est ouverte ; clôturez-la d'abord (RG-01).`);
  }
  const a = await ligne<{ libelle: string }>(tx, sql`
    UPDATE structure.annee_scolaire SET statut = 'ouverte' WHERE id = ${anneeId} AND etablissement_id = ${ctx.etablissementId}
       AND statut = 'preparation' RETURNING libelle`);
  if (!a) throw new ErreurMetier('STR_ANNEE_NON_OUVRABLE', 422, 'Seule une année en préparation peut s\'ouvrir.');
  await journaliser(tx, ctx, { action: 'Modification', objetType: 'Année scolaire', objetLibelle: `Année ${a.libelle}`,
    avant: 'En préparation', apres: 'Ouverte', ligneId: anneeId, table: 'structure.annee_scolaire' });
}

export async function lireClasses(tx: Tx, etab: string, anneeId: string) {
  return lignes(tx, sql`SELECT id, nom FROM structure.classe WHERE etablissement_id = ${etab} AND annee_id = ${anneeId}`);
}
