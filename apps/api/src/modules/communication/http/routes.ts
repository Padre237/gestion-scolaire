// CU-25 SMS (COM-01 à COM-05, RG-28), CU-31 annonces (COM-07, RG-41), CU-32 messagerie des parents (COM-06, RG-42).
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { sql, ligne, lignes, type Tx, tableau } from '../../../core/bd.ts';
import { ErreurMetier, interdit, introuvable } from '../../../core/erreurs.ts';
import { exiger } from '../../../core/session.ts';
import type { Contexte } from '../../../core/contexte.ts';
import { journaliser } from '../../../core/audit.ts';
import { emettre, surEvenement } from '../../../core/evenements.ts';
import { perimetreEnseignant } from '../../../core/perimetre.ts';
import { exigerAnneeOuverte } from '../../structure/index.ts';

const Uuid = z.uuid();
export const CIBLES_ANNONCE: Record<string, string> = { ecole: 'Toute l’école', niveau: 'Un niveau', classe: 'Une classe', parent: 'Un parent', debiteurs: 'Familles débitrices' };
const CIBLES_SMS = ['classe', 'niveau', 'ecole', 'debiteurs'] as const;

// Modèles de SMS (maquette Messages) ; variables remplacées par destinataire.
export const MODELES: Record<string, { libelle: string; fr: string; en: string }> = {
  relance: { libelle: 'Relance de paiement',
    fr: 'Bonjour [responsable], il reste [montant] FCFA à régler pour [élève] ([classe]) depuis le [date limite]. Merci de passer à la caisse ou de déposer à la banque. [école]',
    en: 'Hello [responsable], [montant] FCFA is still due for [élève] ([classe]) since [date limite]. Please pay at the cashier’s office or at the bank. [school]' },
  absence: { libelle: 'Absence non justifiée',
    fr: 'Bonjour [responsable], [élève] ([classe]) est absent(e) ce [date] sans justification. Merci de contacter l’école. [école]',
    en: 'Hello [responsable], [élève] ([classe]) is absent on [date] without excuse. Please contact the school. [school]' },
  bulletin: { libelle: 'Bulletin disponible',
    fr: 'Bonjour [responsable], le bulletin de [élève] ([classe]) est disponible dans l’Espace parents. [école]',
    en: 'Hello [responsable], the report card of [élève] ([classe]) is available in the Parent space. [school]' },
  reunion: { libelle: 'Réunion des parents',
    fr: 'Bonjour [responsable], une réunion des parents aura lieu à l’école. Votre présence est attendue. [école]',
    en: 'Hello [responsable], a parents’ meeting will take place at the school. Your presence is expected. [school]' },
  recu: { libelle: 'Reçu de paiement',
    fr: 'Bonjour [responsable], nous avons reçu [montant] FCFA pour [élève] ([classe]), reçu [reçu]. Merci. [école]',
    en: 'Hello [responsable], we received [montant] FCFA for [élève] ([classe]), receipt [reçu]. Thank you. [school]' },
  reponse: { libelle: 'Réponse de l’école', fr: 'Bonjour [responsable], l’école vous a répondu dans l’Espace parents. [école]', en: 'Hello [responsable], the school replied in the Parent space. [school]' },
  annonce: { libelle: 'Annonce', fr: '[texte] [école]', en: '[texte] [school]' },
};

export const smsParMessage = (texte: string) => (texte.length <= 160 ? 1 : Math.ceil(texte.length / 153));

interface Destinataire { responsable_id: string; responsable: string; telephone: string; langue: 'fr' | 'en'; eleve: string; classe: string; inscription_id: string; montant: number; date_limite: string | null }

