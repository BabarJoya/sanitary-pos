-- ============================================================================
-- Customer link (Round C): a private link a shop sends on WhatsApp so a customer
-- can see their own balance, bills and payments without logging in.
-- Run in the Supabase SQL Editor. Idempotent: safe to re-run.
--
-- Security model
--  * A link is a 64-character random token tied to ONE customer of ONE shop.
--    It is unguessable; whoever has it can read that customer's statement only.
--  * Links expire (180 days by default) and staff can turn a link off at any time
--    (revoke_customer_link). Making a new link turns the old one off.
--  * Shops create / revoke links through SECURITY INVOKER functions, so the normal
--    session-token RLS ("is_valid_session") decides which customers they can reach.
--  * The public read is ONE SECURITY DEFINER function, get_customer_portal(token).
--    It returns only display fields: no cost prices, no other customers, no staff
--    data. The customer_links table itself is not readable without a shop session.
-- ============================================================================

CREATE TABLE IF NOT EXISTS customer_links (
  id          BIGSERIAL PRIMARY KEY,
  shop_id     INTEGER NOT NULL,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  token       TEXT NOT NULL UNIQUE,
  created_by  TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  expires_at  TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '180 days'),
  revoked_at  TIMESTAMPTZ,
  last_viewed_at TIMESTAMPTZ,
  view_count  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS customer_links_customer_idx ON customer_links (shop_id, customer_id);

ALTER TABLE customer_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON customer_links FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON customer_links TO anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE customer_links_id_seq TO anon, authenticated;
DROP POLICY IF EXISTS "Tenant Isolation" ON customer_links;
CREATE POLICY "Tenant Isolation" ON customer_links AS PERMISSIVE FOR ALL TO anon, authenticated
  USING (is_valid_session(shop_id)) WITH CHECK (is_valid_session(shop_id));

-- ── Shop side: get (or make) the active link for a customer ────────────────
CREATE OR REPLACE FUNCTION create_customer_link(p_customer_id INTEGER, p_created_by TEXT DEFAULT NULL, p_renew BOOLEAN DEFAULT FALSE)
RETURNS JSONB LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_shop  INTEGER;
  v_link  customer_links%ROWTYPE;
BEGIN
  -- RLS: only a customer of the caller's own shop is visible
  SELECT shop_id INTO v_shop FROM customers WHERE id = p_customer_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Customer % not found or not accessible', p_customer_id USING ERRCODE = 'P0002';
  END IF;

  IF NOT p_renew THEN
    SELECT * INTO v_link FROM customer_links
     WHERE customer_id = p_customer_id AND revoked_at IS NULL AND expires_at > NOW() + INTERVAL '7 days'
     ORDER BY created_at DESC LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object('token', v_link.token, 'expires_at', v_link.expires_at, 'reused', true);
    END IF;
  END IF;

  -- One active link per customer: turn older ones off
  UPDATE customer_links SET revoked_at = NOW() WHERE customer_id = p_customer_id AND revoked_at IS NULL;

  INSERT INTO customer_links (shop_id, customer_id, token, created_by)
  VALUES (v_shop, p_customer_id,
          replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
          p_created_by)
  RETURNING * INTO v_link;
  RETURN jsonb_build_object('token', v_link.token, 'expires_at', v_link.expires_at, 'reused', false);
END;
$$;

CREATE OR REPLACE FUNCTION revoke_customer_link(p_customer_id INTEGER)
RETURNS INTEGER LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_n INTEGER;
BEGIN
  UPDATE customer_links SET revoked_at = NOW() WHERE customer_id = p_customer_id AND revoked_at IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

-- ── Public side: the customer opens the link ──────────────────────────────
-- Returns { shop, customer, balance, sales[], payments[], link } or NULL for an
-- unknown / expired / turned-off link (the page shows one "link not valid" message).
CREATE OR REPLACE FUNCTION get_customer_portal(p_token TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_link  customer_links%ROWTYPE;
  v_cust  RECORD;
  v_shop  RECORD;
  v_sales JSONB;
  v_pays  JSONB;
BEGIN
  IF p_token IS NULL OR length(p_token) <> 64 OR p_token !~ '^[0-9a-f]{64}$' THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_link FROM customer_links
   WHERE token = p_token AND revoked_at IS NULL AND expires_at > NOW();
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT id, name, outstanding_balance INTO v_cust
    FROM customers WHERE id = v_link.customer_id AND shop_id = v_link.shop_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT id, name, phone, address INTO v_shop FROM shops WHERE id = v_link.shop_id;

  -- Bills (no quotations), newest first, with their lines — selling prices only
  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'created_at' DESC), '[]'::jsonb) INTO v_sales FROM (
    SELECT jsonb_build_object(
      'id', s.id,
      'created_at', s.created_at,
      'total_amount', s.total_amount,
      'discount', COALESCE(s.discount, 0),
      'paid_amount', COALESCE(s.paid_amount, 0),
      'items', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'product_name', si.product_name, 'quantity', si.quantity,
          'unit_price', si.unit_price, 'returned_qty', COALESCE(si.returned_qty, 0)) ORDER BY si.id)
        FROM sale_items si WHERE si.sale_id = s.id), '[]'::jsonb)
    ) AS x
    FROM sales s
    WHERE s.customer_id = v_cust.id AND s.shop_id = v_link.shop_id
      AND COALESCE(s.sale_type, 'sale') <> 'quotation'
    ORDER BY s.created_at DESC
    LIMIT 1000
  ) q;

  -- Payments, returns, manual entries and opening balance (ledger rows)
  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'created_at' DESC), '[]'::jsonb) INTO v_pays FROM (
    SELECT jsonb_build_object(
      'id', p.id, 'created_at', p.created_at, 'amount', p.amount,
      'payment_type', p.payment_type, 'note', p.note) AS x
    FROM customer_payments p
    WHERE p.customer_id = v_cust.id AND p.shop_id = v_link.shop_id
    ORDER BY p.created_at DESC
    LIMIT 2000
  ) q;

  UPDATE customer_links SET last_viewed_at = NOW(), view_count = view_count + 1 WHERE id = v_link.id;

  RETURN jsonb_build_object(
    'shop', jsonb_build_object('name', v_shop.name, 'phone', v_shop.phone, 'address', v_shop.address),
    'customer', jsonb_build_object('name', v_cust.name),
    'balance', COALESCE(v_cust.outstanding_balance, 0),
    'sales', v_sales,
    'payments', v_pays,
    'link', jsonb_build_object('expires_at', v_link.expires_at)
  );
END;
$$;

REVOKE ALL ON FUNCTION get_customer_portal(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_customer_portal(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION create_customer_link(INTEGER, TEXT, BOOLEAN) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION revoke_customer_link(INTEGER) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
