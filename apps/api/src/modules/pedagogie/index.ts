// API publique du module pédagogie (ADR-01) et fournisseur du périmètre des instituteurs (RG-34, ADR-11).
import { sql, ligne, lignes, type Bd, type Tx } from '../../core/bd.ts';
import { enregistrerFournisseurPerimetre, type PerimetreEnseignant } from '../../core/perimetre.ts';
import { REGLES_PAR_DEFAUT, type Regles } from './domain/calcul.ts';

/** « EPS » reste en capitales ; « Anglais » devient « anglais » dans une phrase. */
export const enPhrase = (s: string) => (s === s.toUpperCase() ? s : s.charAt(0).toLowerCase() + s.slice(1));

export async function perimetre(bd: Bd, etab: string, personnelId: string): Promise<PerimetreEnseignant> {
  const principal = await bd.lire<{ id: string; nom: string; exceptions: { fr: string; en: string }[] }>(sql`
    SELECT c.id, c.nom,
           COALESCE((SELECT json_agg(json_build_object('fr', COALESCE(m.abrege_fr, m.libelle_fr), 'en', COALESCE(m.abrege_en, m.libelle_en))
                                     ORDER BY pn.ordre_bulletin)
                       FROM pedagogie.affectation x JOIN pedagogie.matiere m ON m.id = x.matiere_id
                       LEFT JOIN pedagogie.programme_niveau pn ON pn.matiere_id = m.id AND pn.niveau_id = c.niveau_id AND pn.annee_id = c.annee_id
                      WHERE x.classe_id = c.id AND NOT x.principal), '[]') AS exceptions
      FROM pedagogie.affectation a
      JOIN structure.classe c ON c.id = a.classe_id
      JOIN structure.annee_scolaire an ON an.id = a.annee_id AND an.statut = 'ouverte'
      JOIN structure.niveau n ON n.id = c.niveau_id
     WHERE a.etablissement_id = ${etab} AND a.personnel_id = ${personnelId} AND a.principal
     ORDER BY n.rang, c.nom`);
  const matieres = await bd.lire<PerimetreEnseignant['matieres'][number]>(sql`
    SELECT c.id AS "classeId", c.nom AS "classeNom", m.id AS "matiereId", m.libelle_fr AS "matiereLibelle",
           COALESCE(m.abrege_fr, m.libelle_fr) AS "matiereAbrege"
      FROM pedagogie.affectation a
      JOIN structure.classe c ON c.id = a.classe_id
      JOIN structure.niveau n ON n.id = c.niveau_id
      JOIN pedagogie.matiere m ON m.id = a.matiere_id
      JOIN structure.annee_scolaire an ON an.id = a.annee_id AND an.statut = 'ouverte'
     WHERE a.etablissement_id = ${etab} AND a.personnel_id = ${personnelId} AND NOT a.principal
     ORDER BY n.rang, c.nom`);
  return {
    classesPrincipal: principal.map((p) => ({ ...p, exceptions: p.exceptions.map((e) => ({ fr: enPhrase(e.fr), en: enPhrase(e.en) })) })),
    matieres: matieres.map((m) => ({ ...m, matiereLibelle: m.matiereAbrege })),
  };
}

enregistrerFournisseurPerimetre(perimetre);

export interface Titulaire { personnelId: string | null; nom: string | null; principal: boolean }

/** RG-34 : l'exception d'une matière prime ; sinon le principal de la classe porte la matière. */
export async function titulaire(tx: Tx, classeId: string, matiereId: string): Promise<Titulaire> {
  const exception = await ligne<{ personnel_id: string; nom: string }>(tx, sql`
    SELECT a.personnel_id, p.nom_affiche AS nom FROM pedagogie.affectation a JOIN personnel.fiche p ON p.id = a.personnel_id
     WHERE a.classe_id = ${classeId} AND a.matiere_id = ${matiereId} AND NOT a.principal`);
  if (exception) return { personnelId: exception.personnel_id, nom: exception.nom, principal: false };
  const principal = await ligne<{ personnel_id: string; nom: string }>(tx, sql`
    SELECT a.personnel_id, p.nom_affiche AS nom FROM pedagogie.affectation a JOIN personnel.fiche p ON p.id = a.personnel_id
     WHERE a.classe_id = ${classeId} AND a.principal`);
  return { personnelId: principal?.personnel_id ?? null, nom: principal?.nom ?? null, principal: true };
}

/** Titulaire de chaque matière du programme de la classe. */
export async function titulairesClasse(tx: Tx, classeId: string) {
  return lignes<{ matiere_id: string; libelle_fr: string; libelle_en: string; abrege: string; coefficient: number; bareme: number;
    ordre: number; personnel_id: string | null; nom: string | null; principal: boolean; groupe: string | null }>(tx, sql`
    SELECT m.id AS matiere_id, m.libelle_fr, m.libelle_en, COALESCE(m.abrege_fr, m.libelle_fr) AS abrege, pn.coefficient, pn.bareme,
           pn.ordre_bulletin AS ordre, g.libelle_fr AS groupe,
           COALESCE(ex.personnel_id, pr.personnel_id) AS personnel_id, COALESCE(pex.nom_affiche, ppr.nom_affiche) AS nom,
           ex.id IS NULL AS principal
      FROM structure.classe c
      JOIN pedagogie.programme_niveau pn ON pn.niveau_id = c.niveau_id AND pn.annee_id = c.annee_id
      JOIN pedagogie.matiere m ON m.id = pn.matiere_id
      LEFT JOIN pedagogie.groupe_matiere g ON g.id = m.groupe_id
      LEFT JOIN pedagogie.affectation ex ON ex.classe_id = c.id AND ex.matiere_id = m.id AND NOT ex.principal
      LEFT JOIN personnel.fiche pex ON pex.id = ex.personnel_id
      LEFT JOIN pedagogie.affectation pr ON pr.classe_id = c.id AND pr.principal
      LEFT JOIN personnel.fiche ppr ON ppr.id = pr.personnel_id
     WHERE c.id = ${classeId}
     ORDER BY pn.ordre_bulletin`);
}

export async function reglesDe(tx: Tx, anneeId: string, cycleId: string | null): Promise<Regles> {
  const r = await ligne<{ parametres: Partial<Regles> }>(tx, sql`
    SELECT parametres FROM pedagogie.regle_evaluation
     WHERE annee_id = ${anneeId} AND (cycle_id = ${cycleId} OR cycle_id IS NULL)
     ORDER BY (cycle_id IS NULL), version DESC LIMIT 1`);
  return { ...REGLES_PAR_DEFAUT, ...(r?.parametres ?? {}) };
}
