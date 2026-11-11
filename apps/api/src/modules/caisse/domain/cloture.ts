// RG-18 : écart = montant compté − (fonds initial + entrées en espèces − sorties en espèces) ;
// tout écart non nul exige un commentaire.
import { ErreurMetier } from '../../../core/erreurs.ts';

export function especesAttendues(fondsInitial: number, entreesEspeces: number, sortiesEspeces: number): number {
  return fondsInitial + entreesEspeces - sortiesEspeces;
}

export function ecartDeCloture(montantCompte: number, fondsInitial: number, entreesEspeces: number, sortiesEspeces: number,
  motif: string | null | undefined): number {
  const ecart = montantCompte - especesAttendues(fondsInitial, entreesEspeces, sortiesEspeces);
  if (ecart !== 0 && !motif?.trim()) {
    throw new ErreurMetier('CAI_MOTIF_ECART_REQUIS', 422, 'Un écart non nul exige un motif.', 'motifEcart');
  }
  return ecart;
}
