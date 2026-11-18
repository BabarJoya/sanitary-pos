-- ============================================================================
-- Cash shifts: every Close Day / shift close a cashier saves — opening cash,
-- the day's cash book, counted cash and the difference — kept on the server so
-- the owner can see shortages from any device (Dashboard → Close Day).
-- Rows are a record: shop sessions may read and add, not change or delete.
-- Idempotent: safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS cash_shifts (
  id             BIGSERIAL PRIMARY KEY,
  shop_id        INTEGER NOT NULL,
  user_id        INTEGER,
  username       TEXT,
  shift_date     DATE NOT NULL,                 -- the shop's local day
  opening_cash   NUMERIC(14,2) NOT NULL DEFAULT 0,
  cash_in        NUMERIC(14,2) NOT NULL DEFAULT 0, -- cash sales + cash received
  cash_out       NUMERIC(14,2) NOT NULL DEFAULT 0, -- refunds + supplier cash + expenses
  expected_cash  NUMERIC(14,2) NOT NULL DEFAULT 0, -- opening + cash_in − cash_out
  counted_cash   NUMERIC(14,2) NOT NULL,
  difference     NUMERIC(14,2) GENERATED ALWAYS AS (counted_cash - expected_cash) STORED,
  total_sales    NUMERIC(14,2) NOT NULL DEFAULT 0,
  credit_sales   NUMERIC(14,2) NOT NULL DEFAULT 0,
  online_in      NUMERIC(14,2) NOT NULL DEFAULT 0,
  note           TEXT,
  client_ref     UUID UNIQUE,                   -- one row per close, even if the upload is retried
  closed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cash_shifts_shop_day_idx ON cash_shifts (shop_id, shift_date DESC, closed_at DESC);

ALTER TABLE cash_shifts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON cash_shifts FROM anon, authenticated;
GRANT SELECT, INSERT ON cash_shifts TO anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE cash_shifts_id_seq TO anon, authenticated;
DROP POLICY IF EXISTS "Tenant Isolation" ON cash_shifts;
CREATE POLICY "Tenant Isolation" ON cash_shifts AS PERMISSIVE FOR ALL TO anon, authenticated
  USING (is_valid_session(shop_id)) WITH CHECK (is_valid_session(shop_id));

NOTIFY pgrst, 'reload schema';