/** Responsables qui acceptent les SMS (RG-28), selon la cible. */
async function destinataires(tx: Tx, etab: string, cible: string, cibleId: string | null, payeursSeulement = false): Promise<Destinataire[]> {
  return lignes<Destinataire>(tx, sql`
    SELECT DISTINCT ON (r.id, i.id) r.id AS responsable_id, r.nom AS responsable, r.telephone, r.langue, i.prenoms || ' ' || i.nom AS eleve, i.classe,
           i.id AS inscription_id, COALESCE(s.echu, s.reste, 0)::bigint AS montant,
           (SELECT to_char(min(date_limite), 'DD/MM/YYYY') FROM reporting.v_impaye im WHERE im.inscription_id = i.id) AS date_limite
      FROM reporting.v_inscription i
      JOIN structure.annee_scolaire a ON a.id = i.annee_id AND a.statut = 'ouverte'
      JOIN scolarite.eleve_responsable er ON er.eleve_id = i.eleve_id AND er.recoit_sms AND (NOT ${payeursSeulement} OR er.payeur)
      JOIN scolarite.responsable r ON r.id = er.responsable_id
      JOIN structure.classe c ON c.id = i.classe_id
      LEFT JOIN reporting.v_solde s ON s.inscription_id = i.id
     WHERE i.etablissement_id = ${etab} AND i.statut IN ('attente', 'validee')
       AND (${cible} = 'ecole'
            OR (${cible} = 'classe' AND i.classe_id = ${cibleId}::uuid)
            OR (${cible} = 'niveau' AND c.niveau_id = ${cibleId}::uuid)
            OR (${cible} = 'parent' AND r.famille_id = ${cibleId}::uuid)
            OR (${cible} = 'inscription' AND i.id = ${cibleId}::uuid)
            OR (${cible} = 'debiteurs' AND s.echu > 0))`);
}

const fmt = (n: number) => n.toLocaleString('fr-FR').replace(/[  ]/g, ' ');

function remplir(modele: string, d: Destinataire, ecole: { fr: string; en: string }, extra: Record<string, string> = {}) {
  return modele.replaceAll('[responsable]', d.responsable).replaceAll('[élève]', d.eleve).replaceAll('[classe]', d.classe)
    .replaceAll('[montant]', fmt(Number(d.montant))).replaceAll('[date limite]', d.date_limite ?? '').replaceAll('[école]', ecole.fr)
    .replaceAll('[school]', ecole.en).replace(/\[(\w+)\]/g, (m, k: string) => extra[k] ?? m).trim();
}

/** Met des SMS en file. Sans prestataire actif (E-22), ils attendent : rien ne sort du poste. */
export async function mettreEnFile(tx: Tx, etab: string, o: { modele: string; cibleLibelle: string; texteFr: string; texteEn: string | null;
  destinataires: Destinataire[]; auteur: string | null; partirLe?: string; extra?: (d: Destinataire) => Record<string, string> }) {
  const ecole = await ligne<{ nom_fr: string; nom_en: string }>(tx, sql`SELECT nom_fr, nom_en FROM structure.etablissement WHERE id = ${etab}`);
  const uniques = new Map<string, Destinataire>();
  for (const d of o.destinataires) if (!uniques.has(`${d.telephone}|${d.inscription_id}`)) uniques.set(`${d.telephone}|${d.inscription_id}`, d);
  const liste = [...uniques.values()];
  if (!liste.length) return null;
  let nbSms = 0;
  const e = await ligne<{ id: string }>(tx, sql`
    INSERT INTO communication.envoi_sms (etablissement_id, modele, cible_libelle, texte_fr, texte_en, nb_destinataires, partir_le, auteur)
    VALUES (${etab}, ${o.modele}, ${o.cibleLibelle}, ${o.texteFr}, ${o.texteEn}, ${new Set(liste.map((d) => d.telephone)).size},
            ${o.partirLe ?? new Date().toISOString()}, ${o.auteur}) RETURNING id`);
  for (const d of liste) {
    const texte = remplir(d.langue === 'en' && o.texteEn ? o.texteEn : o.texteFr, d, { fr: ecole!.nom_fr, en: ecole!.nom_en }, o.extra?.(d) ?? {});
    nbSms += smsParMessage(texte);
    await tx.execute(sql`INSERT INTO communication.sms (etablissement_id, envoi_id, responsable_id, telephone, langue, texte)
                         VALUES (${etab}, ${e!.id}, ${d.responsable_id}, ${d.telephone}, ${d.langue}, ${texte})`);
  }
  await tx.execute(sql`UPDATE communication.envoi_sms SET nb_sms = ${nbSms} WHERE id = ${e!.id}`);
  return e!.id;
}

async function notificationActive(tx: Tx, etab: string, code: string): Promise<boolean> {
  const n = await ligne<{ active: boolean }>(tx, sql`SELECT active FROM communication.notification_auto WHERE etablissement_id = ${etab} AND code = ${code}`);
  return n?.active ?? code !== 'rappel_echeance'; // par défaut : tout actif sauf le rappel (maquette Messages)
}

