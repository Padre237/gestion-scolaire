// API publique du module caisse (ADR-01) : sessions et mouvements, appelés par les finances.
import { sql, ligne, type Tx } from '../../core/bd.ts';
import { ErreurMetier } from '../../core/erreurs.ts';

export interface SessionOuverte { id: string; caisse: string; fonds_initial: number; ouverte_le: string }

export async function sessionOuverte(tx: Tx, compteId: string): Promise<SessionOuverte | undefined> {
  return ligne<SessionOuverte>(tx, sql`
    SELECT id, caisse, fonds_initial, ouverte_le FROM caisse.session WHERE caissier_id = ${compteId} AND cloturee_le IS NULL`);
}

/** RG-17 : un versement en espèces exige une session de caisse ouverte par l'utilisateur connecté. */
export async function exigerSession(tx: Tx, compteId: string): Promise<SessionOuverte> {
  const s = await sessionOuverte(tx, compteId);
  if (!s) throw new ErreurMetier('CAI_SESSION_FERMEE', 422, 'Ouvrez votre session de caisse avant d\'encaisser des espèces (RG-17).');
  return s;
}

export async function ajouterMouvement(tx: Tx, etab: string, m: {
  sessionId: string; sens: 'entree' | 'sortie'; nature: 'versement' | 'entree_diverse' | 'sortie' | 'annulation' | 'versement_banque';
  libelle: string; mode: string; montant: number; versementId?: string | null; sortieId?: string | null; depotId?: string | null; par: string;
}) {
  await tx.execute(sql`
    INSERT INTO caisse.mouvement (etablissement_id, session_id, versement_id, sortie_id, depot_id, sens, nature, libelle, mode, montant, cree_par)
    VALUES (${etab}, ${m.sessionId}, ${m.versementId ?? null}, ${m.sortieId ?? null}, ${m.depotId ?? null}, ${m.sens}, ${m.nature},
            ${m.libelle}, ${m.mode}, ${m.montant}, ${m.par})`);
}
