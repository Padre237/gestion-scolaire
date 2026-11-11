-- 0003 · Pédagogie, emploi du temps, vie scolaire, communication, demandes,
-- dépenses, relevé bancaire, assistant (analyse § 6.2 et § 6.4 ; conception § 9).

-- ---------------------------------------------------------------- personnel

CREATE TABLE personnel.vacation (
  id                uuid PRIMARY KEY DEFAULT core.uuid_v7(),
  etablissement_id  uuid NOT NULL REFERENCES structure.etablissement,
  personnel_id      uuid NOT NULL REFERENCES personnel.fiche,
  mois              date NOT NULL,                      -- premier jour du mois
  heures_prevues    numeric(6, 2) NOT NULL DEFAULT 0,
  heures_effectuees numeric(6, 2) NOT NULL DEFAULT 0,
  UNIQUE (personnel_id, mois)
);

-- ---------------------------------------------------------------- pédagogie : séquences, évaluations, notes

CREATE TABLE pedagogie.regle_evaluation (
  id               uuid PRIMARY KEY DEFAULT core.uuid_v7(),
  etablissement_id uuid NOT NULL REFERENCES structure.etablissement,
  annee_id         uuid NOT NULL REFERENCES structure.annee_scolaire,
  cycle_id         uuid REFERENCES structure.cycle,
  version          integer NOT NULL DEFAULT 1,
  parametres       jsonb NOT NULL,                     -- conception § 9.3
  cree_le          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (annee_id, cycle_id, version)
);

-- Fenêtre de saisie ouverte par le préfet, par séquence (CU-19, cycle de vie 7.4).
CREATE TABLE pedagogie.sequence (
  id               uuid PRIMARY KEY DEFAULT core.uuid_v7(),
  etablissement_id uuid NOT NULL REFERENCES structure.etablissement,
  annee_id         uuid NOT NULL REFERENCES structure.annee_scolaire,
  periode_id       uuid NOT NULL REFERENCES structure.periode,
  numero           integer NOT NULL,                   -- 1 à 6 ; 0 pour la composition de la période
  libelle_fr       text NOT NULL,                      -- « Séquence 2 », « Composition du 1er trimestre »
  type             text NOT NULL DEFAULT 'devoir' CHECK (type IN ('devoir', 'composition')),
  prevue_le        date,
  statut           text NOT NULL DEFAULT 'planifiee' CHECK (statut IN ('planifiee', 'ouverte', 'fermee')),
  saisie_jusqua    date,
  cree_le          timestamptz NOT NULL DEFAULT now(),
  cree_par         uuid,
  modifie_le       timestamptz NOT NULL DEFAULT now(),
  version          integer NOT NULL DEFAULT 1,
  UNIQUE (periode_id, numero, type)
);

CREATE TABLE pedagogie.evaluation (
  id               uuid PRIMARY KEY DEFAULT core.uuid_v7(),
  etablissement_id uuid NOT NULL REFERENCES structure.etablissement,
  sequence_id      uuid NOT NULL REFERENCES pedagogie.sequence,
  classe_id        uuid NOT NULL REFERENCES structure.classe,
  matiere_id       uuid NOT NULL REFERENCES pedagogie.matiere,
  fait_le          date NOT NULL,
  bareme           integer NOT NULL DEFAULT 20 CHECK (bareme > 0),
  cree_le          timestamptz NOT NULL DEFAULT now(),
  cree_par         uuid,
  modifie_le       timestamptz NOT NULL DEFAULT now(),
  version          integer NOT NULL DEFAULT 1,
  UNIQUE (sequence_id, classe_id, matiere_id)
);

