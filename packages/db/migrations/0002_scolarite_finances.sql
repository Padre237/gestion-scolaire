-- 0002 · Scolarité, échéancier, versements, caisse
-- Chaîne inscription → échéancier → versement → imputation (analyse § 6.1,
-- conception § 6.2 et § 6.3). Les routes d'écriture arrivent aux lots 2 et 3 ;
-- le tableau de bord et l'écran Classes du lot 1 lisent déjà ces tables.

CREATE TABLE scolarite.famille (
  id               uuid PRIMARY KEY DEFAULT core.uuid_v7(),
  etablissement_id uuid NOT NULL REFERENCES structure.etablissement,
  nom              text NOT NULL,
  cree_le          timestamptz NOT NULL DEFAULT now(),
  cree_par         uuid,
  modifie_le       timestamptz NOT NULL DEFAULT now(),
  version          integer NOT NULL DEFAULT 1
);
ALTER TABLE core.compte ADD CONSTRAINT compte_famille_fk FOREIGN KEY (famille_id) REFERENCES scolarite.famille;
CREATE UNIQUE INDEX compte_une_famille ON core.compte (famille_id) WHERE famille_id IS NOT NULL;  -- RG-35

CREATE TABLE scolarite.eleve (
  id               uuid PRIMARY KEY DEFAULT core.uuid_v7(),
  etablissement_id uuid NOT NULL REFERENCES structure.etablissement,
  matricule        text NOT NULL,                                 -- RG-04 : ne change jamais
  nom              text NOT NULL,
  prenoms          text NOT NULL,
  sexe             text NOT NULL CHECK (sexe IN ('M', 'F')),
  date_naissance   date NOT NULL,
  lieu_naissance   text,
  photo            bytea,
  famille_id       uuid NOT NULL REFERENCES scolarite.famille,
  cree_le          timestamptz NOT NULL DEFAULT now(),
  cree_par         uuid,
  modifie_le       timestamptz NOT NULL DEFAULT now(),
  version          integer NOT NULL DEFAULT 1,
  UNIQUE (etablissement_id, matricule)
);
CREATE INDEX eleve_recherche ON scolarite.eleve USING gin (core.sans_accent(nom || ' ' || prenoms) gin_trgm_ops);

CREATE TABLE scolarite.responsable (
  id               uuid PRIMARY KEY DEFAULT core.uuid_v7(),
  etablissement_id uuid NOT NULL REFERENCES structure.etablissement,
  famille_id       uuid NOT NULL REFERENCES scolarite.famille,
  nom              text NOT NULL,
  telephone        text NOT NULL,                                 -- chiffres seuls
  langue           text NOT NULL DEFAULT 'fr' CHECK (langue IN ('fr', 'en')),
  cree_le          timestamptz NOT NULL DEFAULT now(),
  cree_par         uuid,
  modifie_le       timestamptz NOT NULL DEFAULT now(),
  version          integer NOT NULL DEFAULT 1
);
CREATE INDEX responsable_telephone ON scolarite.responsable (etablissement_id, telephone);

CREATE TABLE scolarite.eleve_responsable (
  eleve_id       uuid NOT NULL REFERENCES scolarite.eleve,
  responsable_id uuid NOT NULL REFERENCES scolarite.responsable,
  lien           text NOT NULL CHECK (lien IN ('mere', 'pere', 'tuteur')),
  payeur         boolean NOT NULL DEFAULT false,
  recoit_sms     boolean NOT NULL DEFAULT true,
  ordre          integer NOT NULL DEFAULT 1,
  PRIMARY KEY (eleve_id, responsable_id)
);
CREATE UNIQUE INDEX eleve_un_payeur ON scolarite.eleve_responsable (eleve_id) WHERE payeur;  -- RG-08

