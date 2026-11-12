-- Historique des modifications d'une fiche (D-43) : les versions précédentes se lisent dans le journal d'audit, par ligne.
CREATE INDEX journal_audit_ligne ON core.journal_audit (ligne_id, horodatage DESC) WHERE ligne_id IS NOT NULL;
