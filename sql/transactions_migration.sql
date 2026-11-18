-- ============================================================================
-- Phase 3: one-transaction sales, purchases and returns; idempotent changes;
-- stock movement history; dated return documents.
--
-- Run in the Supabase SQL Editor AFTER sql/data_integrity_migration.sql and
-- sql/purchase_discount_migration.sql. Idempotent: safe to re-run.
--
-- Every function is SECURITY INVOKER: the caller's session-token RLS policies
-- ("Tenant Isolation" / is_valid_session) still decide which rows it may touch.
-- The app keeps working without this file (it falls back to the step-by-step
-- path); once this runs, the app switches to the functions automatically.
--
-- TEST ON A TEST SHOP FIRST: these functions were written without access to a
-- live database. Check: a cash sale, a credit sale, a split sale, a purchase
-- (cash / credit / part paid), a sale return and a purchase return, then
-- compare stock, balances and the ledgers.
-- ============================================================================

-- ── 1. Operation log: a change with an op_id is applied at most once ─────────
CREATE TABLE IF NOT EXISTS applied_ops (
  op_id      UUID PRIMARY KEY,
  shop_id    INTEGER NOT NULL,
  fn         TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE applied_ops ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON applied_ops TO anon, authenticated;
DROP POLICY IF EXISTS "Tenant Isolation" ON applied_ops;
CREATE POLICY "Tenant Isolation" ON applied_ops AS PERMISSIVE FOR ALL TO anon, authenticated
  USING (is_valid_session(shop_id)) WITH CHECK (is_valid_session(shop_id));

-- ── 2. Stock movement history ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS stock_movements (
  id          BIGSERIAL PRIMARY KEY,
  shop_id     INTEGER NOT NULL,
  product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  qty_change  NUMERIC NOT NULL,
  stock_after NUMERIC,
  -- sale | purchase | sale_return | purchase_return | adjustment | stocktake |
  -- sale_delete | purchase_delete | restore | other
  reason      TEXT NOT NULL DEFAULT 'other',
  ref_table   TEXT,
  ref_id      TEXT,
  unit_cost   NUMERIC,
  note        TEXT,
  created_by  TEXT,
  op_id       UUID,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS stock_movements_product_idx ON stock_movements (shop_id, product_id, created_at DESC);
ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON stock_movements TO anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE stock_movements_id_seq TO anon, authenticated;
DROP POLICY IF EXISTS "Tenant Isolation" ON stock_movements;
CREATE POLICY "Tenant Isolation" ON stock_movements AS PERMISSIVE FOR ALL TO anon, authenticated
  USING (is_valid_session(shop_id)) WITH CHECK (is_valid_session(shop_id));

-- ── 3. Dated return documents ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sale_returns (
  id             BIGSERIAL PRIMARY KEY,
  shop_id        INTEGER NOT NULL,
  sale_id        INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  customer_id    INTEGER,
  return_gross   NUMERIC NOT NULL DEFAULT 0,  -- unit price × qty of the goods returned
  discount_share NUMERIC NOT NULL DEFAULT 0,  -- bill discount that came back with them
  refund_total   NUMERIC NOT NULL DEFAULT 0,  -- return_gross − discount_share
  cash_refund    NUMERIC NOT NULL DEFAULT 0,
  credit_refund  NUMERIC NOT NULL DEFAULT 0,  -- taken off the customer's balance
  cost_total     NUMERIC NOT NULL DEFAULT 0,  -- cost of the goods back in stock
  lines          JSONB NOT NULL DEFAULT '[]', -- [{sale_item_id, product_id, product_name, qty, unit_price, cost_price}]
  created_by     TEXT,
  client_ref     UUID,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS sale_returns_client_ref_key ON sale_returns (client_ref) WHERE client_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS sale_returns_shop_date_idx ON sale_returns (shop_id, created_at);
ALTER TABLE sale_returns ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, DELETE ON sale_returns TO anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE sale_returns_id_seq TO anon, authenticated;
DROP POLICY IF EXISTS "Tenant Isolation" ON sale_returns;
CREATE POLICY "Tenant Isolation" ON sale_returns AS PERMISSIVE FOR ALL TO anon, authenticated
  USING (is_valid_session(shop_id)) WITH CHECK (is_valid_session(shop_id));

CREATE TABLE IF NOT EXISTS purchase_returns (
  id             BIGSERIAL PRIMARY KEY,
  shop_id        INTEGER NOT NULL,
  purchase_id    INTEGER NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  supplier_id    INTEGER,
  return_gross   NUMERIC NOT NULL DEFAULT 0,
  discount_share NUMERIC NOT NULL DEFAULT 0,
  refund_total   NUMERIC NOT NULL DEFAULT 0,
  balance_change NUMERIC NOT NULL DEFAULT 0,  -- taken off what the shop owes the supplier
  lines          JSONB NOT NULL DEFAULT '[]',
  created_by     TEXT,
  client_ref     UUID,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS purchase_returns_client_ref_key ON purchase_returns (client_ref) WHERE client_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS purchase_returns_shop_date_idx ON purchase_returns (shop_id, created_at);
ALTER TABLE purchase_returns ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, DELETE ON purchase_returns TO anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE purchase_returns_id_seq TO anon, authenticated;
DROP POLICY IF EXISTS "Tenant Isolation" ON purchase_returns;
CREATE POLICY "Tenant Isolation" ON purchase_returns AS PERMISSIVE FOR ALL TO anon, authenticated
  USING (is_valid_session(shop_id)) WITH CHECK (is_valid_session(shop_id));

-- ── 4. Idempotency keys ──────────────────────────────────────────────────
-- Also created by sql/data_integrity_migration.sql and sql/purchase_discount_migration.sql;
-- repeated here so this file works even if those were skipped.
ALTER TABLE sales     ADD COLUMN IF NOT EXISTS client_ref UUID;
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS client_ref UUID;
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS discount NUMERIC(15,2) DEFAULT 0;
ALTER TABLE sale_items     ADD COLUMN IF NOT EXISTS returned_qty NUMERIC DEFAULT 0;
ALTER TABLE purchase_items ADD COLUMN IF NOT EXISTS returned_qty NUMERIC DEFAULT 0;
CREATE UNIQUE INDEX IF NOT EXISTS sales_client_ref_key     ON sales (client_ref)     WHERE client_ref IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS purchases_client_ref_key ON purchases (client_ref) WHERE client_ref IS NOT NULL;

-- Ledger rows written by the offline queue
ALTER TABLE customer_payments ADD COLUMN IF NOT EXISTS client_ref UUID;
ALTER TABLE supplier_payments ADD COLUMN IF NOT EXISTS client_ref UUID;
ALTER TABLE expenses          ADD COLUMN IF NOT EXISTS client_ref UUID;
CREATE UNIQUE INDEX IF NOT EXISTS customer_payments_client_ref_key ON customer_payments (client_ref) WHERE client_ref IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS supplier_payments_client_ref_key ON supplier_payments (client_ref) WHERE client_ref IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS expenses_client_ref_key          ON expenses (client_ref)          WHERE client_ref IS NOT NULL;

-- Customer credit limit (0 / NULL = no limit) — Phase 3 item 24
ALTER TABLE customers ADD COLUMN IF NOT EXISTS credit_limit NUMERIC;

-- ── 5. Helpers ────────────────────────────────────────────────────────────
-- Claim an op id. TRUE = first time (apply the change), FALSE = already applied.
CREATE OR REPLACE FUNCTION claim_op(p_op_id UUID, p_shop_id INTEGER, p_fn TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_rows INTEGER;
BEGIN
  IF p_op_id IS NULL THEN RETURN TRUE; END IF;
  INSERT INTO applied_ops (op_id, shop_id, fn) VALUES (p_op_id, p_shop_id, p_fn)
  ON CONFLICT (op_id) DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END;
$$;

-- Insert one JSON object into a table, using only keys that are real columns
-- (so optional columns an older database lacks are skipped) and never `id`.
CREATE OR REPLACE FUNCTION insert_json_row(p_table TEXT, p_row JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_cols TEXT;
  v_out  JSONB;
BEGIN
  SELECT string_agg(quote_ident(c.column_name), ', ')
    INTO v_cols
    FROM information_schema.columns c
   WHERE c.table_schema = 'public' AND c.table_name = p_table
     AND c.column_name <> 'id'
     AND p_row ? c.column_name;
  IF v_cols IS NULL THEN RAISE EXCEPTION 'insert_json_row: nothing to insert into %', p_table; END IF;
  EXECUTE format(
    'INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, $1) RETURNING to_jsonb(%I.*)',
    p_table, v_cols, v_cols, p_table, p_table)
  INTO v_out USING p_row;
  RETURN v_out;
END;
$$;

-- ── 6. Atomic changes with op ids (v2 of sql/data_integrity_migration.sql) ──
CREATE OR REPLACE FUNCTION adjust_product_stock_v2(
  p_product_id INTEGER, p_delta NUMERIC, p_op_id UUID DEFAULT NULL,
  p_reason TEXT DEFAULT 'other', p_ref_table TEXT DEFAULT NULL, p_ref_id TEXT DEFAULT NULL,
  p_note TEXT DEFAULT NULL, p_created_by TEXT DEFAULT NULL, p_unit_cost NUMERIC DEFAULT NULL)
RETURNS NUMERIC LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_shop INTEGER;
  v_new  NUMERIC;
BEGIN
  SELECT shop_id INTO v_shop FROM products WHERE id = p_product_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product % not found or not accessible', p_product_id USING ERRCODE = 'P0002';
  END IF;
  IF NOT claim_op(p_op_id, v_shop, 'adjust_product_stock') THEN
    SELECT stock_quantity INTO v_new FROM products WHERE id = p_product_id;
    RETURN v_new; -- already applied (replay after a lost response)
  END IF;
  UPDATE products SET stock_quantity = stock_quantity + p_delta
   WHERE id = p_product_id RETURNING stock_quantity INTO v_new;
  INSERT INTO stock_movements (shop_id, product_id, qty_change, stock_after, reason, ref_table, ref_id, unit_cost, note, created_by, op_id)
  VALUES (v_shop, p_product_id, p_delta, v_new, COALESCE(p_reason, 'other'), p_ref_table, p_ref_id, p_unit_cost, p_note, p_created_by, p_op_id);
  RETURN v_new;
END;
$$;

CREATE OR REPLACE FUNCTION adjust_customer_balance_v2(p_customer_id INTEGER, p_delta NUMERIC, p_op_id UUID DEFAULT NULL)
RETURNS NUMERIC LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_shop INTEGER;
  v_new  NUMERIC;
BEGIN
  SELECT shop_id INTO v_shop FROM customers WHERE id = p_customer_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Customer % not found or not accessible', p_customer_id USING ERRCODE = 'P0002';
  END IF;
  IF NOT claim_op(p_op_id, v_shop, 'adjust_customer_balance') THEN
    SELECT outstanding_balance INTO v_new FROM customers WHERE id = p_customer_id;
    RETURN v_new;
  END IF;
  UPDATE customers SET outstanding_balance = COALESCE(outstanding_balance, 0) + p_delta
   WHERE id = p_customer_id RETURNING outstanding_balance INTO v_new;
  RETURN v_new;
END;
$$;

CREATE OR REPLACE FUNCTION adjust_supplier_balance_v2(p_supplier_id INTEGER, p_delta NUMERIC, p_op_id UUID DEFAULT NULL)
RETURNS NUMERIC LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_shop INTEGER;
  v_new  NUMERIC;
BEGIN
  SELECT shop_id INTO v_shop FROM suppliers WHERE id = p_supplier_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Supplier % not found or not accessible', p_supplier_id USING ERRCODE = 'P0002';
  END IF;
  IF NOT claim_op(p_op_id, v_shop, 'adjust_supplier_balance') THEN
    SELECT outstanding_balance INTO v_new FROM suppliers WHERE id = p_supplier_id;
    RETURN v_new;
  END IF;
  UPDATE suppliers SET outstanding_balance = COALESCE(outstanding_balance, 0) + p_delta
   WHERE id = p_supplier_id RETURNING outstanding_balance INTO v_new;
  RETURN v_new;
END;
$$;

-- ── 7. complete_sale: header + lines + stock + customer balance, all or nothing ──
-- p_sale   : sales row as JSON (no id). client_ref makes a retry return the first result.
-- p_items  : [{product_id, product_name, quantity, unit_price, cost_price, line_total}]
-- p_options: {"allow_negative": bool}  (true for offline replays: the goods already left)
CREATE OR REPLACE FUNCTION complete_sale(p_sale JSONB, p_items JSONB, p_options JSONB DEFAULT '{}'::jsonb)
RETURNS JSONB LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_ref     UUID := NULLIF(p_sale->>'client_ref', '')::uuid;
  v_sale    JSONB;
  v_sale_id INTEGER;
  v_items   JSONB := '[]'::jsonb;
  v_item    JSONB;
  v_row     JSONB;
  v_new     NUMERIC;
  v_net     NUMERIC;
  v_paid    NUMERIC;
  v_unpaid  NUMERIC;
  v_is_sale BOOLEAN := COALESCE(p_sale->>'sale_type', 'sale') <> 'quotation';
  v_allow_neg BOOLEAN := COALESCE((p_options->>'allow_negative')::boolean, false);
BEGIN
  IF v_ref IS NOT NULL THEN
    SELECT to_jsonb(s.*) INTO v_sale FROM sales s WHERE s.client_ref = v_ref;
    IF v_sale IS NOT NULL THEN
      SELECT COALESCE(jsonb_agg(to_jsonb(si.*)), '[]'::jsonb) INTO v_items FROM sale_items si WHERE si.sale_id = (v_sale->>'id')::integer;
      RETURN jsonb_build_object('sale', v_sale, 'items', v_items, 'duplicate', true);
    END IF;
  END IF;

  v_sale := insert_json_row('sales', p_sale - 'id');
  v_sale_id := (v_sale->>'id')::integer;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) LOOP
    v_row := insert_json_row('sale_items', (v_item - 'id') || jsonb_build_object('sale_id', v_sale_id));
    v_items := v_items || jsonb_build_array(v_row);
    IF v_is_sale AND (v_item->>'product_id') IS NOT NULL THEN
      v_new := adjust_product_stock_v2((v_item->>'product_id')::integer, -((v_item->>'quantity')::numeric),
                 NULL, 'sale', 'sales', v_sale_id::text, NULL, p_sale->>'created_by', NULLIF(v_item->>'cost_price', '')::numeric);
      IF v_new < 0 AND NOT v_allow_neg THEN
        RAISE EXCEPTION 'insufficient_stock: % (short by %)', COALESCE(v_item->>'product_name', v_item->>'product_id'), -v_new
          USING ERRCODE = 'P0001';
      END IF;
    END IF;
  END LOOP;

  IF v_is_sale AND (p_sale->>'customer_id') IS NOT NULL THEN
    v_net    := GREATEST(0, COALESCE((p_sale->>'total_amount')::numeric, 0) - COALESCE((p_sale->>'discount')::numeric, 0));
    v_paid   := LEAST(v_net, GREATEST(0, COALESCE((p_sale->>'paid_amount')::numeric, 0)));
    v_unpaid := v_net - v_paid;
    IF v_unpaid > 0 THEN
      PERFORM adjust_customer_balance_v2((p_sale->>'customer_id')::integer, v_unpaid, NULL);
    END IF;
  END IF;

  RETURN jsonb_build_object('sale', v_sale, 'items', v_items, 'duplicate', false);
END;
$$;

-- ── 8. complete_purchase: header + lines + stock + cost + supplier balance/payment ──
-- p_purchase: purchases row as JSON (total_amount = after discount, discount, paid_amount, payment_type)
-- p_items   : [{product_id, product_name, quantity, unit_price, total_price}]
-- p_options : {"cost_method": "last" | "average"}
CREATE OR REPLACE FUNCTION complete_purchase(p_purchase JSONB, p_items JSONB, p_options JSONB DEFAULT '{}'::jsonb)
RETURNS JSONB LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_ref      UUID := NULLIF(p_purchase->>'client_ref', '')::uuid;
  v_pur      JSONB;
  v_pur_id   INTEGER;
  v_items    JSONB := '[]'::jsonb;
  v_item     JSONB;
  v_row      JSONB;
  v_gross    NUMERIC := 0;
  v_ratio    NUMERIC := 0;
  v_disc     NUMERIC := COALESCE((p_purchase->>'discount')::numeric, 0);
  v_total    NUMERIC := COALESCE((p_purchase->>'total_amount')::numeric, 0);
  v_paid     NUMERIC := LEAST(COALESCE((p_purchase->>'total_amount')::numeric, 0), GREATEST(0, COALESCE((p_purchase->>'paid_amount')::numeric, 0)));
  v_method   TEXT := COALESCE(p_options->>'cost_method', 'last');
  v_qty      NUMERIC;
  v_net_cost NUMERIC;
  v_on_hand  NUMERIC;
  v_old_cost NUMERIC;
  v_shop     INTEGER := (p_purchase->>'shop_id')::integer;
  v_supplier INTEGER := NULLIF(p_purchase->>'supplier_id', '')::integer;
BEGIN
  IF v_ref IS NOT NULL THEN
    SELECT to_jsonb(p.*) INTO v_pur FROM purchases p WHERE p.client_ref = v_ref;
    IF v_pur IS NOT NULL THEN
      SELECT COALESCE(jsonb_agg(to_jsonb(pi.*)), '[]'::jsonb) INTO v_items FROM purchase_items pi WHERE pi.purchase_id = (v_pur->>'id')::integer;
      RETURN jsonb_build_object('purchase', v_pur, 'items', v_items, 'duplicate', true);
    END IF;
  END IF;

  SELECT COALESCE(SUM((e->>'unit_price')::numeric * (e->>'quantity')::numeric), 0) INTO v_gross
    FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) e;
  IF v_gross > 0 THEN v_ratio := LEAST(1, GREATEST(0, v_disc / v_gross)); END IF;

  v_pur := insert_json_row('purchases', p_purchase - 'id');
  v_pur_id := (v_pur->>'id')::integer;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) LOOP
    v_row := insert_json_row('purchase_items', (v_item - 'id') || jsonb_build_object('purchase_id', v_pur_id));
    v_items := v_items || jsonb_build_array(v_row);
    IF (v_item->>'product_id') IS NULL THEN CONTINUE; END IF;
    v_qty := (v_item->>'quantity')::numeric;
    v_net_cost := ROUND((v_item->>'unit_price')::numeric * (1 - v_ratio), 2);

    SELECT GREATEST(0, COALESCE(stock_quantity, 0)), COALESCE(cost_price, 0)
      INTO v_on_hand, v_old_cost FROM products WHERE id = (v_item->>'product_id')::integer FOR UPDATE;

    UPDATE products SET cost_price = CASE
        WHEN v_method = 'average' AND v_old_cost > 0 AND v_on_hand + v_qty > 0
          THEN ROUND((v_on_hand * v_old_cost + v_qty * v_net_cost) / (v_on_hand + v_qty), 2)
        ELSE v_net_cost END
     WHERE id = (v_item->>'product_id')::integer;

    PERFORM adjust_product_stock_v2((v_item->>'product_id')::integer, v_qty, NULL, 'purchase', 'purchases',
              v_pur_id::text, NULL, p_purchase->>'created_by', v_net_cost);
  END LOOP;

  IF v_supplier IS NOT NULL THEN
    -- What is still owed raises the supplier balance; what was paid is a payment row
    IF v_total - v_paid > 0 THEN
      PERFORM adjust_supplier_balance_v2(v_supplier, v_total - v_paid, NULL);
    END IF;
    IF v_paid > 0 THEN
      PERFORM insert_json_row('supplier_payments', jsonb_build_object(
        'shop_id', v_shop, 'supplier_id', v_supplier, 'amount', v_paid, 'payment_type', 'payment',
        'payment_mode', COALESCE(p_options->>'payment_mode', 'cash'),
        'note', format('Paid for Purchase PR-%s', right(v_pur_id::text, 6))));
    END IF;
  END IF;

  RETURN jsonb_build_object('purchase', v_pur, 'items', v_items, 'duplicate', false);
END;
$$;

-- ── 9. process_sale_return: dated return document, all effects in one go ──────
-- p_return: {client_ref, sale_id, refund_type: 'cash'|'credit', created_by,
--            lines: [{sale_item_id, qty}]}
-- Refund rules match src/services/integrity.js splitReturnRefund.
CREATE OR REPLACE FUNCTION process_sale_return(p_return JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_ref       UUID := NULLIF(p_return->>'client_ref', '')::uuid;
  v_doc       JSONB;
  v_sale      sales%ROWTYPE;
  v_line      JSONB;
  v_item      sale_items%ROWTYPE;
  v_qty       NUMERIC;
  v_lines     JSONB := '[]'::jsonb;
  v_gross     NUMERIC := 0;   -- value of goods not yet returned
  v_ret_gross NUMERIC := 0;
  v_cost      NUMERIC := 0;
  v_ratio     NUMERIC := 0;
  v_refund    NUMERIC;
  v_share     NUMERIC;
  v_net       NUMERIC;
  v_paid      NUMERIC;
  v_unpaid    NUMERIC;
  v_balance   NUMERIC;
  v_credit    NUMERIC := 0;
  v_cash      NUMERIC;
  v_tag       TEXT;
BEGIN
  IF v_ref IS NOT NULL THEN
    SELECT to_jsonb(r.*) INTO v_doc FROM sale_returns r WHERE r.client_ref = v_ref;
    IF v_doc IS NOT NULL THEN RETURN jsonb_build_object('return', v_doc, 'duplicate', true); END IF;
  END IF;

  SELECT * INTO v_sale FROM sales WHERE id = (p_return->>'sale_id')::integer FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sale % not found or not accessible', p_return->>'sale_id' USING ERRCODE = 'P0002'; END IF;

  SELECT COALESCE(SUM(COALESCE(unit_price, 0) * (COALESCE(quantity, 0) - COALESCE(returned_qty, 0))), 0)
    INTO v_gross FROM sale_items WHERE sale_id = v_sale.id;
  IF v_gross > 0 THEN v_ratio := LEAST(1, GREATEST(0, COALESCE(v_sale.discount, 0) / v_gross)); END IF;

  FOR v_line IN SELECT * FROM jsonb_array_elements(COALESCE(p_return->'lines', '[]'::jsonb)) LOOP
    v_qty := (v_line->>'qty')::numeric;
    IF v_qty IS NULL OR v_qty <= 0 THEN CONTINUE; END IF;
    SELECT * INTO v_item FROM sale_items WHERE id = (v_line->>'sale_item_id')::integer AND sale_id = v_sale.id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Sale line % not found', v_line->>'sale_item_id' USING ERRCODE = 'P0002'; END IF;
    IF v_qty > COALESCE(v_item.quantity, 0) - COALESCE(v_item.returned_qty, 0) THEN
      RAISE EXCEPTION 'return_too_many: % (max %)', v_item.product_name, COALESCE(v_item.quantity, 0) - COALESCE(v_item.returned_qty, 0) USING ERRCODE = 'P0001';
    END IF;
    UPDATE sale_items SET returned_qty = COALESCE(returned_qty, 0) + v_qty WHERE id = v_item.id;
    IF v_item.product_id IS NOT NULL THEN
      PERFORM adjust_product_stock_v2(v_item.product_id, v_qty, NULL, 'sale_return', 'sales', v_sale.id::text, NULL, p_return->>'created_by', v_item.cost_price);
    END IF;
    v_ret_gross := v_ret_gross + COALESCE(v_item.unit_price, 0) * v_qty;
    v_cost := v_cost + COALESCE(v_item.cost_price, 0) * v_qty;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'sale_item_id', v_item.id, 'product_id', v_item.product_id, 'product_name', v_item.product_name,
      'qty', v_qty, 'unit_price', v_item.unit_price, 'cost_price', v_item.cost_price));
  END LOOP;
  IF v_ret_gross = 0 THEN RAISE EXCEPTION 'Nothing to return' USING ERRCODE = 'P0001'; END IF;

  v_refund := ROUND(v_ret_gross * (1 - v_ratio), 2);
  v_share  := ROUND(v_ret_gross * v_ratio, 2);
  v_net    := GREATEST(0, COALESCE(v_sale.total_amount, 0) - COALESCE(v_sale.discount, 0));
  v_paid   := LEAST(v_net, GREATEST(0, COALESCE(v_sale.paid_amount, 0)));
  v_unpaid := v_net - v_paid;

  IF v_sale.customer_id IS NOT NULL THEN
    SELECT GREATEST(0, COALESCE(outstanding_balance, 0)) INTO v_balance FROM customers WHERE id = v_sale.customer_id;
    IF COALESCE(p_return->>'refund_type', 'cash') = 'credit' THEN
      v_credit := v_refund;
    ELSE
      v_credit := LEAST(v_refund, v_unpaid, COALESCE(v_balance, v_unpaid));
    END IF;
  END IF;
  v_credit := ROUND(v_credit, 2);
  v_cash   := ROUND(v_refund - v_credit, 2);

  UPDATE sales SET
    total_amount = ROUND(GREATEST(0, COALESCE(total_amount, 0) - v_ret_gross), 2),
    discount     = ROUND(GREATEST(0, COALESCE(discount, 0) - v_share), 2),
    paid_amount  = ROUND(GREATEST(0, COALESCE(paid_amount, 0) - v_cash), 2)
  WHERE id = v_sale.id;

  v_tag := format('Invoice #%s', right(v_sale.id::text, 6));
  IF v_credit > 0 THEN
    PERFORM adjust_customer_balance_v2(v_sale.customer_id, -v_credit, NULL);
    PERFORM insert_json_row('customer_payments', jsonb_build_object('shop_id', v_sale.shop_id, 'customer_id', v_sale.customer_id,
      'amount', -v_credit, 'payment_type', 'return', 'note', format('Return from %s (Credited to Balance)', v_tag)));
  END IF;
  IF v_cash > 0 THEN
    PERFORM insert_json_row('customer_payments', jsonb_build_object('shop_id', v_sale.shop_id, 'customer_id', v_sale.customer_id,
      'amount', -v_cash, 'payment_type', 'refund', 'note', format('Cash Refund from %s', v_tag)));
  END IF;

  v_doc := insert_json_row('sale_returns', jsonb_build_object(
    'shop_id', v_sale.shop_id, 'sale_id', v_sale.id, 'customer_id', v_sale.customer_id,
    'return_gross', v_ret_gross, 'discount_share', v_share, 'refund_total', v_refund,
    'cash_refund', v_cash, 'credit_refund', v_credit, 'cost_total', v_cost,
    'lines', v_lines, 'created_by', p_return->>'created_by', 'client_ref', v_ref));
  RETURN jsonb_build_object('return', v_doc, 'duplicate', false);
END;
$$;

-- ── 10. process_purchase_return ───────────────────────────────────────────
-- p_return: {client_ref, purchase_id, created_by, lines: [{purchase_item_id, qty}]}
CREATE OR REPLACE FUNCTION process_purchase_return(p_return JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_ref       UUID := NULLIF(p_return->>'client_ref', '')::uuid;
  v_doc       JSONB;
  v_pur       purchases%ROWTYPE;
  v_line      JSONB;
  v_item      purchase_items%ROWTYPE;
  v_qty       NUMERIC;
  v_lines     JSONB := '[]'::jsonb;
  v_gross     NUMERIC := 0;
  v_ret_gross NUMERIC := 0;
  v_ratio     NUMERIC := 0;
  v_disc      NUMERIC := 0;
  v_refund    NUMERIC;
  v_share     NUMERIC;
  v_balance   NUMERIC := 0;
  v_has_disc  BOOLEAN;
BEGIN
  IF v_ref IS NOT NULL THEN
    SELECT to_jsonb(r.*) INTO v_doc FROM purchase_returns r WHERE r.client_ref = v_ref;
    IF v_doc IS NOT NULL THEN RETURN jsonb_build_object('return', v_doc, 'duplicate', true); END IF;
  END IF;

  SELECT * INTO v_pur FROM purchases WHERE id = (p_return->>'purchase_id')::integer FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Purchase % not found or not accessible', p_return->>'purchase_id' USING ERRCODE = 'P0002'; END IF;
  v_has_disc := EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'purchases' AND column_name = 'discount');
  IF v_has_disc THEN v_disc := COALESCE((to_jsonb(v_pur)->>'discount')::numeric, 0); END IF;

  SELECT COALESCE(SUM(COALESCE(unit_price, 0) * (COALESCE(quantity, 0) - COALESCE(returned_qty, 0))), 0)
    INTO v_gross FROM purchase_items WHERE purchase_id = v_pur.id;
  IF v_gross > 0 THEN v_ratio := LEAST(1, GREATEST(0, v_disc / v_gross)); END IF;

  FOR v_line IN SELECT * FROM jsonb_array_elements(COALESCE(p_return->'lines', '[]'::jsonb)) LOOP
    v_qty := (v_line->>'qty')::numeric;
    IF v_qty IS NULL OR v_qty <= 0 THEN CONTINUE; END IF;
    SELECT * INTO v_item FROM purchase_items WHERE id = (v_line->>'purchase_item_id')::integer AND purchase_id = v_pur.id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Purchase line % not found', v_line->>'purchase_item_id' USING ERRCODE = 'P0002'; END IF;
    IF v_qty > COALESCE(v_item.quantity, 0) - COALESCE(v_item.returned_qty, 0) THEN
      RAISE EXCEPTION 'return_too_many: % (max %)', v_item.product_name, COALESCE(v_item.quantity, 0) - COALESCE(v_item.returned_qty, 0) USING ERRCODE = 'P0001';
    END IF;
    UPDATE purchase_items SET returned_qty = COALESCE(returned_qty, 0) + v_qty WHERE id = v_item.id;
    IF v_item.product_id IS NOT NULL THEN
      PERFORM adjust_product_stock_v2(v_item.product_id, -v_qty, NULL, 'purchase_return', 'purchases', v_pur.id::text, NULL, p_return->>'created_by', NULL);
    END IF;
    v_ret_gross := v_ret_gross + COALESCE(v_item.unit_price, 0) * v_qty;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'purchase_item_id', v_item.id, 'product_id', v_item.product_id, 'product_name', v_item.product_name,
      'qty', v_qty, 'unit_price', v_item.unit_price));
  END LOOP;
  IF v_ret_gross = 0 THEN RAISE EXCEPTION 'Nothing to return' USING ERRCODE = 'P0001'; END IF;

  v_refund := ROUND(v_ret_gross * (1 - v_ratio), 2);
  v_share  := ROUND(v_ret_gross * v_ratio, 2);

  IF v_has_disc THEN
    EXECUTE 'UPDATE purchases SET total_amount = ROUND(GREATEST(0, COALESCE(total_amount,0) - $1), 2), discount = ROUND(GREATEST(0, COALESCE(discount,0) - $2), 2) WHERE id = $3'
      USING v_refund, v_share, v_pur.id;
  ELSE
    UPDATE purchases SET total_amount = ROUND(GREATEST(0, COALESCE(total_amount, 0) - v_refund), 2) WHERE id = v_pur.id;
  END IF;

  -- The refund comes off what the shop owes the supplier (for a bill already paid
  -- this becomes an advance / credit note with the supplier). This keeps the stored
  -- balance equal to the ledger: the purchase total drops by the refund and the
  -- 'return' row is a record only.
  IF v_pur.supplier_id IS NOT NULL THEN
    v_balance := v_refund;
    IF v_balance > 0 THEN
      PERFORM adjust_supplier_balance_v2(v_pur.supplier_id, -v_balance, NULL);
      PERFORM insert_json_row('supplier_payments', jsonb_build_object('shop_id', v_pur.shop_id, 'supplier_id', v_pur.supplier_id,
        'amount', -v_balance, 'payment_type', 'return', 'note', format('Return from Purchase PR-%s', right(v_pur.id::text, 6))));
    END IF;
  END IF;

  v_doc := insert_json_row('purchase_returns', jsonb_build_object(
    'shop_id', v_pur.shop_id, 'purchase_id', v_pur.id, 'supplier_id', v_pur.supplier_id,
    'return_gross', v_ret_gross, 'discount_share', v_share, 'refund_total', v_refund,
    'balance_change', v_balance, 'lines', v_lines, 'created_by', p_return->>'created_by', 'client_ref', v_ref));
  RETURN jsonb_build_object('return', v_doc, 'duplicate', false);
END;
$$;

GRANT EXECUTE ON FUNCTION claim_op(UUID, INTEGER, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION insert_json_row(TEXT, JSONB) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION adjust_product_stock_v2(INTEGER, NUMERIC, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION adjust_customer_balance_v2(INTEGER, NUMERIC, UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION adjust_supplier_balance_v2(INTEGER, NUMERIC, UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION complete_sale(JSONB, JSONB, JSONB) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION complete_purchase(JSONB, JSONB, JSONB) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION process_sale_return(JSONB) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION process_purchase_return(JSONB) TO anon, authenticated;

-- PostgREST caches the schema; make the new functions visible right away
NOTIFY pgrst, 'reload schema';
