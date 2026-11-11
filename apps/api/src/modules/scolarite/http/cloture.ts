// Clôture d'année (maquette Cloture, E-30) : vérifications, passage des élèves d'après les décisions du conseil,
// report des soldes impayés (ligne « Arriéré », E-26), puis ouverture de l'année suivante. La secrétaire la conduit.
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { listerSauvegardes, lireConfig, sauvegarder } from '@gs/db';
import { sql, ligne, lignes, type Bd, tableau } from '../../../core/bd.ts';
import { ErreurMetier } from '../../../core/erreurs.ts';
import { exiger } from '../../../core/session.ts';
import { journaliser } from '../../../core/audit.ts';
import { emettre } from '../../../core/evenements.ts';
import { exigerAnneeOuverte } from '../../structure/index.ts';

const Uuid = z.uuid();

interface ClasseC { id: string; nom: string; niveau_id: string; rang: number; cycle_id: string; sous_systeme: string; cycle: string }

async function etat(bd: Bd, etab: string) {
  const annee = await exigerAnneeOuverte(bd, etab);
  const suivante = await bd.lireUn<{ id: string; libelle: string; statut: string; date_debut: string }>(sql`
    SELECT id, libelle, statut, date_debut FROM structure.annee_scolaire WHERE etablissement_id = ${etab} AND date_debut > ${annee.date_debut}
     ORDER BY date_debut LIMIT 1`);
  const derniere = await bd.lireUn<{ id: string; libelle_fr: string }>(sql`SELECT id, libelle_fr FROM structure.periode WHERE annee_id = ${annee.id} ORDER BY ordre DESC LIMIT 1`);
  const classes = await bd.lire<ClasseC>(sql`
    SELECT c.id, c.nom, c.niveau_id, n.rang, n.cycle_id, cy.sous_systeme, cy.libelle AS cycle FROM structure.classe c
      JOIN structure.niveau n ON n.id = c.niveau_id JOIN structure.cycle cy ON cy.id = n.cycle_id
     WHERE c.annee_id = ${annee.id} ORDER BY cy.sous_systeme DESC, n.rang, c.nom`);
  const suivantes = suivante ? await bd.lire<ClasseC>(sql`
    SELECT c.id, c.nom, c.niveau_id, n.rang, n.cycle_id, cy.sous_systeme, cy.libelle AS cycle FROM structure.classe c
      JOIN structure.niveau n ON n.id = c.niveau_id JOIN structure.cycle cy ON cy.id = n.cycle_id
     WHERE c.annee_id = ${suivante.id} ORDER BY n.rang, c.nom`) : [];
  const inscrits = await bd.lire<{ id: string; eleve_id: string; classe_id: string }>(sql`
    SELECT id, eleve_id, classe_id FROM reporting.v_inscription WHERE annee_id = ${annee.id} AND statut IN ('attente', 'validee')`);
  const decisions = derniere ? await bd.lire<{ inscription_id: string; fin_annee: string | null }>(sql`
    SELECT inscription_id, fin_annee FROM reporting.v_decision_conseil WHERE periode_id = ${derniere.id}`) : [];
  const publies = await bd.lire<{ inscription_id: string }>(sql`
    SELECT inscription_id FROM reporting.v_bulletin WHERE periode_id IS NULL AND statut = 'publie'
       AND inscription_id = ANY(${tableau(inscrits.map((i) => i.id))}::uuid[])`);
  const ouvertes = await bd.lire<{ caisse: string }>(sql`SELECT caisse FROM reporting.v_session_caisse WHERE etablissement_id = ${etab} AND cloturee_le IS NULL`);
  const soldes = await bd.lireUn<{ eleves: number; montant: number }>(sql`
    SELECT count(*) FILTER (WHERE s.reste > 0)::int AS eleves, COALESCE(sum(s.reste), 0)::bigint AS montant
      FROM reporting.v_solde s WHERE s.inscription_id = ANY(${tableau(inscrits.map((i) => i.id))}::uuid[])`);
  const sauvegarde = listerSauvegardes(lireConfig())[0] ?? null;
  const decision = (id: string) => decisions.find((d) => d.inscription_id === id)?.fin_annee ?? null;
  const classesCompletes = classes.filter((c) => {
    const e = inscrits.filter((i) => i.classe_id === c.id);
    return e.length > 0 && e.every((i) => publies.some((p) => p.inscription_id === i.id));
  }).length;
  const decides = inscrits.filter((i) => decision(i.id)).length;
  const fraiche = sauvegarde ? Date.now() - new Date(sauvegarde.date).getTime() < 24 * 3600_000 : false;
  const verifications = [
    { code: 'bulletins', libelle: 'Notes saisies et bulletins annuels publiés', detail: `${classesCompletes === classes.length ? classes.length : `${classesCompletes} sur ${classes.length}`} classes`, ok: classes.length > 0 && classesCompletes === classes.length },
    { code: 'decisions', libelle: 'Décisions du conseil enregistrées', detail: `${decides === inscrits.length ? inscrits.length : `${decides} sur ${inscrits.length}`} élèves`, ok: inscrits.length > 0 && decides === inscrits.length },
    { code: 'caisse', libelle: 'Sessions de caisse clôturées', detail: ouvertes.length ? `${ouvertes.length} session${ouvertes.length > 1 ? 's' : ''} encore ouverte${ouvertes.length > 1 ? 's' : ''}` : 'Caisse principale, caisse APE', ok: ouvertes.length === 0 },
    { code: 'sauvegarde', libelle: 'Sauvegarde de fin d’année', detail: sauvegarde ? sauvegarde.date : 'aucune', ok: fraiche },
  ];
  // Classe d'accueil proposée : celles du niveau suivant du même cycle ; la fin du cycle quitte l'école.
  const accueil = (c: ClasseC) => {
    const niveaux = [...new Set(classes.filter((k) => k.cycle_id === c.cycle_id).map((k) => k.rang))].sort((a, b) => a - b);
    const rangSuivant = niveaux.find((r) => r > c.rang);
    if (rangSuivant === undefined) return { ids: [] as string[], libelle: c.sous_systeme === 'anglophone' ? 'End of primary' : 'Fin du primaire' };
    const niveauSuivant = classes.find((k) => k.cycle_id === c.cycle_id && k.rang === rangSuivant)!.niveau_id;
    const cible = suivantes.filter((k) => k.niveau_id === niveauSuivant);
    return { ids: cible.map((k) => k.id), libelle: cible.length ? cible.map((k) => k.nom).join(' et ') : 'classe à créer' };
  };
  const passage = classes.map((c) => {
    const e = inscrits.filter((i) => i.classe_id === c.id);
    const a = accueil(c);
    return { classeId: c.id, classe: c.nom, effectif: e.length, admis: e.filter((i) => decision(i.id) === 'admis').length,
      redoublent: e.filter((i) => decision(i.id) === 'redouble').length, sortants: e.filter((i) => decision(i.id) === 'exclu').length,
      accueil: a.libelle, accueilIds: a.ids, redoublementIds: suivantes.filter((k) => k.niveau_id === c.niveau_id).map((k) => k.id) };
  });
  return { annee, suivante, derniere, classes, suivantes, inscrits, decision, verifications, passage,
    soldes: { eleves: soldes?.eleves ?? 0, montant: Number(soldes?.montant ?? 0) } };
}

