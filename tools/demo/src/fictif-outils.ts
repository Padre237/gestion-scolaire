// Outils de demo:donnees : hasard reproductible, dates à l'heure du Cameroun, types de l'école générée.
import type pg from 'pg';
import type { construireApp } from '@gs/api/src/app.ts';

type FastifyInstance = Awaited<ReturnType<typeof construireApp>>;
import type { Client } from './client.ts';

// ---------------------------------------------------------------- hasard reproductible (mêmes données à chaque lancement)
let graine = 20262027;
export function hasard() {
  graine = (graine + 0x6d2b79f5) | 0;
  let t = Math.imul(graine ^ (graine >>> 15), 1 | graine);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
export const entier = (a: number, b: number) => a + Math.floor(hasard() * (b - a + 1));
export const choisir = <T>(l: readonly T[]): T => l[Math.floor(hasard() * l.length)]!;
export function melanger<T>(l: T[]): T[] { const r = [...l]; for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(hasard() * (i + 1)); [r[i], r[j]] = [r[j]!, r[i]!]; } return r; }

// ---------------------------------------------------------------- dates, à l'heure du Cameroun (UTC+1)
export const jourCm = (d = new Date()) => new Date(d.getTime() + 3600_000).toISOString().slice(0, 10);
export const AUJ = jourCm();
export const aLHeure = (jour: string, hhmm: string) => new Date(`${jour}T${hhmm}:00+01:00`);
export const plusJours = (jour: string, n: number) => jourCm(new Date(new Date(`${jour}T12:00:00+01:00`).getTime() + n * 86400_000));
export const jourSemaine = (jour: string) => new Date(`${jour}T12:00:00+01:00`).getUTCDay();
/** L'école travaille du lundi au samedi (la maquette « Appel » est un samedi). */
export const ouvrable = (jour: string) => jourSemaine(jour) !== 0;
export const hhmm = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
export const fr = (jour: string) => jour.split('-').reverse().join('/');
export const jj = (n: number) => String(n).padStart(2, '0');

const [AA, MM] = AUJ.split('-').map(Number) as [number, number];
/** Année scolaire en cours : commence en septembre. */
export const DEBUT = MM >= 8 ? AA : AA - 1;
export const premierLundi = (debut: number) => { let j = `${debut}-09-01`; while (jourSemaine(j) !== 1) j = plusJours(j, 1); return j; };
export const dernierVendredi = (debut: number) => { let j = `${debut + 1}-06-30`; while (jourSemaine(j) !== 5) j = plusJours(j, -1); return j; };

/** Jours ouvrables entre deux dates (incluses), avant aujourd'hui. */
export function joursOuvrables(du: string, au: string): string[] {
  const r: string[] = [];
  for (let j = du; j <= au && j < AUJ; j = plusJours(j, 1)) if (ouvrable(j)) r.push(j);
  return r;
}
/** n-ième jour ouvrable avant aujourd'hui (1 = la veille ouvrable). */
export function ouvrableAvant(n: number): string {
  let j = AUJ, k = 0;
  while (k < n) { j = plusJours(j, -1); if (ouvrable(j)) k++; }
  return j;
}
/** Premier jour ouvrable à partir de la date donnée. */
export const ouvrableApres = (jour: string) => { let j = jour; while (!ouvrable(j)) j = plusJours(j, 1); return j; };
/** Un jour ouvrable au hasard entre deux dates (avant aujourd'hui), ou null. */
export const jourEntre = (du: string, au: string) => { const j = joursOuvrables(du, au); return j.length ? choisir(j) : null; };

// ---------------------------------------------------------------- horloge
/** Exécute une opération de l'API « à une date » ; le générateur rapide l'exécute simplement, puis redate en masse. */
export interface Horloge { a<T>(cible: Date, fn: () => Promise<T>): Promise<T> }

// ---------------------------------------------------------------- l'école fictive : types
export type Profil = 'solde' | 'bon' | 'moyen' | 'retard' | 'tardif' | 'attente' | 'fixe' | 'arriere';
export interface Famille { nom: string; telephone: string; payeur: string; lien: 'mere' | 'pere' | 'tuteur'; langue: 'fr' | 'en'; second?: { nom: string; telephone: string; lien: 'mere' | 'pere' } }
/** Situation d'un élève pendant une année scolaire. */
export interface Passage {
  classe: string;
  type: 'nouvelle' | 'reinscription' | 'redoublement';
  profil: Profil;
  /** Décision de fin d'année : admis, redouble, ou départ (transfert avant la clôture). Absent pour l'année en cours. */
  fin?: 'admis' | 'redouble' | 'depart' | 'exclu';
  inscriptionId?: string;
  lignes?: { id: string; ordre: number; aPayer: number }[];
}
export interface Eleve {
  nom: string; prenoms: string; sexe: 'M' | 'F'; famille: Famille; naissance: string; lieu: string;
  /** Première année scolaire dans l'école (début de l'année civile) ; avant la première année gérée, l'élève arrive par l'import. */
  entree: number;
  parcours: Record<number, Passage>;
  matricule?: string; eleveId?: string;
  reductions?: { ordre: number; montant: number; motif: string }[];
  /** Note de niveau (sur 20) autour de laquelle se répartissent ses notes. */
  niveauScolaire: number;
  inscritLe?: string; classeInitiale?: string;
}

export interface Periode { id: string; ordre: number; dateDebut: string; dateFin: string; sequences: { id: string; numero: number }[] }
export interface Annee {
  debut: number; libelle: string; rentree: string; fin: string; courante: boolean;
  id?: string; periodes: Periode[]; classes: Record<string, string>;
}

export interface Contexte {
  app: FastifyInstance;
  horloge: Horloge;
  proprio: pg.Client;
  sec: Client; dir: Client; eco: Client; pre: Client;
  comptes: Record<string, Client>;          // identifiant → client connecté
  niveaux: Record<string, string>;          // code → id
  personnel: Record<string, string>;        // identifiant (ou nom) → fiche
  matieres: Record<string, string>;         // libellé français → id
  annees: Annee[];
  eleves: Eleve[];
  parNom: (nom: string) => Eleve;
  clientDe: (nomPersonnel: string) => Client | undefined;
  parents: Record<string, Client>;          // téléphone (chiffres) → client famille
  arriveeVacataire: (a: Annee) => Promise<void>; // instituteurs de matière arrivés une année donnée
  petit: boolean;                           // --petit : effectifs réduits pour un essai rapide
}

/** Mots de passe de répétition : « demo- » suivi de la première partie de l'identifiant (demo-onana, demo-eyenga…). */
export const motDePasseDemo = (identifiant: string) => `demo-${identifiant.split('.')[0]}`;