CREATE TABLE scolarite.inscription (
  id               uuid PRIMARY KEY DEFAULT core.uuid_v7(),
  etablissement_id uuid NOT NULL REFERENCES structure.etablissement,
  annee_id         uuid NOT NULL REFERENCES structure.annee_scolaire,
  eleve_id         uuid NOT NULL REFERENCES scolarite.eleve,
  classe_id        uuid NOT NULL REFERENCES structure.classe,
  type             text NOT NULL CHECK (type IN ('nouvelle', 'reinscription', 'redoublement')),
  tarif            text NOT NULL CHECK (tarif IN ('nouveau', 'ancien')),
  statut           text NOT NULL CHECK (statut IN ('attente', 'validee', 'sortie', 'cloturee', 'annulee')),
  inscrit_le       date NOT NULL DEFAULT current_date,
  cree_le          timestamptz NOT NULL DEFAULT now(),
  cree_par         uuid,
  modifie_le       timestamptz NOT NULL DEFAULT now(),
  version          integer NOT NULL DEFAULT 1
);
-- RG-05 : au plus une inscription active par élève et par année.
CREATE UNIQUE INDEX inscription_une_active ON scolarite.inscription (eleve_id, annee_id) WHERE statut IN ('attente', 'validee');

CREATE TABLE scolarite.mouvement (
  id               uuid PRIMARY KEY DEFAULT core.uuid_v7(),
  etablissement_id uuid NOT NULL REFERENCES structure.etablissement,
  annee_id         uuid NOT NULL REFERENCES structure.annee_scolaire,
  inscription_id   uuid NOT NULL REFERENCES scolarite.inscription,
  survenu_le       date NOT NULL,
  type             text NOT NULL CHECK (type IN ('changement_classe', 'depart')),
  classe_avant_id  uuid REFERENCES structure.classe,
  classe_apres_id  uuid REFERENCES structure.classe,
  motif            text,
  piece            text,                                          -- n° d'exeat
  cree_le          timestamptz NOT NULL DEFAULT now(),
  cree_par         uuid
);

-- ---------------------------------------------------------------- échéancier et versements

CREATE TABLE finances.ligne_echeance (
  id               uuid PRIMARY KEY DEFAULT core.uuid_v7(),
  etablissement_id uuid NOT NULL REFERENCES structure.etablissement,
  inscription_id   uuid NOT NULL REFERENCES scolarite.inscription,
  rubrique_id      uuid REFERENCES finances.rubrique,
  libelle_fr       text NOT NULL,
  libelle_en       text NOT NULL,
  ordre            integer NOT NULL,
  prix_unitaire    bigint NOT NULL CHECK (prix_unitaire >= 0),
  reduction        bigint NOT NULL DEFAULT 0,
  motif_reduction  text,
  date_limite      date NOT NULL,
  cree_le          timestamptz NOT NULL DEFAULT now(),
  cree_par         uuid,
  modifie_le       timestamptz NOT NULL DEFAULT now(),
  version          integer NOT NULL DEFAULT 1,
  CHECK (reduction BETWEEN 0 AND prix_unitaire),                  -- RG-11
  UNIQUE (inscription_id, ordre)
);

CREATE TABLE finances.versement (
  id               uuid PRIMARY KEY DEFAULT core.uuid_v7(),
  etablissement_id uuid NOT NULL REFERENCES structure.etablissement,
  annee_id         uuid NOT NULL REFERENCES structure.annee_scolaire,
  inscription_id   uuid NOT NULL REFERENCES scolarite.inscription,
  numero_recu      text NOT NULL,
  encaisse_le      timestamptz NOT NULL DEFAULT now(),
  montant          bigint NOT NULL CHECK (montant > 0),
  mode             text NOT NULL CHECK (mode IN ('especes', 'versement_bancaire', 'virement', 'cheque')),
  banque           text,
  bordereau        text,
  date_bordereau   date,
  statut           text NOT NULL DEFAULT 'valide' CHECK (statut IN ('valide', 'annulation_demandee', 'annule')),
  caissier_id      uuid NOT NULL REFERENCES core.compte,
  cle_idempotence  text NOT NULL,
  motif_annulation text,
  cree_le          timestamptz NOT NULL DEFAULT now(),
  cree_par         uuid,
  modifie_le       timestamptz NOT NULL DEFAULT now(),
  version          integer NOT NULL DEFAULT 1,
  UNIQUE (etablissement_id, annee_id, numero_recu),               -- RG-14
  UNIQUE (etablissement_id, cle_idempotence),
  CHECK (mode <> 'versement_bancaire' OR (banque IS NOT NULL AND bordereau IS NOT NULL AND date_bordereau IS NOT NULL))  -- RG-13
);
-- RG-13 : un bordereau n'est enregistré qu'une fois par banque.
CREATE UNIQUE INDEX versement_bordereau_unique ON finances.versement (etablissement_id, banque, bordereau)
  WHERE mode = 'versement_bancaire' AND statut <> 'annule';

