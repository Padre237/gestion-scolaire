-- Modèles d'impression et vérification des documents (D-44).
-- Modèle choisi par document : { fiche, carte, bulletin } ∈ classique | bandeau | epure.
ALTER TABLE structure.etablissement ADD COLUMN gabarits jsonb NOT NULL DEFAULT '{}'::jsonb;
-- Adresse publique de la page « Vérifier » (QR codes) ; vide : adresse du poste qui imprime.
ALTER TABLE structure.etablissement ADD COLUMN adresse_verification text;

-- Code de vérification d'un document imprimé : un code aléatoire par carte (inscription) ou par version de bulletin.
CREATE TABLE scolarite.verification (
  code             text PRIMARY KEY CHECK (code ~ '^[A-Z2-7]{12}$'),
  etablissement_id uuid NOT NULL REFERENCES structure.etablissement,
  type             text NOT NULL CHECK (type IN ('carte', 'bulletin')),
  objet_id         uuid NOT NULL,
  emis_le          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (type, objet_id)
);
COMMENT ON TABLE scolarite.verification IS 'Codes des QR imprimés sur les cartes et les bulletins ; la page publique « Vérifier » les lit.';
