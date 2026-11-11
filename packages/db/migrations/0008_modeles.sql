-- Modèles de documents (maquette Etablissement, « Modèles de documents ») : en-tête et mentions de chaque document,
-- en français et en anglais, imprimés sur les PDF (reçu, avis de paiement, certificat, liste de classe, bulletin).
ALTER TABLE structure.etablissement ADD COLUMN modeles jsonb NOT NULL DEFAULT '{}'::jsonb;
COMMENT ON COLUMN structure.etablissement.modeles IS 'Par document (recu, avis, certificat, liste, bulletin) : { fr: { entete, mentions }, en: { entete, mentions } }.';
