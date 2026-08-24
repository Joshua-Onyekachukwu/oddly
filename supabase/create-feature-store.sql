-- ═══════════════════════════════════════════════════════════════════════
-- ODDLY Feature Store — replaces all local JSON files
-- Each table is the source of truth for its data type
-- ═══════════════════════════════════════════════════════════════════════

-- 1. Team feature profiles (replaces team-composite-ratings.json, team-player-impacts.json, team-injury-impact.json)
CREATE TABLE IF NOT EXISTS team_feature_profiles (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  team_name TEXT NOT NULL UNIQUE,
  league TEXT,
  
  -- Composite ratings (from team-composite-ratings.json)
  attack_rating NUMERIC(6,3),
  defense_rating NUMERIC(6,3),
  goals_for_per_game NUMERIC(4,2),
  goals_against_per_game NUMERIC(4,2),
  win_rate NUMERIC(4,3),
  home_win_rate NUMERIC(4,3),
  away_win_rate NUMERIC(4,3),
  shots_per_game NUMERIC(4,1),
  fouls_per_game NUMERIC(4,1),
  yellow_per_game NUMERIC(4,1),
  corners_per_game NUMERIC(4,1),
  recent_form TEXT,  -- "WWDLW"
  form_points NUMERIC(4,2),
  goal_diff_per_game NUMERIC(4,2),
  
  -- Player impact (from team-player-impacts.json)
  player_impact_score NUMERIC(5,2),
  squad_depth NUMERIC(4,1),
  top_player_goals NUMERIC(4,1),
  pis_1x2_impact NUMERIC(5,3),
  shot_accuracy NUMERIC(4,3),
  defensive_solidity NUMERIC(4,3),
  
  -- Injury impact (from team-injury-impact.json)
  injuries_per_match NUMERIC(4,2),
  injury_impact_per_match NUMERIC(5,3),
  avg_injury_severity NUMERIC(4,2),
  key_player_injuries NUMERIC(3,1),
  
  -- xG features (from statsbomb-xg.json + understat-xg.json)
  avg_xg NUMERIC(5,3),
  avg_xga NUMERIC(5,3),
  xg_last5 NUMERIC(5,3),
  home_xg NUMERIC(5,3),
  away_xg NUMERIC(5,3),
  home_xga NUMERIC(5,3),
  away_xga NUMERIC(5,3),
  avg_ppda NUMERIC(5,2),
  avg_deep NUMERIC(4,1),
  avg_shots NUMERIC(4,1),
  avg_big_chances NUMERIC(4,2),
  npxg_ratio NUMERIC(4,3),
  xg_source TEXT,  -- 'statsbomb' or 'understat'
  
  -- Metadata
  data_season TEXT,
  last_updated TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_team_feature_name ON team_feature_profiles(team_name);
CREATE INDEX IF NOT EXISTS idx_team_feature_league ON team_feature_profiles(league);


-- 2. Referee profiles (replaces referee-profiles.json)
CREATE TABLE IF NOT EXISTS referee_feature_profiles (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  matches_officiated INTEGER DEFAULT 0,
  
  -- Outcome tendencies
  home_win_pct NUMERIC(4,3),
  draw_pct NUMERIC(4,3),
  away_win_pct NUMERIC(4,3),
  btts_pct NUMERIC(4,3),
  over25_pct NUMERIC(4,3),
  
  -- Card tendencies
  avg_goals NUMERIC(4,2),
  avg_yellow NUMERIC(4,2),
  avg_red NUMERIC(5,3),
  avg_fouls NUMERIC(5,1),
  
  -- Home bias (positive = favors home team)
  home_bias NUMERIC(5,4),
  
  -- Leagues this referee officiates in
  leagues JSONB DEFAULT '[]'::jsonb,
  
  last_updated TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_referee_name ON referee_feature_profiles(name);


-- 3. Per-league model parameters (replaces per-league-models.json)
CREATE TABLE IF NOT EXISTS league_model_params (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  league_name TEXT NOT NULL,
  league_code TEXT,
  
  -- Model accuracy
  overall_accuracy NUMERIC(5,3),
  home_win_accuracy NUMERIC(5,3),
  draw_accuracy NUMERIC(5,3),
  away_win_accuracy NUMERIC(5,3),
  
  -- League characteristics (used as features)
  avg_goals NUMERIC(4,2),
  home_win_pct NUMERIC(4,3),
  draw_pct NUMERIC(4,3),
  avg_yellow NUMERIC(4,2),
  avg_corners NUMERIC(4,1),
  
  -- Model weights for this league
  poisson_weight NUMERIC(4,3),
  elo_weight NUMERIC(4,3),
  regression_weight NUMERIC(4,3),
  
  -- League-specific adjustments
  home_advantage NUMERIC(5,1),
  goal_expectancy NUMERIC(4,2),
  
  data_points INTEGER DEFAULT 0,
  last_trained TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_league_model_name ON league_model_params(league_name);


-- 4. Optimized model weights (replaces optimized-weights.json)
CREATE TABLE IF NOT EXISTS model_weight_config (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  config_name TEXT NOT NULL UNIQUE,
  
  -- Regression weights
  intercept NUMERIC(8,5),
  elo_diff_weight NUMERIC(8,5),
  home_ppg_weight NUMERIC(8,5),
  away_ppg_weight NUMERIC(8,5),
  home_gf_weight NUMERIC(8,5),
  home_ga_weight NUMERIC(8,5),
  away_gf_weight NUMERIC(8,5),
  away_ga_weight NUMERIC(8,5),
  clean_sheet_weight NUMERIC(8,5),
  home_win_rate_weight NUMERIC(8,5),
  away_win_rate_weight NUMERIC(8,5),
  streak_weight NUMERIC(8,5),
  fatigue_weight NUMERIC(8,5),
  h2h_weight NUMERIC(8,5),
  home_xg_weight NUMERIC(8,5),
  away_xg_weight NUMERIC(8,5),
  home_xg_diff_weight NUMERIC(8,5),
  away_xg_diff_weight NUMERIC(8,5),
  shots_diff_weight NUMERIC(8,5),
  big_chances_diff_weight NUMERIC(8,5),
  
  -- Ensemble weights
  poisson_1x2_weight NUMERIC(4,3),
  elo_1x2_weight NUMERIC(4,3),
  regression_1x2_weight NUMERIC(4,3),
  poisson_totals_weight NUMERIC(4,3),
  regression_totals_weight NUMERIC(4,3),
  poisson_btts_weight NUMERIC(4,3),
  regression_btts_weight NUMERIC(4,3),
  poisson_dc_weight NUMERIC(4,3),
  elo_dc_weight NUMERIC(4,3),
  regression_dc_weight NUMERIC(4,3),
  
  -- Training metadata
  brier_score NUMERIC(8,6),
  accuracy NUMERIC(5,3),
  matches_analyzed INTEGER,
  trained_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);


-- 5. Odds cache (replaces odds-features.json — much larger and fresher)
CREATE TABLE IF NOT EXISTS odds_feature_cache (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  fixture_id UUID NOT NULL,
  
  -- Market odds (averaged across bookmakers)
  true_home NUMERIC(6,3),
  true_draw NUMERIC(6,3),
  true_away NUMERIC(6,3),
  true_btts_yes NUMERIC(6,3),
  true_over_25 NUMERIC(6,3),
  
  -- Consensus metrics
  home_consensus NUMERIC(4,3),
  draw_consensus NUMERIC(4,3),
  away_consensus NUMERIC(4,3),
  bookmaker_count INTEGER DEFAULT 0,
  
  -- Market movement
  opening_home NUMERIC(6,3),
  closing_home NUMERIC(6,3),
  movement NUMERIC(6,4),
  
  computed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_odds_feature_fixture ON odds_feature_cache(fixture_id);


-- 6. Injury data (replaces premier-injuries.json + transfermarkt-injuries.json)
CREATE TABLE IF NOT EXISTS player_injury_data (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  team_name TEXT NOT NULL,
  player_name TEXT,
  
  status TEXT NOT NULL, -- 'injured', 'suspended', 'doubtful', 'questionable'
  injury_type TEXT,
  expected_return DATE,
  
  -- Impact metrics
  player_importance NUMERIC(3,1) DEFAULT 5,  -- 1-10 scale
  matches_missed INTEGER DEFAULT 0,
  
  source TEXT,  -- 'transfermarkt', 'football-data', 'manual'
  fetched_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_injury_team ON player_injury_data(team_name);
CREATE INDEX IF NOT EXISTS idx_injury_status ON player_injury_data(status);


-- ═══ Migration helper: backfill from local JSON ═══
-- Run worker/feature-store-sync.js after creating tables
