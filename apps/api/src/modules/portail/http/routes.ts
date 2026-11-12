// CU-32 · Espace parent (POR-03, POR-04, POR-06, COM-06) : un compte par famille, qui ne voit que ses enfants
// et ce que l'école a publié (RG-35), le bulletin sous condition de paiement (RG-40), sans téléchargement.
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { sql, ligne } from '../../../core/bd.ts';
import { ErreurMetier, interdit, introuvable } from '../../../core/erreurs.ts';
import { exiger } from '../../../core/session.ts';
import type { Contexte } from '../../../core/contexte.ts';
import { journaliser } from '../../../core/audit.ts';
import { visibilites } from '../../pedagogie/http/resultats.ts';
import { coursDuJour } from '../../pedagogie/http/edt.ts';
import { TYPES_OBSERVATION } from '../../vie-scolaire/http/routes.ts';
import { MODES } from '../../finances/index.ts';
import { donneesRecuPortail } from './recu.ts';

const Uuid = z.uuid();
const CIVILITE: Record<string, string> = { mere: 'Mme', pere: 'M.', tuteur: '' };
const DESTINATAIRES = ['instituteur_principal', 'econome', 'directeur', 'secretaire'] as const;
const fmt = (n: number) => n.toLocaleString('fr-FR').replace(/[  ]/g, ' ');

