// RG-40 : le parent ne voit un bulletin publié que si l'élève est solvable.
// Bulletin de période : la tranche rattachée à la période est payée à 90 % au moins.
// Bulletin de fin d'année : les frais de l'année sont payés à 100 %.
// La levée du blocage par le directeur rend le bulletin visible quoi qu'il en soit.

export interface LigneSolvabilite { ordre: number; aPayer: number; verse: number }

export const SEUIL_PERIODE = 90;
export const SEUIL_ANNUEL = 100;

/** La tranche n est la ligne d'ordre n + 1 : l'inscription occupe l'ordre 1 (copie de la grille, RG-07). */
export const ordreDeTranche = (tranche: number) => tranche + 1;

/** Pourcentage payé, arrondi à l'entier inférieur ; une ligne sans montant dû compte comme payée. */
export function tauxPaye(lignes: LigneSolvabilite[]): number {
  const aPayer = lignes.reduce((s, l) => s + l.aPayer, 0);
  const verse = lignes.reduce((s, l) => s + Math.min(l.verse, l.aPayer), 0);
  if (aPayer <= 0) return 100;
  return Math.floor((verse * 100) / aPayer);
}

export interface Visibilite { visible: boolean; taux: number; seuil: number; tranche: number | null; leve: boolean }

export function visibiliteBulletin(lignes: LigneSolvabilite[], tranche: number | null, annuel: boolean, leve: boolean): Visibilite {
  const concernees = annuel ? lignes : lignes.filter((l) => tranche !== null && l.ordre === ordreDeTranche(tranche));
  const taux = tauxPaye(concernees);
  const seuil = annuel ? SEUIL_ANNUEL : SEUIL_PERIODE;
  return { visible: leve || taux >= seuil, taux, seuil, tranche, leve };
}
