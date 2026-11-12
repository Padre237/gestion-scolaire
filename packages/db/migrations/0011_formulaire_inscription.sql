-- Formulaire d'inscription configurable (D-42) : champs choisis par l'établissement, réponses de chaque élève, photos jointes.
CREATE TABLE scolarite.champ_inscription (
  id               uuid PRIMARY KEY DEFAULT core.uuid_v7(),
  etablissement_id uuid NOT NULL REFERENCES structure.etablissement,
  code             text NOT NULL,
  bloc             text NOT NULL CHECK (bloc IN ('identite', 'famille', 'scolarite', 'sante', 'vie', 'pieces')),
  libelle          text NOT NULL,
  type             text NOT NULL CHECK (type IN ('texte', 'choix_unique', 'choix_multiple', 'photo', 'date', 'nombre')),
  options          jsonb NOT NULL DEFAULT '[]'::jsonb,
  obligatoire      boolean NOT NULL DEFAULT false,
  actif            boolean NOT NULL DEFAULT true,
  supprime         boolean NOT NULL DEFAULT false,                -- retiré du formulaire ; les réponses déjà données restent
  ordre            integer NOT NULL DEFAULT 0,
  modele           text,                                          -- code de la question prête, null pour une question de l'école
  cree_le          timestamptz NOT NULL DEFAULT now(),
  cree_par         uuid,
  modifie_le       timestamptz NOT NULL DEFAULT now(),
  version          integer NOT NULL DEFAULT 1,
  UNIQUE (etablissement_id, code)
);
CREATE TRIGGER suivi BEFORE UPDATE ON scolarite.champ_inscription FOR EACH ROW EXECUTE FUNCTION core.fn_suivi();
CREATE TRIGGER audit AFTER INSERT OR DELETE OR UPDATE ON scolarite.champ_inscription FOR EACH ROW EXECUTE FUNCTION core.fn_audit();

-- Réponses aux champs du formulaire : { code: valeur } ; une photo y figure par l'identifiant de sa pièce.
ALTER TABLE scolarite.eleve ADD COLUMN renseignements jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE scolarite.piece_eleve (
  id               uuid PRIMARY KEY DEFAULT core.uuid_v7(),
  etablissement_id uuid NOT NULL REFERENCES structure.etablissement,
  eleve_id         uuid NOT NULL REFERENCES scolarite.eleve,
  champ_code       text NOT NULL,
  nom_fichier      text,
  type_mime        text NOT NULL CHECK (type_mime IN ('image/png', 'image/jpeg', 'image/webp')),
  taille           integer NOT NULL CHECK (taille > 0 AND taille <= 5242880),
  contenu          bytea NOT NULL,
  cree_le          timestamptz NOT NULL DEFAULT now(),
  cree_par         uuid
);
CREATE INDEX piece_eleve_eleve ON scolarite.piece_eleve (eleve_id);
COMMENT ON TABLE scolarite.piece_eleve IS 'Photos jointes au dossier d''un élève (acte de naissance, carnet de vaccination…), 5 Mo au plus.';
