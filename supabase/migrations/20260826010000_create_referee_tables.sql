-- ============================================
-- REFEREE TABLES — UNIFIED MIGRATION
-- Date: August 26, 2026
--
-- Creates all referee-related tables that were defined across
-- add-referee-stats.sql and add-referee-to-fixtures.sql but
-- never actually created in Supabase.
--
-- Tables:
--   1. referee_profiles      — aggregated referee tendencies
--   2. match_stats           — per-match detailed stats + referee
--   3. team_referee_stats    — team performance under each referee
--   4. referee_match_history — match-level referee observations
--
-- Also adds referee_name column to fixtures.
-- ============================================

-- ============================================
-- 0. ADD REFEREE COLUMNS TO FIXTURES
-- ============================================

ALTER TABLE fixtures ADD COLUMN IF NOT EXISTS referee_name TEXT;
ALTER TABLE fixtures ADD COLUMN IF NOT EXISTS referee_id TEXT;
CREATE INDEX IF NOT EXISTS idx_fixtures_referee ON fixtures(referee_name);

-- ============================================
-- 1. REFEREE_PROFILES
-- Aggregated referee tendencies used as prediction features
-- ============================================

CREATE TABLE IF NOT EXISTS referee_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referee_name TEXT NOT NULL UNIQUE,

  -- Match counts
  total_matches INTEGER DEFAULT 0,

  -- Outcome percentages (0-1 scale)
  home_win_pct DECIMAL(5,4),
  draw_pct DECIMAL(5,4),
  away_win_pct DECIMAL(5,4),

  -- Goals tendencies
  avg_total_goals DECIMAL(5,3),
  avg_home_goals DECIMAL(5,3),
  avg_away_goals DECIMAL(5,3),

  -- Card tendencies (strictness indicator)
  avg_yellow_per_match DECIMAL(5,2),
  avg_red_per_match DECIMAL(5,3),
  avg_fouls_per_match DECIMAL(5,2),

  -- Market tendencies
  btts_pct DECIMAL(5,4),
  over_2_5_pct DECIMAL(5,4),
  over_1_5_pct DECIMAL(5,4),

  -- Home bias (positive = favors home team, negative = favors away)
  home_bias DECIMAL(5,4),

  -- Leagues officiated (array of league codes)
  leagues_officiated TEXT[],

  -- Tracking
  last_match_date DATE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_referee_profiles_name ON referee_profiles(referee_name);
CREATE INDEX IF NOT EXISTS idx_referee_profiles_matches ON referee_profiles(total_matches DESC);

-- ============================================
-- 2. MATCH_STATS
-- Per-match detailed statistics including referee
-- ============================================

CREATE TABLE IF NOT EXISTS match_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fixture_id UUID NOT NULL REFERENCES fixtures(id) ON DELETE CASCADE UNIQUE,

  -- Referee
  referee_name TEXT,

  -- Shots
  home_shots INTEGER,
  away_shots INTEGER,
  home_shots_on_target INTEGER,
  away_shots_on_target INTEGER,

  -- Fouls
  home_fouls INTEGER,
  away_fouls INTEGER,

  -- Corners
  home_corners INTEGER,
  away_corners INTEGER,

  -- Cards
  home_yellow_cards INTEGER,
  away_yellow_cards INTEGER,
  home_red_cards INTEGER,
  away_red_cards INTEGER,

  -- Half-time
  ht_home_goals INTEGER,
  ht_away_goals INTEGER,
  ht_result TEXT,

  -- Full-time result
  ft_result TEXT,

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_match_stats_fixture ON match_stats(fixture_id);
CREATE INDEX IF NOT EXISTS idx_match_stats_referee ON match_stats(referee_name);
CREATE INDEX IF NOT EXISTS idx_match_stats_ft_result ON match_stats(ft_result);

-- ============================================
-- 3. TEAM_REFEREE_STATS
-- How each team performs under each specific referee
-- ============================================

CREATE TABLE IF NOT EXISTS team_referee_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  referee_name TEXT NOT NULL,

  matches_under_referee INTEGER DEFAULT 0,
  wins INTEGER DEFAULT 0,
  draws INTEGER DEFAULT 0,
  losses INTEGER DEFAULT 0,

  goals_scored INTEGER DEFAULT 0,
  goals_conceded INTEGER DEFAULT 0,

  yellow_cards INTEGER DEFAULT 0,
  red_cards INTEGER DEFAULT 0,
  fouls_committed INTEGER DEFAULT 0,

  -- Win rate under this referee
  win_pct DECIMAL(5,4),

  -- Referee advantage for this team (positive = favorable)
  referee_advantage DECIMAL(5,4),

  last_match_date DATE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(team_id, referee_name)
);