export async function routesPortail(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  function famille(ctx: Contexte): string {
    if (ctx.type !== 'famille' || !ctx.familleId) throw interdit('portail.famille.consulter');
    return ctx.familleId;
  }

  /** RG-35 : la famille ne voit que ses enfants. */
  async function enfant(ctx: Contexte, eleveId: string) {
    const f = famille(ctx);
    const e = await app.bd.lireUn<{ eleve_id: string; inscription_id: string; prenoms: string; nom: string; classe: string; classe_id: string; annee_id: string }>(sql`
      SELECT e.id AS eleve_id, i.id AS inscription_id, e.prenoms, e.nom, c.nom AS classe, c.id AS classe_id, i.annee_id
        FROM scolarite.eleve e JOIN scolarite.inscription i ON i.eleve_id = e.id AND i.statut IN ('attente', 'validee')
        JOIN structure.classe c ON c.id = i.classe_id WHERE e.id = ${eleveId} AND e.famille_id = ${f}`);
    if (!e) throw interdit('portail.famille.consulter');
    return e;
  }

  async function enfants(ctx: Contexte) {
    const f = famille(ctx);
    return app.bd.lire<{ eleve_id: string; inscription_id: string; prenoms: string; nom: string; classe: string; classe_id: string }>(sql`
      SELECT e.id AS eleve_id, i.id AS inscription_id, e.prenoms, e.nom, c.nom AS classe, c.id AS classe_id
        FROM scolarite.eleve e JOIN scolarite.inscription i ON i.eleve_id = e.id AND i.statut IN ('attente', 'validee')
        JOIN structure.classe c ON c.id = i.classe_id JOIN structure.niveau n ON n.id = c.niveau_id
       WHERE e.famille_id = ${f} ORDER BY n.rang DESC, e.date_naissance`);
  }

  r.get('/portail/accueil', { config: { permission: 'portail.famille.consulter' }, schema: { tags: ['portail'] } }, async (req) => {
    const ctx = exiger(req);
    const f = famille(ctx);
    const payeur = await app.bd.lireUn<{ nom: string; lien: string; famille: string }>(sql`
      SELECT r.nom, er.lien, fa.nom AS famille FROM scolarite.eleve e JOIN scolarite.eleve_responsable er ON er.eleve_id = e.id AND er.payeur
        JOIN scolarite.responsable r ON r.id = er.responsable_id JOIN scolarite.famille fa ON fa.id = e.famille_id
       WHERE e.famille_id = ${f} ORDER BY e.date_naissance LIMIT 1`);
    const liste = await enfants(ctx);
    const res = [];
    const alertes: string[] = [];
    const blocages: { eleveId: string; prenom: string; texte: string }[] = [];
    for (const e of liste) {
      const ech = await app.bd.lire<{ libelle_fr: string; ordre: number; a_payer: number; reste: number; date_limite: string }>(sql`
        SELECT libelle_fr, ordre, a_payer, reste, date_limite FROM reporting.v_echeance WHERE inscription_id = ${e.inscription_id} ORDER BY ordre`);
      const prochaine = ech.find((x) => Number(x.reste) > 0);
      const auj = new Date(Date.now() + 3600_000).toISOString().slice(0, 10);
      // Dernières notes publiées (séquence fermée), les plus récentes d'abord.
      const notes = await app.bd.lire<{ matiere: string; abrege: string; valeur: number; bareme: number; sequence: string; date: string }>(sql`
        SELECT m.libelle_fr AS matiere, COALESCE(m.abrege_fr, m.libelle_fr) AS abrege, n.valeur, ev.bareme, s.libelle_fr AS sequence, ev.fait_le AS date
          FROM pedagogie.note n JOIN pedagogie.evaluation ev ON ev.id = n.evaluation_id
          JOIN pedagogie.sequence s ON s.id = ev.sequence_id AND s.statut = 'fermee' JOIN pedagogie.matiere m ON m.id = ev.matiere_id
         WHERE n.inscription_id = ${e.inscription_id} AND n.valeur IS NOT NULL
         ORDER BY ev.fait_le DESC, s.numero DESC, m.libelle_fr LIMIT 3`);
      const note = notes[0];
      const abs = await app.bd.lireUn<{ n: number; justifiees: number }>(sql`
        SELECT count(DISTINCT (jour, debut < '12:00'))::int AS n,
               count(DISTINCT (jour, debut < '12:00')) FILTER (WHERE statut = 'justifiee')::int AS justifiees
          FROM reporting.v_absence WHERE inscription_id = ${e.inscription_id}
           AND jour >= (SELECT p.date_debut FROM structure.periode p JOIN scolarite.inscription i ON i.annee_id = p.annee_id
                         WHERE i.id = ${e.inscription_id} AND current_date BETWEEN p.date_debut AND p.date_fin + 30 ORDER BY p.ordre LIMIT 1)`);
      // Alerte de bulletin bloqué (RG-40) : bulletin publié de la dernière période, non visible.
      const b = await app.bd.lireUn<{ periode_id: string; libelle: string; tranche: number | null }>(sql`
        SELECT b.periode_id, p.libelle_fr AS libelle, p.tranche_ordre AS tranche FROM pedagogie.bulletin b JOIN structure.periode p ON p.id = b.periode_id
         WHERE b.inscription_id = ${e.inscription_id} AND b.statut = 'publie' ORDER BY p.ordre DESC LIMIT 1`);
      if (b) {
        const v = await app.bd.transaction(null, (tx) => visibilites(tx, [e.inscription_id], b.periode_id, b.tranche));
        const vis = v.get(e.inscription_id)!;
        if (!vis.visible) {
          alertes.push(`Le bulletin du ${b.libelle} de ${e.prenoms} sera visible quand la tranche ${b.tranche} sera payée à ${vis.seuil} % (aujourd’hui ${vis.taux} %).`);
          blocages.push({ eleveId: e.eleve_id, prenom: e.prenoms,
            texte: `le bulletin du ${b.libelle} sera visible quand la tranche ${b.tranche} sera payée à ${vis.seuil} % (aujourd’hui ${vis.taux} %).` });
        }
      }
      res.push({
        eleveId: e.eleve_id, inscriptionId: e.inscription_id, nom: `${e.nom} ${e.prenoms}`, prenom: e.prenoms, classe: e.classe,
        resteDu: ech.reduce((s, x) => s + Number(x.reste), 0),
        prochaine: prochaine ? { montant: Number(prochaine.reste), date: prochaine.date_limite, ligne: prochaine.libelle_fr, enRetard: prochaine.date_limite < auj } : null,
        derniereNote: note ? { matiere: note.abrege, valeur: Number(note.valeur), bareme: note.bareme } : null,
        dernieresNotes: notes.map((n) => ({ matiere: n.matiere, valeur: Number(n.valeur), bareme: n.bareme, sequence: n.sequence, date: n.date })),
        tranches: ech.map((x) => ({ libelle: x.libelle_fr, aPayer: Number(x.a_payer), reste: Number(x.reste), dateLimite: x.date_limite })),
        absences: abs?.n ?? 0,
        absencesJustifiees: abs?.justifiees ?? 0,
      });
    }
    const annonces = await app.bd.lire(sql`
      SELECT a.id, a.titre, a.texte_fr AS "texteFr", a.texte_en AS "texteEn", a.publiee_le AS date,
             CASE a.cible WHEN 'ecole' THEN 'Toute l’école' WHEN 'debiteurs' THEN 'Paiements' ELSE a.cible_libelle END AS cible
        FROM communication.annonce a JOIN communication.annonce_famille af ON af.annonce_id = a.id
       WHERE af.famille_id = ${f} AND a.statut = 'publiee' ORDER BY a.publiee_le DESC LIMIT 3`);
    const nouvelles = await app.bd.lire<{ date: string; type: string; texte: string }>(sql`
      SELECT * FROM (
        SELECT v.encaisse_le AS date, 'Paiement' AS type, 'Reçu ' || v.numero_recu || ' · ' || replace(to_char(v.montant, 'FM999,999,999'), ',', U&'\\202F') || ' FCFA pour ' || e.prenoms AS texte
          FROM finances.versement v JOIN scolarite.inscription i ON i.id = v.inscription_id JOIN scolarite.eleve e ON e.id = i.eleve_id
         WHERE e.famille_id = ${f} AND v.statut <> 'annule'
        UNION ALL
        SELECT a.publiee_le, 'Annonce', a.titre FROM communication.annonce a JOIN communication.annonce_famille af ON af.annonce_id = a.id WHERE af.famille_id = ${f}
        UNION ALL
        SELECT s.modifie_le, 'Note', COALESCE(m.libelle_fr, '') || ', ' || lower(s.libelle_fr) || ' : note publiée pour ' || e.prenoms
          FROM pedagogie.evaluation ev JOIN pedagogie.sequence s ON s.id = ev.sequence_id AND s.statut = 'fermee' JOIN pedagogie.matiere m ON m.id = ev.matiere_id
          JOIN pedagogie.note n ON n.evaluation_id = ev.id JOIN scolarite.inscription i ON i.id = n.inscription_id JOIN scolarite.eleve e ON e.id = i.eleve_id
         WHERE e.famille_id = ${f}) x
       WHERE date IS NOT NULL ORDER BY date DESC LIMIT 3`);
    const nonLus = await app.bd.lireUn<{ n: number }>(sql`SELECT count(*)::int AS n FROM communication.conversation WHERE famille_id = ${f} AND non_lu_famille`);
    const annee = await app.bd.lireUn<{ libelle: string }>(sql`
      SELECT libelle FROM structure.annee_scolaire WHERE etablissement_id = ${ctx.etablissementId} AND statut = 'ouverte' LIMIT 1`);
    return { salutation: payeur ? `${CIVILITE[payeur.lien] ?? ''} ${payeur.famille}`.trim() : '', annee: annee?.libelle ?? null, enfants: res, alertes, blocages, annonces,
      nouvelles: nouvelles.map((n) => ({ ...n, texte: n.texte.replace(/ | |,/g, (c) => (c === ',' ? ',' : ' ')) })), nonLus: nonLus?.n ?? 0 };
  });

  r.get('/portail/enfants', { config: { permission: 'portail.famille.consulter' }, schema: { tags: ['portail'] } }, async (req) => {
    const ctx = exiger(req);
    return (await enfants(ctx)).map((e) => ({ eleveId: e.eleve_id, prenom: e.prenoms, nom: `${e.nom} ${e.prenoms}`, classe: e.classe }));
  });

  // RG-40, RG-35 : bulletin publié, à l'écran, visible sous condition de paiement.
  r.get('/portail/enfants/:eleveId/bulletin', {
    config: { permission: 'portail.famille.consulter' }, schema: { tags: ['portail'], params: z.object({ eleveId: Uuid }), querystring: z.object({ periodeId: Uuid.optional() }) },
  }, async (req) => {
    const ctx = exiger(req);
    const e = await enfant(ctx, req.params.eleveId);
    const b = await app.bd.lireUn<{ periode_id: string | null; libelle: string; tranche: number | null; resultats: Record<string, unknown>; version: number }>(sql`
      SELECT b.periode_id, COALESCE(p.libelle_fr, 'Annuel') AS libelle, p.tranche_ordre AS tranche, b.resultats, b.version
        FROM pedagogie.bulletin b LEFT JOIN structure.periode p ON p.id = b.periode_id
       WHERE b.inscription_id = ${e.inscription_id} AND b.statut = 'publie' AND (${req.query.periodeId ?? null}::uuid IS NULL OR b.periode_id = ${req.query.periodeId ?? null}::uuid)
       ORDER BY p.ordre DESC NULLS FIRST LIMIT 1`);
    // Choix de la période à l'écran : toutes les périodes de l'année, celles dont le bulletin est publié sont consultables.
    const periodes = (await app.bd.lire<{ id: string; libelle: string; publie: boolean }>(sql`
      SELECT p.id, p.libelle_fr AS libelle,
             EXISTS (SELECT 1 FROM pedagogie.bulletin b WHERE b.inscription_id = ${e.inscription_id} AND b.periode_id = p.id AND b.statut = 'publie') AS publie
        FROM structure.periode p WHERE p.annee_id = ${e.annee_id} ORDER BY p.ordre`));
    const affectations = await app.bd.lire<{ matiere_id: string | null; nom: string; principal: boolean }>(sql`
      SELECT a.matiere_id, p.nom_affiche AS nom, a.principal FROM pedagogie.affectation a JOIN personnel.fiche p ON p.id = a.personnel_id
       WHERE a.classe_id = ${e.classe_id}`);
    const principal = affectations.find((a) => a.principal)?.nom ?? null;
    const enseignants = Object.fromEntries(affectations.filter((a) => !a.principal && a.matiere_id).map((a) => [a.matiere_id!, a.nom]));
    const commun = { prenom: e.prenoms, classe: e.classe, principal, periodes, enseignants };
    if (!b) return { ...commun, periodeId: req.query.periodeId ?? null, bulletin: null, bloque: null };
    const vis = (await app.bd.transaction(null, (tx) => visibilites(tx, [e.inscription_id], b.periode_id, b.tranche))).get(e.inscription_id)!;
    if (!vis.visible) {
      return { ...commun, periodeId: b.periode_id, periode: b.libelle, bulletin: null,
        bloque: `Le bulletin du ${b.libelle} de ${e.prenoms} sera visible quand ${b.periode_id ? `la tranche ${b.tranche} sera payée à ${vis.seuil} %` : 'les frais de l’année seront payés à 100 %'} (aujourd’hui ${vis.taux} %).` };
    }
    return { ...commun, periodeId: b.periode_id, periode: b.libelle, bulletin: b.resultats, version: b.version, bloque: null };
  });

  r.get('/portail/enfants/:eleveId/paiements', { config: { permission: 'portail.famille.consulter' }, schema: { tags: ['portail'], params: z.object({ eleveId: Uuid }) } }, async (req) => {
    const ctx = exiger(req);
    const e = await enfant(ctx, req.params.eleveId);
    const lignes = await app.bd.lire<{ libelle_fr: string; ordre: number; a_payer: number; verse: number; reste: number; reduction: number; date_limite: string; motif: string | null }>(sql`
      SELECT v.libelle_fr, v.ordre, v.a_payer, v.verse, v.reste, v.reduction, v.date_limite, l.motif_reduction AS motif
        FROM reporting.v_echeance v JOIN finances.ligne_echeance l ON l.id = v.id WHERE v.inscription_id = ${e.inscription_id} ORDER BY v.ordre`);
    const recus = await app.bd.lire<{ id: string; numero: string; montant: number; date: string; mode: string }>(sql`
      SELECT id, numero_recu AS numero, montant, encaisse_le AS date, mode FROM finances.versement
       WHERE inscription_id = ${e.inscription_id} AND statut <> 'annule' ORDER BY encaisse_le DESC`);
    const etab = await app.bd.lireUn<{ banque: string | null; numero_compte: string | null }>(sql`SELECT banque, numero_compte FROM structure.etablissement WHERE id = ${ctx.etablissementId}`);
    const aPayer = lignes.reduce((s, l) => s + Number(l.a_payer), 0);
    const verse = lignes.reduce((s, l) => s + Number(l.verse), 0);
    return { nom: `${e.nom} ${e.prenoms}`, classe: e.classe, resteDu: aPayer - verse, verse, aPayer, banque: etab?.banque ?? null, numeroCompte: etab?.numero_compte ?? null,
      lignes: lignes.map((l) => ({ libelle: l.libelle_fr, aPayer: Number(l.a_payer), reste: Number(l.reste), dateLimite: l.date_limite, solde: Number(l.reste) === 0,
        reduction: Number(l.reduction) > 0 ? (l.motif ?? 'réduction') : null })),
      recus: recus.map((x) => ({ ...x, montant: Number(x.montant), modeLibelle: MODES[x.mode]?.fr.toLowerCase() })) };
  });

  r.get('/portail/recus/:versementId', { config: { permission: 'portail.famille.consulter' }, schema: { tags: ['portail'], params: z.object({ versementId: Uuid }) } }, async (req) => {
    const ctx = exiger(req);
    const f = famille(ctx);
    const v = await app.bd.lireUn<{ inscription_id: string }>(sql`
      SELECT v.inscription_id FROM finances.versement v JOIN scolarite.inscription i ON i.id = v.inscription_id JOIN scolarite.eleve e ON e.id = i.eleve_id
       WHERE v.id = ${req.params.versementId} AND e.famille_id = ${f}`);
    if (!v) throw interdit('portail.famille.consulter');
    // Consultation à l'écran seulement : la route renvoie des données, jamais de fichier (RG-35).
    return donneesRecuPortail(app, ctx.etablissementId, req.params.versementId);
  });

  r.get('/portail/enfants/:eleveId/agenda', {
    config: { permission: 'portail.famille.consulter' }, schema: { tags: ['portail'], params: z.object({ eleveId: Uuid }), querystring: z.object({ jour: z.coerce.number().int().min(1).max(6).optional() }) },
  }, async (req) => {
    const ctx = exiger(req);
    const e = await enfant(ctx, req.params.eleveId);
    const maintenant = new Date(Date.now() + 3600_000);
    const auj = ((maintenant.getUTCDay() + 6) % 7) + 1;
    const jour = req.query.jour ?? (auj > 6 ? 1 : auj);
    // Un emploi du temps déjà publié reste en vigueur pendant qu'une modification attend la validation du préfet.
    const edt = await app.bd.lireUn<{ statut: string; publie_le: string | null }>(sql`SELECT statut, publie_le FROM pedagogie.emploi_du_temps WHERE classe_id = ${e.classe_id}`);
    const cours = edt && (edt.statut === 'publie' || edt.publie_le) ? await coursDuJour(app.bd, e.classe_id, jour) : [];
    const creneauxPause = await app.bd.lire<{ debut: string; fin: string; type: string }>(sql`
      SELECT to_char(cr.debut, 'HH24:MI') AS debut, to_char(cr.fin, 'HH24:MI') AS fin, cr.type FROM pedagogie.creneau cr
       WHERE cr.annee_id = (SELECT annee_id FROM structure.classe WHERE id = ${e.classe_id}) AND cr.type = 'recreation' AND ${jour} = ANY(cr.jours)`);
    const principal = await app.bd.lireUn<{ personnel_id: string }>(sql`SELECT personnel_id FROM pedagogie.affectation WHERE classe_id = ${e.classe_id} AND principal`);
    const devoirs = await app.bd.lire(sql`
      SELECT s.libelle AS matiere, s.devoir, s.devoir_pour AS "pour" FROM pedagogie.seance s
       WHERE s.classe_id = ${e.classe_id} AND s.devoir IS NOT NULL AND (s.devoir_pour IS NULL OR s.devoir_pour >= current_date) ORDER BY s.devoir_pour NULLS LAST LIMIT 6`);
    const date = new Date(maintenant.getTime() + (jour - (auj > 6 ? 1 : auj)) * 86_400_000).toISOString().slice(0, 10);
    const lignes = [...cours.map((c) => ({ debut: c.debut, fin: c.fin, libelle: c.libelle, enseignant: c.personnel,
      principal: !!principal && c.personnelId === principal.personnel_id })), ...creneauxPause.map((p) => ({ debut: p.debut, fin: p.fin, libelle: 'Récréation', enseignant: null, principal: false }))]
      .sort((a, b) => a.debut.localeCompare(b.debut));
    return { prenom: e.prenoms, nom: `${e.nom} ${e.prenoms}`, classe: e.classe, jour, date, cours: cours.length ? lignes : [], devoirs };
  });

  // « lu=0 » : lecture des absences et annonces sans marquer les conversations comme lues.
  r.get('/portail/messages', { config: { permission: 'portail.famille.consulter' }, schema: { tags: ['portail'], querystring: z.object({ lu: z.enum(['0', '1']).optional() }) } }, async (req) => {
    const ctx = exiger(req);
    const f = famille(ctx);
    const fam = await app.bd.lireUn<{ nom: string }>(sql`SELECT nom FROM scolarite.famille WHERE id = ${f}`);
    const annonces = await app.bd.lire(sql`
      SELECT a.id, a.titre, a.texte_fr AS "texteFr", a.texte_en AS "texteEn", a.publiee_le AS date,
             CASE a.cible WHEN 'ecole' THEN 'Toute l’école' WHEN 'debiteurs' THEN 'Paiements' ELSE a.cible_libelle END AS cible
        FROM communication.annonce a JOIN communication.annonce_famille af ON af.annonce_id = a.id
       WHERE af.famille_id = ${f} AND a.statut = 'publiee' ORDER BY a.publiee_le DESC LIMIT 5`);
    const absences = await app.bd.lire<{ inscription_id: string; prenom: string; jour: string; matin: boolean; apres: boolean; justifiee: boolean; demande: string | null }>(sql`
      SELECT a.inscription_id, e.prenoms AS prenom, a.jour, bool_or(a.debut < '12:00') AS matin, bool_or(a.debut >= '12:00') AS apres,
             bool_and(a.statut = 'justifiee') AS justifiee, max(a.demande_parent) AS demande
        FROM vie_scolaire.absence a JOIN scolarite.inscription i ON i.id = a.inscription_id JOIN scolarite.eleve e ON e.id = i.eleve_id
       WHERE e.famille_id = ${f} GROUP BY a.inscription_id, e.prenoms, a.jour ORDER BY a.jour DESC LIMIT 5`);
    const observations = await app.bd.lire<{ type: string; prenom: string; description: string; sanction: string | null; date: string }>(sql`
      SELECT o.type, e.prenoms AS prenom, o.description, o.sanction, o.survenu_le AS date FROM vie_scolaire.observation o
        JOIN scolarite.inscription i ON i.id = o.inscription_id JOIN scolarite.eleve e ON e.id = i.eleve_id
       WHERE e.famille_id = ${f} ORDER BY o.survenu_le DESC LIMIT 5`);
    const conversations = await app.bd.lire(sql`
      SELECT c.id, c.eleve_id AS "eleveId", c.destinataire_role AS destinataire, c.sujet, c.non_lu_famille AS "nonLu",
             (SELECT m.texte FROM communication.message m WHERE m.conversation_id = c.id AND NOT m.brouillon ORDER BY m.envoye_le DESC LIMIT 1) AS dernier,
             (SELECT m.auteur_type FROM communication.message m WHERE m.conversation_id = c.id AND NOT m.brouillon ORDER BY m.envoye_le DESC LIMIT 1) AS "dernierAuteur",
             c.derniere_activite AS date
        FROM communication.conversation c WHERE c.famille_id = ${f} ORDER BY c.derniere_activite DESC LIMIT 60`);
    if (req.query.lu !== '0') await app.bd.lire(sql`UPDATE communication.conversation SET non_lu_famille = false WHERE famille_id = ${f}`);
    const evenements = [
      ...absences.map((a) => ({ type: 'Absence', prenom: a.prenom, date: a.jour, texte: `${a.matin && a.apres ? 'journée' : a.matin ? 'matin' : 'après-midi'} · ${a.justifiee ? 'justifiée' : a.demande ? 'justification demandée' : 'non justifiée'}`,
        inscriptionId: a.inscription_id, jour: a.jour, justifiable: !a.justifiee && !a.demande })),
      ...observations.map((o) => ({ type: TYPES_OBSERVATION[o.type] ?? o.type, prenom: o.prenom, date: o.date, texte: `${o.description.toLowerCase()}${o.sanction ? ` · ${o.sanction.toLowerCase()}` : ''}`,
        inscriptionId: null, jour: null, justifiable: false })),
    ].sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 4);
    return { famille: fam?.nom ?? '', annonces, evenements, conversations };
  });

  r.post('/portail/absences/justification', {
    config: { permission: 'vie_scolaire.absence.demander' },
    schema: { tags: ['portail'], body: z.object({ inscriptionId: Uuid, jour: z.iso.date(), texte: z.string().trim().min(3).max(500) }) },
  }, async (req) => {
    const ctx = exiger(req);
    const f = famille(ctx);
    return app.bd.transaction(ctx.compteId, async (tx) => {
      const i = await ligne<{ eleve_id: string; prenoms: string }>(tx, sql`
        SELECT e.id AS eleve_id, e.prenoms FROM scolarite.inscription i JOIN scolarite.eleve e ON e.id = i.eleve_id WHERE i.id = ${req.body.inscriptionId} AND e.famille_id = ${f}`);
      if (!i) throw interdit('vie_scolaire.absence.demander');
      const n = await tx.execute(sql`UPDATE vie_scolaire.absence SET demande_parent = ${req.body.texte}, demande_le = now()
                                     WHERE inscription_id = ${req.body.inscriptionId} AND jour = ${req.body.jour} AND statut = 'non_justifiee'`);
      if (!n.rowCount) throw new ErreurMetier('VIE_RIEN_A_JUSTIFIER', 422, 'Aucune absence non justifiée ce jour-là.');
      // RG-39 : la demande attend la décision de la secrétaire, qui la reçoit dans sa messagerie.
      const date = req.body.jour.split('-').reverse().slice(0, 2).join('/');
      const c = await ligne<{ id: string }>(tx, sql`
        INSERT INTO communication.conversation (etablissement_id, famille_id, eleve_id, destinataire_role, sujet)
        VALUES (${ctx.etablissementId}, ${f}, ${i.eleve_id}, 'secretaire', ${`Demande de justification : absence du ${date}`}) RETURNING id`);
      await tx.execute(sql`INSERT INTO communication.message (etablissement_id, conversation_id, auteur_type, auteur, texte)
                           VALUES (${ctx.etablissementId}, ${c!.id}, 'famille', ${ctx.compteId}, ${req.body.texte})`);
      await journaliser(tx, ctx, { action: 'Demande', objetType: 'Absence', objetLibelle: `Justification · ${i.prenoms} · ${date}`, avant: 'Non justifiée',
        apres: 'Demande du parent', eleveId: i.eleve_id });
      return { ok: true };
    });
  });

  r.get('/portail/destinataires', { config: { permission: 'communication.messagerie.ecrire' }, schema: { tags: ['portail'], querystring: z.object({ eleveId: Uuid }) } }, async (req) => {
    const ctx = exiger(req);
    const e = await enfant(ctx, req.query.eleveId);
    const principal = await app.bd.lireUn<{ nom: string }>(sql`
      SELECT p.nom_affiche AS nom FROM pedagogie.affectation a JOIN personnel.fiche p ON p.id = a.personnel_id WHERE a.classe_id = ${e.classe_id} AND a.principal`);
    const directeur = await app.bd.lireUn<{ nom: string }>(sql`
      SELECT c.nom_affiche AS nom FROM core.compte c JOIN core.compte_role cr ON cr.compte_id = c.id JOIN core.role r ON r.id = cr.role_id
       WHERE c.etablissement_id = ${ctx.etablissementId} AND r.code = 'directeur' AND c.actif ORDER BY c.cree_le LIMIT 1`);
    return [
      { code: 'instituteur_principal', role: 'Instituteur principal', nom: principal ? `${principal.nom} · ${e.classe}` : e.classe, aide: 'Le travail, le comportement, la vie de la classe' },
      { code: 'econome', role: 'Économe', nom: 'Paiements et reçus', aide: 'Une échéance, un reçu, un versement bancaire' },
      { code: 'directeur', role: 'Directeur', nom: directeur?.nom ?? '', aide: 'Une demande que les autres ne peuvent pas trancher' },
      { code: 'secretaire', role: 'Secrétaire', nom: 'Secrétariat', aide: 'Absence, certificat, inscription, renseignement' },
    ];
  });

  // RG-42 : le message va au seul destinataire choisi.
  r.post('/portail/messages', {
    config: { permission: 'communication.messagerie.ecrire' },
    schema: { tags: ['portail'], body: z.object({ destinataire: z.enum(DESTINATAIRES), eleveId: Uuid, texte: z.string().trim().min(2).max(2000) }) },
  }, async (req) => {
    const ctx = exiger(req);
    const f = famille(ctx);
    const e = await enfant(ctx, req.body.eleveId);
    return app.bd.transaction(ctx.compteId, async (tx) => {
      let destinataireCompte: string | null = null;
      if (req.body.destinataire === 'instituteur_principal') {
        const p = await ligne<{ compte_id: string | null }>(tx, sql`
          SELECT c.id AS compte_id FROM pedagogie.affectation a LEFT JOIN core.compte c ON c.personnel_id = a.personnel_id AND c.actif
           WHERE a.classe_id = ${e.classe_id} AND a.principal`);
        if (!p?.compte_id) throw new ErreurMetier('COM_PRINCIPAL_SANS_COMPTE', 422, 'La classe n\'a pas encore d\'instituteur principal joignable.');
        destinataireCompte = p.compte_id;
      }
      let c = await ligne<{ id: string }>(tx, sql`
        SELECT id FROM communication.conversation WHERE famille_id = ${f} AND eleve_id = ${req.body.eleveId} AND destinataire_role = ${req.body.destinataire}
           AND destinataire_compte IS NOT DISTINCT FROM ${destinataireCompte}::uuid AND sujet IS NULL ORDER BY derniere_activite DESC LIMIT 1`);
      if (!c) {
        c = await ligne<{ id: string }>(tx, sql`
          INSERT INTO communication.conversation (etablissement_id, famille_id, eleve_id, destinataire_role, destinataire_compte)
          VALUES (${ctx.etablissementId}, ${f}, ${req.body.eleveId}, ${req.body.destinataire}, ${destinataireCompte}) RETURNING id`);
      }
      await tx.execute(sql`INSERT INTO communication.message (etablissement_id, conversation_id, auteur_type, auteur, texte)
                           VALUES (${ctx.etablissementId}, ${c!.id}, 'famille', ${ctx.compteId}, ${req.body.texte})`);
      await tx.execute(sql`UPDATE communication.conversation SET non_lu_ecole = true, derniere_activite = now() WHERE id = ${c!.id}`);
      return { conversationId: c!.id };
    });
  });

  r.get('/portail/conversations/:id', { config: { permission: 'portail.famille.consulter' }, schema: { tags: ['portail'], params: z.object({ id: Uuid }) } }, async (req) => {
    const ctx = exiger(req);
    const f = famille(ctx);
    const c = await app.bd.lireUn(sql`SELECT id, destinataire_role AS destinataire, sujet FROM communication.conversation WHERE id = ${req.params.id} AND famille_id = ${f}`);
    if (!c) throw introuvable('Conversation');
    const messages = await app.bd.lire(sql`
      SELECT m.auteur_type AS "auteurType", co.nom_affiche AS auteur, m.texte, m.envoye_le AS "envoyeLe" FROM communication.message m JOIN core.compte co ON co.id = m.auteur
       WHERE m.conversation_id = ${req.params.id} AND NOT m.brouillon ORDER BY m.envoye_le`);
    return { ...c, messages };
  });
  void fmt;
}
