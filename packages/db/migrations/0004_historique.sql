-- 0004 · Historique de la fiche élève : les lignes métier du journal portent l'élève concerné.
ALTER TABLE core.journal_audit ADD COLUMN eleve_id uuid;
CREATE INDEX journal_audit_eleve ON core.journal_audit (eleve_id, horodatage DESC) WHERE eleve_id IS NOT NULL;
