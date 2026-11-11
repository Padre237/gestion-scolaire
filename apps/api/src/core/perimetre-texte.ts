// Textes de périmètre affichés dans Utilisateurs et rôles et dans Personnel :
// « EPS · du CE1 au CM2 », « Anglais · CM1 A, CM2 A », « Steve (CE2 B), Loïc (SIL A) ».
import type { Bd } from './bd.ts';

export interface ClasseNiveau { nom: string; niveauRang: number; niveauCode: string }

type FournisseurFamille = (bd: Bd, familleId: string) => Promise<{ prenom: string; classe: string | null }[]>;
let fournisseurFamille: FournisseurFamille | null = null;
export const enregistrerFournisseurFamille = (f: FournisseurFamille) => { fournisseurFamille = f; };

export async function texteFamille(bd: Bd, familleId: string): Promise<string> {
  if (!fournisseurFamille) return '';
  const enfants = await fournisseurFamille(bd, familleId);
  return enfants.map((e) => (e.classe ? `${e.prenom} (${e.classe})` : e.prenom)).join(', ');
}

/**
 * Résume une liste de classes. Quand elles couvrent toutes les classes de niveaux consécutifs
 * (trois niveaux au moins), on écrit « du CE1 au CM2 » ; sinon on liste les classes.
 * `toutes` = toutes les classes de l'année, pour savoir si un niveau est complet.
 */
export function resumeClasses(classes: ClasseNiveau[], toutes: ClasseNiveau[]): string {
  if (!classes.length) return '';
  const tri = [...classes].sort((a, b) => a.niveauRang - b.niveauRang || a.nom.localeCompare(b.nom));
  const rangs = [...new Set(tri.map((c) => c.niveauRang))];
  const consecutifs = rangs.every((r, i) => i === 0 || r === rangs[i - 1]! + 1);
  const niveauxComplets = rangs.every((r) =>
    toutes.filter((c) => c.niveauRang === r).length === tri.filter((c) => c.niveauRang === r).length);
  // Les rangs doivent aussi être consécutifs parmi les niveaux existants.
  if (rangs.length >= 3 && consecutifs && niveauxComplets) {
    return `du ${tri[0]!.niveauCode} au ${tri[tri.length - 1]!.niveauCode}`;
  }
  return tri.map((c) => c.nom).join(', ');
}
