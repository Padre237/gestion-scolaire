// CU-27, CU-28 · Assistant (IA-01 à IA-07, RG-29 à RG-33), relié à un fournisseur compatible OpenRouter (D-48).
// Seuls partent chez le fournisseur : la question nettoyée de toute donnée personnelle et des chiffres agrégés de l'école
// (effectifs, recouvrement, absences, moyennes par classe) ; jamais un nom, un téléphone ou une ligne d'élève.
// Sans fournisseur réglé, ou sans internet, la question reste en file et part plus tard.
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { sql, ligne, type Bd } from '../../../core/bd.ts';
import { ErreurMetier } from '../../../core/erreurs.ts';
import { exiger } from '../../../core/session.ts';
import { journaliser } from '../../../core/audit.ts';
import { anneeOuverte } from '../../structure/index.ts';
import { anonymiser, motsDesNoms } from '../domain/anonymiser.ts';

// Tâche → permission qui décide de la proposition (conception § 9.6).
export const TACHES: Record<string, { libelle: string; permission: string }> = {
  'IA-01': { libelle: 'Traduction', permission: 'assistant.proposition.traduction' },
  'IA-02': { libelle: 'Relances d’impayés', permission: 'assistant.proposition.relance' },
  'IA-03': { libelle: 'Lecture d’un bordereau', permission: 'assistant.proposition.bordereau' },
  'IA-04': { libelle: 'Import d’élèves', permission: 'assistant.proposition.import' },
  'IA-05': { libelle: 'Appréciations de bulletin', permission: 'assistant.proposition.appreciation' },
  'IA-06': { libelle: 'Synthèse pour le conseil', permission: 'assistant.proposition.synthese' },
  'IA-07': { libelle: 'Question de la direction', permission: 'assistant.question.poser' },
};

interface Reglage { adresse: string; modele: string; cle: string | null; actif: boolean }
const PAR_DEFAUT: Reglage = { adresse: 'https://openrouter.ai/api/v1', modele: 'anthropic/claude-sonnet-5.5', cle: null, actif: false };

async function lireReglage(bd: Bd, etab: string): Promise<Reglage> {
  return (await bd.lireUn<Reglage>(sql`SELECT adresse, modele, cle, actif FROM assistant.reglage WHERE etablissement_id = ${etab}`)) ?? PAR_DEFAUT;
}
const relie = (r: Reglage) => r.actif && !!r.cle;

/** Noms connus de l'établissement (élèves, responsables, personnel) : ce qu'il faut retirer d'une question. */
async function nomsConnus(bd: Bd, etab: string) {
  const l = await bd.lire<{ n: string }>(sql`
    SELECT nom || ' ' || prenoms AS n FROM scolarite.eleve WHERE etablissement_id = ${etab}
    UNION SELECT nom FROM scolarite.responsable WHERE etablissement_id = ${etab}
    UNION SELECT nom_affiche FROM personnel.fiche WHERE etablissement_id = ${etab}
    UNION SELECT nom_affiche FROM core.compte WHERE etablissement_id = ${etab} AND type = 'personnel'`);
  return motsDesNoms(l.map((x) => x.n));
}

