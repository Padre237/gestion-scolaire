-- 0001 · Socle, structure, personnel, paramétrage pédagogique, grille des frais
-- Conventions (conception § 6.1) : schéma par module, tables au singulier en
-- snake_case, clé uuid v7, etablissement_id sur toute table métier, colonnes de
-- suivi, montants en bigint (RG-20), valeurs fermées en text + CHECK.

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

CREATE SCHEMA core;
CREATE SCHEMA structure;
CREATE SCHEMA scolarite;
CREATE SCHEMA finances;
CREATE SCHEMA caisse;
CREATE SCHEMA pedagogie;
CREATE SCHEMA vie_scolaire;
CREATE SCHEMA personnel;
CREATE SCHEMA communication;
CREATE SCHEMA reporting;

-- ---------------------------------------------------------------- utilitaires

-- UUID version 7 : 48 bits d'horodatage en millisecondes, puis aléa.
CREATE FUNCTION core.uuid_v7() RETURNS uuid LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  b bytea := uuid_send(gen_random_uuid());
  ms bigint := floor(extract(epoch FROM clock_timestamp()) * 1000);
BEGIN
  b := overlay(b PLACING substring(int8send(ms) FROM 3) FROM 1 FOR 6);
  b := set_byte(b, 6, (get_byte(b, 6) & 15) | 112);
  RETURN encode(b, 'hex')::uuid;
END $$;

-- unaccent immuable, pour l'index trigramme de recherche (conception § 6.3).
CREATE FUNCTION core.sans_accent(text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  AS $$ SELECT lower(public.unaccent('public.unaccent'::regdictionary, $1)) $$;

-- Colonnes de suivi : modifie_le et version (verrouillage optimiste).
CREATE FUNCTION core.fn_suivi() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.modifie_le := now();
  NEW.version := OLD.version + 1;
  RETURN NEW;
END $$;

-- ---------------------------------------------------------------- journal d'audit (§ 6.5)

CREATE TABLE core.journal_audit (
  id               uuid PRIMARY KEY DEFAULT core.uuid_v7(),
  horodatage       timestamptz NOT NULL DEFAULT clock_timestamp(),
  etablissement_id uuid,
  utilisateur_id   uuid,
  nature           text NOT NULL CHECK (nature IN ('technique', 'metier')),
  table_nom        text,
  ligne_id         uuid,
  action           text NOT NULL,
  avant            jsonb,
  apres            jsonb,
  -- Lignes « métier » : ce qu'affiche l'écran Journal d'audit.
  objet_type       text,
  objet_libelle    text,
  avant_libelle    text,
  apres_libelle    text
);
CREATE INDEX journal_audit_etab_date ON core.journal_audit (etablissement_id, horodatage DESC);
CREATE INDEX journal_audit_metier ON core.journal_audit (etablissement_id, horodatage DESC) WHERE nature = 'metier';

CREATE FUNCTION core.fn_audit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  ligne jsonb := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
BEGIN
  INSERT INTO core.journal_audit (etablissement_id, utilisateur_id, nature, table_nom, ligne_id, action, avant, apres)
  VALUES (
    COALESCE((ligne ->> 'etablissement_id')::uuid, CASE WHEN TG_TABLE_NAME = 'etablissement' THEN (ligne ->> 'id')::uuid END),
    NULLIF(current_setting('app.utilisateur_id', true), '')::uuid,
    'technique',
    TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME,
    (ligne ->> 'id')::uuid,
    TG_OP,
    -- L'empreinte du mot de passe ne va jamais au journal.
    CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) - 'mot_de_passe' END,
    CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) - 'mot_de_passe' END
  );
  RETURN NULL;
END $$;

-- Pose les déclencheurs d'audit et de suivi sur une table.
CREATE FUNCTION core.surveiller(t regclass, suivi boolean DEFAULT true) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON %s FOR EACH ROW EXECUTE FUNCTION core.fn_audit()', t);
  IF suivi THEN
    EXECUTE format('CREATE TRIGGER suivi BEFORE UPDATE ON %s FOR EACH ROW EXECUTE FUNCTION core.fn_suivi()', t);
  END IF;
END $$;

-- ---------------------------------------------------------------- structure

