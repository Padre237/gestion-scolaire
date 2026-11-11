// Outils de demo:fictif : hasard reproductible, dates à l'heure du Cameroun, horloge, structure de l'école fictive.
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

const [AA, MM] = AUJ.split('-').map(Number) as [number, number];
export const DEBUT = MM >= 8 ? AA : AA - 1;
export const RENTREE = (() => { let j = `${DEBUT}-09-01`; while (jourSemaine(j) !== 1) j = plusJours(j, 1); return j; })();
export const FIN = (() => { let j = `${DEBUT + 1}-06-30`; while (jourSemaine(j) !== 5) j = plusJours(j, -1); return j; })();
export const ANNEE = `${DEBUT}/${DEBUT + 1}`;
export const DATES_GRILLE = [RENTREE, `${DEBUT}-09-30`, `${DEBUT}-11-30`, `${DEBUT + 1}-01-31`];

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

// ---------------------------------------------------------------- horloge : ramène une opération à sa date
export class Horloge {
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
           WHERE c.table_schema IN ('core', 'structure', 'scolarite', 'finances', 'caisse', 'pedagogie', 'vie_scolaire', 'communication', 'personnel', 'assistant')
             AND c.data_type IN ('timestamp with time zone', 'date')
             AND NOT (c.table_schema = 'core' AND c.table_name = 'session')
             AND c.column_name NOT IN ('date_limite', 'date_bordereau', 'date_debut', 'date_fin', 'date_naissance', 'jusqua', 'saisie_jusqua',
                                       'entree_le', 'mois', 'jour', 'fait_le', 'prevue_le', 'devoir_pour', 'depose_le', 'opere_le')
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
  }

  /** Exécute l'opération puis la date du moment voulu (jamais dans le futur). */
  async a<T>(cible: Date, fn: () => Promise<T>): Promise<T> {
    const maintenant = Date.now() - 60_000;
    const quand = cible.getTime() > maintenant ? new Date(maintenant) : cible;
    const m = (await this.db.query<{ t0: string; id: string }>('SELECT clock_timestamp() AS t0, core.uuid_v7() AS id')).rows[0]!;
    await new Promise((r) => setTimeout(r, 3));
    const r = await fn();
    await this.db.query('SELECT pg_temp.decaler($1, $2, $3, $4)', [m.t0, quand.toISOString(), jourCm(quand), m.id]);
    return r;
  }
}

// ---------------------------------------------------------------- l'école fictive
export const CLASSES: { nom: string; niveau: string; n: number; principal: [string, string, string] }[] = [
  { nom: 'SIL A', niveau: 'SIL', n: 11, principal: ['nana.o', 'Mme NANA Odile', '600 000 214'] },
  { nom: 'CP A', niveau: 'CP', n: 12, principal: ['belinga.a', 'Mme BELINGA Agnès', '600 000 215'] },
  { nom: 'CE1 A', niveau: 'CE1', n: 12, principal: ['mvogo.d', 'M. MVOGO Daniel', '600 000 216'] },
  { nom: 'CE2 A', niveau: 'CE2', n: 13, principal: ['ngono.c', 'Mme NGONO Chantal', '600 000 217'] },
  { nom: 'CE2 B', niveau: 'CE2', n: 13, principal: ['eyenga.s', 'Mme EYENGA Solange', '600 000 212'] },
  { nom: 'CM1 A', niveau: 'CM1', n: 12, principal: ['kamga.h', 'M. KAMGA Hervé', '600 000 218'] },
  { nom: 'CM2 A', niveau: 'CM2', n: 12, principal: ['onana.b', 'M. ONANA Bertrand', '600 000 211'] },
  { nom: 'Class 1', niveau: 'Class 1', n: 12, principal: ['nfor.g', 'Mrs NFOR Gladys', '600 000 231'] },
  { nom: 'Class 2', niveau: 'Class 2', n: 12, principal: ['awah.d', 'Mr AWAH Divine', '600 000 232'] },
  { nom: 'Class 3', niveau: 'Class 3', n: 13, principal: ['bih.m', 'Mrs BIH Mercy', '600 000 233'] },
  { nom: 'Class 4', niveau: 'Class 4', n: 12, principal: ['che.e', 'Mr CHE Emmanuel', '600 000 234'] },
  { nom: 'Class 5', niveau: 'Class 5', n: 13, principal: ['ebai.f', 'Mrs EBAI Florence', '600 000 235'] },
  { nom: 'Class 6', niveau: 'Class 6', n: 12, principal: ['tanyi.p', 'Mr TANYI Peter', '600 000 213'] },
];

export type Profil = 'solde' | 'bon' | 'moyen' | 'retard' | 'tardif' | 'attente' | 'fixe';
export interface Famille { nom: string; telephone: string; payeur: string; lien: 'mere' | 'pere' | 'tuteur'; langue: 'fr' | 'en'; second?: { nom: string; telephone: string; lien: 'mere' | 'pere' } }
export interface Eleve {
  nom: string; prenoms: string; sexe: 'M' | 'F'; classe: string; niveau: string; famille: Famille;
  type: 'nouvelle' | 'reinscription' | 'redoublement'; profil: Profil; naissance: string; lieu: string;
  matricule?: string; inscritLe: string; classeInitiale?: string;
  inscriptionId?: string; eleveId?: string; lignes?: { id: string; ordre: number; aPayer: number }[];
  reductions?: { ordre: number; montant: number; motif: string }[];
  /** Note de niveau (sur 20) autour de laquelle se répartissent ses notes. */
  niveauScolaire: number;
}

export interface Contexte {
  app: FastifyInstance;
  horloge: Horloge;
  proprio: pg.Client;
  sec: Client; dir: Client; eco: Client; pre: Client;
  comptes: Record<string, Client>;          // identifiant → client connecté
  classes: Record<string, string>;          // nom → id
  niveaux: Record<string, string>;          // code → id
  personnel: Record<string, string>;        // identifiant (ou nom) → fiche
  matieres: Record<string, string>;         // libellé français → id
  periodes: { id: string; ordre: number; dateDebut: string; dateFin: string }[];
  eleves: Eleve[];
  parNom: (nom: string) => Eleve;
  clientDe: (nomPersonnel: string) => Client | undefined;
  parents: Record<string, Client>;          // téléphone (chiffres) → client famille
}

/** Mots de passe de répétition : « demo- » suivi de la première partie de l'identifiant (demo-onana, demo-eyenga…). */
export const motDePasseDemo = (identifiant: string) => `demo-${identifiant.split('.')[0]}`;