export async function routesCloture(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get('/scolarite/cloture', { config: { unePermissionParmi: ['structure.annee.cloturer', 'structure.consulter'] }, schema: { tags: ['scolarite'] } }, async (req) => {
    const ctx = exiger(req);
    const e = await etat(app.bd, ctx.etablissementId);
    const pret = e.verifications.every((v) => v.ok) && !!e.suivante && e.suivante.statut === 'preparation';
    const totaux = e.passage.reduce((s, p) => ({ effectif: s.effectif + p.effectif, admis: s.admis + p.admis, redoublent: s.redoublent + p.redoublent, sortants: s.sortants + p.sortants }),
      { effectif: 0, admis: 0, redoublent: 0, sortants: 0 });
    return { annee: { id: e.annee.id, libelle: e.annee.libelle }, suivante: e.suivante ? { id: e.suivante.id, libelle: e.suivante.libelle, statut: e.suivante.statut } : null,
      verifications: e.verifications, passage: e.passage.map(({ redoublementIds: _r, ...p }) => p), totaux, soldes: e.soldes, pret,
      etape: e.verifications.every((v) => v.ok) ? 2 : 1, classesSuivantes: e.suivantes.map((k) => ({ id: k.id, nom: k.nom })) };
  });

  r.post('/scolarite/cloture', {
    config: { permission: 'structure.annee.cloturer' },
    schema: { tags: ['scolarite'], body: z.object({ passages: z.array(z.object({ classeId: Uuid, accueilClasseIds: z.array(Uuid).max(10) })).max(200) }) },
  }, async (req) => {
    const ctx = exiger(req);
    const e = await etat(app.bd, ctx.etablissementId);
    if (!e.suivante || e.suivante.statut !== 'preparation') throw new ErreurMetier('STR_ANNEE_SUIVANTE', 422, 'Créez d’abord l’année suivante, en préparation, avec ses classes.');
    const manque = e.verifications.filter((v) => v.ok === false && v.code !== 'sauvegarde');
    if (manque.length) throw new ErreurMetier('STR_CLOTURE_INCOMPLETE', 422, `Clôture impossible : ${manque.map((m) => `${m.libelle.toLowerCase()} (${m.detail})`).join(' ; ')}.`);
    // La clôture commence par une sauvegarde (maquette : « Sauvegarde de fin d'année »).
    await sauvegarder(lireConfig(), 'fin-annee');
    const suivante = e.suivante;
    return app.bd.transaction(ctx.compteId, async (tx) => {
      const grilles = await lignes<{ niveau_id: string }>(tx, sql`SELECT niveau_id FROM finances.grille_frais WHERE annee_id = ${suivante.id} AND statut_eleve = 'ancien'`);
      let reinscrits = 0, reportes = 0;
      for (const p of e.passage) {
        const choix = req.body.passages.find((x) => x.classeId === p.classeId)?.accueilClasseIds ?? p.accueilIds;
        const eleves = e.inscrits.filter((i) => i.classe_id === p.classeId);
        let tour = 0;
        for (const i of eleves) {
          const d = e.decision(i.id);
          const cibles = d === 'admis' ? choix : d === 'redouble' ? p.redoublementIds : [];
          await tx.execute(sql`UPDATE scolarite.inscription SET statut = 'cloturee' WHERE id = ${i.id}`);
          if (!cibles.length) continue;
          const classeId = cibles[tour++ % cibles.length]!;
          const k = e.suivantes.find((x) => x.id === classeId);
          if (!k) throw new ErreurMetier('STR_CLASSE_ACCUEIL', 422, 'Classe d’accueil inconnue pour l’année suivante.');
          if (!grilles.some((g) => g.niveau_id === k.niveau_id)) throw new ErreurMetier('STR_GRILLE_SUIVANTE', 422, `Aucune grille « anciens élèves » en ${suivante.libelle} pour ${k.nom} : copiez la grille d’abord.`);
          const n = await ligne<{ id: string }>(tx, sql`
            INSERT INTO scolarite.inscription (etablissement_id, annee_id, eleve_id, classe_id, type, tarif, statut, cree_par)
            VALUES (${ctx.etablissementId}, ${suivante.id}, ${i.eleve_id}, ${classeId}, ${d === 'redouble' ? 'redoublement' : 'reinscription'}, 'ancien', 'attente', ${ctx.compteId})
            RETURNING id`);
          await emettre(tx, ctx, 'inscription.creee', { inscriptionId: n!.id, eleveId: i.eleve_id, classeId, niveauId: k.niveau_id, anneeId: suivante.id, tarif: 'ancien' });
          await emettre(tx, ctx, 'inscription.reportee', { ancienneInscriptionId: i.id, nouvelleInscriptionId: n!.id, libelleAnnee: e.annee.libelle, dateLimite: suivante.date_debut });
          reinscrits++;
        }
      }
      const reste = await ligne<{ n: number }>(tx, sql`
        SELECT count(*)::int AS n FROM finances.ligne_echeance l JOIN scolarite.inscription i ON i.id = l.inscription_id WHERE i.annee_id = ${suivante.id} AND l.ordre = 0`);
      reportes = reste!.n;
      await tx.execute(sql`UPDATE structure.annee_scolaire SET statut = 'cloturee' WHERE id = ${e.annee.id}`);
      await tx.execute(sql`UPDATE structure.annee_scolaire SET statut = 'ouverte' WHERE id = ${suivante.id}`);
      await journaliser(tx, ctx, { action: 'Modification', objetType: 'Année scolaire', objetLibelle: `Clôture de ${e.annee.libelle}, ouverture de ${suivante.libelle}`,
        avant: 'Ouverte', apres: `${reinscrits} réinscriptions, ${reportes} arriérés reportés` });
      return { reinscrits, reportes, ouverte: suivante.libelle };
    });
  });
}
