-- Utilisateurs et rôles réservés au directeur (D-46) : droits sur mesure, attributions pour une période définie ou non.

-- Période d'un rôle sur mesure, et d'un rôle attribué à un compte (dates incluses ; vide : sans limite).
ALTER TABLE core.role ADD COLUMN du date, ADD COLUMN au date, ADD CONSTRAINT role_periode CHECK (du IS NULL OR au IS NULL OR au >= du);
ALTER TABLE core.compte_role ADD COLUMN du date, ADD COLUMN au date, ADD CONSTRAINT compte_role_periode CHECK (du IS NULL OR au IS NULL OR au >= du);

-- Attribution particulière : une permission donnée à un compte, en plus de ses rôles, pour une période définie ou non.
CREATE TABLE core.compte_permission (
  id               uuid PRIMARY KEY DEFAULT core.uuid_v7(),
  etablissement_id uuid NOT NULL REFERENCES structure.etablissement,
  compte_id        uuid NOT NULL REFERENCES core.compte,
  permission_code  text NOT NULL REFERENCES core.permission,
  du               date,
  au               date,
  motif            text,
  cree_le          timestamptz NOT NULL DEFAULT now(),
  cree_par         uuid,
  UNIQUE (compte_id, permission_code),
  CHECK (du IS NULL OR au IS NULL OR au >= du)
);
CREATE TRIGGER audit AFTER INSERT OR DELETE OR UPDATE ON core.compte_permission FOR EACH ROW EXECUTE FUNCTION core.fn_audit();

-- Le directeur gère les comptes et les rôles ; la secrétaire ne garde que la réinitialisation (comptes famille seulement).
DELETE FROM core.role_permission rp USING core.role r
 WHERE rp.role_id = r.id AND r.systeme AND r.code = 'secretaire'
   AND rp.permission_code IN ('core.compte.consulter', 'core.compte.gerer', 'core.compte.desactiver', 'core.role.gerer');
INSERT INTO core.role_permission (role_id, permission_code)
SELECT r.id, p FROM core.role r CROSS JOIN unnest(ARRAY['core.compte.consulter', 'core.compte.gerer', 'core.compte.reinitialiser',
       'core.compte.desactiver', 'core.role.gerer']) AS p
 WHERE r.systeme AND r.code = 'directeur'
ON CONFLICT DO NOTHING;
