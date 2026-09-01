-- ============================================
-- CREATE REALTIME TABLES
-- Creates the 4 missing Supabase realtime tables.
-- Safe to run multiple times (IF NOT EXISTS).
-- Date: August 27, 2026
-- ============================================

-- ============================================================
-- 1. live_pick — The current active "One Game Pick"
-- ============================================================
CREATE TABLE IF NOT EXISTS live_pick (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fixture_id TEXT,
  match_name TEXT,
  market TEXT NOT NULL DEFAULT '1X2',
  selection TEXT NOT NULL DEFAULT 'home',
  probability NUMERIC(5,4),
  odds NUMERIC(6,2),
  edge NUMERIC(5,4),
  composite_score NUMERIC(8,2),
  confidence_tier TEXT DEFAULT 'MEDIUM',
  decision TEXT DEFAULT 'WATCH',
  clv_signal TEXT,
  league_name TEXT,
  kickoff_time TIMESTAMPTZ,
  decided_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE live_pick ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role manages live_pick" ON live_pick;
CREATE POLICY "Service role manages live_pick" ON live_pick FOR ALL USING (public.is_service_role());
DROP POLICY IF EXISTS "Authenticated read live_pick" ON live_pick;
CREATE POLICY "Authenticated read live_pick" ON live_pick FOR SELECT USING (auth.role() = 'authenticated');
REVOKE ALL ON live_pick FROM anon;

ALTER TABLE live_pick REPLICA IDENTITY FULL;

-- ============================================================
-- 2. value_picks — Current value bet recommendations
-- ============================================================
CREATE TABLE IF NOT EXISTS value_picks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fixture_id TEXT,
  match_name TEXT,
  market TEXT NOT NULL,
  selection TEXT NOT NULL,
  model_prob NUMERIC(5,4),
  bookmaker_odds NUMERIC(6,2),
  implied_prob NUMERIC(5,4),
  edge NUMERIC(5,4),
  ev NUMERIC(6,2),
  tier TEXT DEFAULT 'MEDIUM',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE value_picks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role manages value_picks" ON value_picks;
CREATE POLICY "Service role manages value_picks" ON value_picks FOR ALL USING (public.is_service_role());
DROP POLICY IF EXISTS "Authenticated read value_picks" ON value_picks;
CREATE POLICY "Authenticated read value_picks" ON value_picks FOR SELECT USING (auth.role() = 'authenticated');
REVOKE ALL ON value_picks FROM anon;

ALTER TABLE value_picks REPLICA IDENTITY FULL;

-- ============================================================
-- 3. settlement_feed — Recent settlement results for realtime display
-- ============================================================
CREATE TABLE IF NOT EXISTS settlement_feed (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fixture_id TEXT,
  market TEXT NOT NULL,
  selection TEXT NOT NULL,
  model_probability NUMERIC(5,4),
  model_version TEXT DEFAULT 'v5.1',
  result TEXT,
  match_name TEXT,
  settled_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE settlement_feed ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role manages settlement_feed" ON settlement_feed;
CREATE POLICY "Service role manages settlement_feed" ON settlement_feed FOR ALL USING (public.is_service_role());
DROP POLICY IF EXISTS "Authenticated read settlement_feed" ON settlement_feed;
CREATE POLICY "Authenticated read settlement_feed" ON settlement_feed FOR SELECT USING (auth.role() = 'authenticated');
REVOKE ALL ON settlement_feed FROM anon;

ALTER TABLE settlement_feed REPLICA IDENTITY FULL;

-- Auto-cap settlement_feed at 500 rows (trim oldest on insert)
CREATE OR REPLACE FUNCTION trim_settlement_feed()
RETURNS TRIGGER AS $fn$
BEGIN
  DELETE FROM settlement_feed
  WHERE id IN (
    SELECT id FROM settlement_feed
    ORDER BY created_at DESC
    OFFSET 500
  );
  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_trim_settlement_feed ON settlement_feed;
CREATE TRIGGER trg_trim_settlement_feed
  AFTER INSERT ON settlement_feed
  FOR EACH STATEMENT
  EXECUTE FUNCTION trim_settlement_feed();

-- ============================================================
-- 4. live_stats — Key-value store for live dashboard counters
-- ============================================================
CREATE TABLE IF NOT EXISTS live_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL UNIQUE,
  value NUMERIC DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE live_stats ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role manages live_stats" ON live_stats;
CREATE POLICY "Service role manages live_stats" ON live_stats FOR ALL USING (public.is_service_role());
DROP POLICY IF EXISTS "Authenticated read live_stats" ON live_stats;
CREATE POLICY "Authenticated read live_stats" ON live_stats FOR SELECT USING (auth.role() = 'authenticated');
REVOKE ALL ON live_stats FROM anon;

ALTER TABLE live_stats REPLICA IDENTITY FULL;

-- ============================================================
-- 5. RPC: upsert_live_stat (atomic upsert for live_stats)
-- ============================================================
CREATE OR REPLACE FUNCTION upsert_live_stat(
  p_key TEXT,
  p_value NUMERIC,
  p_mode TEXT DEFAULT 'set'
)
RETURNS void AS $fn$
BEGIN
  IF p_mode = 'increment' THEN
    INSERT INTO live_stats (key, value, updated_at)
    VALUES (p_key, p_value, NOW())
    ON CONFLICT (key) DO UPDATE
      SET value = live_stats.value + EXCLUDED.value,
          updated_at = NOW();
  ELSIF p_mode = 'decrement' THEN
    INSERT INTO live_stats (key, value, updated_at)
    VALUES (p_key, p_value, NOW())
    ON CONFLICT (key) DO UPDATE
      SET value = live_stats.value - EXCLUDED.value,
          updated_at = NOW();
  ELSE
    INSERT INTO live_stats (key, value, updated_at)
    VALUES (p_key, p_value, NOW())
    ON CONFLICT (key) DO UPDATE
      SET value = EXCLUDED.value,
          updated_at = NOW();
  END IF;
END;
$fn$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 6. GRANTS
-- ============================================================
GRANT SELECT ON live_pick TO authenticated;
GRANT SELECT ON value_picks TO authenticated;
GRANT SELECT ON settlement_feed TO authenticated;
GRANT SELECT ON live_stats TO authenticated;
GRANT EXECUTE ON FUNCTION upsert_live_stat(TEXT, NUMERIC, TEXT) TO service_role;

-- ============================================================
-- 7. Enable Supabase Realtime
-- ============================================================
ALTER PUBLICATION supabase_realtime ADD TABLE live_pick;
ALTER PUBLICATION supabase_realtime ADD TABLE value_picks;
ALTER PUBLICATION supabase_realtime ADD TABLE settlement_feed;
ALTER PUBLICATION supabase_realtime ADD TABLE live_stats;

-- ============================================================
-- DONE
-- ============================================================
SELECT 'All 4 realtime tables created with RLS, triggers, and RPC.' as status;
