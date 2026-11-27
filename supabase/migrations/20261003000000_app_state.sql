-- ============================================
-- APP STATE (key-value store for cron pipeline state)
-- Date: October 3, 2026
--
-- Replaces data/*.json files (pipeline-state.json,
-- clv-snapshots.json, clv-features.json,
-- predicted-lineups.json, market-consensus.json)
-- which cannot be written on Vercel serverless
-- (read-only filesystem).
--
-- Access:
-- - service_role: full read/write (cron routes)
-- - authenticated admins: read-only
-- ============================================

-- Prerequisite helpers (safe to re-create; also defined in cron infra migration)
CREATE OR REPLACE FUNCTION public.is_service_role()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT current_setting('request.jwt.claims', true)::json->>'role' = 'service_role'
  OR current_setting('role') = 'service_role';
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  );
$$;

CREATE TABLE IF NOT EXISTS app_state (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE app_state ENABLE ROW LEVEL SECURITY;

-- Service role manages all state (cron/pipeline writes)
DROP POLICY IF EXISTS "Service role manages app_state" ON app_state;
CREATE POLICY "Service role manages app_state" ON app_state
  FOR ALL USING (public.is_service_role() OR current_setting('role') = 'service_role');

-- Authenticated admins can read state (admin dashboard)
DROP POLICY IF EXISTS "Admins can read app_state" ON app_state;
CREATE POLICY "Admins can read app_state" ON app_state
  FOR SELECT USING (auth.role() = 'authenticated' AND public.is_admin());

GRANT SELECT ON app_state TO authenticated;
GRANT ALL ON app_state TO service_role;
REVOKE ALL ON app_state FROM anon;

COMMENT ON TABLE app_state IS 'Generic key-value JSONB store replacing data/*.json files on serverless';