CREATE TABLE finances.imputation (
  id                uuid PRIMARY KEY DEFAULT core.uuid_v7(),
  etablissement_id  uuid NOT NULL REFERENCES structure.etablissement,
  versement_id      uuid NOT NULL REFERENCES finances.versement,
  ligne_echeance_id uuid NOT NULL REFERENCES finances.ligne_echeance,
  montant           bigint NOT NULL CHECK (montant > 0)
);

-- RG-10, filet de sécurité derrière le code : le cumul des imputations
-- actives d'une ligne ne dépasse pas son montant à payer.
CREATE FUNCTION finances.fn_controle_imputation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  a_payer bigint;
  cumul   bigint;
BEGIN
  SELECT prix_unitaire - reduction INTO a_payer FROM finances.ligne_echeance WHERE id = NEW.ligne_echeance_id;
  SELECT COALESCE(sum(i.montant), 0) INTO cumul
    FROM finances.imputation i JOIN finances.versement v ON v.id = i.versement_id
   WHERE i.ligne_echeance_id = NEW.ligne_echeance_id AND v.statut <> 'annule';
  IF cumul > a_payer THEN
    RAISE EXCEPTION 'FIN_IMPUTATION_SUPERIEURE_AU_MONTANT' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER controle_imputation AFTER INSERT OR UPDATE ON finances.imputation
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION finances.fn_controle_imputation();

-- ---------------------------------------------------------------- caisse

CREATE TABLE caisse.session (
  id               uuid PRIMARY KEY DEFAULT core.uuid_v7(),
  etablissement_id uuid NOT NULL REFERENCES structure.etablissement,
  caisse           text NOT NULL DEFAULT 'principale' CHECK (caisse IN ('principale', 'ape')),
  caissier_id      uuid NOT NULL REFERENCES core.compte,
  ouverte_le       timestamptz NOT NULL DEFAULT now(),
  cloturee_le      timestamptz,
  fonds_initial    bigint NOT NULL CHECK (fonds_initial >= 0),
  montant_compte   bigint,
  ecart            bigint,
  motif_ecart      text,
  cree_le          timestamptz NOT NULL DEFAULT now(),
  cree_par         uuid,
  modifie_le       timestamptz NOT NULL DEFAULT now(),
  version          integer NOT NULL DEFAULT 1,
  CHECK (ecart IS NULL OR ecart = 0 OR motif_ecart IS NOT NULL)   -- RG-18
);
CREATE UNIQUE INDEX session_une_ouverte ON caisse.session (caissier_id) WHERE cloturee_le IS NULL;

CREATE TABLE caisse.mouvement (
  id               uuid PRIMARY KEY DEFAULT core.uuid_v7(),
  etablissement_id uuid NOT NULL REFERENCES structure.etablissement,
  session_id       uuid NOT NULL REFERENCES caisse.session,
  versement_id     uuid REFERENCES finances.versement,
  sens             text NOT NULL CHECK (sens IN ('entree', 'sortie')),
  nature           text NOT NULL CHECK (nature IN ('versement', 'entree_diverse', 'sortie', 'annulation', 'versement_banque')),
  libelle          text NOT NULL,
  mode             text NOT NULL DEFAULT 'especes',
  montant          bigint NOT NULL CHECK (montant > 0),
  horodatage       timestamptz NOT NULL DEFAULT now(),
  cree_par         uuid
);

SELECT core.surveiller(t) FROM unnest(ARRAY[
  'scolarite.famille', 'scolarite.eleve', 'scolarite.responsable', 'scolarite.inscription',
  'finances.ligne_echeance', 'finances.versement', 'caisse.session'
]::regclass[]) AS t;
SELECT core.surveiller(t, false) FROM unnest(ARRAY[
  'scolarite.eleve_responsable', 'scolarite.mouvement', 'finances.imputation', 'caisse.mouvement'
]::regclass[]) AS t;