CREATE TABLE structure.etablissement (
  id               uuid PRIMARY KEY DEFAULT core.uuid_v7(),
  nom_fr           text NOT NULL,
  nom_en           text NOT NULL,
  devise           text,
  ville_bp         text,
  telephone        text,
  logo             bytea,
  cachet           bytea,
  signature        bytea,
  signataire       text,
  banque           text,
  numero_compte    text,
  seuil_reduction  bigint CHECK (seuil_reduction >= 0),          -- RG-11
  cree_le          timestamptz NOT NULL DEFAULT now(),
  cree_par         uuid,
  modifie_le       timestamptz NOT NULL DEFAULT now(),
  version          integer NOT NULL DEFAULT 1
);

CREATE TABLE structure.annee_scolaire (
  id               uuid PRIMARY KEY DEFAULT core.uuid_v7(),
  etablissement_id uuid NOT NULL REFERENCES structure.etablissement,
  libelle          text NOT NULL,
  date_debut       date NOT NULL,
  date_fin         date NOT NULL CHECK (date_fin > date_debut),
  statut           text NOT NULL DEFAULT 'preparation' CHECK (statut IN ('preparation', 'ouverte', 'cloturee')),
  cree_le          timestamptz NOT NULL DEFAULT now(),
  cree_par         uuid,
  modifie_le       timestamptz NOT NULL DEFAULT now(),
  version          integer NOT NULL DEFAULT 1,
  UNIQUE (etablissement_id, libelle)
);
-- RG-01 : au plus une année ouverte par établissement.
CREATE UNIQUE INDEX annee_une_ouverte ON structure.annee_scolaire (etablissement_id) WHERE statut = 'ouverte';

CREATE TABLE structure.periode (
  id               uuid PRIMARY KEY DEFAULT core.uuid_v7(),
  etablissement_id uuid NOT NULL REFERENCES structure.etablissement,
  annee_id         uuid NOT NULL REFERENCES structure.annee_scolaire,
  ordre            integer NOT NULL,
  type             text NOT NULL DEFAULT 'trimestre' CHECK (type IN ('trimestre', 'semestre')),
  libelle_fr       text NOT NULL,
  libelle_en       text NOT NULL,
  date_debut       date NOT NULL,
  date_fin         date NOT NULL,
  sequences        text,
  tranche_ordre    integer,                                       -- RG-40, SOC-04
  statut           text NOT NULL DEFAULT 'planifiee' CHECK (statut IN ('planifiee', 'ouverte', 'fermee', 'publiee')),
  saisie_jusqua    date,
  cree_le          timestamptz NOT NULL DEFAULT now(),
  cree_par         uuid,
  modifie_le       timestamptz NOT NULL DEFAULT now(),
  version          integer NOT NULL DEFAULT 1,
  UNIQUE (annee_id, ordre)
);

CREATE TABLE structure.cycle (
  id                 uuid PRIMARY KEY DEFAULT core.uuid_v7(),
  etablissement_id   uuid NOT NULL REFERENCES structure.etablissement,
  sous_systeme       text NOT NULL CHECK (sous_systeme IN ('francophone', 'anglophone')),
  ordre_enseignement text NOT NULL CHECK (ordre_enseignement IN ('maternelle', 'primaire', 'secondaire')),
  libelle            text NOT NULL,
  code_section       text NOT NULL,                               -- RG-04 : FR, ANG…
  ordre              integer NOT NULL DEFAULT 0,
  cree_le            timestamptz NOT NULL DEFAULT now(),
  cree_par           uuid,
  modifie_le         timestamptz NOT NULL DEFAULT now(),
  version            integer NOT NULL DEFAULT 1,
  UNIQUE (etablissement_id, sous_systeme, ordre_enseignement)
);

CREATE TABLE structure.niveau (
  id               uuid PRIMARY KEY DEFAULT core.uuid_v7(),
  etablissement_id uuid NOT NULL REFERENCES structure.etablissement,
  cycle_id         uuid NOT NULL REFERENCES structure.cycle,
  code             text NOT NULL,
  libelle          text NOT NULL,
  rang             integer NOT NULL,
  cree_le          timestamptz NOT NULL DEFAULT now(),
  cree_par         uuid,
  modifie_le       timestamptz NOT NULL DEFAULT now(),
  version          integer NOT NULL DEFAULT 1,
  UNIQUE (etablissement_id, code)
);

CREATE TABLE structure.classe (
  id               uuid PRIMARY KEY DEFAULT core.uuid_v7(),
  etablissement_id uuid NOT NULL REFERENCES structure.etablissement,
  annee_id         uuid NOT NULL REFERENCES structure.annee_scolaire,
  niveau_id        uuid NOT NULL REFERENCES structure.niveau,
  nom              text NOT NULL,
  effectif_max     integer NOT NULL CHECK (effectif_max > 0),     -- RG-06
  cree_le          timestamptz NOT NULL DEFAULT now(),
  cree_par         uuid,
  modifie_le       timestamptz NOT NULL DEFAULT now(),
  version          integer NOT NULL DEFAULT 1,
  UNIQUE (annee_id, nom)
);

