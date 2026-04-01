-- Customer payments: add bill_number + new detail fields
ALTER TABLE customer_payments ADD COLUMN IF NOT EXISTS bill_number TEXT;
ALTER TABLE customer_payments ADD COLUMN IF NOT EXISTS details TEXT;
ALTER TABLE customer_payments ADD COLUMN IF NOT EXISTS payment_mode TEXT;
ALTER TABLE customer_payments ADD COLUMN IF NOT EXISTS transaction_ref TEXT;

-- Supplier payments: add new detail fields (bill_number may already exist)
ALTER TABLE supplier_payments ADD COLUMN IF NOT EXISTS bill_number TEXT;
ALTER TABLE supplier_payments ADD COLUMN IF NOT EXISTS details TEXT;
ALTER TABLE supplier_payments ADD COLUMN IF NOT EXISTS payment_mode TEXT;
ALTER TABLE supplier_payments ADD COLUMN IF NOT EXISTS transaction_ref TEXT;
