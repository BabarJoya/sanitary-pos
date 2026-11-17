-- ============================================================================
-- Phase 3 item 25: decimal quantities and pack sizes. Idempotent: safe to re-run.
--
-- Hardware / sanitary shops sell pipe by the foot or metre and paint or cement by
-- the kg: quantities must allow decimals (2.5 m). Older schemas created these
-- columns as INTEGER, which rejects or rounds 2.5. NUMERIC keeps whole numbers
-- exactly as they are.
--
-- Packs: a product may be bought / sold in packs (Box of 12, Carton of 24).
-- Stock is always kept in the base unit (pieces); the pack is a shortcut.
-- ============================================================================
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT table_name, column_name FROM information_schema.columns
     WHERE table_schema = 'public'
       AND (table_name, column_name) IN (
         ('products', 'stock_quantity'),
         ('sale_items', 'quantity'), ('sale_items', 'returned_qty'),
         ('purchase_items', 'quantity'), ('purchase_items', 'returned_qty'))
       AND data_type IN ('integer', 'smallint', 'bigint')
  LOOP
    EXECUTE format('ALTER TABLE %I ALTER COLUMN %I TYPE NUMERIC USING %I::numeric', r.table_name, r.column_name, r.column_name);
  END LOOP;
END $$;

ALTER TABLE products ADD COLUMN IF NOT EXISTS pack_size NUMERIC; -- base units per pack, e.g. 12
ALTER TABLE products ADD COLUMN IF NOT EXISTS pack_name TEXT;    -- e.g. 'Box', 'Carton', 'Dozen'

NOTIFY pgrst, 'reload schema';