CREATE TABLE pedagogie.note (
  id               uuid PRIMARY KEY DEFAULT core.uuid_v7(),
  etablissement_id uuid NOT NULL REFERENCES structure.etablissement,
  evaluation_id    uuid NOT NULL REFERENCES pedagogie.evaluation,
  inscription_id   uuid NOT NULL REFERENCES scolarite.inscription,
  valeur           numeric(5, 2) CHECK (valeur >= 0),
  statut           text NOT NULL DEFAULT 'present' CHECK (statut IN ('present', 'absent', 'absent_justifie', 'dispense')),
  remarque         text,
  saisie_par       uuid NOT NULL REFERENCES core.compte,  -- RG-22 : seul l'auteur modifie
  cree_le          timestamptz NOT NULL DEFAULT now(),
  modifie_le       timestamptz NOT NULL DEFAULT now(),
  version          integer NOT NULL DEFAULT 1,
  UNIQUE (evaluation_id, inscription_id),
  CHECK (statut = 'present' OR valeur IS NULL)
);

-- Appréciation d'une matière par l'instituteur qui l'enseigne, pour une période.
CREATE TABLE pedagogie.appreciation (
  id               uuid PRIMARY KEY DEFAULT core.uuid_v7(),
  etablissement_id uuid NOT NULL REFERENCES structure.etablissement,
  periode_id       uuid NOT NULL REFERENCES structure.periode,
  inscription_id   uuid NOT NULL REFERENCES scolarite.inscription,
  matiere_id       uuid REFERENCES pedagogie.matiere,     -- NULL : appréciation générale du principal
  texte            text NOT NULL,
  auteur           uuid NOT NULL REFERENCES core.compte,
  modifie_le       timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (periode_id, inscription_id, matiere_id)
);

CREATE TABLE pedagogie.signalement (
  id               uuid PRIMARY KEY DEFAULT core.uuid_v7(),
  etablissement_id uuid NOT NULL REFERENCES structure.etablissement,
  classe_id        uuid NOT NULL REFERENCES structure.classe,
  periode_id       uuid NOT NULL REFERENCES structure.periode,
  matiere_id       uuid NOT NULL REFERENCES pedagogie.matiere,
  texte            text NOT NULL,
  auteur           uuid NOT NULL REFERENCES core.compte,
  statut           text NOT NULL DEFAULT 'ouvert' CHECK (statut IN ('ouvert', 'traite')),
  cree_le          timestamptz NOT NULL DEFAULT now()
);

-- Circuit de la fusion (RG-36) : saisie → fusion → validation du préfet → publication.
CREATE TABLE pedagogie.fusion (
  id               uuid PRIMARY KEY DEFAULT core.uuid_v7(),
  etablissement_id uuid NOT NULL REFERENCES structure.etablissement,
  classe_id        uuid NOT NULL REFERENCES structure.classe,
  periode_id       uuid NOT NULL REFERENCES structure.periode,
  statut           text NOT NULL CHECK (statut IN ('calculee', 'transmise', 'validee', 'publiee')),
  calculee_le      timestamptz,
  transmise_le     timestamptz,
  transmise_par    uuid REFERENCES core.compte,
  validee_le       timestamptz,
  validee_par      uuid REFERENCES core.compte,
  modifie_le       timestamptz NOT NULL DEFAULT now(),
  version          integer NOT NULL DEFAULT 1,
  UNIQUE (classe_id, periode_id)
);

