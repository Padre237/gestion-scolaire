-- Cumul versé par ligne d'échéancier calculé en une passe (D-43) : la liste des élèves répondait en 3 à 4 secondes,
-- le cumul étant recalculé ligne par ligne pour chaque inscription. Mêmes colonnes, mêmes valeurs.
CREATE OR REPLACE VIEW reporting.v_echeance AS
SELECT l.id, l.etablissement_id, i.annee_id, l.inscription_id, i.classe_id, l.libelle_fr, l.ordre, l.prix_unitaire,
       l.reduction, l.prix_unitaire - l.reduction AS a_payer,
       COALESCE(v.verse, 0) AS verse,
       GREATEST(l.prix_unitaire - l.reduction - COALESCE(v.verse, 0), 0) AS reste,
       l.date_limite
  FROM finances.ligne_echeance l
  JOIN scolarite.inscription i ON i.id = l.inscription_id AND i.statut IN ('attente', 'validee')
  LEFT JOIN (
    SELECT im.ligne_echeance_id, sum(im.montant) AS verse
      FROM finances.imputation im JOIN finances.versement ve ON ve.id = im.versement_id
     WHERE ve.statut <> 'annule'
     GROUP BY im.ligne_echeance_id
  ) v ON v.ligne_echeance_id = l.id;
