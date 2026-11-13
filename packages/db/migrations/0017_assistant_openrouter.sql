-- Assistant relié à un fournisseur compatible OpenRouter (D-48) : adresse, modèle et clé, réglés par le directeur.
-- Pas de déclencheur d'audit sur cette table : la clé ne doit jamais se retrouver dans le journal (une ligne « métier » trace chaque réglage).
CREATE TABLE assistant.reglage (
  etablissement_id uuid PRIMARY KEY REFERENCES structure.etablissement,
  adresse          text NOT NULL DEFAULT 'https://openrouter.ai/api/v1',
  modele           text NOT NULL DEFAULT 'anthropic/claude-sonnet-5.5',
  cle              text,
  actif            boolean NOT NULL DEFAULT false,
  modifie_le       timestamptz NOT NULL DEFAULT now(),
  version          integer NOT NULL DEFAULT 1
);
CREATE TRIGGER suivi BEFORE UPDATE ON assistant.reglage FOR EACH ROW EXECUTE FUNCTION core.fn_suivi();
COMMENT ON TABLE assistant.reglage IS 'Fournisseur de l''assistant ; la clé n''est jamais renvoyée à l''écran ni écrite au journal.';

-- Nouvelle permission « Régler l'assistant » : au directeur.
INSERT INTO core.permission (code, module, libelle_fr, libelle_en, ordre)
VALUES ('assistant.reglage.gerer', 'Assistant', 'Régler l''assistant (fournisseur, modèle, clé)', 'Configure the assistant', 999)
ON CONFLICT (code) DO NOTHING;
INSERT INTO core.role_permission (role_id, permission_code)
SELECT id, 'assistant.reglage.gerer' FROM core.role WHERE systeme AND code = 'directeur' ON CONFLICT DO NOTHING;
