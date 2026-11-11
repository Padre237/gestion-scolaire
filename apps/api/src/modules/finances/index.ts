// API publique du module finances (ADR-01) : échéancier créé à l'inscription (RG-07).
import { sql, ligne, lignes, type Tx } from '../../core/bd.ts';
import { surEvenement } from '../../core/evenements.ts';
import { validerInscription } from '../scolarite/index.ts';

export const MODES: Record<string, { fr: string; en: string }> = {
  especes: { fr: 'Espèces', en: 'Cash' },
  versement_bancaire: { fr: 'Versement bancaire', en: 'Bank deposit' },
  virement: { fr: 'Virement', en: 'Transfer' },
  cheque: { fr: 'Chèque', en: 'Cheque' },
};

export interface LigneEcheancier {
  id: string; ordre: number; libelle_fr: string; libelle_en: string; prix_unitaire: number; reduction: number; motif_reduction: string | null;
  a_payer: number; verse: number; reste: number; date_limite: string;
}

export async function echeancier(tx: Tx, inscriptionId: string, verrouiller = false): Promise<LigneEcheancier[]> {
  if (verrouiller) await tx.execute(sql`SELECT id FROM finances.ligne_echeance WHERE inscription_id = ${inscriptionId} FOR UPDATE`);
  return lignes<LigneEcheancier>(tx, sql`
    SELECT l.id, l.ordre, l.libelle_fr, l.libelle_en, l.prix_unitaire, l.reduction, l.motif_reduction,
           l.prix_unitaire - l.reduction AS a_payer, COALESCE(v.verse, 0)::bigint AS verse,
           GREATEST(l.prix_unitaire - l.reduction - COALESCE(v.verse, 0), 0)::bigint AS reste, l.date_limite
      FROM finances.ligne_echeance l
      LEFT JOIN LATERAL (SELECT sum(im.montant) AS verse FROM finances.imputation im JOIN finances.versement ve ON ve.id = im.versement_id
                          WHERE im.ligne_echeance_id = l.id AND ve.statut <> 'annule') v ON true
     WHERE l.inscription_id = ${inscriptionId} ORDER BY l.ordre`);
}

// RG-07 : la validation de l'inscription copie la grille du niveau ; chaque ligne garde montant et date limite.
surEvenement('inscription.creee', async (tx, ctx, d) => {
  const n = await ligne<{ n: number }>(tx, sql`
    INSERT INTO finances.ligne_echeance (etablissement_id, inscription_id, rubrique_id, libelle_fr, libelle_en, ordre, prix_unitaire, date_limite, cree_par)
    SELECT g.etablissement_id, ${d.inscriptionId}, l.rubrique_id, l.libelle_fr, l.libelle_en, l.ordre, l.montant, l.date_limite, ${ctx?.compteId ?? null}
      FROM finances.grille_frais g JOIN finances.ligne_grille l ON l.grille_id = g.id
     WHERE g.annee_id = ${d.anneeId} AND g.niveau_id = ${d.niveauId} AND g.statut_eleve = ${d.tarif}
    RETURNING 1`).then(async () => ligne<{ n: number }>(tx, sql`SELECT min(prix_unitaire)::bigint AS n FROM finances.ligne_echeance WHERE inscription_id = ${d.inscriptionId} AND ordre = 1`));
  // Sans montant d'inscription, l'inscription n'attend aucun versement (cycle de vie 7.1).
  if (!n || Number(n.n ?? 0) === 0) await validerInscription(tx, d.inscriptionId, 'aucun versement minimal', ctx);
});

// Une relance de paiement mise en file par SMS s'inscrit dans le suivi des impayés (« Dernière relance »).
surEvenement('relance.sms', async (tx, _ctx, d) => {
  for (const id of d.inscriptionIds) {
    await tx.execute(sql`INSERT INTO finances.relance (etablissement_id, inscription_id, canal, par)
                         SELECT etablissement_id, id, 'sms', ${d.compteId} FROM scolarite.inscription WHERE id = ${id}`);
  }
});

// Clôture d'année (E-26) : le reste dû devient la ligne « Arriéré », d'ordre 0, répartie en premier dans le nouvel échéancier.
surEvenement('inscription.reportee', async (tx, ctx, d) => {
  const l = await echeancier(tx, d.ancienneInscriptionId);
  const reste = l.reduce((s, x) => s + Number(x.reste), 0);
  if (reste <= 0) return;
  await tx.execute(sql`
    INSERT INTO finances.ligne_echeance (etablissement_id, inscription_id, rubrique_id, libelle_fr, libelle_en, ordre, prix_unitaire, date_limite, cree_par)
    SELECT i.etablissement_id, ${d.nouvelleInscriptionId}, (SELECT id FROM finances.rubrique r WHERE r.etablissement_id = i.etablissement_id AND r.code = 'scolarite'),
           ${`Arriéré ${d.libelleAnnee}`}, ${`Arrears ${d.libelleAnnee}`}, 0, ${reste}, ${d.dateLimite}, ${ctx?.compteId ?? null}
      FROM scolarite.inscription i WHERE i.id = ${d.nouvelleInscriptionId}`);
});