-- ---------------------------------------------------------------- vues de reporting (§ 6.6)

CREATE VIEW reporting.v_inscription AS
SELECT i.id, i.etablissement_id, i.annee_id, a.libelle AS annee, i.eleve_id, e.matricule, e.nom, e.prenoms, e.sexe,
       e.date_naissance, i.classe_id, c.nom AS classe, n.code AS niveau, n.rang AS niveau_rang, cy.sous_systeme,
       i.type, i.tarif, i.statut, i.inscrit_le
  FROM scolarite.inscription i
  JOIN scolarite.eleve e ON e.id = i.eleve_id
  JOIN structure.classe c ON c.id = i.classe_id
  JOIN structure.niveau n ON n.id = c.niveau_id
  JOIN structure.cycle cy ON cy.id = n.cycle_id
  JOIN structure.annee_scolaire a ON a.id = i.annee_id;
COMMENT ON VIEW reporting.v_inscription IS 'Une ligne par inscription : élève, classe, niveau, sous-système, type, tarif et statut.';

CREATE VIEW reporting.v_echeance AS
SELECT l.id, l.etablissement_id, i.annee_id, l.inscription_id, i.classe_id, l.libelle_fr, l.ordre, l.prix_unitaire,
       l.reduction, l.prix_unitaire - l.reduction AS a_payer,
       COALESCE(v.verse, 0) AS verse,
       GREATEST(l.prix_unitaire - l.reduction - COALESCE(v.verse, 0), 0) AS reste,
       l.date_limite
  FROM finances.ligne_echeance l
  JOIN scolarite.inscription i ON i.id = l.inscription_id AND i.statut IN ('attente', 'validee')
  LEFT JOIN LATERAL (
    SELECT sum(im.montant) AS verse
      FROM finances.imputation im JOIN finances.versement ve ON ve.id = im.versement_id
     WHERE im.ligne_echeance_id = l.id AND ve.statut <> 'annule'
  ) v ON true;
COMMENT ON VIEW reporting.v_echeance IS 'Échéancier : montant à payer (prix − réduction), cumul versé, reste (RG-10) et date limite de chaque ligne.';

CREATE VIEW reporting.v_versement AS
SELECT v.id, v.etablissement_id, v.annee_id, v.numero_recu, v.encaisse_le, v.montant, v.mode, v.statut,
       i.eleve_id, e.nom, e.prenoms, c.nom AS classe, v.caissier_id
  FROM finances.versement v
  JOIN scolarite.inscription i ON i.id = v.inscription_id
  JOIN scolarite.eleve e ON e.id = i.eleve_id
  JOIN structure.classe c ON c.id = i.classe_id;
COMMENT ON VIEW reporting.v_versement IS 'Versements avec numéro de reçu, élève, classe, mode et statut.';

CREATE VIEW reporting.v_impaye AS
SELECT e.*, current_date - e.date_limite AS jours_retard
  FROM reporting.v_echeance e
 WHERE e.reste > 0 AND e.date_limite < current_date;
COMMENT ON VIEW reporting.v_impaye IS 'Lignes d''échéance dont la date limite est passée et le reste positif.';

CREATE VIEW reporting.v_journal_caisse AS
SELECT m.id, m.etablissement_id, s.caisse, s.caissier_id, m.session_id, m.horodatage, m.sens, m.nature, m.libelle,
       m.mode, m.montant
  FROM caisse.mouvement m JOIN caisse.session s ON s.id = m.session_id;
COMMENT ON VIEW reporting.v_journal_caisse IS 'Mouvements de caisse par session.';

CREATE VIEW reporting.v_eleve AS
SELECT e.id, e.etablissement_id, e.matricule, e.nom, e.prenoms, e.sexe, e.date_naissance, e.lieu_naissance, e.famille_id
  FROM scolarite.eleve e;
COMMENT ON VIEW reporting.v_eleve IS 'Élèves : identité, sans photo ni contact.';
