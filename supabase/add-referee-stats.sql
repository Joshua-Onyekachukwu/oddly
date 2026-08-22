-- ============================================================
-- Match Stats Table — Referee Data, Shots, Fouls, Cards, Corners
-- ============================================================
-- This table stores detailed match statistics from football-data.co.uk
-- including referee names, shots, fouls, cards, and corners.
-- These data points are key features for prediction accuracy.

-- 1. Create match_stats table
CREATE TABLE IF NOT EXISTS match_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fixture_id UUID NOT NULL REFERENCES fixtures(id) ON DELETE CASCADE UNIQUE,
  
  -- Referee
  referee TEXT,
  
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
  ht_result TEXT, -- H/D/A
  
  -- Full-time result (redundant with fixtures but useful for quick queries)
  ft_result TEXT, -- H/D/A
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Create indexes for fast queries
CREATE INDEX IF NOT EXISTS idx_match_stats_fixture ON match_stats(fixture_id);
CREATE INDEX IF NOT EXISTS idx_match_stats_referee ON match_stats(referee);
CREATE INDEX IF NOT EXISTS idx_match_stats_ft_result ON match_stats(ft_result);

-- 3. Create referee_profiles table
-- Aggregated referee statistics for prediction features
CREATE TABLE IF NOT EXISTS referee_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referee_name TEXT NOT NULL UNIQUE,
  
  -- Overall stats
  total_matches INTEGER DEFAULT 0,
  total_home_wins INTEGER DEFAULT 0,
  total_draws INTEGER DEFAULT 0,
  total_away_wins INTEGER DEFAULT 0,
  
  -- Home advantage under this referee
  home_win_pct DECIMAL(5,2),
  draw_pct DECIMAL(5,2),
  away_win_pct DECIMAL(5,2),
  
  -- Cards per match (indicator of strictness)
  avg_yellow_per_match DECIMAL(5,2),
  avg_red_per_match DECIMAL(5,3),
  avg_fouls_per_match DECIMAL(5,2),
  
  -- Penalty tendencies
  total_penalties INTEGER DEFAULT 0,
  avg_penalties_per_match DECIMAL(5,3),
  
  -- Goals tendencies
  avg_total_goals DECIMAL(5,2),
  avg_home_goals DECIMAL(5,2),
  avg_away_goals DECIMAL(5,2),
  
  -- BTTS tendency
  btts_pct DECIMAL(5,2),
  over_2_5_pct DECIMAL(5,2),
  over_1_5_pct DECIMAL(5,2),
  
  -- Home bias (positive = favors home, negative = favors away)
  home_bias DECIMAL(5,3),
  
  -- Leagues officiated
  leagues_officiated TEXT[], -- Array of league names
  
  -- Last updated
  last_match_date DATE,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_referee_profiles_name ON referee_profiles(referee_name);

-- 4. Create team_referee_stats table
-- How each team performs under each specific referee
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
  win_pct DECIMAL(5,2),
  
  -- Is this referee favorable to this team? (positive = good, negative = bad)
  referee_advantage DECIMAL(5,3),
  
  last_match_date DATE,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(team_id, referee_name)
);

CREATE INDEX IF NOT EXISTS idx_team_referee_team ON team_referee_stats(team_id);
CREATE INDEX IF NOT EXISTS idx_team_referee_name ON team_referee_stats(referee_name);

-- 5. Enable RLS (read-only for anon, full for service role)
ALTER TABLE match_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE referee_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_referee_stats ENABLE ROW LEVEL SECURITY;

-- Allow anon read
CREATE POLICY "match_stats_read" ON match_stats FOR SELECT USING (true);
CREATE POLICY "referee_profiles_read" ON referee_profiles FOR SELECT USING (true);
CREATE POLICY "team_referee_stats_read" ON team_referee_stats FOR SELECT USING (true);

-- Allow service role full access
CREATE POLICY "match_stats_all" ON match_stats FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "referee_profiles_all" ON referee_profiles FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "team_referee_stats_all" ON team_referee_stats FOR ALL USING (auth.role() = 'service_role');

-- 6. Enable realtime for live updates
ALTER PUBLICATION supabase_realtime ADD TABLE referee_profiles;

-- 7. Create a view for quick referee analysis
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
  -- How many unique teams this referee has officiated
  (SELECT COUNT(DISTINCT team_id) FROM team_referee_stats WHERE referee_name = r.referee_name) as teams_officiated
FROM referee_profiles r
WHERE r.total_matches >= 10  -- Only referees with meaningful sample
ORDER BY r.total_matches DESC;

-- 8. Create a view for team-referee analysis
CREATE OR REPLACE VIEW team_referee_analysis AS
SELECT
  t.name as team_name,
  tr.referee_name,
  tr.matches_under_referee,
  tr.wins,
  tr.draws,
  tr.losses,
  tr.win_pct,
  tr.goals_scored,
  tr.goals_conceded,
  tr.yellow_cards,
  tr.red_cards,
  tr.referee_advantage,
  tr.last_match_date,
  l.name as league_name
FROM team_referee_stats tr
JOIN teams t ON t.id = tr.team_id
LEFT JOIN leagues l ON l.id = t.league_id
WHERE tr.matches_under_referee >= 3  -- Meaningful sample
ORDER BY tr.referee_advantage DESC;

-- Summary
DO $$
BEGIN
  RAISE NOTICE '✅ Match stats tables created successfully!';
  RAISE NOTICE '   match_stats — Per-match referee + stats data';
  RAISE NOTICE '   referee_profiles — Aggregated referee tendencies';
  RAISE NOTICE '   team_referee_stats — Team performance under each referee';
  RAISE NOTICE '   referee_analysis view — Quick referee lookup';
  RAISE NOTICE '   team_referee_analysis view — Team-referee relationship lookup';
END $$;
