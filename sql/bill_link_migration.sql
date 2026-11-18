-- ============================================================================
-- Bill link + QR code: every bill gets a random code; the QR printed on the bill
-- opens /b/<code>, a public page showing that ONE bill (no login).
-- Run in the Supabase SQL Editor. Idempotent: safe to re-run.
--
-- Security model
--  * bill_token is 32 random hex characters (128 bits): it cannot be guessed.
--    The app makes it when the sale is created (so offline bills can print a QR
--    straight away); the database default covers any other insert and the
--    backfill below covers old bills.
--  * The public read is ONE SECURITY DEFINER function, get_bill(token). It
--    returns display fields only: shop name/contact, bill number, date, customer
--    name, items with selling prices, totals and payment. No cost prices, no
--    customer balance or phone, no other bills.
-- ============================================================================

ALTER TABLE sales ADD COLUMN IF NOT EXISTS bill_token TEXT;
ALTER TABLE sales ALTER COLUMN bill_token SET DEFAULT replace(gen_random_uuid()::text, '-', '');
UPDATE sales SET bill_token = replace(gen_random_uuid()::text, '-', '') WHERE bill_token IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS sales_bill_token_key ON sales (bill_token) WHERE bill_token IS NOT NULL;

CREATE OR REPLACE FUNCTION get_bill(p_token TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_sale  sales%ROWTYPE;
  v_shop  JSONB;
  v_cust  TEXT;
  v_items JSONB;
BEGIN
  IF p_token IS NULL OR p_token !~ '^[0-9a-f]{32}$' THEN RETURN NULL; END IF;

  SELECT * INTO v_sale FROM sales WHERE bill_token = p_token;
  IF NOT FOUND THEN RETURN NULL; END IF;

  -- Only columns every shops table has here; invoice prefix / logo when present
  SELECT jsonb_build_object('name', s.name, 'phone', s.phone, 'address', s.address)
         || jsonb_strip_nulls(jsonb_build_object(
              'invoice_prefix', to_jsonb(s.*)->>'invoice_prefix',
              'logo_url', to_jsonb(s.*)->>'logo_url',
              'invoice_footer', to_jsonb(s.*)->>'invoice_footer'))
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
      'sale_type', COALESCE(v_sale.sale_type, 'sale'),
      'customer_name', COALESCE(v_cust, v_sale.customer_name),
      'total_amount', COALESCE(v_sale.total_amount, 0),
      'discount', COALESCE(v_sale.discount, 0),
      'paid_amount', COALESCE(v_sale.paid_amount, 0),
      'payment_type', v_sale.payment_type,
      'price_tier', to_jsonb(v_sale)->>'price_tier'),
    'items', v_items
  );
END;
$$;

REVOKE ALL ON FUNCTION get_bill(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_bill(TEXT) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
