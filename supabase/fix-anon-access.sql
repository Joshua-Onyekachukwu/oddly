-- ============================================
-- BLOCK ANON READ ACCESS TO SENSITIVE TABLES
-- ============================================
-- Run this in Supabase SQL Editor.
-- Only service_role can read/write these tables.
-- Authenticated users CANNOT read them either.
-- All API routes use the service_role key server-side.
-- ============================================

-- ── predictions ──
ALTER TABLE predictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE predictions FORCE ROW LEVEL SECURITY;

-- Drop any existing policies
DROP POLICY IF EXISTS "Anyone can view predictions" ON predictions;
DROP POLICY IF EXISTS "Admins can manage predictions" ON predictions;
DROP POLICY IF EXISTS "Service role manages predictions" ON predictions;

-- Only service_role can do anything
CREATE POLICY "Service role manages predictions" ON predictions
  FOR ALL USING (public.is_service_role());

-- ── odds_snapshots ──
ALTER TABLE odds_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE odds_snapshots FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view odds" ON odds_snapshots;
DROP POLICY IF EXISTS "Admins can manage odds" ON odds_snapshots;
DROP POLICY IF EXISTS "Service role manages odds" ON odds_snapshots;

CREATE POLICY "Service role manages odds" ON odds_snapshots
  FOR ALL USING (public.is_service_role());

-- ── model_performance ──
ALTER TABLE model_performance ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_performance FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view model performance" ON model_performance;
DROP POLICY IF EXISTS "Admins can manage model performance" ON model_performance;
DROP POLICY IF EXISTS "Service role manages model performance" ON model_performance;

CREATE POLICY "Service role manages model performance" ON model_performance
  FOR ALL USING (public.is_service_role());

-- ── Revoke grants ──
REVOKE ALL ON predictions FROM anon;
REVOKE ALL ON odds_snapshots FROM anon;
REVOKE ALL ON model_performance FROM anon;
REVOKE ALL ON predictions FROM authenticated;
REVOKE ALL ON odds_snapshots FROM authenticated;
REVOKE ALL ON model_performance FROM authenticated;

-- ── Verify ──
DO $$ BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '=== ANON ACCESS BLOCKED ===';
  RAISE NOTICE '  predictions:      service_role ONLY';
  RAISE NOTICE '  odds_snapshots:   service_role ONLY';
  RAISE NOTICE '  model_performance: service_role ONLY';
  RAISE NOTICE '';
  RAISE NOTICE 'Test with anon key:';
  RAISE NOTICE '  const anon = createClient(url, anonKey);';
  RAISE NOTICE '  await anon.from("predictions").select("*"); // should return empty/error';
  RAISE NOTICE '';
END $$;
