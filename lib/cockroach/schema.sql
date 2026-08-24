-- ============================================================
-- CockroachDB Schema for ODDLY Hybrid Architecture
-- 
-- Purpose: Store historical/cold data that exceeds Supabase
-- free tier capacity and enables complex analytics queries.
--
-- Supabase (hot): Auth, real-time, recent predictions
-- CockroachDB (cold): History, ML training, analytics
-- ============================================================

-- ─── Leagues Reference ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS cockroach_leagues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id INTEGER UNIQUE,
  name TEXT NOT NULL,
  country TEXT,
  logo TEXT,
  is_active BOOLEAN DEFAULT true,
  priority INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Teams Reference ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cockroach_teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_name TEXT NOT NULL,
  country TEXT,
  league_id UUID REFERENCES cockroach_leagues(id),
  logo TEXT,
  elo_rating NUMERIC(8,2) DEFAULT 1500,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- xG features from Understat
  avg_xg NUMERIC(5,3),
  avg_xga NUMERIC(5,3),
  avg_npxg NUMERIC(5,3),
  avg_npxga NUMERIC(5,3),
  home_xg NUMERIC(5,3),
  home_xga NUMERIC(5,3),
  away_xg NUMERIC(5,3),
  away_xga NUMERIC(5,3),
  xg_last5 NUMERIC(5,3),
  xga_last5 NUMERIC(5,3),
  avg_ppda NUMERIC(5,2),
  avg_deep NUMERIC(5,2),
  avg_deep_allowed NUMERIC(5,2),
  xg_diff NUMERIC(5,3)
);

CREATE INDEX IF NOT EXISTS idx_cockroach_teams_name ON cockroach_teams(canonical_name);
CREATE INDEX IF NOT EXISTS idx_cockroach_teams_league ON cockroach_teams(league_id);

-- ─── Historical Fixtures ────────────────────────────────────
CREATE TABLE IF NOT EXISTS cockroach_fixtures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id TEXT,
  home_team_id UUID REFERENCES cockroach_teams(id),
  away_team_id UUID REFERENCES cockroach_teams(id),
  league_id UUID REFERENCES cockroach_leagues(id),
  kickoff_time TIMESTAMPTZ NOT NULL,
  status TEXT DEFAULT 'scheduled',
  home_score INTEGER,
  away_score INTEGER,
  season TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cockroach_fixtures_external ON cockroach_fixtures(external_id);
CREATE INDEX IF NOT EXISTS idx_cockroach_fixtures_kickoff ON cockroach_fixtures(kickoff_time);
CREATE INDEX IF NOT EXISTS idx_cockroach_fixtures_league ON cockroach_fixtures(league_id);
CREATE INDEX IF NOT EXISTS idx_cockroach_fixtures_season ON cockroach_fixtures(season);

-- ─── Historical Predictions (Cold Storage) ──────────────────
-- This is the largest table — stores ALL predictions ever made
CREATE TABLE IF NOT EXISTS cockroach_predictions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fixture_id UUID REFERENCES cockroach_fixtures(id),
  market TEXT NOT NULL,           -- '1X2', 'OU_Over_2.5', 'BTTS', etc.
  selection TEXT NOT NULL,        -- 'Home', 'Over', 'Yes', etc.
  model_probability NUMERIC(5,4) NOT NULL,
  confidence_lower NUMERIC(5,4),
  confidence_upper NUMERIC(5,4),
  model_version TEXT DEFAULT 'v5.1',
  poisson_prob NUMERIC(5,4),
  elo_prob NUMERIC(5,4),
  regression_prob NUMERIC(5,4),
  xg_adjusted_prob NUMERIC(5,4),
  bookmaker_odds NUMERIC(6,2),
  implied_probability NUMERIC(5,4),
  edge NUMERIC(5,4),
  result TEXT,                    -- 'correct', 'wrong', NULL if unsettled
  actual_outcome TEXT,
  settled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cockroach_preds_fixture ON cockroach_predictions(fixture_id);
