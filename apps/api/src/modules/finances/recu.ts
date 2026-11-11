// Données du reçu bilingue (conception § 9.2) : un seul objet pour l'écran, le PDF et l'ESC/P.
import { sql, ligne, lignes, type Tx } from '../../core/bd.ts';
import { introuvable } from '../../core/erreurs.ts';
import { inscription } from '../scolarite/index.ts';
import { MODES } from './index.ts';
import { francsCfaEn, francsCfaFr } from './domain/montant-lettres.ts';
import { dateFr, type RecuData } from '@gs/print';

const heureCm = (iso: string) => new Date(new Date(iso).getTime() + 3600_000).toISOString().slice(11, 16);
const jourCm = (iso: string) => new Date(new Date(iso).getTime() + 3600_000).toISOString().slice(0, 10);

export async function donneesRecu(tx: Tx, etab: string, versementId: string): Promise<RecuData & { nbImpressions: number; inscriptionId: string; familleId: string; eleveId: string }> {
  const v = await ligne<{ inscription_id: string; numero_recu: string; encaisse_le: string; montant: number; mode: string; banque: string | null;
    bordereau: string | null; date_bordereau: string | null; statut: string; caissier: string }>(tx, sql`
    SELECT v.inscription_id, v.numero_recu, v.encaisse_le, v.montant, v.mode, v.banque, v.bordereau, v.date_bordereau, v.statut, c.nom_affiche AS caissier
      FROM finances.versement v JOIN core.compte c ON c.id = v.caissier_id WHERE v.id = ${versementId} AND v.etablissement_id = ${etab}`);
  if (!v) throw introuvable('Versement');
  const i = await inscription(tx, v.inscription_id, etab);
  const e = await ligne<{ nom_fr: string; nom_en: string; ville_bp: string | null; telephone: string | null; devise: string | null }>(tx, sql`
    SELECT nom_fr, nom_en, ville_bp, telephone, devise FROM structure.etablissement WHERE id = ${etab}`);
  const annee = await ligne<{ libelle: string }>(tx, sql`SELECT a.libelle FROM scolarite.inscription i JOIN structure.annee_scolaire a ON a.id = i.annee_id WHERE i.id = ${v.inscription_id}`);
  // État de l'échéancier juste après ce versement : imputations des versements antérieurs ou égaux (ordre des reçus).
  const l = await lignes<{ ordre: number; libelle_fr: string; libelle_en: string; prix_unitaire: number; reduction: number; verse: number; date_limite: string }>(tx, sql`
    SELECT l.ordre, l.libelle_fr, l.libelle_en, l.prix_unitaire, l.reduction, l.date_limite,
           COALESCE((SELECT sum(im.montant) FROM finances.imputation im JOIN finances.versement ve ON ve.id = im.versement_id
                      WHERE im.ligne_echeance_id = l.id AND ve.statut <> 'annule' AND ve.numero_recu <= ${v.numero_recu}), 0)::bigint AS verse
      FROM finances.ligne_echeance l WHERE l.inscription_id = ${v.inscription_id} ORDER BY l.ordre`);
  const impressions = await ligne<{ n: number }>(tx, sql`
    SELECT count(*)::int AS n FROM core.journal_audit WHERE ligne_id = ${versementId} AND nature = 'metier' AND objet_type = 'Reçu'`);
  const mode = MODES[v.mode]!;
  return {
    etablissement: { nom_fr: e!.nom_fr, nom_en: e!.nom_en, ville_bp: e!.ville_bp, telephone: e!.telephone, devise: e!.devise },
    numero: v.numero_recu, date: dateFr(jourCm(v.encaisse_le)), heure: heureCm(v.encaisse_le),
    eleve: `${i!.nom} ${i!.prenoms}`, matricule: i!.matricule, classe: i!.classe, annee: annee!.libelle,
    lignes: l.map((x) => {
      const aPayer = Number(x.prix_unitaire) - Number(x.reduction);
      return { libelleFr: x.libelle_fr, libelleEn: x.libelle_en, prix: Number(x.prix_unitaire), reduction: Number(x.reduction), aPayer,
        verse: Number(x.verse), reste: Math.max(aPayer - Number(x.verse), 0), dateLimite: dateFr(x.date_limite) };
    }),
    montant: Number(v.montant), montantLettresFr: francsCfaFr(Number(v.montant)), montantLettresEn: francsCfaEn(Number(v.montant)),
    modeFr: mode.fr.toLowerCase(), modeEn: mode.en.toLowerCase(),
    bordereau: v.bordereau ? `${v.bordereau}${v.date_bordereau ? ` du ${dateFr(v.date_bordereau)}` : ''}` : null,
    caissier: v.caissier, duplicata: impressions!.n > 0, annule: v.statut === 'annule',
    nbImpressions: impressions!.n, inscriptionId: v.inscription_id, familleId: i!.famille_id, eleveId: i!.eleve_id,
  };
}

