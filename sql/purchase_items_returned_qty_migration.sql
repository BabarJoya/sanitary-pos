-- ============================================================================
-- purchase_items.returned_qty (needed for purchase returns). Idempotent.
--
-- Found missing on the live database on 2026-11-18: without it, returning goods
-- to a supplier fails (both process_purchase_return and the app's step-by-step
-- path update this column). Run once in the Supabase SQL Editor.
-- ============================================================================
ALTER TABLE purchase_items ADD COLUMN IF NOT EXISTS returned_qty NUMERIC DEFAULT 0;
UPDATE purchase_items SET returned_qty = 0 WHERE returned_qty IS NULL;

NOTIFY pgrst, 'reload schema';
