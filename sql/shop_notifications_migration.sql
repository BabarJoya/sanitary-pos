-- ============================================================================
-- Shop notifications: targeted in-app messages (trial ending, buy a plan, ...)
-- Run in the Supabase SQL Editor AFTER sql/superadmin_edge_functions_migration.sql.
-- Idempotent: safe to re-run.
--
-- The existing `announcements` table becomes the delivery table for in-app
-- notifications:
--   * shop_id NULL      -> shown to every shop (global announcement)
--   * shop_id = <shop>  -> shown only to that shop (trial reminders, billing)
-- Superadmins write rows through the `admin-api` Edge Function (service role),
-- which already allow-lists `announcements`. Shops only read.
-- ============================================================================

-- 1. Columns used by targeted notifications.
ALTER TABLE announcements ADD COLUMN IF NOT EXISTS shop_id     INTEGER;
ALTER TABLE announcements ADD COLUMN IF NOT EXISTS title       TEXT;
ALTER TABLE announcements ADD COLUMN IF NOT EXISTS category    TEXT    DEFAULT 'general';  -- general | trial_ending | trial_expired | payment_due | plan_upgrade
ALTER TABLE announcements ADD COLUMN IF NOT EXISTS cta_label   TEXT;                       -- e.g. 'Buy Plan'
ALTER TABLE announcements ADD COLUMN IF NOT EXISTS cta_url     TEXT;                       -- in-app path ('/settings#plan') or https:// / wa.me link
ALTER TABLE announcements ADD COLUMN IF NOT EXISTS show_popup  BOOLEAN DEFAULT FALSE;      -- also open a dialog when the shop opens the app
ALTER TABLE announcements ADD COLUMN IF NOT EXISTS dismissible BOOLEAN DEFAULT TRUE;
ALTER TABLE announcements ADD COLUMN IF NOT EXISTS expires_at  TIMESTAMPTZ;
ALTER TABLE announcements ADD COLUMN IF NOT EXISTS created_by  TEXT;

-- Remove a shop's notifications together with the shop.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'announcements_shop_id_fkey'
    ) THEN
        DELETE FROM announcements a
        WHERE a.shop_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM shops s WHERE s.id = a.shop_id);
        ALTER TABLE announcements
            ADD CONSTRAINT announcements_shop_id_fkey
            FOREIGN KEY (shop_id) REFERENCES shops (id) ON DELETE CASCADE;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS announcements_shop_active_idx
    ON announcements (shop_id, is_active, created_at DESC);

-- Only safe link shapes may be stored as call-to-action targets.
ALTER TABLE announcements DROP CONSTRAINT IF EXISTS announcements_cta_url_check;
ALTER TABLE announcements ADD CONSTRAINT announcements_cta_url_check
    CHECK (cta_url IS NULL OR cta_url ~ '^(/[^/]|https://)');

-- 2. Read access.
--    Previously every active row was readable by anyone, so a shop could read
--    messages aimed at other shops. Now: global rows are public, shop rows are
--    readable only with a valid session for that shop. Expired rows are hidden.
ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON announcements FROM anon, authenticated;
GRANT SELECT ON announcements TO anon, authenticated;

DROP POLICY IF EXISTS "Announcements Read" ON announcements;
CREATE POLICY "Announcements Read" ON announcements
AS PERMISSIVE FOR SELECT
TO anon, authenticated
USING (
    is_active = TRUE
    AND (expires_at IS NULL OR expires_at > NOW())
    AND (shop_id IS NULL OR is_valid_session(shop_id))
);
