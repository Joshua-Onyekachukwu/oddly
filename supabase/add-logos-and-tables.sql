-- Run this in Supabase SQL Editor to add logo columns
-- Safe to run multiple times

-- Add logo columns (skip if already exists)
DO $$ BEGIN ALTER TABLE public.leagues ADD COLUMN logo text; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.teams ADD COLUMN logo text; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.leagues ADD COLUMN country_flag text; EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- Add historical data tables
DO $$ BEGIN
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
    home_odds numeric,
    draw_odds numeric,
    away_odds numeric,
    data_source text,
    fetched_at timestamptz DEFAULT now(),
    created_at timestamptz DEFAULT now()
  );
EXCEPTION WHEN duplicate_table THEN NULL; END $$;

DO $$ BEGIN
  CREATE TABLE IF NOT EXISTS match_features (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id uuid UNIQUE REFERENCES historical_matches(id),
    season integer, league_id uuid, home_team_id uuid, away_team_id uuid,
    home_form_last5 text, home_form_last10 text, home_ppg_last5 numeric,
    home_goals_scored_avg numeric, home_goals_conceded_avg numeric,
    home_clean_sheet_pct numeric, home_btts_pct numeric,
    away_form_last5 text, away_form_last10 text, away_ppg_last5 numeric,
    away_goals_scored_avg numeric, away_goals_conceded_avg numeric,
    away_clean_sheet_pct numeric, away_btts_pct numeric,
    home_home_win_rate numeric, home_away_win_rate numeric,
    home_home_goals_scored numeric, home_home_goals_conceded numeric,
    away_home_win_rate numeric, away_away_win_rate numeric,
    away_away_goals_scored numeric, away_away_goals_conceded numeric,
    h2h_home_win_rate numeric, h2h_goals_avg numeric,
    implied_home_prob numeric, implied_draw_prob numeric, implied_away_prob numeric,
    market_consensus numeric, odds_movement numeric,
    home_days_since_last integer, away_days_since_last integer,
    home_goal_difference integer, away_goal_difference integer,
    league_position integer, home_elo numeric, away_elo numeric,
    elo_expected_home numeric, elo_expected_away numeric,
    actual_result text, home_score_actual integer, away_score_actual integer,
    total_goals integer, both_teams_scored boolean,
    created_at timestamptz DEFAULT now()
  );
EXCEPTION WHEN duplicate_table THEN NULL; END $$;

DO $$ BEGIN
  CREATE TABLE IF NOT EXISTS model_predictions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id uuid REFERENCES historical_matches(id),
    model_name text NOT NULL, model_version text,
    home_win_prob numeric, draw_prob numeric, away_win_prob numeric,
    over25_prob numeric, under25_prob numeric, btts_yes_prob numeric,
    confidence numeric, actual_result text, home_score_actual integer, away_score_actual integer,
    brier_score numeric, log_loss numeric,
    created_at timestamptz DEFAULT now()
  );
EXCEPTION WHEN duplicate_table THEN NULL; END $$;

DO $$ BEGIN
  CREATE TABLE IF NOT EXISTS model_performance_history (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    model_name text NOT NULL, model_version text, evaluation_date date NOT NULL,
    total_predictions integer, correct_predictions integer, accuracy numeric,
    brier_score numeric, log_loss numeric, roi numeric,
    match_result_accuracy numeric, over_under_accuracy numeric, btts_accuracy numeric,
    high_confidence_accuracy numeric, medium_confidence_accuracy numeric, low_confidence_accuracy numeric,
    created_at timestamptz DEFAULT now()
  );
EXCEPTION WHEN duplicate_table THEN NULL; END $$;

-- Enable Realtime (safe)
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE fixtures; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE fixtures REPLICA IDENTITY FULL; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE notifications; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE notifications REPLICA IDENTITY FULL; EXCEPTION WHEN undefined_table THEN NULL; END $$;

-- Add notification preferences (safe)
DO $$ BEGIN
  ALTER TABLE public.profiles ADD COLUMN notification_preferences jsonb DEFAULT '{"new_picks":true,"crown_jewel":true,"match_started":true,"result_settled":true,"chain_milestone":true,"chain_broken":true,"accumulator_settled":true,"model_alert":true,"announcement":true,"drawdown_warning":true,"rollover_pick":true}'::jsonb;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- Verify
SELECT 'Setup complete!' as status;