CREATE INDEX IF NOT EXISTS idx_cockroach_preds_market ON cockroach_predictions(market);
CREATE INDEX IF NOT EXISTS idx_cockroach_preds_result ON cockroach_predictions(result);
CREATE INDEX IF NOT EXISTS idx_cockroach_preds_model ON cockroach_predictions(model_version);
CREATE INDEX IF NOT EXISTS idx_cockroach_preds_created ON cockroach_predictions(created_at);

-- ─── Odds Snapshots (Historical) ───────────────────────────
CREATE TABLE IF NOT EXISTS cockroach_odds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fixture_id UUID REFERENCES cockroach_fixtures(id),
  bookmaker TEXT,
  market TEXT,
  selection TEXT,
  odds NUMERIC(6,2),
  implied_prob NUMERIC(5,4),
  timestamp TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cockroach_odds_fixture ON cockroach_odds(fixture_id);

-- ─── xG Features (Per Team Per Season) ──────────────────────
CREATE TABLE IF NOT EXISTS cockroach_xg_features (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_name TEXT NOT NULL,
  league TEXT,
  season TEXT,
  source TEXT DEFAULT 'understat', -- 'understat' or 'statsbomb'
  
  -- Aggregate stats
  matches_played INTEGER,
  total_goals INTEGER,
  total_xg NUMERIC(6,2),
  total_xga NUMERIC(6,2),
  total_npxg NUMERIC(6,2),
  
  -- Per-match averages
  avg_xg NUMERIC(5,3),
  avg_xga NUMERIC(5,3),
  avg_npxg NUMERIC(5,3),
  avg_npxga NUMERIC(5,3),
  
  -- Home/Away splits
  home_xg NUMERIC(5,3),
  home_xga NUMERIC(5,3),
  home_goals INTEGER,
  home_matches INTEGER,
  away_xg NUMERIC(5,3),
  away_xga NUMERIC(5,3),
  away_goals INTEGER,
  away_matches INTEGER,
  
  -- Recent form
  xg_last5 NUMERIC(5,3),
  xga_last5 NUMERIC(5,3),
  xg_last10 NUMERIC(5,3),
  xga_last10 NUMERIC(5,3),
  
  -- Advanced metrics
  avg_ppda NUMERIC(5,2),
  avg_deep NUMERIC(5,2),
  avg_deep_allowed NUMERIC(5,2),
  xg_diff NUMERIC(5,3),  -- actual goals - xG
  npxg_ratio NUMERIC(5,3),
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cockroach_xg_team ON cockroach_xg_features(team_name);
CREATE INDEX IF NOT EXISTS idx_cockroach_xg_season ON cockroach_xg_features(season);

-- ─── Referee Profiles ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS cockroach_referee_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  matches_officiated INTEGER DEFAULT 0,
  avg_goals NUMERIC(4,2),
  home_win_pct NUMERIC(5,4),
  draw_pct NUMERIC(5,4),
  away_win_pct NUMERIC(5,4),
  avg_yellow NUMERIC(4,2),
  avg_red NUMERIC(4,2),
  avg_fouls NUMERIC(5,2),
  home_bias NUMERIC(5,4),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Referee Match History ─────────────────────────────────
CREATE TABLE IF NOT EXISTS cockroach_referee_matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referee_name TEXT,
  match_date DATE,
  home_team TEXT,
  away_team TEXT,
  home_goals INTEGER,
  away_goals INTEGER,
  yellow_cards INTEGER,
  red_cards INTEGER,
  fouls INTEGER,
  league TEXT,
  season TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cockroach_ref_matches_ref ON cockroach_referee_matches(referee_name);
CREATE INDEX IF NOT EXISTS idx_cockroach_ref_matches_date ON cockroach_referee_matches(match_date);

-- ─── Injuries & Suspensions ────────────────────────────────
CREATE TABLE IF NOT EXISTS cockroach_injuries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_name TEXT NOT NULL,
  team_name TEXT,
  injury_type TEXT,
  detail TEXT,
  return_date TEXT,
  status TEXT,       -- 'Out', 'Doubtful', 'Questionable'
  source TEXT DEFAULT 'premierinjuries',
  fetched_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cockroach_injuries_team ON cockroach_injuries(team_name);

-- ─── Match-Level xG (for calibration) ──────────────────────
CREATE TABLE IF NOT EXISTS cockroach_match_xg (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fixture_id UUID,
  home_team TEXT,
  away_team TEXT,
  league TEXT,
  season TEXT,
  match_date DATE,
  
  -- Actual
  home_goals INTEGER,
  away_goals INTEGER,
  
  -- xG
  home_xg NUMERIC(5,3),
  away_xg NUMERIC(5,3),
  home_npxg NUMERIC(5,3),
  away_npxg NUMERIC(5,3),
  
  source TEXT DEFAULT 'understat',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cockroach_mxg_date ON cockroach_match_xg(match_date);
CREATE INDEX IF NOT EXISTS idx_cockroach_mxg_teams ON cockroach_match_xg(home_team, away_team);

-- ─── Training Datasets ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS cockroach_training_data (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fixture_id UUID,
  market TEXT,
  
  -- Features (pre-computed for fast training)
  features JSONB,
  
  -- Labels
  label INTEGER,  -- 1 = correct, 0 = wrong
  model_version TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cockroach_training_market ON cockroach_training_data(market);

-- ─── Per-League Model Parameters ───────────────────────────
CREATE TABLE IF NOT EXISTS cockroach_league_models (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_name TEXT NOT NULL,
  model_version TEXT,
  
  -- Model weights/parameters
  intercept NUMERIC(10,6),
  weights JSONB,
  
  -- Performance metrics
  accuracy NUMERIC(5,4),
  brier_score NUMERIC(5,4),
  log_loss NUMERIC(5,4),
  sample_size INTEGER,
  
  trained_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Value Analysis Results ────────────────────────────────
CREATE TABLE IF NOT EXISTS cockroach_value_picks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fixture_id UUID,
  match_name TEXT,
  market TEXT,
  selection TEXT,
  model_prob NUMERIC(5,4),
  bookmaker_odds NUMERIC(6,2),
  implied_prob NUMERIC(5,4),
  edge NUMERIC(5,4),
  ev NUMERIC(6,3),
  tier TEXT,  -- 'ELITE', 'GOOD', 'FAIR'
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Audit Log ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cockroach_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action TEXT NOT NULL,
  details JSONB,
  rows_affected INTEGER,
  duration_ms INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Database Stats View ───────────────────────────────────
CREATE VIEW cockroach_db_stats AS
SELECT 
  'leagues' as table_name, COUNT(*) as row_count FROM cockroach_leagues
UNION ALL SELECT 'teams', COUNT(*) FROM cockroach_teams
UNION ALL SELECT 'fixtures', COUNT(*) FROM cockroach_fixtures
UNION ALL SELECT 'predictions', COUNT(*) FROM cockroach_predictions
UNION ALL SELECT 'odds', COUNT(*) FROM cockroach_odds
UNION ALL SELECT 'xg_features', COUNT(*) FROM cockroach_xg_features
UNION ALL SELECT 'referee_profiles', COUNT(*) FROM cockroach_referee_profiles
UNION ALL SELECT 'referee_matches', COUNT(*) FROM cockroach_referee_matches
UNION ALL SELECT 'injuries', COUNT(*) FROM cockroach_injuries
UNION ALL SELECT 'match_xg', COUNT(*) FROM cockroach_match_xg
UNION ALL SELECT 'training_data', COUNT(*) FROM cockroach_training_data
UNION ALL SELECT 'league_models', COUNT(*) FROM cockroach_league_models
UNION ALL SELECT 'value_picks', COUNT(*) FROM cockroach_value_picks;