// Événements traités dans la transaction de l'action (conception § 2) : versement.enregistre, absence.saisie, bulletin publié.
surEvenement('versement.enregistre', async (tx, ctx, d) => {
  const etab = (await ligne<{ etablissement_id: string }>(tx, sql`SELECT etablissement_id FROM finances.versement WHERE id = ${d.versementId}`))!.etablissement_id;
  if (!(await notificationActive(tx, etab, 'recu'))) return;
  const v = await ligne<{ numero_recu: string }>(tx, sql`SELECT numero_recu FROM finances.versement WHERE id = ${d.versementId}`);
  const dest = (await destinataires(tx, etab, 'inscription', d.inscriptionId, true)).map((x) => ({ ...x, montant: d.montant }));
  await mettreEnFile(tx, etab, { modele: MODELES['recu']!.libelle, cibleLibelle: '1 destinataire', texteFr: MODELES['recu']!.fr, texteEn: MODELES['recu']!.en,
    destinataires: dest, auteur: ctx?.compteId ?? null, extra: () => ({ 'reçu': v!.numero_recu }) });
});

surEvenement('absence.saisie', async (tx, ctx, d) => {
  const a = await lignes<{ etablissement_id: string; inscription_id: string; jour: string }>(tx, sql`
    SELECT DISTINCT etablissement_id, inscription_id, jour FROM vie_scolaire.absence WHERE id = ANY(${tableau(d.absenceIds)}::uuid[])`);
  if (!a.length || !(await notificationActive(tx, a[0]!.etablissement_id, 'absence'))) return;
  const etab = a[0]!.etablissement_id;
  const dest: Destinataire[] = [];
  for (const x of a) dest.push(...await destinataires(tx, etab, 'inscription', x.inscription_id));
  // À 10:00, sauf si l'absence a été justifiée ou corrigée d'ici là (maquette Appel, E-32).
  const dix = new Date(`${d.jour}T09:00:00Z`); // 10:00 au Cameroun
  const partir = dix.getTime() > Date.now() ? dix.toISOString() : new Date().toISOString();
  await mettreEnFile(tx, etab, { modele: MODELES['absence']!.libelle, cibleLibelle: `${dest.length} destinataire${dest.length > 1 ? 's' : ''}`,
    texteFr: MODELES['absence']!.fr, texteEn: MODELES['absence']!.en, destinataires: dest, auteur: ctx?.compteId ?? null, partirLe: partir,
    extra: () => ({ date: d.jour.split('-').reverse().join('/') }) });
});

surEvenement('absence.justifiee', async (tx, _ctx, d) => {
  await tx.execute(sql`
    UPDATE communication.sms s SET statut = 'annule' FROM communication.envoi_sms e, scolarite.eleve_responsable er, scolarite.inscription i
     WHERE s.envoi_id = e.id AND e.modele = ${MODELES['absence']!.libelle} AND s.statut = 'en_attente' AND e.partir_le::date = ${d.jour}::date
       AND er.responsable_id = s.responsable_id AND i.eleve_id = er.eleve_id AND i.id = ${d.inscriptionId}`);
});

surEvenement('bulletins.publies', async (tx, ctx, d) => {
  const etab = (await ligne<{ etablissement_id: string }>(tx, sql`SELECT etablissement_id FROM structure.classe WHERE id = ${d.classeId}`))!.etablissement_id;
  if (!(await notificationActive(tx, etab, 'bulletin'))) return;
  const dest: Destinataire[] = [];
  for (const i of d.inscriptionIds) dest.push(...await destinataires(tx, etab, 'inscription', i));
  await mettreEnFile(tx, etab, { modele: MODELES['bulletin']!.libelle, cibleLibelle: `${dest.length} destinataires`, texteFr: MODELES['bulletin']!.fr,
    texteEn: MODELES['bulletin']!.en, destinataires: dest, auteur: ctx?.compteId ?? null });
});

