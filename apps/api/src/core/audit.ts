// Lignes « métier » du journal d'audit : ce que montre l'écran Paramètres · Journal d'audit.
// Les lignes « techniques » sont écrites par le déclencheur core.fn_audit (conception § 6.5).
import { sql, type Tx } from './bd.ts';
import type { Contexte } from './contexte.ts';

export type ActionAudit = 'Création' | 'Modification' | 'Annulation' | 'Demande' | 'Validation' | 'Refus'
  | 'Levée de blocage' | 'Désactivation' | 'Réinitialisation' | 'Export' | 'Connexion refusée';

export interface EntreeAudit {
  action: ActionAudit;
  objetType: string;          // « Versement », « Élève », « Droits »…
  objetLibelle: string;       // « Versement R2026-000310 »
  avant?: string | null;      // « – » si absent
  apres?: string | null;
  ligneId?: string | null;
  table?: string | null;
  /** Élève concerné : la ligne apparaît dans l'historique de sa fiche. */
  eleveId?: string | null;
}

export async function journaliser(tx: Tx, ctx: Pick<Contexte, 'compteId' | 'etablissementId'> | null,
  e: EntreeAudit, etablissementId?: string) {
  await tx.execute(sql`
    INSERT INTO core.journal_audit (etablissement_id, utilisateur_id, nature, table_nom, ligne_id, action,
                                    objet_type, objet_libelle, avant_libelle, apres_libelle, eleve_id)
    VALUES (${etablissementId ?? ctx?.etablissementId ?? null}, ${ctx?.compteId ?? null}, 'metier', ${e.table ?? null},
            ${e.ligneId ?? null}, ${e.action}, ${e.objetType}, ${e.objetLibelle}, ${e.avant ?? null}, ${e.apres ?? null},
            ${e.eleveId ?? null})`);
}
