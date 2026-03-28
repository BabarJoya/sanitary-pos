-- Migration: brand_categories junction table
-- Run this in your Supabase SQL editor

CREATE TABLE IF NOT EXISTS brand_categories (
  id bigint primary key generated always as identity,
  brand_id uuid references brands(id) on delete cascade,
  category_id integer references categories(id) on delete cascade,
  shop_id integer,
  unique(brand_id, category_id)
);

-- Row Level Security (permissive — app handles shop isolation via shop_id filter)
ALTER TABLE brand_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "allow_access" ON brand_categories USING (true) WITH CHECK (true);

-- Index for fast lookups by brand
CREATE INDEX IF NOT EXISTS idx_brand_categories_brand_id ON brand_categories(brand_id);
CREATE INDEX IF NOT EXISTS idx_brand_categories_shop_id ON brand_categories(shop_id);

-- Grant access to anon and authenticated roles
GRANT ALL ON brand_categories TO anon;
GRANT ALL ON brand_categories TO authenticated;
