-- ============================================
-- ODDLY Injury & xG Tables — Run this in Supabase SQL Editor
-- Creates: player_availability, xg_features
-- No dependencies on other tables
-- ============================================

-- 1. Player Availability (injuries, suspensions, fitness)
CREATE TABLE IF NOT EXISTS player_availability (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  player_name TEXT NOT NULL,
  player_id INTEGER,
  team_name TEXT NOT NULL,
  team_id_api INTEGER,
  status TEXT DEFAULT 'available' CHECK (status IN ('available', 'injured', 'suspended', 'doubtful')),
  reason TEXT,
  injury_type TEXT,
  expected_return DATE,
  fixture_date TIMESTAMPTZ,
  league TEXT,
  source TEXT DEFAULT 'unknown',
  matches_missed INTEGER DEFAULT 0,
  is_key_player BOOLEAN DEFAULT false,
  fetched_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(player_name, team_name)
);

ALTER TABLE player_availability ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read" ON player_availability FOR SELECT USING (true);
CREATE POLICY "Service write" ON player_availability FOR ALL USING (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS idx_pa_team ON player_availability(team_name);
CREATE INDEX IF NOT EXISTS idx_pa_player ON player_availability(player_name);
CREATE INDEX IF NOT EXISTS idx_pa_status ON player_availability(status);
CREATE INDEX IF NOT EXISTS idx_pa_fixture_date ON player_availability(fixture_date);
CREATE INDEX IF NOT EXISTS idx_pa_league ON player_availability(league);

-- 2. xG Features (expected goals data per team per match)
CREATE TABLE IF NOT EXISTS xg_features (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  fixture_id UUID,
  team_name TEXT NOT NULL,
  team_id_api INTEGER,
  xg_for NUMERIC(5,3) DEFAULT 0,
  xg_against NUMERIC(5,3) DEFAULT 0,
  xg_diff NUMERIC(5,3) DEFAULT 0,
  shots_total INTEGER DEFAULT 0,
  shots_on_target INTEGER DEFAULT 0,
  deep_completions INTEGER DEFAULT 0,
  ppda NUMERIC(5,2) DEFAULT 0,
  possession_pct NUMERIC(5,2) DEFAULT 50,
  league TEXT,
  season TEXT,
  match_date DATE,
  source TEXT DEFAULT 'statsbomb',
  fetched_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE xg_features ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read" ON xg_features FOR SELECT USING (true);
CREATE POLICY "Service write" ON xg_features FOR ALL USING (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS idx_xg_fixture ON xg_features(fixture_id);
CREATE INDEX IF NOT EXISTS idx_xg_team ON xg_features(team_name);
CREATE INDEX IF NOT EXISTS idx_xg_date ON xg_features(match_date);

-- 3. Team Injury Summary View
CREATE OR REPLACE VIEW team_injury_summary AS
SELECT
  team_name,
  COUNT(*) as total_injuries,
  COUNT(*) FILTER (WHERE status = 'injured') as injured_count,
  COUNT(*) FILTER (WHERE status = 'suspended') as suspended_count,
  COUNT(*) FILTER (WHERE reason ILIKE '%knee%' OR reason ILIKE '%ACL%' OR reason ILIKE '%rupture%') as impact_injuries,
  COUNT(*) FILTER (WHERE reason ILIKE '%muscle%' OR reason ILIKE '%hamstring%') as muscle_injuries,
  (
    COUNT(*) FILTER (WHERE reason ILIKE '%knee%' OR reason ILIKE '%ACL%' OR reason ILIKE '%rupture%') * 3.0 +
    COUNT(*) FILTER (WHERE reason ILIKE '%muscle%' OR reason ILIKE '%hamstring%') * 2.0 +
    COUNT(*) * 1.0
  ) / 25.0 as injury_impact_score
FROM player_availability
WHERE status IN ('injured', 'suspended')
GROUP BY team_name
ORDER BY injury_impact_score DESC;
