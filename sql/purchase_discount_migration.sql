-- ============================================================================
-- Purchase discount column (Phase 2 shop fixes). Idempotent: safe to re-run.
--
-- Purchases now store the bill discount separately so that purchase returns
-- refund the discounted cost and the product cost price is the net cost.
-- Until this runs, the app saves purchases without the discount (old behaviour).
-- ============================================================================
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS discount NUMERIC(15,2) DEFAULT 0;
