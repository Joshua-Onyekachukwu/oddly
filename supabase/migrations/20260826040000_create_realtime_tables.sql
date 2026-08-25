-- ============================================================
-- REPLACEMENT FOR CONVEX: Realtime tables in Supabase
-- ============================================================
-- These tables replace the Convex livePick, valuePicks,
-- settlementFeed, and liveStats tables.

-- 1. Live Pick (single row — current pick of the day)
CREATE TABLE IF NOT EXISTS live_pick (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fixture_id TEXT NOT NULL,
  match_name TEXT NOT NULL,
  market TEXT NOT NULL,
  selection TEXT NOT NULL,
  probability NUMERIC NOT NULL,
  odds NUMERIC NOT NULL,
  edge NUMERIC NOT NULL,
  composite_score NUMERIC NOT NULL,
  confidence_tier TEXT NOT NULL,
  decision TEXT NOT NULL,
  clv_signal TEXT,
  league_name TEXT,
  kickoff_time TIMESTAMPTZ NOT NULL,
  decided_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Value Picks (up to 500 rows)
CREATE TABLE IF NOT EXISTS value_picks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fixture_id TEXT,
  match_name TEXT,
  market TEXT NOT NULL,
  selection TEXT NOT NULL,
  model_prob NUMERIC NOT NULL,
  bookmaker_odds NUMERIC,
  implied_prob NUMERIC,
  edge NUMERIC,
  ev NUMERIC,
  tier TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_value_picks_tier ON value_picks(tier);
CREATE INDEX IF NOT EXISTS idx_value_picks_market ON value_picks(market);
CREATE INDEX IF NOT EXISTS idx_value_picks_edge ON value_picks(edge DESC);

-- 3. Settlement Feed (capped at 500 rows)
CREATE TABLE IF NOT EXISTS settlement_feed (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fixture_id TEXT NOT NULL,
  market TEXT NOT NULL,
  selection TEXT NOT NULL,
  model_probability NUMERIC NOT NULL,
  model_version TEXT NOT NULL,
  result TEXT NOT NULL,
  match_name TEXT,
  settled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_settlement_feed_result ON settlement_feed(result);
CREATE INDEX IF NOT EXISTS idx_settlement_feed_settled ON settlement_feed(settled_at DESC);

-- 4. Live Stats (key-value counters)
CREATE TABLE IF NOT EXISTS live_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL UNIQUE,
  value NUMERIC NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_live_stats_key ON live_stats(key);

-- ============================================================
-- RLS Policies
-- ============================================================

ALTER TABLE live_pick ENABLE ROW LEVEL SECURITY;
ALTER TABLE value_picks ENABLE ROW LEVEL SECURITY;
ALTER TABLE settlement_feed ENABLE ROW LEVEL SECURITY;
ALTER TABLE live_stats ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if any
DROP POLICY IF EXISTS "Service role manages live_pick" ON live_pick;
DROP POLICY IF EXISTS "Authenticated can read live_pick" ON live_pick;
DROP POLICY IF EXISTS "Service role manages value_picks" ON value_picks;
DROP POLICY IF EXISTS "Authenticated can read value_picks" ON value_picks;
DROP POLICY IF EXISTS "Service role manages settlement_feed" ON settlement_feed;
DROP POLICY IF EXISTS "Authenticated can read settlement_feed" ON settlement_feed;
DROP POLICY IF EXISTS "Service role manages live_stats" ON live_stats;
DROP POLICY IF EXISTS "Authenticated can read live_stats" ON live_stats;

-- live_pick: service_role writes, authenticated reads
CREATE POLICY "Service role manages live_pick" ON live_pick
  FOR ALL USING (public.is_service_role());
CREATE POLICY "Authenticated can read live_pick" ON live_pick
  FOR SELECT USING (auth.role() = 'authenticated');

-- value_picks: service_role writes, authenticated reads
CREATE POLICY "Service role manages value_picks" ON value_picks
  FOR ALL USING (public.is_service_role());
CREATE POLICY "Authenticated can read value_picks" ON value_picks
  FOR SELECT USING (auth.role() = 'authenticated');

-- settlement_feed: service_role writes, authenticated reads
CREATE POLICY "Service role manages settlement_feed" ON settlement_feed
  FOR ALL USING (public.is_service_role());
CREATE POLICY "Authenticated can read settlement_feed" ON settlement_feed
  FOR SELECT USING (auth.role() = 'authenticated');

-- live_stats: service_role writes, authenticated reads
CREATE POLICY "Service role manages live_stats" ON live_stats
  FOR ALL USING (public.is_service_role());
CREATE POLICY "Authenticated can read live_stats" ON live_stats
  FOR SELECT USING (auth.role() = 'authenticated');

-- ============================================================
-- Cleanup: auto-delete old rows (keep last 500 settlements)
-- ============================================================

CREATE OR REPLACE FUNCTION trim_settlement_feed()
RETURNS TRIGGER AS $$
BEGIN
  DELETE FROM settlement_feed
  WHERE id NOT IN (
    SELECT id FROM settlement_feed ORDER BY settled_at DESC LIMIT 500
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_trim_settlement_feed ON settlement_feed;
CREATE TRIGGER trigger_trim_settlement_feed
  AFTER INSERT ON settlement_feed
  FOR EACH STATEMENT
  EXECUTE FUNCTION trim_settlement_feed();

-- ============================================================
-- Cleanup: auto-delete old value picks (keep last 500)
-- ============================================================

CREATE OR REPLACE FUNCTION trim_value_picks()
RETURNS TRIGGER AS $$
BEGIN
  DELETE FROM value_picks
  WHERE id NOT IN (
    SELECT id FROM value_picks ORDER BY created_at DESC LIMIT 500
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_trim_value_picks ON value_picks;
CREATE TRIGGER trigger_trim_value_picks
  AFTER INSERT ON value_picks
  FOR EACH STATEMENT
  EXECUTE FUNCTION trim_value_picks();

-- ============================================================
-- RPC: upsert live stats (atomic increment)
-- ============================================================

CREATE OR REPLACE FUNCTION upsert_live_stat(p_key TEXT, p_value NUMERIC, p_mode TEXT DEFAULT 'set')
RETURNS VOID AS $$
BEGIN
  INSERT INTO live_stats (key, value, updated_at)
  VALUES (p_key, p_value, NOW())
  ON CONFLICT (key) DO UPDATE SET
    value = CASE
      WHEN p_mode = 'increment' THEN live_stats.value + p_value
      WHEN p_mode = 'decrement' THEN live_stats.value - p_value
      ELSE p_value
    END,
    updated_at = NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- GRANT
-- ============================================================

GRANT SELECT ON live_pick TO authenticated;
GRANT SELECT ON value_picks TO authenticated;
GRANT SELECT ON settlement_feed TO authenticated;
GRANT SELECT ON live_stats TO authenticated;

REVOKE ALL ON live_pick FROM anon;
REVOKE ALL ON value_picks FROM anon;
REVOKE ALL ON settlement_feed FROM anon;
REVOKE ALL ON live_stats FROM anon;