/** Chiffres agrégés de l'année ouverte, par classe : aucune donnée individuelle. */
async function contexteAgrege(bd: Bd, etab: string): Promise<string> {
  const annee = await anneeOuverte(bd, etab);
  if (!annee) return 'Aucune année scolaire ouverte.';
  const classes = await bd.lire<{ classe: string; section: string; niveau: string; eleves: number; garcons: number; filles: number;
    a_payer: number; verse: number; reste: number; echu: number }>(sql`
    SELECT c.nom AS classe, cy.sous_systeme AS section, n.code AS niveau, count(i.id)::int AS eleves,
           count(*) FILTER (WHERE e.sexe = 'M')::int AS garcons, count(*) FILTER (WHERE e.sexe = 'F')::int AS filles,
           COALESCE(sum(s.a_payer), 0)::bigint AS a_payer, COALESCE(sum(s.verse), 0)::bigint AS verse, COALESCE(sum(s.reste), 0)::bigint AS reste,
           COALESCE(sum(s.echu), 0)::bigint AS echu
      FROM structure.classe c JOIN structure.niveau n ON n.id = c.niveau_id JOIN structure.cycle cy ON cy.id = n.cycle_id
      LEFT JOIN scolarite.inscription i ON i.classe_id = c.id AND i.statut IN ('attente', 'validee')
      LEFT JOIN scolarite.eleve e ON e.id = i.eleve_id LEFT JOIN reporting.v_solde s ON s.inscription_id = i.id
     WHERE c.annee_id = ${annee.id} GROUP BY c.id, c.nom, cy.sous_systeme, n.code, n.rang ORDER BY cy.sous_systeme DESC, n.rang, c.nom`);
  const absences = await bd.lire<{ classe: string; n: number }>(sql`
    SELECT c.nom AS classe, count(*)::int AS n FROM vie_scolaire.absence a JOIN scolarite.inscription i ON i.id = a.inscription_id
      JOIN structure.classe c ON c.id = i.classe_id WHERE a.etablissement_id = ${etab} AND c.annee_id = ${annee.id}
       AND a.jour >= (now() AT TIME ZONE 'Africa/Douala')::date - 30 GROUP BY c.nom`);
  const moyennes = await bd.lire<{ classe: string; periode: string; moyenne: number }>(sql`
    SELECT c.nom AS classe, p.libelle_fr AS periode, round(avg(b.moyenne)::numeric, 2)::float AS moyenne
      FROM pedagogie.bulletin b JOIN structure.periode p ON p.id = b.periode_id JOIN scolarite.inscription i ON i.id = b.inscription_id
      JOIN structure.classe c ON c.id = i.classe_id WHERE b.statut = 'publie' AND c.annee_id = ${annee.id} GROUP BY c.nom, p.libelle_fr, p.ordre ORDER BY p.ordre`);
  const encaisse = await bd.lireUn<{ m: number; n: number }>(sql`
    SELECT COALESCE(sum(montant), 0)::bigint AS m, count(*)::int AS n FROM finances.versement
     WHERE etablissement_id = ${etab} AND statut = 'valide' AND (encaisse_le AT TIME ZONE 'Africa/Douala')::date >= (now() AT TIME ZONE 'Africa/Douala')::date - 30`);
  const abs = new Map(absences.map((x) => [x.classe, x.n]));
  const lignes = classes.map((c) => [c.classe, c.section, c.niveau, c.eleves, c.garcons, c.filles, c.a_payer, c.verse, c.reste, c.echu,
    c.a_payer ? Math.round((100 * Number(c.verse)) / Number(c.a_payer)) : 0, abs.get(c.classe) ?? 0].join(';'));
  const t = classes.reduce((s, c) => ({ e: s.e + c.eleves, a: s.a + Number(c.a_payer), v: s.v + Number(c.verse), r: s.r + Number(c.reste), x: s.x + Number(c.echu) }), { e: 0, a: 0, v: 0, r: 0, x: 0 });
  return [
    `Année scolaire ${annee.libelle}. Montants en FCFA.`,
    `Totaux : ${t.e} élèves inscrits ; à payer ${t.a} ; versé ${t.v} ; reste dû ${t.r} ; dont échu ${t.x} ; taux de recouvrement ${t.a ? Math.round((100 * t.v) / t.a) : 0} %.`,
    `Encaissements des 30 derniers jours : ${encaisse?.m ?? 0} FCFA en ${encaisse?.n ?? 0} versements.`,
    'Par classe (classe;section;niveau;élèves;garçons;filles;à payer;versé;reste dû;échu;recouvrement %;absences des 30 derniers jours) :',
    ...lignes,
    moyennes.length ? `Moyennes générales publiées (classe;période;moyenne sur 20) :\n${moyennes.map((m) => `${m.classe};${m.periode};${m.moyenne}`).join('\n')}` : 'Aucun bulletin publié cette année.',
  ].join('\n');
}