-- RG-27 : un bulletin publié est figé ; une correction crée une nouvelle version.
CREATE TABLE pedagogie.bulletin (
  id                    uuid PRIMARY KEY DEFAULT core.uuid_v7(),
  etablissement_id      uuid NOT NULL REFERENCES structure.etablissement,
  inscription_id        uuid NOT NULL REFERENCES scolarite.inscription,
  periode_id            uuid REFERENCES structure.periode,   -- NULL : bulletin annuel
  version               integer NOT NULL DEFAULT 1,
  statut                text NOT NULL DEFAULT 'brouillon' CHECK (statut IN ('brouillon', 'publie', 'remplace')),
  resultats             jsonb NOT NULL,
  moyenne               numeric(5, 2),
  rang                  integer,
  effectif              integer,
  appreciation_generale text,
  publie_le             timestamptz,
  publie_par            uuid REFERENCES core.compte,
  empreinte_pdf         text,
  cree_le               timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (inscription_id, periode_id, version)
);
CREATE UNIQUE INDEX bulletin_un_courant ON pedagogie.bulletin (inscription_id, COALESCE(periode_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE statut <> 'remplace';

-- RG-40 : levée du blocage par le directeur, tracée.
CREATE TABLE pedagogie.levee_blocage (
  id               uuid PRIMARY KEY DEFAULT core.uuid_v7(),
  etablissement_id uuid NOT NULL REFERENCES structure.etablissement,
  inscription_id   uuid NOT NULL REFERENCES scolarite.inscription,
  periode_id       uuid REFERENCES structure.periode,
  motif            text,
  leve_par         uuid NOT NULL REFERENCES core.compte,
  leve_le          timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (inscription_id, periode_id)
);

-- Conseil de classe : distinctions et décisions de fin d'année.
CREATE TABLE pedagogie.decision_conseil (
  id               uuid PRIMARY KEY DEFAULT core.uuid_v7(),
  etablissement_id uuid NOT NULL REFERENCES structure.etablissement,
  inscription_id   uuid NOT NULL REFERENCES scolarite.inscription,
  periode_id       uuid NOT NULL REFERENCES structure.periode,
  distinction      text CHECK (distinction IN ('tableau_honneur', 'encouragements', 'aucune', 'avertissement_travail')),
  fin_annee        text CHECK (fin_annee IN ('admis', 'redouble', 'exclu')),
  modifie_par      uuid REFERENCES core.compte,
  modifie_le       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (inscription_id, periode_id)
);

CREATE TABLE pedagogie.proces_verbal (
  id               uuid PRIMARY KEY DEFAULT core.uuid_v7(),
  etablissement_id uuid NOT NULL REFERENCES structure.etablissement,
  classe_id        uuid NOT NULL REFERENCES structure.classe,
  periode_id       uuid NOT NULL REFERENCES structure.periode,
  contenu          text NOT NULL DEFAULT '',
  modifie_par      uuid REFERENCES core.compte,
  modifie_le       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (classe_id, periode_id)
);

-- ---------------------------------------------------------------- emploi du temps (RG-37, RG-38)

CREATE TABLE pedagogie.creneau (
  id               uuid PRIMARY KEY DEFAULT core.uuid_v7(),
  etablissement_id uuid NOT NULL REFERENCES structure.etablissement,
  annee_id         uuid NOT NULL REFERENCES structure.annee_scolaire,
  debut            time NOT NULL,
  fin              time NOT NULL CHECK (fin > debut),
  type             text NOT NULL DEFAULT 'cours' CHECK (type IN ('cours', 'recreation', 'pause')),
  jours            integer[] NOT NULL DEFAULT '{1,2,3,4,5,6}',   -- 1 = lundi … 6 = samedi
  UNIQUE (annee_id, debut)
);

CREATE TABLE pedagogie.cours (
  id               uuid PRIMARY KEY DEFAULT core.uuid_v7(),
  etablissement_id uuid NOT NULL REFERENCES structure.etablissement,
  classe_id        uuid NOT NULL REFERENCES structure.classe,
  creneau_id       uuid NOT NULL REFERENCES pedagogie.creneau,
  jour             integer NOT NULL CHECK (jour BETWEEN 1 AND 6),
  matiere_id       uuid REFERENCES pedagogie.matiere,
  libelle          text,                                -- « Révisions » quand le cours n'a pas de matière
  personnel_id     uuid REFERENCES personnel.fiche,
  duree_creneaux   integer NOT NULL DEFAULT 1,
  cree_par         uuid,
  modifie_le       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (classe_id, creneau_id, jour),
  CHECK (matiere_id IS NOT NULL OR libelle IS NOT NULL)
);

CREATE TABLE pedagogie.emploi_du_temps (
  id               uuid PRIMARY KEY DEFAULT core.uuid_v7(),
  etablissement_id uuid NOT NULL REFERENCES structure.etablissement,
  classe_id        uuid NOT NULL REFERENCES structure.classe UNIQUE,
  statut           text NOT NULL DEFAULT 'brouillon' CHECK (statut IN ('brouillon', 'soumis', 'publie')),
  place_le         timestamptz,
  place_par        uuid REFERENCES core.compte,
  publie_le        timestamptz,
  publie_par       uuid REFERENCES core.compte,
  renvoi_motif     text,
  modifie_le       timestamptz NOT NULL DEFAULT now()
);

-- Cahier de textes : séance du jour et devoir à faire.
CREATE TABLE pedagogie.seance (
  id               uuid PRIMARY KEY DEFAULT core.uuid_v7(),
  etablissement_id uuid NOT NULL REFERENCES structure.etablissement,
  classe_id        uuid NOT NULL REFERENCES structure.classe,
  fait_le          date NOT NULL,
  heure            time NOT NULL,
  matiere_id       uuid REFERENCES pedagogie.matiere,
  libelle          text NOT NULL,
  contenu          text NOT NULL,
  devoir           text,
  devoir_pour      date,
  auteur           uuid NOT NULL REFERENCES core.compte,
  cree_le          timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- vie scolaire (RG-38, RG-39)

CREATE TABLE vie_scolaire.fiche_appel (
  id               uuid PRIMARY KEY DEFAULT core.uuid_v7(),
  etablissement_id uuid NOT NULL REFERENCES structure.etablissement,
  classe_id        uuid NOT NULL REFERENCES structure.classe,
  jour             date NOT NULL,
  debut            time NOT NULL,
  fin              time NOT NULL,
  libelle          text NOT NULL,
  personnel_id     uuid REFERENCES personnel.fiche,
  cours_commun     text,                                -- « cours commun avec CE2 A »
  statut           text NOT NULL DEFAULT 'a_faire' CHECK (statut IN ('a_faire', 'faite')),
  faite_le         timestamptz,
  faite_par        uuid REFERENCES core.compte,
  UNIQUE (classe_id, jour, debut)
);

CREATE TABLE vie_scolaire.presence (
  id               uuid PRIMARY KEY DEFAULT core.uuid_v7(),
  etablissement_id uuid NOT NULL REFERENCES structure.etablissement,
  fiche_id         uuid NOT NULL REFERENCES vie_scolaire.fiche_appel,
  inscription_id   uuid NOT NULL REFERENCES scolarite.inscription,
  statut           text NOT NULL CHECK (statut IN ('present', 'absent', 'retard')),
  retard_minutes   integer,
  UNIQUE (fiche_id, inscription_id)
);

CREATE TABLE vie_scolaire.absence (
  id               uuid PRIMARY KEY DEFAULT core.uuid_v7(),
  etablissement_id uuid NOT NULL REFERENCES structure.etablissement,
  inscription_id   uuid NOT NULL REFERENCES scolarite.inscription,
  fiche_id         uuid REFERENCES vie_scolaire.fiche_appel UNIQUE,
  jour             date NOT NULL,
  debut            time NOT NULL,
  duree_minutes    integer NOT NULL CHECK (duree_minutes > 0),
  statut           text NOT NULL DEFAULT 'non_justifiee' CHECK (statut IN ('non_justifiee', 'justifiee')),
  motif            text,
  demande_parent   text,
  demande_le       timestamptz,
  justifiee_par    uuid REFERENCES core.compte,
  justifiee_le     timestamptz,
  sms_le           timestamptz,
  cree_le          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX absence_inscription ON vie_scolaire.absence (inscription_id, jour);

CREATE TABLE vie_scolaire.observation (
  id               uuid PRIMARY KEY DEFAULT core.uuid_v7(),
  etablissement_id uuid NOT NULL REFERENCES structure.etablissement,
  inscription_id   uuid NOT NULL REFERENCES scolarite.inscription,
  type             text NOT NULL CHECK (type IN ('comportement', 'retard', 'travail_non_fait', 'tenue', 'felicitations')),
  description      text NOT NULL,
  sanction         text,
  matiere_id       uuid REFERENCES pedagogie.matiere,
  survenu_le       date NOT NULL DEFAULT current_date,
  auteur           uuid NOT NULL REFERENCES core.compte,
  cree_le          timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- communication (RG-28, RG-41, RG-42)

CREATE TABLE communication.annonce (
  id               uuid PRIMARY KEY DEFAULT core.uuid_v7(),
  etablissement_id uuid NOT NULL REFERENCES structure.etablissement,
  titre            text NOT NULL,
  texte_fr         text NOT NULL,
  texte_en         text,
  cible            text NOT NULL CHECK (cible IN ('ecole', 'niveau', 'classe', 'parent', 'debiteurs')),
  cible_id         uuid,
  cible_libelle    text NOT NULL,
  statut           text NOT NULL DEFAULT 'brouillon' CHECK (statut IN ('brouillon', 'publiee')),
  nb_familles      integer NOT NULL DEFAULT 0,
  auteur           uuid NOT NULL REFERENCES core.compte,
  publiee_le       timestamptz,
  cree_le          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE communication.annonce_famille (
  annonce_id       uuid NOT NULL REFERENCES communication.annonce,
  famille_id       uuid NOT NULL REFERENCES scolarite.famille,
  PRIMARY KEY (annonce_id, famille_id)
);

-- File d'envoi des SMS (conception § 9.4) : sans fournisseur actif, les messages attendent (E-22).
CREATE TABLE communication.envoi_sms (
  id               uuid PRIMARY KEY DEFAULT core.uuid_v7(),
  etablissement_id uuid NOT NULL REFERENCES structure.etablissement,
  modele           text NOT NULL,
  cible_libelle    text NOT NULL,
  texte_fr         text NOT NULL,
  texte_en         text,
  statut           text NOT NULL DEFAULT 'en_attente' CHECK (statut IN ('en_attente', 'envoye', 'expire')),
  nb_destinataires integer NOT NULL DEFAULT 0,
  nb_sms           integer NOT NULL DEFAULT 0,
  nb_echecs        integer NOT NULL DEFAULT 0,
  partir_le        timestamptz NOT NULL DEFAULT now(),
  auteur           uuid REFERENCES core.compte,
  cree_le          timestamptz NOT NULL DEFAULT now(),
  envoye_le        timestamptz
);

CREATE TABLE communication.sms (
  id               uuid PRIMARY KEY DEFAULT core.uuid_v7(),
  etablissement_id uuid NOT NULL REFERENCES structure.etablissement,
  envoi_id         uuid NOT NULL REFERENCES communication.envoi_sms,
  responsable_id   uuid REFERENCES scolarite.responsable,
  telephone        text NOT NULL,
  langue           text NOT NULL CHECK (langue IN ('fr', 'en')),
  texte            text NOT NULL,
  statut           text NOT NULL DEFAULT 'en_attente' CHECK (statut IN ('en_attente', 'envoye', 'echec', 'expire', 'annule')),
  reference        text,
  envoye_le        timestamptz
);

CREATE TABLE communication.notification_auto (
  etablissement_id uuid NOT NULL REFERENCES structure.etablissement,
  code             text NOT NULL CHECK (code IN ('recu', 'absence', 'bulletin', 'rappel_echeance')),
  active           boolean NOT NULL,
  PRIMARY KEY (etablissement_id, code)
);

CREATE TABLE communication.conversation (
  id                 uuid PRIMARY KEY DEFAULT core.uuid_v7(),
  etablissement_id   uuid NOT NULL REFERENCES structure.etablissement,
  famille_id         uuid NOT NULL REFERENCES scolarite.famille,
  eleve_id           uuid NOT NULL REFERENCES scolarite.eleve,
  destinataire_role  text NOT NULL CHECK (destinataire_role IN ('instituteur_principal', 'econome', 'directeur', 'secretaire')),
  destinataire_compte uuid REFERENCES core.compte,      -- le principal de la classe, le cas échéant
  sujet              text,
  non_lu_ecole       boolean NOT NULL DEFAULT true,
  non_lu_famille     boolean NOT NULL DEFAULT false,
  derniere_activite  timestamptz NOT NULL DEFAULT now(),
  cree_le            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE communication.message (
  id               uuid PRIMARY KEY DEFAULT core.uuid_v7(),
  etablissement_id uuid NOT NULL REFERENCES structure.etablissement,
  conversation_id  uuid NOT NULL REFERENCES communication.conversation,
  auteur_type      text NOT NULL CHECK (auteur_type IN ('famille', 'ecole')),
  auteur           uuid NOT NULL REFERENCES core.compte,
  texte            text NOT NULL,
  brouillon        boolean NOT NULL DEFAULT false,
  envoye_le        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE core.notification (
  id               uuid PRIMARY KEY DEFAULT core.uuid_v7(),
  etablissement_id uuid NOT NULL REFERENCES structure.etablissement,
  role_code        text NOT NULL,                       -- destinataires : les comptes de ce rôle
  type             text NOT NULL,
  texte            text NOT NULL,
  objet_id         uuid,
  cree_le          timestamptz NOT NULL DEFAULT now(),
  lue_le           timestamptz
);

-- ---------------------------------------------------------------- demandes à valider (RG-06, RG-11, RG-16)

CREATE TABLE finances.demande (
  id                uuid PRIMARY KEY DEFAULT core.uuid_v7(),
  etablissement_id  uuid NOT NULL REFERENCES structure.etablissement,
  type              text NOT NULL CHECK (type IN ('reduction', 'derogation', 'annulation')),
  statut            text NOT NULL DEFAULT 'demandee' CHECK (statut IN ('demandee', 'validee', 'refusee')),
  inscription_id    uuid REFERENCES scolarite.inscription,
  ligne_echeance_id uuid REFERENCES finances.ligne_echeance,
  versement_id      uuid REFERENCES finances.versement,
  montant           bigint CHECK (montant >= 0),
  objet             text NOT NULL,                      -- « tranche 2 », « inscription sans premier versement »
  motif             text NOT NULL,
  demandeur         uuid NOT NULL REFERENCES core.compte,
  demande_le        timestamptz NOT NULL DEFAULT now(),
  decideur          uuid REFERENCES core.compte,
  decide_le         timestamptz,
  motif_decision    text
);

-- ---------------------------------------------------------------- dépenses (RG-19)

CREATE TABLE caisse.categorie (
  id               uuid PRIMARY KEY DEFAULT core.uuid_v7(),
  etablissement_id uuid NOT NULL REFERENCES structure.etablissement,
  libelle          text NOT NULL,
  ordre            integer NOT NULL DEFAULT 0,
  UNIQUE (etablissement_id, libelle)
);

CREATE TABLE caisse.budget (
  id               uuid PRIMARY KEY DEFAULT core.uuid_v7(),
  etablissement_id uuid NOT NULL REFERENCES structure.etablissement,
  categorie_id     uuid NOT NULL REFERENCES caisse.categorie,
  periode_id       uuid NOT NULL REFERENCES structure.periode,
  montant          bigint NOT NULL CHECK (montant >= 0),
  UNIQUE (categorie_id, periode_id)
);

CREATE TABLE caisse.sortie (
  id               uuid PRIMARY KEY DEFAULT core.uuid_v7(),
  etablissement_id uuid NOT NULL REFERENCES structure.etablissement,
  numero           text NOT NULL,
  objet            text NOT NULL,
  categorie_id     uuid NOT NULL REFERENCES caisse.categorie,
  montant          bigint NOT NULL CHECK (montant > 0),
  motif            text NOT NULL,
  statut           text NOT NULL DEFAULT 'demandee' CHECK (statut IN ('demandee', 'validee', 'refusee', 'decaissee')),
  demandeur        uuid NOT NULL REFERENCES core.compte,
  demande_le       timestamptz NOT NULL DEFAULT now(),
  decideur         uuid REFERENCES core.compte,
  decide_le        timestamptz,
  motif_decision   text,
  session_id       uuid REFERENCES caisse.session,
  decaisse_le      timestamptz,
  decaisse_par     uuid REFERENCES core.compte,
  piece_nom        text,
  piece            bytea,
  piece_type       text,
  UNIQUE (etablissement_id, numero),
  CHECK (decideur IS NULL OR decideur <> demandeur)     -- RG-19 : le directeur ne valide pas sa propre demande
);

CREATE TABLE caisse.depot_banque (
  id               uuid PRIMARY KEY DEFAULT core.uuid_v7(),
  etablissement_id uuid NOT NULL REFERENCES structure.etablissement,
  session_id       uuid NOT NULL REFERENCES caisse.session,
  montant          bigint NOT NULL CHECK (montant > 0),
  banque           text NOT NULL,
  bordereau        text NOT NULL,
  depose_le        date NOT NULL,
  saisi_par        uuid NOT NULL REFERENCES core.compte,
  cree_le          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE caisse.mouvement ADD COLUMN sortie_id uuid REFERENCES caisse.sortie;
ALTER TABLE caisse.mouvement ADD COLUMN depot_id uuid REFERENCES caisse.depot_banque;

-- ---------------------------------------------------------------- avis, relances, relevé bancaire

CREATE TABLE finances.avis (
  id               uuid PRIMARY KEY DEFAULT core.uuid_v7(),
  etablissement_id uuid NOT NULL REFERENCES structure.etablissement,
  numero           text NOT NULL,
  inscription_id   uuid NOT NULL REFERENCES scolarite.inscription,
  montant_du       bigint NOT NULL,
  emis_le          timestamptz NOT NULL DEFAULT now(),
  emis_par         uuid NOT NULL REFERENCES core.compte,
  UNIQUE (etablissement_id, numero)
);

CREATE TABLE finances.relance (
  id               uuid PRIMARY KEY DEFAULT core.uuid_v7(),
  etablissement_id uuid NOT NULL REFERENCES structure.etablissement,
  inscription_id   uuid NOT NULL REFERENCES scolarite.inscription,
  canal            text NOT NULL CHECK (canal IN ('sms', 'avis')),
  relance_le       timestamptz NOT NULL DEFAULT now(),
  par              uuid REFERENCES core.compte
);

CREATE TABLE finances.releve (
  id               uuid PRIMARY KEY DEFAULT core.uuid_v7(),
  etablissement_id uuid NOT NULL REFERENCES structure.etablissement,
  banque           text NOT NULL,
  mois             date NOT NULL,
  importe_le       timestamptz NOT NULL DEFAULT now(),
  importe_par      uuid NOT NULL REFERENCES core.compte,
  UNIQUE (etablissement_id, banque, mois)
);

CREATE TABLE finances.ligne_releve (
  id               uuid PRIMARY KEY DEFAULT core.uuid_v7(),
  etablissement_id uuid NOT NULL REFERENCES structure.etablissement,
  releve_id        uuid NOT NULL REFERENCES finances.releve,
  ordre            integer NOT NULL,
  opere_le         date NOT NULL,
  libelle          text NOT NULL,
  montant          bigint NOT NULL,
  reference        text,
  versement_id     uuid REFERENCES finances.versement,
  depot_id         uuid REFERENCES caisse.depot_banque
);

-- ---------------------------------------------------------------- assistant (analyse § 6.4, conception § 9.6)

CREATE SCHEMA assistant;

CREATE TABLE assistant.tache (
  id               uuid PRIMARY KEY DEFAULT core.uuid_v7(),
  etablissement_id uuid NOT NULL REFERENCES structure.etablissement,
  type             text NOT NULL,                       -- IA-01 … IA-07
  statut           text NOT NULL DEFAULT 'en_file' CHECK (statut IN ('en_file', 'en_cours', 'proposee', 'validee', 'rejetee', 'expiree')),
  entree           jsonb NOT NULL,                      -- déjà pseudonymisée (RG-31)
  libelle          text NOT NULL,
  modele           text,
  cout_fcfa        integer NOT NULL DEFAULT 0,
  cree_par         uuid REFERENCES core.compte,
  cree_le          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE assistant.proposition (
  id               uuid PRIMARY KEY DEFAULT core.uuid_v7(),
  etablissement_id uuid NOT NULL REFERENCES structure.etablissement,
  tache_id         uuid NOT NULL REFERENCES assistant.tache,
  contenu          jsonb NOT NULL,
  statut           text NOT NULL DEFAULT 'proposee' CHECK (statut IN ('proposee', 'validee', 'rejetee', 'expiree')),
  decide_par       uuid REFERENCES core.compte,
  decide_le        timestamptz,
  motif_rejet      text
);

-- La correspondance des codes ne quitte jamais le serveur de l'école (RG-31).
CREATE TABLE assistant.correspondance (
  tache_id         uuid NOT NULL REFERENCES assistant.tache,
  code             text NOT NULL,
  valeur_reelle    text NOT NULL,
  PRIMARY KEY (tache_id, code)
);

-- ---------------------------------------------------------------- surveillance

SELECT core.surveiller(t) FROM unnest(ARRAY[
  'pedagogie.sequence', 'pedagogie.evaluation', 'pedagogie.note', 'pedagogie.fusion'
]::regclass[]) AS t;
SELECT core.surveiller(t, false) FROM unnest(ARRAY[
  'personnel.vacation', 'pedagogie.appreciation', 'pedagogie.bulletin', 'pedagogie.levee_blocage', 'pedagogie.decision_conseil',
  'pedagogie.cours', 'pedagogie.emploi_du_temps', 'vie_scolaire.presence', 'vie_scolaire.absence', 'vie_scolaire.observation',
  'communication.annonce', 'communication.envoi_sms', 'finances.demande', 'caisse.sortie', 'caisse.depot_banque', 'finances.avis',
  'finances.ligne_releve', 'assistant.proposition'
]::regclass[]) AS t;

-- ---------------------------------------------------------------- vues de reporting complémentaires

CREATE VIEW reporting.v_note AS
SELECT n.id, n.etablissement_id, e.classe_id, e.matiere_id, s.periode_id, s.numero AS sequence, s.type AS type_sequence,
       n.inscription_id, n.statut, n.valeur, e.bareme,
       CASE WHEN n.statut = 'present' AND n.valeur IS NOT NULL THEN round(n.valeur * 20 / e.bareme, 2) END AS sur_20
  FROM pedagogie.note n JOIN pedagogie.evaluation e ON e.id = n.evaluation_id JOIN pedagogie.sequence s ON s.id = e.sequence_id;
COMMENT ON VIEW reporting.v_note IS 'Notes ramenées sur 20 (RG-23), par élève, matière, séquence et période.';

CREATE VIEW reporting.v_bulletin AS
SELECT b.id, b.etablissement_id, b.inscription_id, b.periode_id, b.version, b.statut, b.moyenne, b.rang, b.effectif, b.publie_le
  FROM pedagogie.bulletin b;
COMMENT ON VIEW reporting.v_bulletin IS 'Bulletins : version, statut, moyenne, rang, publication.';
