-- Une absence par élève et par fiche d'appel : l'unicité portait sur la fiche seule, si bien que deux élèves absents
-- au même cours n'avaient qu'une ligne (le second écrasait la durée du premier).
ALTER TABLE vie_scolaire.absence DROP CONSTRAINT absence_fiche_id_key;
ALTER TABLE vie_scolaire.absence ADD CONSTRAINT absence_fiche_eleve UNIQUE (fiche_id, inscription_id);