-- ---------------------------------------------------------------- personnel

CREATE TABLE personnel.fiche (
  id               uuid PRIMARY KEY DEFAULT core.uuid_v7(),
  etablissement_id uuid NOT NULL REFERENCES structure.etablissement,
  nom_affiche      text NOT NULL,                                 -- « M. ONANA Bertrand »
  fonction         text NOT NULL CHECK (fonction IN ('directeur', 'secretaire', 'econome', 'prefet',
                                                     'instituteur_principal', 'instituteur_matiere', 'autre')),
  statut           text NOT NULL DEFAULT 'permanent' CHECK (statut IN ('permanent', 'vacataire')),
  telephone        text,
  diplome          text,
  entree_le        date,
  actif            boolean NOT NULL DEFAULT true,
  cree_le          timestamptz NOT NULL DEFAULT now(),
  cree_par         uuid,
  modifie_le       timestamptz NOT NULL DEFAULT now(),
  version          integer NOT NULL DEFAULT 1
);

-- ---------------------------------------------------------------- comptes, rôles, permissions (§ 8, ADR-12)

CREATE TABLE core.permission (
  code       text PRIMARY KEY,                                    -- module.ressource.action
  module     text NOT NULL,
  libelle_fr text NOT NULL,
  libelle_en text NOT NULL,
  ordre      integer NOT NULL
);

CREATE TABLE core.role (
  id               uuid PRIMARY KEY DEFAULT core.uuid_v7(),
  etablissement_id uuid NOT NULL REFERENCES structure.etablissement,
  code             text NOT NULL,
  libelle_fr       text NOT NULL,
  libelle_en       text NOT NULL,
  systeme          boolean NOT NULL DEFAULT false,                -- les sept rôles prêts à l'emploi
  perimetre_type   text NOT NULL CHECK (perimetre_type IN ('etablissement', 'affectations', 'famille')),
  cree_depuis      uuid REFERENCES core.role,
  ordre            integer NOT NULL DEFAULT 100,
  cree_le          timestamptz NOT NULL DEFAULT now(),
  cree_par         uuid,
  modifie_le       timestamptz NOT NULL DEFAULT now(),
  version          integer NOT NULL DEFAULT 1,
  UNIQUE (etablissement_id, code)
);

CREATE TABLE core.role_permission (
  role_id         uuid NOT NULL REFERENCES core.role ON DELETE CASCADE,
  permission_code text NOT NULL REFERENCES core.permission,
  PRIMARY KEY (role_id, permission_code)
);

CREATE TABLE core.compte (
  id                uuid PRIMARY KEY DEFAULT core.uuid_v7(),
  etablissement_id  uuid NOT NULL REFERENCES structure.etablissement,
  identifiant       text NOT NULL,
  nom_affiche       text NOT NULL,
  mot_de_passe      text NOT NULL,                                -- scrypt$N$r$p$sel$empreinte (ADR-05)
  type              text NOT NULL CHECK (type IN ('personnel', 'famille')),
  personnel_id      uuid REFERENCES personnel.fiche,
  famille_id        uuid,
  actif             boolean NOT NULL DEFAULT true,
  echecs            integer NOT NULL DEFAULT 0,
  verrouille_jusqua timestamptz,
  derniere_activite timestamptz,
  cree_le           timestamptz NOT NULL DEFAULT now(),
  cree_par          uuid,
  modifie_le        timestamptz NOT NULL DEFAULT now(),
  version           integer NOT NULL DEFAULT 1,
  UNIQUE (etablissement_id, identifiant)
);

CREATE TABLE core.compte_role (
  id               uuid PRIMARY KEY DEFAULT core.uuid_v7(),
  etablissement_id uuid NOT NULL REFERENCES structure.etablissement,
  compte_id        uuid NOT NULL REFERENCES core.compte,
  role_id          uuid NOT NULL REFERENCES core.role,
  cycle_id         uuid REFERENCES structure.cycle,               -- périmètre « cycle » éventuel
  UNIQUE (compte_id, role_id)
);

