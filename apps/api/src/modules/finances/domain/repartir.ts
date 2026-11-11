// RG-10 et RG-12 : règles pures de l'échéancier (conception § 9.1).
import { ErreurMetier } from '../../../core/erreurs.ts';

export type LigneDue = { id: string; ordre: number; reste: number };
export type Part = { ligneId: string; montant: number };

/** Répartit un versement dans l'ordre des échéances ; refuse ce qui dépasse le reste dû (RG-12). */
export function repartir(montant: number, lignes: LigneDue[]): Part[] {
  if (!Number.isInteger(montant) || montant <= 0) throw new ErreurMetier('FIN_MONTANT_INVALIDE', 422, 'Montant invalide.', 'montant');
  const parts: Part[] = [];
  let resteAImputer = montant;
  for (const ligne of [...lignes].sort((a, b) => a.ordre - b.ordre)) {
    if (resteAImputer === 0) break;
    const part = Math.min(ligne.reste, resteAImputer);
    if (part > 0) {
      parts.push({ ligneId: ligne.id, montant: part });
      resteAImputer -= part;
    }
  }
  if (resteAImputer > 0) {
    throw new ErreurMetier('FIN_MONTANT_SUPERIEUR_AU_RESTE', 422, 'Le montant dépasse le reste dû.', 'montant');
  }
  return parts;
}

/** RG-10 : à payer = prix − réduction ; reste = à payer − versé, jamais négatif. */
export function calculerLigne(prix: number, reduction: number, verse: number) {
  const aPayer = prix - reduction;
  return { aPayer, verse, reste: Math.max(aPayer - verse, 0) };
}

/** Montant qui solde la première tranche non soldée (raccourci « Solder la tranche en cours »). */
export function soldeTrancheEnCours(lignes: LigneDue[]): number {
  return [...lignes].sort((a, b) => a.ordre - b.ordre).find((l) => l.reste > 0)?.reste ?? 0;
}
