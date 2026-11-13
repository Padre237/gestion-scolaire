// API publique du module structure : seul point d'entrée pour les autres modules (ADR-01).
import { sql, type Bd, type Tx, ligne } from '../../core/bd.ts';
import { ErreurMetier } from '../../core/erreurs.ts';
import { exigerPostePrincipal } from '../../core/http/synchro.ts';

export interface AnneeOuverte { id: string; libelle: string; date_debut: string; date_fin: string; annee_civile: number }

export async function anneeOuverte(bd: Bd, etab: string): Promise<AnneeOuverte | undefined> {
  return bd.lireUn<AnneeOuverte>(sql`
    SELECT id, libelle, date_debut, date_fin, extract(year FROM date_debut)::int AS annee_civile
      FROM structure.annee_scolaire WHERE etablissement_id = ${etab} AND statut = 'ouverte'`);
}

export async function anneeOuverteTx(tx: Tx, etab: string): Promise<AnneeOuverte> {
  const a = await ligne<AnneeOuverte>(tx, sql`
    SELECT id, libelle, date_debut, date_fin, extract(year FROM date_debut)::int AS annee_civile
      FROM structure.annee_scolaire WHERE etablissement_id = ${etab} AND statut = 'ouverte'`);
  if (!a) throw new ErreurMetier('STR_AUCUNE_ANNEE_OUVERTE', 422, 'Aucune année scolaire n\'est ouverte.');
  return a;
}

export async function exigerAnneeOuverte(bd: Bd, etab: string): Promise<AnneeOuverte> {
  const a = await anneeOuverte(bd, etab);
  if (!a) throw new ErreurMetier('STR_AUCUNE_ANNEE_OUVERTE', 422, 'Aucune année scolaire n\'est ouverte.');
  return a;
}

// ------------------------------------------------------------- numérotation sans trou (§ 6.4, ADR-08)

const pad = (n: number, l: number) => String(n).padStart(l, '0');

export const FORMATS = {
  recu: (annee: number, n: number) => `R${annee}-${pad(n, 6)}`,
  avis: (annee: number, n: number) => `A${annee}-${pad(n, 6)}`,
  exeat: (annee: number, n: number) => `E${annee}-${pad(n, 4)}`,
  sortie: (annee: number, n: number) => `S${annee}-${pad(n, 4)}`,
  // RG-04 : année d'entrée sur 2 chiffres, code de section, ordre sur 4 chiffres.
  matricule: (annee: number, section: string, n: number) => `${String(annee).slice(-2)}${section}${pad(n, 4)}`,
};

export const cleCompteur = {
  recu: (annee: number) => `recu:${annee}`,
  avis: (annee: number) => `avis:${annee}`,
  exeat: (annee: number) => `exeat:${annee}`,
  sortie: (annee: number) => `sortie:${annee}`,
  matricule: (annee: number, section: string) => `matricule:${annee}:${section}`,
};

/** Incrémente le compteur dans la transaction courante, sous verrou de ligne. */
export async function prochainNumero(tx: Tx, etab: string, cle: string): Promise<number> {
  // Application hybride (D-49) : la numérotation sans trou n'est tenue qu'au poste de l'école.
  exigerPostePrincipal();
  const r = await ligne<{ n: number }>(tx, sql`SELECT core.prochain_numero(${etab}, ${cle})::int AS n`);
  return r!.n;
}

/** Valeur qui sera attribuée au prochain appel, sans la consommer (écran Établissement). */
export async function numeroSuivant(bd: Bd, etab: string, cle: string): Promise<number> {
  const r = await bd.lireUn<{ valeur: number }>(sql`SELECT valeur FROM core.compteur WHERE etablissement_id = ${etab} AND cle = ${cle}`);
  return (r?.valeur ?? 0) + 1;
}

export interface ClasseInfo {
  id: string; nom: string; effectif_max: number; niveau_id: string; niveau_code: string; niveau_rang: number;
  cycle_id: string; sous_systeme: 'francophone' | 'anglophone'; ordre_enseignement: string; code_section: string; annee_id: string;
}

export async function classeInfo(bdOuTx: Bd | Tx, id: string, etab: string): Promise<ClasseInfo | undefined> {
  const requete = sql`
    SELECT c.id, c.nom, c.effectif_max, c.niveau_id, n.code AS niveau_code, n.rang AS niveau_rang, n.cycle_id,
           cy.sous_systeme, cy.ordre_enseignement, cy.code_section, c.annee_id
      FROM structure.classe c JOIN structure.niveau n ON n.id = c.niveau_id JOIN structure.cycle cy ON cy.id = n.cycle_id
     WHERE c.id = ${id} AND c.etablissement_id = ${etab}`;
  if (bdOuTx instanceof Object && 'lireUn' in bdOuTx) return (bdOuTx as Bd).lireUn<ClasseInfo>(requete);
  return ligne<ClasseInfo>(bdOuTx as Tx, requete);
}

// ---------------------------------------------------------------- modèles d'impression (D-44)
export type Gabarit = 'classique' | 'bandeau' | 'epure';
export interface HabillageImpression { gabarit: Gabarit; logo: Buffer | null; adresse: string | null }
/** Modèle choisi pour un document, logo et adresse publique de la page « Vérifier ». */
export async function habillageImpression(bd: Bd, etab: string, document: 'fiche' | 'carte' | 'bulletin'): Promise<HabillageImpression> {
  const e = await bd.lireUn<{ gabarits: Record<string, string> | null; logo: Buffer | null; adresse_verification: string | null }>(sql`
    SELECT gabarits, logo, adresse_verification FROM structure.etablissement WHERE id = ${etab}`);
  const g = e?.gabarits?.[document];
  return { gabarit: g === 'bandeau' || g === 'epure' ? g : 'classique', logo: e?.logo ?? null, adresse: e?.adresse_verification ?? null };
}
/** Adresse de la page « Vérifier » imprimée dans les QR codes : celle réglée par l'établissement, sinon celle du poste qui imprime. */
export const baseVerification = (adresse: string | null, req: { protocol: string; headers: { host?: string } }) =>
  adresse?.trim().replace(/\/+$/, '') || `${req.protocol}://${req.headers.host ?? 'localhost'}`;