CREATE TABLE core.session (
  id                uuid PRIMARY KEY DEFAULT core.uuid_v7(),
  compte_id         uuid NOT NULL REFERENCES core.compte,
  empreinte         bytea NOT NULL UNIQUE,                        -- SHA-256 du jeton ; le jeton n'est pas stocké
  cree_le           timestamptz NOT NULL DEFAULT now(),
  derniere_activite timestamptz NOT NULL DEFAULT now(),
  expire_max        timestamptz NOT NULL,
  appareil          text,
  revoquee_le       timestamptz
);

-- Numérotation sans trou (§ 6.4, ADR-08).
CREATE TABLE core.compteur (
  etablissement_id uuid NOT NULL REFERENCES structure.etablissement,
  cle              text NOT NULL,
  valeur           bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (etablissement_id, cle)
);

CREATE FUNCTION core.prochain_numero(etab uuid, cle_compteur text) RETURNS bigint LANGUAGE sql AS $$
  INSERT INTO core.compteur (etablissement_id, cle, valeur) VALUES (etab, cle_compteur, 1)
  ON CONFLICT (etablissement_id, cle) DO UPDATE SET valeur = core.compteur.valeur + 1
  RETURNING valeur
$$;

-- ---------------------------------------------------------------- pédagogie : paramétrage

CREATE TABLE pedagogie.groupe_matiere (
  id               uuid PRIMARY KEY DEFAULT core.uuid_v7(),
  etablissement_id uuid NOT NULL REFERENCES structure.etablissement,
  libelle_fr       text NOT NULL,
  libelle_en       text NOT NULL,
  ordre            integer NOT NULL DEFAULT 0,
  cree_le          timestamptz NOT NULL DEFAULT now(),
  cree_par         uuid,
  modifie_le       timestamptz NOT NULL DEFAULT now(),
  version          integer NOT NULL DEFAULT 1
);

CREATE TABLE pedagogie.matiere (
  id               uuid PRIMARY KEY DEFAULT core.uuid_v7(),
  etablissement_id uuid NOT NULL REFERENCES structure.etablissement,
  code             text NOT NULL,
  libelle_fr       text NOT NULL,
  libelle_en       text NOT NULL,
  abrege_fr        text,                                          -- « Maths », « Histoire-géo. »
  groupe_id        uuid REFERENCES pedagogie.groupe_matiere,
  cree_le          timestamptz NOT NULL DEFAULT now(),
  cree_par         uuid,
  modifie_le       timestamptz NOT NULL DEFAULT now(),
  version          integer NOT NULL DEFAULT 1,
  UNIQUE (etablissement_id, code)
);

