// Événements traités dans la même transaction (conception § 2) : par exemple,
// inscription.creee déclenche la création de l'échéancier par le module finances,
// sans que la scolarité dépende des finances.
import type { Tx } from './bd.ts';
import type { Contexte } from './contexte.ts';

export interface Evenements {
  'inscription.creee': { inscriptionId: string; eleveId: string; classeId: string; niveauId: string; anneeId: string; tarif: 'nouveau' | 'ancien' };
  'versement.enregistre': { versementId: string; inscriptionId: string; montant: number };
  'versement.annule': { versementId: string; inscriptionId: string };
  'absence.saisie': { absenceIds: string[]; jour: string };
  'reduction.appliquee': { inscriptionId: string };
  'absence.justifiee': { inscriptionId: string; jour: string };
  'relance.sms': { inscriptionIds: string[]; compteId: string };
  'bulletins.publies': { classeId: string; periodeId: string | null; inscriptionIds: string[] };
  /** Nouvelle année préremplie (lot 1) : classes et programme repris de la précédente, ou programme préinstallé. */
  'annee.creee': { anneeId: string; precedenteId: string | null };
  'inscription.reportee': { ancienneInscriptionId: string; nouvelleInscriptionId: string; libelleAnnee: string; dateLimite: string };
}

type Gestionnaire<K extends keyof Evenements> = (tx: Tx, ctx: Contexte | null, donnees: Evenements[K]) => Promise<void>;
const gestionnaires = new Map<keyof Evenements, Gestionnaire<never>[]>();

export function surEvenement<K extends keyof Evenements>(nom: K, g: Gestionnaire<K>) {
  gestionnaires.set(nom, [...(gestionnaires.get(nom) ?? []), g as Gestionnaire<never>]);
}

export async function emettre<K extends keyof Evenements>(tx: Tx, ctx: Contexte | null, nom: K, donnees: Evenements[K]) {
  for (const g of gestionnaires.get(nom) ?? []) await (g as Gestionnaire<K>)(tx, ctx, donnees);
}
