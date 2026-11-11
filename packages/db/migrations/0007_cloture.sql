-- Clôture d'année (maquette Cloture) : lectures entre modules par des vues (décision D-09).
CREATE VIEW reporting.v_decision_conseil AS
SELECT d.etablissement_id, d.inscription_id, d.periode_id, d.distinction, d.fin_annee FROM pedagogie.decision_conseil d;
COMMENT ON VIEW reporting.v_decision_conseil IS 'Décisions du conseil de classe : distinction, passage en fin d''année.';

CREATE VIEW reporting.v_session_caisse AS
SELECT s.id, s.etablissement_id, s.caisse, s.caissier_id, s.ouverte_le, s.cloturee_le FROM caisse.session s;
COMMENT ON VIEW reporting.v_session_caisse IS 'Sessions de caisse : ouverture et clôture.';
