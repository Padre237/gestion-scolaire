-- Application hybride (D-49) : le poste de l'école et la version en ligne échangent leurs modifications.
-- Chaque insertion, modification ou suppression d'une table métier entre au journal de synchronisation ; l'autre instance
-- l'applique. Pour une même ligne modifiée des deux côtés, la modification la plus récente l'emporte et l'autre version
-- est gardée dans sync.conflit. Les modifications reçues sont appliquées sans déclencheur (session_replication_role = replica) :
-- elles n'entrent pas au journal de l'instance qui les reçoit et ne repartent pas.
CREATE SCHEMA sync;

CREATE TABLE sync.journal (
  seq        bigserial PRIMARY KEY,
  horodatage timestamptz NOT NULL DEFAULT clock_timestamp(),
  table_nom  text NOT NULL,
  operation  text NOT NULL CHECK (operation IN ('INSERT', 'UPDATE', 'DELETE')),
  cle        jsonb NOT NULL,                 -- clé primaire de la ligne : { colonne: valeur }
  ligne      jsonb                           -- ligne complète après la modification ; vide pour une suppression
);
CREATE INDEX journal_ligne ON sync.journal (table_nom, cle, seq DESC);

-- Où en est l'échange : dernier numéro envoyé (journal local), dernier numéro reçu (journal distant), date.
CREATE TABLE sync.etat (cle text PRIMARY KEY, valeur text NOT NULL, modifie_le timestamptz NOT NULL DEFAULT now());

-- Versions écartées : rien n'est perdu sans trace.
CREATE TABLE sync.conflit (
  id              bigserial PRIMARY KEY,
  horodatage      timestamptz NOT NULL DEFAULT now(),
  table_nom       text NOT NULL,
  cle             jsonb NOT NULL,
  issue           text NOT NULL CHECK (issue IN ('distant_garde', 'local_garde', 'refuse')),
  version_gardee  jsonb,
  version_ecartee jsonb,
  motif           text
);

-- Colonnes dont le seul changement ne se transmet pas (activité d'une session, verrouillage d'un poste).
CREATE FUNCTION sync.fn_capture() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  ignorees text[] := ARRAY['derniere_activite', 'modifie_le', 'version', 'echecs', 'verrouille_jusqua'];
  ligne jsonb;
  k jsonb := '{}'::jsonb;
  c text;
BEGIN
  IF TG_OP = 'UPDATE' AND (to_jsonb(OLD) - ignorees) = (to_jsonb(NEW) - ignorees) THEN RETURN NULL; END IF;
  ligne := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  FOREACH c IN ARRAY TG_ARGV LOOP k := k || jsonb_build_object(c, ligne -> c); END LOOP;
  INSERT INTO sync.journal (table_nom, operation, cle, ligne)
  VALUES (TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME, TG_OP, k, CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE ligne END);
  RETURN NULL;
END $$;

-- Pose le déclencheur sur chaque table métier qui ne l'a pas encore (appelée après chaque migration).
CREATE FUNCTION sync.installer() RETURNS integer LANGUAGE plpgsql AS $$
DECLARE t record; n integer := 0;
BEGIN
  FOR t IN
    SELECT c.oid::regclass AS tab, array_agg(a.attname::text ORDER BY array_position(i.indkey::int2[], a.attnum)) AS pk
      FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
      JOIN pg_index i ON i.indrelid = c.oid AND i.indisprimary
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY (i.indkey)
     WHERE c.relkind = 'r'
       AND ns.nspname IN ('core', 'structure', 'scolarite', 'finances', 'caisse', 'pedagogie', 'vie_scolaire', 'personnel', 'communication', 'assistant')
       AND (ns.nspname || '.' || c.relname) <> 'core.session'
       AND NOT EXISTS (SELECT 1 FROM pg_trigger tg WHERE tg.tgrelid = c.oid AND tg.tgname = 'synchro')
     GROUP BY c.oid
  LOOP
    EXECUTE format('CREATE TRIGGER synchro AFTER INSERT OR UPDATE OR DELETE ON %s FOR EACH ROW EXECUTE FUNCTION sync.fn_capture(%s)',
                   t.tab, (SELECT string_agg(quote_literal(x), ', ') FROM unnest(t.pk) AS x));
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;

-- Applique une modification reçue : insertion ou remplacement de la ligne entière, ou suppression, par la clé primaire.
CREATE FUNCTION sync.appliquer(p_table text, p_operation text, p_cle jsonb, p_ligne jsonb) RETURNS void LANGUAGE plpgsql AS $$
DECLARE pk text; maj text;
BEGIN
  SELECT string_agg(quote_ident(k), ', ') INTO pk FROM jsonb_object_keys(p_cle) AS k;
  IF p_operation = 'DELETE' THEN
    EXECUTE format('DELETE FROM %s WHERE (%s) = (SELECT %s FROM jsonb_populate_record(NULL::%s, $1))', p_table, pk, pk, p_table) USING p_cle;
    RETURN;
  END IF;
  SELECT string_agg(format('%I = EXCLUDED.%I', a.attname, a.attname), ', ') INTO maj
    FROM pg_attribute a
   WHERE a.attrelid = p_table::regclass AND a.attnum > 0 AND NOT a.attisdropped
     AND NOT (a.attname::text IN (SELECT jsonb_object_keys(p_cle)));
  EXECUTE format('INSERT INTO %s SELECT * FROM jsonb_populate_record(NULL::%s, $1) ON CONFLICT (%s) DO %s',
                 p_table, p_table, pk, CASE WHEN maj IS NULL THEN 'NOTHING' ELSE 'UPDATE SET ' || maj END) USING p_ligne;
END $$;

SELECT sync.installer();
