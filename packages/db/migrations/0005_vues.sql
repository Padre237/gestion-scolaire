-- 0005 · Abréviation anglaise des matières ; vues de reporting de la vie scolaire et des finances par élève.
ALTER TABLE pedagogie.matiere ADD COLUMN abrege_en text;

CREATE VIEW reporting.v_absence AS
SELECT a.id, a.etablissement_id, a.inscription_id, i.classe_id, a.jour, a.debut, a.duree_minutes, a.statut, a.motif,
       a.demande_parent, f.personnel_id, f.libelle
  FROM vie_scolaire.absence a JOIN scolarite.inscription i ON i.id = a.inscription_id
  LEFT JOIN vie_scolaire.fiche_appel f ON f.id = a.fiche_id;
COMMENT ON VIEW reporting.v_absence IS 'Absences par créneau : durée, statut (justifiée ou non), motif, instituteur du créneau.';

CREATE VIEW reporting.v_observation AS
SELECT o.id, o.etablissement_id, o.inscription_id, i.classe_id, o.type, o.description, o.sanction, o.matiere_id, o.survenu_le,
       o.auteur, c.nom_affiche AS auteur_nom, c.personnel_id AS auteur_personnel_id
  FROM vie_scolaire.observation o JOIN scolarite.inscription i ON i.id = o.inscription_id JOIN core.compte c ON c.id = o.auteur;
COMMENT ON VIEW reporting.v_observation IS 'Observations et sanctions, avec leur auteur.';

-- Solde par inscription : base des situations « À jour », « En retard », « Soldé ».
CREATE VIEW reporting.v_solde AS
SELECT i.id AS inscription_id, i.etablissement_id, i.annee_id, i.classe_id, i.eleve_id,
       COALESCE(sum(e.a_payer), 0)::bigint AS a_payer, COALESCE(sum(e.verse), 0)::bigint AS verse, COALESCE(sum(e.reste), 0)::bigint AS reste,
       COALESCE(sum(e.reste) FILTER (WHERE e.date_limite < current_date), 0)::bigint AS echu
  FROM scolarite.inscription i LEFT JOIN reporting.v_echeance e ON e.inscription_id = i.id
 WHERE i.statut IN ('attente', 'validee')
 GROUP BY i.id;
COMMENT ON VIEW reporting.v_solde IS 'Par inscription active : montant à payer, versé, reste et reste échu.';