CREATE INDEX IF NOT EXISTS idx_team_referee_team ON team_referee_stats(team_id);
CREATE INDEX IF NOT EXISTS idx_team_referee_name ON team_referee_stats(referee_name);
CREATE INDEX IF NOT EXISTS idx_team_referee_advantage ON team_referee_stats(referee_advantage DESC);

-- ============================================
-- 4. REFEREE_MATCH_HISTORY
-- Match-level referee observations (raw data)
-- ============================================

CREATE TABLE IF NOT EXISTS referee_match_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referee_name TEXT NOT NULL,
  fixture_id UUID REFERENCES fixtures(id),
  match_date DATE,

  -- Match results
  home_goals INTEGER,
  away_goals INTEGER,
  ft_result TEXT,

  -- Card data
  home_yellow INTEGER DEFAULT 0,
  away_yellow INTEGER DEFAULT 0,
  home_red INTEGER DEFAULT 0,
  away_red INTEGER DEFAULT 0,
  total_cards INTEGER DEFAULT 0,

  -- Other stats
  home_fouls INTEGER,
  away_fouls INTEGER,
  home_shots INTEGER,
  away_shots INTEGER,
  home_corners INTEGER,
  away_corners INTEGER,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_referee_history_name ON referee_match_history(referee_name);
CREATE INDEX IF NOT EXISTS idx_referee_history_date ON referee_match_history(match_date);
CREATE INDEX IF NOT EXISTS idx_referee_history_fixture ON referee_match_history(fixture_id);

-- ============================================
-- 5. RLS POLICIES
-- ============================================

-- Referee profiles: authenticated read, service role write
ALTER TABLE referee_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE referee_profiles FORCE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can view referee profiles" ON referee_profiles
  FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Service role manages referee profiles" ON referee_profiles
  FOR ALL USING (public.is_service_role());

-- Match stats: authenticated read, service role write
ALTER TABLE match_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE match_stats FORCE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can view match stats" ON match_stats
  FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Service role manages match stats" ON match_stats
  FOR ALL USING (public.is_service_role());

-- Team referee stats: authenticated read, service role write
ALTER TABLE team_referee_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_referee_stats FORCE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can view team referee stats" ON team_referee_stats
  FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Service role manages team referee stats" ON team_referee_stats
  FOR ALL USING (public.is_service_role());

-- Referee match history: authenticated read, service role write
ALTER TABLE referee_match_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE referee_match_history FORCE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can view referee history" ON referee_match_history
  FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Service role manages referee history" ON referee_match_history
  FOR ALL USING (public.is_service_role());

-- ============================================
-- 6. VIEWS
-- ============================================

-- Quick referee lookup for prediction features
CREATE OR REPLACE VIEW referee_analysis AS
SELECT
  r.referee_name,
  r.total_matches,
  r.home_win_pct,
  r.draw_pct,
  r.away_win_pct,
  r.avg_yellow_per_match,
  r.avg_red_per_match,
  r.avg_total_goals,
  r.btts_pct,
  r.over_2_5_pct,
  r.home_bias,
  r.leagues_officiated,
  r.last_match_date,
  (SELECT COUNT(DISTINCT team_id) FROM team_referee_stats WHERE referee_name = r.referee_name) as teams_officiated
FROM referee_profiles r
WHERE r.total_matches >= 5
ORDER BY r.total_matches DESC;

-- Team-referee relationship lookup
CREATE OR REPLACE VIEW team_referee_analysis AS
SELECT
  t.canonical_name as team_name,
  tr.referee_name,
  tr.matches_under_referee,
  tr.wins,
  tr.draws,
  tr.losses,
  tr.win_pct,
  tr.goals_scored,
  tr.goals_conceded,
  tr.referee_advantage,
  tr.last_match_date
FROM team_referee_stats tr
JOIN teams t ON t.id = tr.team_id
WHERE tr.matches_under_referee >= 3
ORDER BY tr.referee_advantage DESC;

-- ============================================
-- 7. TRIGGERS
-- ============================================

CREATE TRIGGER update_referee_profiles_updated_at
  BEFORE UPDATE ON referee_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_match_stats_updated_at
  BEFORE UPDATE ON match_stats
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_team_referee_stats_updated_at
  BEFORE UPDATE ON team_referee_stats
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