const CONSIGNE = `Tu es l'assistant de la direction d'un groupe scolaire au Cameroun (maternelle et primaire, sections francophone et anglophone).
Réponds en français, en quelques phrases claires, uniquement à partir des chiffres fournis. N'invente aucun chiffre : si l'information
n'est pas dans les données, dis-le et indique l'écran de l'application où la trouver (Élèves, Frais et caisse, Notes et bulletins, Vie scolaire, Pilotage).
Les noms ont été retirés de la question (« [personne] », « [numéro] », « [adresse] ») : ne cherche pas à les deviner.`;

/** Appel du fournisseur (format OpenAI, accepté par OpenRouter). Lève une erreur lisible en cas d'échec. */
async function interroger(r: Reglage, question: string, contexte: string): Promise<{ texte: string; jetons: number }> {
  const ctrl = new AbortController();
  const minuteur = setTimeout(() => ctrl.abort(), 45_000);
  try {
    const rep = await fetch(`${r.adresse.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST', signal: ctrl.signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${r.cle}`, 'x-title': 'Sekou' },
      body: JSON.stringify({ model: r.modele, temperature: 0.2, max_tokens: 700,
        messages: [{ role: 'system', content: CONSIGNE }, { role: 'user', content: `Données de l'école :\n${contexte}\n\nQuestion : ${question}` }] }),
    });
    const corps = await rep.json().catch(() => null) as { choices?: { message?: { content?: string } }[]; usage?: { total_tokens?: number }; error?: { message?: string } } | null;
    if (!rep.ok) throw new Error(rep.status === 401 ? 'clé refusée par le fournisseur' : `réponse ${rep.status}${corps?.error?.message ? ` : ${corps.error.message}` : ''}`);
    const texte = corps?.choices?.[0]?.message?.content?.trim();
    if (!texte) throw new Error('réponse vide du fournisseur');
    return { texte, jetons: corps?.usage?.total_tokens ?? 0 };
  } finally {
    clearTimeout(minuteur);
  }
}