export async function routesCommunication(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  /** RG-41 : le principal publie pour sa classe seulement. */
  async function ciblePermise(ctx: Contexte, cible: string, cibleId: string | null | undefined) {
    if (ctx.portee('communication.annonce.publier') === 'etablissement') return;
    const p = await perimetreEnseignant(app.bd, ctx);
    if (cible !== 'classe' || !cibleId || !p.classesPrincipal.some((c) => c.id === cibleId)) {
      throw new ErreurMetier('COM_CIBLE_HORS_PERIMETRE', 403, 'L\'instituteur principal publie pour sa classe seulement (RG-41).');
    }
  }

  async function libelleCible(tx: Tx, cible: string, cibleId: string | null | undefined) {
    if (cible === 'ecole') return 'Toute l’école';
    if (cible === 'debiteurs') return 'Familles débitrices';
    if (cible === 'classe') return (await ligne<{ nom: string }>(tx, sql`SELECT nom FROM structure.classe WHERE id = ${cibleId!}`))?.nom ?? '';
    if (cible === 'niveau') return `Niveau ${(await ligne<{ code: string }>(tx, sql`SELECT code FROM structure.niveau WHERE id = ${cibleId!}`))?.code ?? ''}`;
    return `Famille ${(await ligne<{ nom: string }>(tx, sql`SELECT nom FROM scolarite.famille WHERE id = ${cibleId!}`))?.nom ?? ''}`;
  }

  // ------------------------------------------------------------- annonces (CU-31)

  r.get('/communication/annonces', { config: { permission: 'communication.annonce.publier' }, schema: { tags: ['communication'] } }, async (req) => {
    const ctx = exiger(req);
    const annee = await exigerAnneeOuverte(app.bd, ctx.etablissementId);
    const p = await perimetreEnseignant(app.bd, ctx);
    const large = ctx.portee('communication.annonce.publier') === 'etablissement';
    const classes = await app.bd.lire<{ id: string; nom: string }>(sql`
      SELECT c.id, c.nom FROM structure.classe c JOIN structure.niveau n ON n.id = c.niveau_id WHERE c.annee_id = ${annee.id} ORDER BY n.rang, c.nom`);
    const niveaux = large ? await app.bd.lire(sql`SELECT n.id, n.code AS nom FROM structure.niveau n JOIN structure.cycle cy ON cy.id = n.cycle_id
                                                     WHERE n.etablissement_id = ${ctx.etablissementId} ORDER BY cy.sous_systeme DESC, n.rang`) : [];
    const familles = large ? await app.bd.lire(sql`SELECT id, 'Famille ' || nom AS nom FROM scolarite.famille WHERE etablissement_id = ${ctx.etablissementId} ORDER BY nom`) : [];
    const publiees = await app.bd.lire(sql`
      SELECT a.id, a.titre, a.cible_libelle AS cible, a.nb_familles AS "nbFamilles", a.cible, a.statut, a.publiee_le AS "publieeLe", a.cree_le AS "creeLe",
             c.nom_affiche AS auteur
        FROM communication.annonce a JOIN core.compte c ON c.id = a.auteur
       WHERE a.etablissement_id = ${ctx.etablissementId} AND (a.statut = 'publiee' OR a.auteur = ${ctx.compteId})
       ORDER BY COALESCE(a.publiee_le, a.cree_le) DESC LIMIT 12`);
    return { classes: large ? classes : classes.filter((c) => p.classesPrincipal.some((x) => x.id === c.id)), niveaux, familles, cibles: large ? Object.keys(CIBLES_ANNONCE) : ['classe'], publiees };
  });

  const Annonce = z.object({ titre: z.string().trim().min(3).max(120), texteFr: z.string().trim().min(3).max(1000), texteEn: z.string().trim().max(1000).nullish(),
    cible: z.enum(['ecole', 'niveau', 'classe', 'parent', 'debiteurs']), cibleId: Uuid.nullish(), publier: z.boolean() });

  r.get('/communication/annonces/estimation', {
    config: { permission: 'communication.annonce.publier' },
    schema: { tags: ['communication'], querystring: z.object({ cible: z.enum(['ecole', 'niveau', 'classe', 'parent', 'debiteurs']), cibleId: Uuid.optional() }) },
  }, async (req) => {
    const ctx = exiger(req);
    const d = await app.bd.transaction(null, (tx) => destinataires(tx, ctx.etablissementId, req.query.cible, req.query.cibleId ?? null));
    return { familles: d.length ? new Set(d.map((x) => x.inscription_id)).size && (await app.bd.lireUn<{ n: number }>(sql`
      SELECT count(DISTINCT e.famille_id)::int AS n FROM scolarite.inscription i JOIN scolarite.eleve e ON e.id = i.eleve_id WHERE i.id = ANY(${tableau(d.map((x) => x.inscription_id))}::uuid[])`))!.n : 0,
      sms: new Set(d.map((x) => x.telephone)).size };
  });

  r.post('/communication/annonces', { config: { permission: 'communication.annonce.publier' }, schema: { tags: ['communication'], body: Annonce } }, async (req) => {
    const ctx = exiger(req);
    const b = req.body;
    if (b.cible !== 'ecole' && b.cible !== 'debiteurs' && !b.cibleId) throw new ErreurMetier('COM_CIBLE_REQUISE', 422, 'Choisissez le destinataire.', 'cibleId');
    await ciblePermise(ctx, b.cible, b.cibleId);
    return app.bd.transaction(ctx.compteId, async (tx) => {
      const cibleLibelle = await libelleCible(tx, b.cible, b.cibleId);
      const dest = await destinataires(tx, ctx.etablissementId, b.cible, b.cibleId ?? null);
      const familles = await lignes<{ famille_id: string }>(tx, sql`
        SELECT DISTINCT e.famille_id FROM scolarite.inscription i JOIN scolarite.eleve e ON e.id = i.eleve_id
         WHERE i.id = ANY(${tableau(dest.map((x) => x.inscription_id))}::uuid[])
        UNION SELECT ${b.cible === 'parent' ? b.cibleId ?? null : null}::uuid WHERE ${b.cible === 'parent'}`);
      const a = await ligne<{ id: string }>(tx, sql`
        INSERT INTO communication.annonce (etablissement_id, titre, texte_fr, texte_en, cible, cible_id, cible_libelle, statut, nb_familles, auteur, publiee_le)
        VALUES (${ctx.etablissementId}, ${b.titre}, ${b.texteFr}, ${b.texteEn ?? null}, ${b.cible}, ${b.cibleId ?? null}, ${cibleLibelle},
                ${b.publier ? 'publiee' : 'brouillon'}, ${familles.filter((f) => f.famille_id).length}, ${ctx.compteId}, ${b.publier ? new Date().toISOString() : null}) RETURNING id`);
      if (b.publier) {
        for (const f of familles) if (f.famille_id) await tx.execute(sql`INSERT INTO communication.annonce_famille (annonce_id, famille_id) VALUES (${a!.id}, ${f.famille_id}) ON CONFLICT DO NOTHING`);
        await mettreEnFile(tx, ctx.etablissementId, { modele: 'Annonce', cibleLibelle, texteFr: `${b.titre}. ${b.texteFr}`.slice(0, 300),
          texteEn: b.texteEn ? `${b.texteEn}`.slice(0, 300) : null, destinataires: dest, auteur: ctx.compteId });
        await journaliser(tx, ctx, { action: 'Création', objetType: 'Annonce', objetLibelle: `Annonce · ${b.titre}`, avant: '–', apres: `Publiée · ${cibleLibelle}` });
      }
      return { id: a!.id };
    });
  });

  // ------------------------------------------------------------- SMS (CU-25)

  r.get('/communication/sms', { config: { unePermissionParmi: ['communication.sms.envoyer', 'communication.sms.parametrer'] }, schema: { tags: ['communication'] } }, async (req) => {
    const ctx = exiger(req);
    const annee = await exigerAnneeOuverte(app.bd, ctx.etablissementId);
    const file = await app.bd.lire(sql`
      SELECT e.id, e.modele, e.cible_libelle AS cible, e.cree_le AS "creeLe", e.partir_le AS "partirLe", e.nb_destinataires AS destinataires,
             e.nb_sms AS sms, e.nb_echecs AS echecs,
             (SELECT count(*)::int FROM communication.sms s WHERE s.envoi_id = e.id AND s.statut = 'en_attente') AS "enAttente",
             (SELECT count(*)::int FROM communication.sms s WHERE s.envoi_id = e.id AND s.statut = 'envoye') AS envoyes
        FROM communication.envoi_sms e WHERE e.etablissement_id = ${ctx.etablissementId} ORDER BY e.cree_le DESC LIMIT 8`);
    const enAttente = await app.bd.lireUn<{ n: number }>(sql`SELECT count(*)::int AS n FROM communication.sms WHERE etablissement_id = ${ctx.etablissementId} AND statut = 'en_attente'`);
    const notifs = await app.bd.lire<{ code: string; active: boolean }>(sql`SELECT code, active FROM communication.notification_auto WHERE etablissement_id = ${ctx.etablissementId}`);
    const classes = await app.bd.lire(sql`SELECT c.id, c.nom FROM structure.classe c JOIN structure.niveau n ON n.id = c.niveau_id WHERE c.annee_id = ${annee.id} ORDER BY n.rang, c.nom`);
    const niveaux = await app.bd.lire(sql`SELECT n.id, n.code AS nom FROM structure.niveau n JOIN structure.cycle cy ON cy.id = n.cycle_id
                                           WHERE n.etablissement_id = ${ctx.etablissementId} ORDER BY cy.sous_systeme DESC, n.rang`);
    const actif = (code: string) => notifs.find((n) => n.code === code)?.active ?? code !== 'rappel_echeance';
    return {
      file: file.map((f) => ({ ...(f as Record<string, unknown>), statut: (f as { enAttente: number }).enAttente > 0 ? 'en_attente' : 'envoye' })),
      enAttente: enAttente!.n, fournisseur: 'desactive',
      notifications: [
        { code: 'recu', libelle: 'Reçu de paiement', canal: 'SMS et application', active: actif('recu') },
        { code: 'absence', libelle: 'Absence non justifiée', canal: 'SMS', active: actif('absence') },
        { code: 'bulletin', libelle: 'Bulletin disponible', canal: 'SMS et application', active: actif('bulletin') },
        { code: 'rappel_echeance', libelle: 'Rappel avant une date limite', canal: 'SMS', active: actif('rappel_echeance') },
      ],
      modeles: Object.entries(MODELES).filter(([k]) => ['relance', 'absence', 'bulletin', 'reunion'].includes(k)).map(([code, m]) => ({ code, ...m })),
      classes, niveaux, permis: ctx.a('communication.sms.envoyer') ? (ctx.a('communication.annonce.publier') && ctx.roles.some((x) => x.code === 'econome') && !ctx.roles.some((x) => x.code === 'secretaire') ? ['relance'] : null) : [],
    };
  });

  const NouveauSms = z.object({ cible: z.enum(CIBLES_SMS), cibleId: Uuid.nullish(), modele: z.enum(['relance', 'absence', 'bulletin', 'reunion']),
    texteFr: z.string().trim().min(3).max(612), texteEn: z.string().trim().max(612).nullish() });

  /** E-20 : l'économe met en file les seules relances de paiement. */
  function smsPermis(ctx: Contexte, modele: string) {
    const seulementRelance = ctx.roles.some((x) => x.code === 'econome') && !ctx.roles.some((x) => x.code === 'secretaire');
    if (seulementRelance && modele !== 'relance') throw interdit('communication.sms.envoyer');
  }

  r.post('/communication/sms/estimation', { config: { permission: 'communication.sms.envoyer' }, schema: { tags: ['communication'], body: NouveauSms } }, async (req) => {
    const ctx = exiger(req);
    const b = req.body;
    const d = await app.bd.transaction(null, (tx) => destinataires(tx, ctx.etablissementId, b.cible, b.cibleId ?? null, b.modele === 'relance'));
    const tel = new Map(d.map((x) => [x.telephone, x.langue]));
    const fr = [...tel.values()].filter((l) => l === 'fr').length;
    const exemple = d[0];
    return { destinataires: tel.size, fr, en: tel.size - fr,
      smsParMessage: Math.max(smsParMessage(b.texteFr), smsParMessage(b.texteEn ?? '')),
      apercu: exemple ? { famille: exemple.responsable, texte: remplir(exemple.langue === 'en' && b.texteEn ? b.texteEn : b.texteFr, exemple, { fr: '', en: '' }) } : null };
  });

  r.post('/communication/sms', { config: { permission: 'communication.sms.envoyer' }, schema: { tags: ['communication'], body: NouveauSms } }, async (req) => {
    const ctx = exiger(req);
    const b = req.body;
    smsPermis(ctx, b.modele);
    if ((b.cible === 'classe' || b.cible === 'niveau') && !b.cibleId) throw new ErreurMetier('COM_CIBLE_REQUISE', 422, 'Choisissez la classe ou le niveau.', 'cibleId');
    return app.bd.transaction(ctx.compteId, async (tx) => {
      const dest = await destinataires(tx, ctx.etablissementId, b.cible, b.cibleId ?? null, b.modele === 'relance');
      if (!dest.length) throw new ErreurMetier('COM_AUCUN_DESTINATAIRE', 422, 'Aucun responsable n\'accepte les SMS dans cette cible (RG-28).');
      const cibleLibelle = b.cible === 'debiteurs' ? 'Familles en retard' : await libelleCible(tx, b.cible, b.cibleId);
      const id = await mettreEnFile(tx, ctx.etablissementId, { modele: MODELES[b.modele]!.libelle, cibleLibelle, texteFr: b.texteFr, texteEn: b.texteEn ?? null,
        destinataires: dest, auteur: ctx.compteId });
      if (b.modele === 'relance') await emettre(tx, ctx, 'relance.sms', { inscriptionIds: [...new Set(dest.map((x) => x.inscription_id))], compteId: ctx.compteId });
      await journaliser(tx, ctx, { action: 'Création', objetType: 'SMS', objetLibelle: `SMS · ${MODELES[b.modele]!.libelle} · ${cibleLibelle}`, avant: '–',
        apres: `${new Set(dest.map((x) => x.telephone)).size} destinataires · en file` });
      return { id };
    });
  });

  r.put('/communication/notifications/:code', {
    config: { permission: 'communication.sms.parametrer' },
    schema: { tags: ['communication'], params: z.object({ code: z.enum(['recu', 'absence', 'bulletin', 'rappel_echeance']) }), body: z.object({ active: z.boolean() }) },
  }, async (req) => {
    const ctx = exiger(req);
    return app.bd.transaction(ctx.compteId, async (tx) => {
      await tx.execute(sql`INSERT INTO communication.notification_auto (etablissement_id, code, active) VALUES (${ctx.etablissementId}, ${req.params.code}, ${req.body.active})
                           ON CONFLICT (etablissement_id, code) DO UPDATE SET active = EXCLUDED.active`);
      await journaliser(tx, ctx, { action: 'Modification', objetType: 'SMS', objetLibelle: `Notification automatique · ${req.params.code}`, avant: req.body.active ? 'Inactive' : 'Active', apres: req.body.active ? 'Active' : 'Inactive' });
      return { ok: true };
    });
  });

  // ------------------------------------------------------------- messagerie des parents (RG-42)

  /** Boîte de la personne connectée : seulement les conversations qui lui sont adressées. */
  function filtreBoite(ctx: Contexte) {
    const roles = ctx.roles.map((x) => x.code).filter((c) => ['econome', 'directeur', 'secretaire'].includes(c));
    return sql`(c.destinataire_role = ANY(${tableau(roles)}::text[]) OR c.destinataire_compte = ${ctx.compteId})`;
  }

  r.get('/communication/conversations', { config: { permission: 'communication.messagerie.repondre' }, schema: { tags: ['communication'] } }, async (req) => {
    const ctx = exiger(req);
    const rows = await app.bd.lire(sql`
      SELECT c.id, f.nom AS famille, e.prenoms AS eleve, cl.nom AS classe, c.sujet, c.non_lu_ecole AS "nonLu", c.derniere_activite AS "derniereActivite",
             (SELECT m.texte FROM communication.message m WHERE m.conversation_id = c.id AND NOT m.brouillon ORDER BY m.envoye_le DESC LIMIT 1) AS dernier
        FROM communication.conversation c JOIN scolarite.famille f ON f.id = c.famille_id JOIN scolarite.eleve e ON e.id = c.eleve_id
        LEFT JOIN scolarite.inscription i ON i.eleve_id = e.id AND i.statut IN ('attente', 'validee') LEFT JOIN structure.classe cl ON cl.id = i.classe_id
       WHERE c.etablissement_id = ${ctx.etablissementId} AND ${filtreBoite(ctx)} ORDER BY c.derniere_activite DESC LIMIT 50`);
    const roleBoite = ctx.roles.find((x) => ['secretaire', 'econome', 'directeur', 'instituteur_principal'].includes(x.code))?.libelleFr ?? '';
    return { boite: roleBoite, conversations: rows, nonLues: rows.filter((x) => (x as { nonLu: boolean }).nonLu).length };
  });

  r.get('/communication/conversations/:id', { config: { permission: 'communication.messagerie.repondre' }, schema: { tags: ['communication'], params: z.object({ id: Uuid }) } }, async (req) => {
    const ctx = exiger(req);
    const c = await app.bd.lireUn<{ id: string; famille: string; eleve: string; classe: string; sujet: string | null; inscription_id: string | null; eleve_id: string }>(sql`
      SELECT c.id, f.nom AS famille, e.prenoms AS eleve, cl.nom AS classe, c.sujet, i.id AS inscription_id, e.id AS eleve_id
        FROM communication.conversation c JOIN scolarite.famille f ON f.id = c.famille_id JOIN scolarite.eleve e ON e.id = c.eleve_id
        LEFT JOIN scolarite.inscription i ON i.eleve_id = e.id AND i.statut IN ('attente', 'validee') LEFT JOIN structure.classe cl ON cl.id = i.classe_id
       WHERE c.id = ${req.params.id} AND c.etablissement_id = ${ctx.etablissementId} AND ${filtreBoite(ctx)}`);
    if (!c) throw introuvable('Conversation');
    await app.bd.lire(sql`UPDATE communication.conversation SET non_lu_ecole = false WHERE id = ${req.params.id}`);
    const messages = await app.bd.lire(sql`
      SELECT m.id, m.auteur_type AS "auteurType", co.nom_affiche AS auteur, m.texte, m.brouillon, m.envoye_le AS "envoyeLe"
        FROM communication.message m JOIN core.compte co ON co.id = m.auteur
       WHERE m.conversation_id = ${req.params.id} AND (NOT m.brouillon OR m.auteur = ${ctx.compteId}) ORDER BY m.envoye_le`);
    const absence = await app.bd.lireUn<{ jour: string }>(sql`
      SELECT a.jour FROM vie_scolaire.absence a WHERE a.inscription_id = ${c.inscription_id} AND a.statut = 'non_justifiee' AND a.demande_parent IS NOT NULL ORDER BY a.jour DESC LIMIT 1`);
    return { ...c, messages, absenceAJustifier: absence?.jour ?? null };
  });

  r.post('/communication/conversations/:id/messages', {
    config: { permission: 'communication.messagerie.repondre' },
    schema: { tags: ['communication'], params: z.object({ id: Uuid }), body: z.object({ texte: z.string().trim().min(1).max(2000), brouillon: z.boolean().default(false) }) },
  }, async (req) => {
    const ctx = exiger(req);
    return app.bd.transaction(ctx.compteId, async (tx) => {
      const c = await ligne<{ famille_id: string; eleve_id: string }>(tx, sql`
        SELECT c.famille_id, c.eleve_id FROM communication.conversation c WHERE c.id = ${req.params.id} AND c.etablissement_id = ${ctx.etablissementId} AND ${filtreBoite(ctx)}`);
      if (!c) throw introuvable('Conversation');
      await tx.execute(sql`DELETE FROM communication.message WHERE conversation_id = ${req.params.id} AND auteur = ${ctx.compteId} AND brouillon`);
      await tx.execute(sql`INSERT INTO communication.message (etablissement_id, conversation_id, auteur_type, auteur, texte, brouillon)
                           VALUES (${ctx.etablissementId}, ${req.params.id}, 'ecole', ${ctx.compteId}, ${req.body.texte}, ${req.body.brouillon})`);
      if (!req.body.brouillon) {
        await tx.execute(sql`UPDATE communication.conversation SET non_lu_famille = true, derniere_activite = now() WHERE id = ${req.params.id}`);
        // La réponse arrive dans l'application et par SMS (maquette Parent · écrire à l'école).
        const dest = await destinataires(tx, ctx.etablissementId, 'parent', c.famille_id, true);
        await mettreEnFile(tx, ctx.etablissementId, { modele: MODELES['reponse']!.libelle, cibleLibelle: '1 destinataire', texteFr: MODELES['reponse']!.fr,
          texteEn: MODELES['reponse']!.en, destinataires: dest.slice(0, 1), auteur: ctx.compteId });
      }
      return { ok: true };
    });
  });
}

export { destinataires, MODELES as MODELES_SMS };
