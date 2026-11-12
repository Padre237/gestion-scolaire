// Outils de demo:fictif : hasard reproductible, dates à l'heure du Cameroun, horloge, types de l'école fictive.
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
export const minuteActuelle = () => Math.floor((Date.now() + 3600_000) / 60_000) % 1440;
export const jj = (n: number) => String(n).padStart(2, '0');

const [AA, MM] = AUJ.split('-').map(Number) as [number, number];
/** Année scolaire en cours : commence en septembre. */
export const DEBUT = MM >= 8 ? AA : AA - 1;
export const premierLundi = (debut: number) => { let j = `${debut}-09-01`; while (jourSemaine(j) !== 1) j = plusJours(j, 1); return j; };
export const dernierVendredi = (debut: number) => { let j = `${debut + 1}-06-30`; while (jourSemaine(j) !== 5) j = plusJours(j, -1); return j; };
export const RENTREE = premierLundi(DEBUT);
export const FIN = dernierVendredi(DEBUT);
export const ANNEE = `${DEBUT}/${DEBUT + 1}`;

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
/** Ramène une date au jour ouvrable le plus proche, sans dépasser la veille. */
export const ouvrableAuPlus = (jour: string) => {
  let j = jour >= AUJ ? plusJours(AUJ, -1) : jour;
  while (!ouvrable(j)) j = plusJours(j, -1);
  return j;
};
/** Premier jour ouvrable à partir de la date donnée. */
export const ouvrableApres = (jour: string) => { let j = jour; while (!ouvrable(j)) j = plusJours(j, 1); return j; };
/** Un jour ouvrable au hasard entre deux dates (avant aujourd'hui), ou null. */
export const jourEntre = (du: string, au: string) => { const j = joursOuvrables(du, au); return j.length ? choisir(j) : null; };

// ---------------------------------------------------------------- horloge : ramène une opération à sa date
const COLONNES_FIXES = ['date_limite', 'date_bordereau', 'date_debut', 'date_fin', 'date_naissance', 'jusqua', 'saisie_jusqua',
  'entree_le', 'mois', 'jour', 'fait_le', 'prevue_le', 'devoir_pour', 'depose_le', 'opere_le', 'survenu_le'];
const SCHEMAS = ['core', 'structure', 'scolarite', 'finances', 'caisse', 'pedagogie', 'vie_scolaire', 'communication', 'personnel', 'assistant'];

export class Horloge {
  private indexes: string[] = [];
  constructor(private db: pg.Client) {}

  async preparer() {
    // Les corrections de date ne passent pas par les déclencheurs d'audit : seules les dates bougent.
    await this.db.query('SET session_replication_role = replica');
    await this.db.query(`
      CREATE FUNCTION pg_temp.decaler(t0 timestamptz, cible timestamptz, jour date, marque uuid) RETURNS void LANGUAGE plpgsql AS $$
      DECLARE r record; delta interval := cible - t0;
      BEGIN
        FOR r IN
          SELECT c.table_schema AS s, c.table_name AS t, c.column_name AS col, c.data_type AS type,
                 EXISTS (SELECT 1 FROM information_schema.columns x WHERE x.table_schema = c.table_schema AND x.table_name = c.table_name
                           AND x.column_name = 'id' AND x.data_type = 'uuid') AS a_id
            FROM information_schema.columns c
            JOIN information_schema.tables tb ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name AND tb.table_type = 'BASE TABLE'
           WHERE c.table_schema = ANY('{${SCHEMAS.join(',')}}'::text[])
             AND c.data_type IN ('timestamp with time zone', 'date')
             AND NOT (c.table_schema = 'core' AND c.table_name = 'session')
             AND c.column_name <> ALL('{${COLONNES_FIXES.join(',')}}'::text[])
        LOOP
          IF r.type = 'date' THEN
            IF r.a_id THEN
              EXECUTE format('UPDATE %I.%I SET %I = $1 WHERE id > $2 AND %I = current_date', r.s, r.t, r.col, r.col) USING jour, marque;
            END IF;
          ELSE
            EXECUTE format('UPDATE %I.%I SET %I = %I + $1 WHERE %I >= $2', r.s, r.t, r.col, r.col, r.col) USING delta, t0;
          END IF;
        END LOOP;
      END $$`);
    // Index provisoires sur les colonnes datées : le décalage devient une lecture d'index au lieu d'un parcours des tables.
    const cols = await this.db.query<{ s: string; t: string; col: string }>(`
      SELECT c.table_schema AS s, c.table_name AS t, c.column_name AS col FROM information_schema.columns c
      JOIN information_schema.tables tb ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name AND tb.table_type = 'BASE TABLE'
      WHERE c.table_schema = ANY($1) AND c.data_type = 'timestamp with time zone' AND NOT (c.table_schema = 'core' AND c.table_name = 'session')
        AND c.column_name <> ALL($2)`, [SCHEMAS, COLONNES_FIXES]);
    for (const c of cols.rows) {
      const nom = `_hz_${c.t}_${c.col}`.slice(0, 60);
      await this.db.query(`CREATE INDEX IF NOT EXISTS ${nom} ON ${c.s}.${c.t} (${c.col})`);
      this.indexes.push(`${c.s}.${nom}`);
    }
  }

  async terminer() {
    for (const i of this.indexes) await this.db.query(`DROP INDEX IF EXISTS ${i}`);
    this.indexes = [];
  }

  /** Exécute l'opération puis la date du moment voulu (jamais dans le futur). */
  async a<T>(cible: Date, fn: () => Promise<T>): Promise<T> {
    const maintenant = Date.now() - 60_000;
    const quand = cible.getTime() > maintenant ? new Date(maintenant) : cible;
    const m = (await this.db.query<{ t0: string; id: string }>('SELECT clock_timestamp() AS t0, core.uuid_v7() AS id')).rows[0]!;
    await new Promise((r) => setTimeout(r, 2));
    const r = await fn();
    await this.db.query('SELECT pg_temp.decaler($1, $2, $3, $4)', [m.t0, quand.toISOString(), jourCm(quand), m.id]);
    return r;
  }
}

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
