-- ============================================
-- ODDLY Historical Data Schema
-- Stores match results, team stats, and features
-- for model training and backtesting
-- ============================================

-- Historical matches (raw data from APIs)
CREATE TABLE IF NOT EXISTS historical_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id text UNIQUE,
  season integer NOT NULL,
  league_id uuid REFERENCES leagues(id),
  home_team_id uuid REFERENCES teams(id),
  away_team_id uuid REFERENCES teams(id),
  home_score integer,
  away_score integer,
  halftime_home integer,
  halftime_away integer,
  match_date date NOT NULL,
  status text DEFAULT 'finished',
  -- Market data at match time
  home_odds numeric,
  draw_odds numeric,
  away_odds numeric,
  -- Metadata
  data_source text, -- 'api-football', 'football-data-org'
  fetched_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

-- Team-level statistics (pre-computed for each match)
CREATE TABLE IF NOT EXISTS team_match_stats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid REFERENCES historical_matches(id),
  team_id uuid REFERENCES teams(id),
  is_home boolean NOT NULL,
  -- Form (last N matches)
  form_last5 text, -- 'WWDLW'
  form_last10 text,
  ppg_last5 numeric,
  ppg_last10 numeric,
  -- Goals
  goals_scored_avg numeric,
  goals_conceded_avg numeric,
  clean_sheet_pct numeric,
  btts_pct numeric,
  -- Home/Away specific
  home_win_rate numeric,
  away_win_rate numeric,
  home_goals_scored numeric,
  home_goals_conceded numeric,
  away_goals_scored numeric,
  away_goals_conceded numeric,
  -- H2H
  h2h_win_rate numeric,
  h2h_goals_avg numeric,
  -- Contextual
  days_since_last_match integer,
  league_position integer,
  goal_difference integer,
  created_at timestamptz DEFAULT now()
);

-- Model predictions (for backtesting)
CREATE TABLE IF NOT EXISTS model_predictions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid REFERENCES historical_matches(id),
  model_name text NOT NULL, -- 'dixon-coles', 'elo', 'xgboost', 'ensemble'
  model_version text,
  -- Predicted probabilities
  home_win_prob numeric,
  draw_prob numeric,
  away_win_prob numeric,
  over25_prob numeric,
  under25_prob numeric,
  btts_yes_prob numeric,
  -- Confidence
  confidence numeric,
  -- Actual outcome (for evaluation)
  actual_result text, -- 'home', 'draw', 'away'
  actual_goals integer,
  -- Evaluation metrics
  brier_score numeric,
  log_loss numeric,
  created_at timestamptz DEFAULT now()
);

-- Model performance tracking
CREATE TABLE IF NOT EXISTS model_performance_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_name text NOT NULL,
  model_version text,
  evaluation_date date NOT NULL,
  total_predictions integer,
  correct_predictions integer,
  accuracy numeric,
  brier_score numeric,
  log_loss numeric,
  roi numeric,
  -- Breakdown by market
  match_result_accuracy numeric,
  over_under_accuracy numeric,
  btts_accuracy numeric,
  -- Breakdown by confidence tier
  high_confidence_accuracy numeric,
  medium_confidence_accuracy numeric,
  low_confidence_accuracy numeric,
  created_at timestamptz DEFAULT now()
);

-- Match features (computed by feature engineering pipeline)
CREATE TABLE IF NOT EXISTS match_features (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid UNIQUE REFERENCES historical_matches(id),
  season integer,
  league_id uuid,
  home_team_id uuid,
  away_team_id uuid,

  -- Category 1: Form & Performance
  home_form_last5 text,
  home_form_last10 text,
  home_ppg_last5 numeric,
  home_goals_scored_avg numeric,
  home_goals_conceded_avg numeric,
  home_clean_sheet_pct numeric,
  home_btts_pct numeric,
  away_form_last5 text,
  away_form_last10 text,
  away_ppg_last5 numeric,
  away_goals_scored_avg numeric,
  away_goals_conceded_avg numeric,
  away_clean_sheet_pct numeric,
  away_btts_pct numeric,

  -- Category 2: Home/Away Performance
  home_home_win_rate numeric,
  home_away_win_rate numeric,
  home_home_goals_scored numeric,
  home_home_goals_conceded numeric,
  away_home_win_rate numeric,
  away_away_win_rate numeric,
  away_away_goals_scored numeric,
  away_away_goals_conceded numeric,

  -- Category 3: Head-to-Head
  h2h_home_win_rate numeric,
  h2h_goals_avg numeric,

  -- Category 4: Market Data
  implied_home_prob numeric,
  implied_draw_prob numeric,
  implied_away_prob numeric,
  market_consensus numeric,
  odds_movement numeric,

  -- Category 5: Contextual
  home_days_since_last integer,
  away_days_since_last integer,
  home_goal_difference integer,
  away_goal_difference integer,
  league_position integer,

  -- Elo Ratings
  home_elo numeric,
  away_elo numeric,
  elo_expected_home numeric,
  elo_expected_away numeric,

  -- Actual Outcome (for supervised learning)
  actual_result text,
  home_score_actual integer,
  away_score_actual integer,
  total_goals integer,
  both_teams_scored boolean,

  created_at timestamptz DEFAULT now()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_match_features_season ON match_features(season);
CREATE INDEX IF NOT EXISTS idx_match_features_league ON match_features(league_id);
CREATE INDEX IF NOT EXISTS idx_match_features_home_team ON match_features(home_team_id);
CREATE INDEX IF NOT EXISTS idx_match_features_away_team ON match_features(away_team_id);
CREATE INDEX IF NOT EXISTS idx_historical_matches_season ON historical_matches(season);
CREATE INDEX IF NOT EXISTS idx_historical_matches_date ON historical_matches(match_date);
CREATE INDEX IF NOT EXISTS idx_historical_matches_league ON historical_matches(league_id);
CREATE INDEX IF NOT EXISTS idx_team_match_stats_team ON team_match_stats(team_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_model_predictions_match_model ON model_predictions(match_id, model_name);
CREATE INDEX IF NOT EXISTS idx_model_predictions_model ON model_predictions(model_name);
CREATE INDEX IF NOT EXISTS idx_model_performance_date ON model_performance_history(evaluation_date);
