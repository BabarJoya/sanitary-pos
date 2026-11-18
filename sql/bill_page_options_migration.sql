-- ============================================================================
-- Bill page options: the page a bill QR opens (/b/<code>) can show the actual
-- printed bill (80mm receipt or A4 invoice, with its QR) for viewing, printing
-- and PDF download. The shop decides in Settings → Print.
-- Run AFTER sql/bill_link_migration.sql. Idempotent: safe to re-run.
-- ============================================================================

ALTER TABLE shops ADD COLUMN IF NOT EXISTS bill_page_full BOOLEAN NOT NULL DEFAULT TRUE;

-- Shop admin turns the printed-bill view on / off. shops rows are not directly
-- updatable by shop sessions, so this checks the caller's session for that shop.
CREATE OR REPLACE FUNCTION set_bill_page_options(p_shop_id INTEGER, p_show_full BOOLEAN)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT is_valid_session(p_shop_id) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  UPDATE shops SET bill_page_full = COALESCE(p_show_full, TRUE) WHERE id = p_shop_id;
  RETURN COALESCE(p_show_full, TRUE);
END;
$$;
REVOKE ALL ON FUNCTION set_bill_page_options(INTEGER, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION set_bill_page_options(INTEGER, BOOLEAN) TO anon, authenticated;

-- get_bill: same safety rules as before (display fields only — no cost prices,
-- customer balance or phone), plus what is needed to draw the printed bill.
CREATE OR REPLACE FUNCTION get_bill(p_token TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_sale  sales%ROWTYPE;
  v_s     JSONB;
  v_shop  JSONB;
  v_cust  TEXT;
  v_items JSONB;
BEGIN
  IF p_token IS NULL OR p_token !~ '^[0-9a-f]{32}$' THEN RETURN NULL; END IF;

  SELECT * INTO v_sale FROM sales WHERE bill_token = p_token;
  IF NOT FOUND THEN RETURN NULL; END IF;
  v_s := to_jsonb(v_sale);

  SELECT jsonb_build_object('name', s.name, 'phone', s.phone, 'address', s.address)
         || jsonb_strip_nulls(jsonb_build_object(
              'invoice_prefix',   to_jsonb(s.*)->>'invoice_prefix',
              'logo_url',         to_jsonb(s.*)->>'logo_url',
              'invoice_footer',   to_jsonb(s.*)->>'invoice_footer',
              'quotation_footer', to_jsonb(s.*)->>'quotation_footer',
              'print_template',   to_jsonb(s.*)->>'print_template',
              'print_size',       to_jsonb(s.*)->>'print_size',
              'bill_page_full',   COALESCE((to_jsonb(s.*)->>'bill_page_full')::boolean, TRUE)))
    INTO v_shop FROM shops s WHERE s.id = v_sale.shop_id;

  IF v_sale.customer_id IS NOT NULL THEN
    SELECT name INTO v_cust FROM customers WHERE id = v_sale.customer_id;
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'product_name', si.product_name, 'quantity', si.quantity,
           'unit_price', si.unit_price, 'returned_qty', COALESCE(si.returned_qty, 0)) ORDER BY si.id), '[]'::jsonb)
    INTO v_items FROM sale_items si WHERE si.sale_id = v_sale.id;

  RETURN jsonb_build_object(
    'shop', COALESCE(v_shop, '{}'::jsonb),
    'bill', jsonb_build_object(
      'id', v_sale.id,
      'created_at', v_sale.created_at,
      'sale_type', COALESCE(v_s->>'sale_type', 'sale'),
      'customer_name', COALESCE(v_cust, v_s->>'customer_name'),
      'total_amount', COALESCE(v_sale.total_amount, 0),
      'discount', COALESCE(v_sale.discount, 0),
      'paid_amount', COALESCE(v_sale.paid_amount, 0),
      'payment_type', v_s->>'payment_type',
      'payment_details', v_s->'payment_details',
      'online_provider', v_s->>'online_provider',
      'price_tier', v_s->>'price_tier',
      'created_by', v_s->>'created_by'),
    'items', v_items
  );
END;
$$;

REVOKE ALL ON FUNCTION get_bill(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_bill(TEXT) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