export async function routesAssistant(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  /** Traite une question en file : envoi, réponse rangée comme proposition à relire. */
  async function traiter(etab: string, tacheId: string): Promise<{ statut: string; erreur?: string }> {
    const reglage = await lireReglage(app.bd, etab);
    if (!relie(reglage)) return { statut: 'en_file', erreur: 'assistant non relié à un fournisseur' };
    const t = await app.bd.lireUn<{ question: string }>(sql`SELECT entree->>'question' AS question FROM assistant.tache WHERE id = ${tacheId} AND statut = 'en_file'`);
    if (!t) return { statut: 'proposee' };
    try {
      const rep = await interroger(reglage, t.question, await contexteAgrege(app.bd, etab));
      await app.bd.transaction(null, async (tx) => {
        await tx.execute(sql`INSERT INTO assistant.proposition (etablissement_id, tache_id, contenu) VALUES (${etab}, ${tacheId}, ${JSON.stringify({ texte: rep.texte })}::jsonb)`);
        await tx.execute(sql`UPDATE assistant.tache SET statut = 'proposee', modele = ${reglage.modele} WHERE id = ${tacheId}`);
      });
      return { statut: 'proposee' };
    } catch (e) {
      // Sans internet ou fournisseur indisponible : la question reste en file, elle repartira.
      return { statut: 'en_file', erreur: e instanceof Error ? (e.name === 'AbortError' ? 'pas de réponse du fournisseur (délai dépassé)' : e.message) : String(e) };
    }
  }

  r.get('/assistant', { config: { permission: 'assistant.question.poser' }, schema: { tags: ['assistant'] } }, async (req) => {
    const ctx = exiger(req);
    const questions = await app.bd.lire(sql`
      SELECT t.id, t.entree->>'question' AS question, (t.entree->>'remplacements')::int AS remplacements, t.statut, t.cree_le AS "creeLe",
             (SELECT p.contenu FROM assistant.proposition p WHERE p.tache_id = t.id ORDER BY p.id DESC LIMIT 1) AS reponse
        FROM assistant.tache t WHERE t.etablissement_id = ${ctx.etablissementId} AND t.type = 'IA-07' ORDER BY t.cree_le DESC LIMIT 8`);
    const propositions = await app.bd.lire(sql`
      SELECT p.id, t.type, t.libelle, p.contenu, t.cree_le AS "creeLe" FROM assistant.proposition p JOIN assistant.tache t ON t.id = p.tache_id
       WHERE p.etablissement_id = ${ctx.etablissementId} AND p.statut = 'proposee' AND t.type <> 'IA-07' ORDER BY t.cree_le DESC LIMIT 10`);
    const usage = await app.bd.lireUn<{ en_file: number; cout: number }>(sql`
      SELECT count(*) FILTER (WHERE statut = 'en_file')::int AS en_file,
             COALESCE(sum(cout_fcfa) FILTER (WHERE date_trunc('month', cree_le) = date_trunc('month', now())), 0)::int AS cout
        FROM assistant.tache WHERE etablissement_id = ${ctx.etablissementId}`);
    return { fournisseur: relie(await lireReglage(app.bd, ctx.etablissementId)) ? 'actif' : 'desactive', questions, propositions,
      usage: { enFile: usage!.en_file, coutMois: usage!.cout, plafond: null } };
  });

  // ----------------------------------------------------------- réglage du fournisseur (directeur)
  r.get('/assistant/reglage', { config: { permission: 'assistant.reglage.gerer' }, schema: { tags: ['assistant'] } }, async (req) => {
    const ctx = exiger(req);
    const x = await lireReglage(app.bd, ctx.etablissementId);
    // La clé ne revient jamais à l'écran : seulement ses quatre derniers caractères.
    return { adresse: x.adresse, modele: x.modele, actif: x.actif, cleEnregistree: !!x.cle, finCle: x.cle ? x.cle.slice(-4) : null };
  });

  r.put('/assistant/reglage', {
    config: { permission: 'assistant.reglage.gerer' },
    schema: { tags: ['assistant'], body: z.object({
      adresse: z.string().trim().regex(/^https?:\/\/\S+$/, 'Adresse commençant par http:// ou https://').max(200),
      modele: z.string().trim().min(2).max(120),
      /** Absente : la clé enregistrée est gardée ; chaîne vide : la clé est effacée. */
      cle: z.string().trim().max(400).optional(),
      actif: z.boolean(),
    }) },
  }, async (req) => {
    const ctx = exiger(req);
    const b = req.body;
    const avant = await lireReglage(app.bd, ctx.etablissementId);
    const cle = b.cle === undefined ? avant.cle : b.cle || null;
    if (b.actif && !cle) throw new ErreurMetier('IA_CLE_REQUISE', 422, 'Saisissez la clé du fournisseur pour activer l’assistant.', 'cle');
    await app.bd.transaction(ctx.compteId, async (tx) => {
      await tx.execute(sql`
        INSERT INTO assistant.reglage (etablissement_id, adresse, modele, cle, actif) VALUES (${ctx.etablissementId}, ${b.adresse}, ${b.modele}, ${cle}, ${b.actif})
        ON CONFLICT (etablissement_id) DO UPDATE SET adresse = EXCLUDED.adresse, modele = EXCLUDED.modele, cle = EXCLUDED.cle, actif = EXCLUDED.actif`);
      await journaliser(tx, ctx, { action: 'Modification', objetType: 'Assistant', objetLibelle: 'Réglage de l’assistant',
        avant: `${avant.actif ? 'Activé' : 'Désactivé'} · ${avant.modele}`,
        apres: `${b.actif ? 'Activé' : 'Désactivé'} · ${b.modele} · ${new URL(b.adresse).host}${b.cle !== undefined ? ' · clé changée' : ''}` });
    });
    return { ok: true };
  });

  // ----------------------------------------------------------- questions de la direction (IA-07)
  // RG-31 : la question est nettoyée avant d'être gardée et envoyée ; seuls des chiffres agrégés l'accompagnent.
  r.post('/assistant/questions', {
    config: { permission: 'assistant.question.poser' }, schema: { tags: ['assistant'], body: z.object({ question: z.string().trim().min(5).max(500) }) },
  }, async (req) => {
    const ctx = exiger(req);
    const { texte, remplacements } = anonymiser(req.body.question, await nomsConnus(app.bd, ctx.etablissementId));
    const t = await app.bd.transaction(ctx.compteId, async (tx) => {
      const x = await ligne<{ id: string }>(tx, sql`
        INSERT INTO assistant.tache (etablissement_id, type, entree, libelle, cree_par)
        VALUES (${ctx.etablissementId}, 'IA-07', ${JSON.stringify({ question: texte, remplacements })}::jsonb, 'Question de la direction', ${ctx.compteId}) RETURNING id`);
      await journaliser(tx, ctx, { action: 'Création', objetType: 'Assistant', objetLibelle: 'Question à l’assistant', avant: '–',
        apres: remplacements ? `${remplacements} information${remplacements > 1 ? 's' : ''} personnelle${remplacements > 1 ? 's' : ''} retirée${remplacements > 1 ? 's' : ''}` : 'Question' });
      return x!;
    });
    const res = await traiter(ctx.etablissementId, t.id);
    return { id: t.id, remplacements, questionEnvoyee: texte, ...res };
  });

  /** Envoie les questions restées en file (retour d'internet, fournisseur réglé après coup). */
  r.post('/assistant/file', { config: { permission: 'assistant.question.poser' }, schema: { tags: ['assistant'] } }, async (req) => {
    const ctx = exiger(req);
    const enFile = await app.bd.lire<{ id: string }>(sql`
      SELECT id FROM assistant.tache WHERE etablissement_id = ${ctx.etablissementId} AND type = 'IA-07' AND statut = 'en_file' ORDER BY cree_le LIMIT 10`);
    let traitees = 0;
    let erreur: string | undefined;
    for (const t of enFile) {
      const x = await traiter(ctx.etablissementId, t.id);
      if (x.statut === 'proposee') traitees++; else { erreur = x.erreur; break; }
    }
    return { traitees, restantes: enFile.length - traitees, erreur };
  });

  // Toute autre tâche (traduction, bordereau, import, appréciations, synthèse, relances) : enregistrée en file.
  r.post('/assistant/taches', {
    config: { unePermissionParmi: Object.values(TACHES).map((t) => t.permission) },
    schema: { tags: ['assistant'], body: z.object({ type: z.enum(['IA-01', 'IA-02', 'IA-03', 'IA-04', 'IA-05', 'IA-06']), objet: z.string().trim().max(200) }) },
  }, async (req) => {
    const ctx = exiger(req);
    const t = TACHES[req.body.type]!;
    if (!ctx.a(t.permission)) throw new ErreurMetier('CORE_INTERDIT', 403, `Permission requise : ${t.permission}.`);
    const { texte } = anonymiser(req.body.objet, await nomsConnus(app.bd, ctx.etablissementId));
    return app.bd.transaction(ctx.compteId, async (tx) => {
      // Rien de personnel n'est stocké dans l'entrée : seulement l'objet de la demande, nettoyé (RG-31).
      const x = await ligne<{ id: string }>(tx, sql`
        INSERT INTO assistant.tache (etablissement_id, type, entree, libelle, cree_par)
        VALUES (${ctx.etablissementId}, ${req.body.type}, ${JSON.stringify({ objet: texte })}::jsonb, ${t.libelle}, ${ctx.compteId}) RETURNING id`);
      return { id: x!.id, statut: 'en_file' };
    });
  });
}
