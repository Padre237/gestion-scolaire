-- Préférences propres à chaque compte (D-41) : les cartes du tableau de bord, choisies par chaque utilisateur.
CREATE TABLE core.preference (
  compte_id        uuid NOT NULL REFERENCES core.compte,
  etablissement_id uuid NOT NULL REFERENCES structure.etablissement,
  cle              text NOT NULL CHECK (cle IN ('tableau_de_bord')),
  valeur           jsonb NOT NULL,
  modifie_le       timestamptz NOT NULL DEFAULT now(),
  version          integer NOT NULL DEFAULT 1,
  PRIMARY KEY (compte_id, cle)
);
CREATE TRIGGER suivi BEFORE UPDATE ON core.preference FOR EACH ROW EXECUTE FUNCTION core.fn_suivi();
COMMENT ON TABLE core.preference IS 'Réglages personnels d''un compte (cartes du tableau de bord) ; rien de métier.';