-- Paramétrage du niveau pour une année (mode d'évaluation, filière).
CREATE TABLE pedagogie.niveau_annee (
  id               uuid PRIMARY KEY DEFAULT core.uuid_v7(),
  etablissement_id uuid NOT NULL REFERENCES structure.etablissement,
  annee_id         uuid NOT NULL REFERENCES structure.annee_scolaire,
  niveau_id        uuid NOT NULL REFERENCES structure.niveau,
  mode_evaluation  text NOT NULL DEFAULT 'notes_sur_20' CHECK (mode_evaluation IN ('notes_sur_20', 'competences')),
  filiere          text,
  cree_le          timestamptz NOT NULL DEFAULT now(),
  cree_par         uuid,
  modifie_le       timestamptz NOT NULL DEFAULT now(),
  version          integer NOT NULL DEFAULT 1,
  UNIQUE (annee_id, niveau_id)
);

-- RG-02 : coefficients et barèmes rattachés à l'année.
CREATE TABLE pedagogie.programme_niveau (
  id               uuid PRIMARY KEY DEFAULT core.uuid_v7(),
  etablissement_id uuid NOT NULL REFERENCES structure.etablissement,
  annee_id         uuid NOT NULL REFERENCES structure.annee_scolaire,
  niveau_id        uuid NOT NULL REFERENCES structure.niveau,
  matiere_id       uuid NOT NULL REFERENCES pedagogie.matiere,
  coefficient      numeric(5, 2) NOT NULL CHECK (coefficient > 0),
  bareme           integer NOT NULL DEFAULT 20 CHECK (bareme > 0),
  ordre_bulletin   integer NOT NULL,
  cree_le          timestamptz NOT NULL DEFAULT now(),
  cree_par         uuid,
  modifie_le       timestamptz NOT NULL DEFAULT now(),
  version          integer NOT NULL DEFAULT 1,
  UNIQUE (annee_id, niveau_id, matiere_id)
);

-- RG-34, ADR-11 : seuls le principal et les exceptions sont enregistrés.
CREATE TABLE pedagogie.affectation (
  id               uuid PRIMARY KEY DEFAULT core.uuid_v7(),
  etablissement_id uuid NOT NULL REFERENCES structure.etablissement,
  annee_id         uuid NOT NULL REFERENCES structure.annee_scolaire,
  classe_id        uuid NOT NULL REFERENCES structure.classe,
  matiere_id       uuid REFERENCES pedagogie.matiere,
  personnel_id     uuid NOT NULL REFERENCES personnel.fiche,
  principal        boolean NOT NULL,
  cree_le          timestamptz NOT NULL DEFAULT now(),
  cree_par         uuid,
  modifie_le       timestamptz NOT NULL DEFAULT now(),
  version          integer NOT NULL DEFAULT 1,
  CHECK (principal = (matiere_id IS NULL))
);
CREATE UNIQUE INDEX affectation_un_principal ON pedagogie.affectation (classe_id) WHERE principal;
CREATE UNIQUE INDEX affectation_une_exception ON pedagogie.affectation (classe_id, matiere_id) WHERE NOT principal;

-- ---------------------------------------------------------------- finances : grille des frais (CU-10)

CREATE TABLE finances.rubrique (
  id               uuid PRIMARY KEY DEFAULT core.uuid_v7(),
  etablissement_id uuid NOT NULL REFERENCES structure.etablissement,
  code             text NOT NULL,
  libelle_fr       text NOT NULL,
  libelle_en       text NOT NULL,
  obligatoire      boolean NOT NULL,
  precision_fr     text,                                          -- « 3 tranches », « caisse APE »
  caisse           text NOT NULL DEFAULT 'principale' CHECK (caisse IN ('principale', 'ape')),
  ordre            integer NOT NULL,
  cree_le          timestamptz NOT NULL DEFAULT now(),
  cree_par         uuid,
  modifie_le       timestamptz NOT NULL DEFAULT now(),
  version          integer NOT NULL DEFAULT 1,
  UNIQUE (etablissement_id, code)
);

CREATE TABLE finances.grille_frais (
  id               uuid PRIMARY KEY DEFAULT core.uuid_v7(),
  etablissement_id uuid NOT NULL REFERENCES structure.etablissement,
  annee_id         uuid NOT NULL REFERENCES structure.annee_scolaire,
  niveau_id        uuid NOT NULL REFERENCES structure.niveau,
  statut_eleve     text NOT NULL CHECK (statut_eleve IN ('nouveau', 'ancien')),
  cree_le          timestamptz NOT NULL DEFAULT now(),
  cree_par         uuid,
  modifie_le       timestamptz NOT NULL DEFAULT now(),
  version          integer NOT NULL DEFAULT 1,
  UNIQUE (annee_id, niveau_id, statut_eleve)
);

CREATE TABLE finances.ligne_grille (
  id               uuid PRIMARY KEY DEFAULT core.uuid_v7(),
  etablissement_id uuid NOT NULL REFERENCES structure.etablissement,
  grille_id        uuid NOT NULL REFERENCES finances.grille_frais ON DELETE CASCADE,
  rubrique_id      uuid NOT NULL REFERENCES finances.rubrique,
  libelle_fr       text NOT NULL,
  libelle_en       text NOT NULL,
  ordre            integer NOT NULL,
  montant          bigint NOT NULL CHECK (montant >= 0),
  date_limite      date NOT NULL,
  cree_le          timestamptz NOT NULL DEFAULT now(),
  cree_par         uuid,
  modifie_le       timestamptz NOT NULL DEFAULT now(),
  version          integer NOT NULL DEFAULT 1,
  UNIQUE (grille_id, ordre)
);

-- ---------------------------------------------------------------- surveillance

SELECT core.surveiller(t) FROM unnest(ARRAY[
  'structure.etablissement', 'structure.annee_scolaire', 'structure.periode', 'structure.cycle',
  'structure.niveau', 'structure.classe', 'personnel.fiche', 'core.role', 'core.compte',
  'pedagogie.groupe_matiere', 'pedagogie.matiere', 'pedagogie.niveau_annee', 'pedagogie.programme_niveau',
  'pedagogie.affectation', 'finances.rubrique', 'finances.grille_frais', 'finances.ligne_grille'
]::regclass[]) AS t;
SELECT core.surveiller(t, false) FROM unnest(ARRAY['core.role_permission', 'core.compte_role']::regclass[]) AS t;
