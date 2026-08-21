-- ODDLY: Complete Database Setup
-- Run this ONE file to create everything

-- 1. Match features (for self-learning)
CREATE TABLE IF NOT EXISTS match_features (
  id uuid primary key default uuid_generate_v4(),
  fixture_id uuid references fixtures(id) unique,
  home_team_name text,
  away_team_name text,
  home_elo decimal(10,2),
  away_elo decimal(10,2),
  elo_diff decimal(10,2),
  elo_home_prob decimal(5,4),
  home_form_ppg decimal(4,3),
  away_form_ppg decimal(4,3),
  home_win_rate decimal(4,3),
  away_win_rate decimal(4,3),
  home_avg_goals decimal(4,3),
  home_avg_conceded decimal(4,3),
  away_avg_goals decimal(4,3),
  away_avg_conceded decimal(4,3),
  home_streak int default 0,
  away_streak int default 0,
  goal_diff decimal(4,3),
  home_clean_sheet_pct decimal(4,3),
  home_btts_pct decimal(4,3),
  fatigue_days int,
  home_odds decimal(10,4),
  draw_odds decimal(10,4),
  away_odds decimal(10,4),
  market_home_prob decimal(5,4),
  home_score int,
  away_score int,
  actual_result text,
  predicted_side text,
  predicted_prob decimal(5,4),
  prediction_correct boolean,
  patterns text[],
  computed_at timestamptz default now()
);

-- 2. Training log
CREATE TABLE IF NOT EXISTS training_log (
  id uuid primary key default uuid_generate_v4(),
  model_version text not null,
  training_date date not null,
  training_type text default 'daily',
  predictions_count int default 0,
  correct_count int default 0,
  accuracy decimal(5,4),
  elite_count int default 0,
  elite_correct int default 0,
  high_count int default 0,
  high_correct int default 0,
  medium_count int default 0,
  medium_correct int default 0,
  model_weights jsonb,
  feature_weights jsonb,
  market_performance jsonb,
  league_performance jsonb,
  notes text,
  created_at timestamptz default now()
);

-- 3. Model learning history
CREATE TABLE IF NOT EXISTS model_learning_history (
  id uuid primary key default uuid_generate_v4(),
  model_version text default 'v1.0',
  prediction_id uuid,
  fixture_id uuid,
  market text,
  selection text,
  predicted_probability decimal(5,4),
  features_snapshot jsonb,
  actual_outcome text,
  actual_score text,
  actual_total_goals int,
  was_correct boolean,
  predicted_at timestamptz default now(),
  settled_at timestamptz,
  created_at timestamptz default now()
);

-- 4. Crown jewel history
CREATE TABLE IF NOT EXISTS crown_jewel_history (
  id uuid primary key default uuid_generate_v4(),
  pick_date date unique,
  fixture_id uuid,
  market text,
  selection text,
  odds decimal(10,4),
  model_probability decimal(5,4),
  edge decimal(5,4),
  opportunity_score int,
  data_quality_score int,
  features_snapshot jsonb,
  patterns text[],
  result text default 'pending',
  actual_score text,
  profit_loss decimal(10,4),
  created_at timestamptz default now(),
  settled_at timestamptz
);

-- 5. Model versions
CREATE TABLE IF NOT EXISTS model_versions (
  id uuid primary key default uuid_generate_v4(),
  version text unique,
  model_weights jsonb,
  ensemble_weights jsonb,
  feature_weights jsonb,
  backtest_accuracy decimal(5,4),
  training_samples int,
  training_date date,
  status text default 'active',
  notes text,
  created_at timestamptz default now()
);

-- 6. Feature importance
CREATE TABLE IF NOT EXISTS feature_importance (
  id uuid primary key default uuid_generate_v4(),
  model_version text,
  feature_name text,
  importance decimal(5,4),
  sample_size int default 0,
  updated_at timestamptz default now()
);

-- 7. Scoring config
CREATE TABLE IF NOT EXISTS scoring_config (
  config_key text primary key,
  config_value jsonb,
  updated_at timestamptz default now()
);

-- 8. Player tables
CREATE TABLE IF NOT EXISTS players (
  id uuid primary key default uuid_generate_v4(),
  statsbomb_id int unique,
  name text not null,
  nickname text,
  position text,
  nationality text,
  created_at timestamptz default now()
);

CREATE TABLE IF NOT EXISTS player_appearances (
  id uuid primary key default uuid_generate_v4(),
  player_id uuid references players(id),
  fixture_id uuid,
  team_id uuid,
  is_starter boolean,
  is_substitute boolean,
  substitute_in_minute int,
  minutes_played int,
  position text,
  goals int default 0,
  assists int default 0,
  shots int default 0,
  xg decimal(5,4) default 0,
  xa decimal(5,4) default 0,
  tackles int default 0,
  interceptions int default 0,
  yellow_cards int default 0,
  red_cards int default 0,
  created_at timestamptz default now()
);

CREATE TABLE IF NOT EXISTS player_impact (
  id uuid primary key default uuid_generate_v4(),
  player_id uuid references players(id),
  team_id uuid,
  season text default 'all',
  matches_started int,
  team_win_rate_with decimal(5,4),
  team_win_rate_without decimal(5,4),
  impact_score int,
  impact_tier text,
  calculated_at timestamptz default now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_mf_fixture ON match_features(fixture_id);
CREATE INDEX IF NOT EXISTS idx_mf_correct ON match_features(prediction_correct);
CREATE INDEX IF NOT EXISTS idx_tl_date ON training_log(training_date);
CREATE INDEX IF NOT EXISTS idx_tl_version ON training_log(model_version);
CREATE INDEX IF NOT EXISTS idx_mlh_version ON model_learning_history(model_version);
CREATE INDEX IF NOT EXISTS idx_mlh_correct ON model_learning_history(was_correct);
CREATE INDEX IF NOT EXISTS idx_mlh_fixture ON model_learning_history(fixture_id);
CREATE INDEX IF NOT EXISTS idx_cj_date ON crown_jewel_history(pick_date);
CREATE INDEX IF NOT EXISTS idx_mv_status ON model_versions(status);
CREATE INDEX IF NOT EXISTS idx_fi_name ON feature_importance(feature_name);
CREATE INDEX IF NOT EXISTS idx_pa_player ON player_appearances(player_id);
CREATE INDEX IF NOT EXISTS idx_pa_fixture ON player_appearances(fixture_id);
CREATE INDEX IF NOT EXISTS idx_pi_score ON player_impact(impact_score);

-- RLS (enable all, service role full access, anon read)
ALTER TABLE match_features ENABLE ROW LEVEL SECURITY;
ALTER TABLE training_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_learning_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE crown_jewel_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE feature_importance ENABLE ROW LEVEL SECURITY;
ALTER TABLE scoring_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE players ENABLE ROW LEVEL SECURITY;
ALTER TABLE player_appearances ENABLE ROW LEVEL SECURITY;
ALTER TABLE player_impact ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN CREATE POLICY "s1" ON match_features FOR ALL USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "s2" ON training_log FOR ALL USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "s3" ON model_learning_history FOR ALL USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "s4" ON crown_jewel_history FOR ALL USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "s5" ON model_versions FOR ALL USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "s6" ON feature_importance FOR ALL USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "s7" ON scoring_config FOR ALL USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "s8" ON players FOR ALL USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "s9" ON player_appearances FOR ALL USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "s10" ON player_impact FOR ALL USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE POLICY "a1" ON match_features FOR SELECT USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "a2" ON training_log FOR SELECT USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "a3" ON model_learning_history FOR SELECT USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "a4" ON crown_jewel_history FOR SELECT USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "a5" ON model_versions FOR SELECT USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "a6" ON feature_importance FOR SELECT USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "a7" ON scoring_config FOR SELECT USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "a8" ON players FOR SELECT USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "a9" ON player_appearances FOR SELECT USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "a10" ON player_impact FOR SELECT USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Insert default config
INSERT INTO scoring_config (config_key, config_value) VALUES
  ('current_model_version', '"v1.0"'),
  ('ensemble_weights', '{"elo": 0.29, "form": 0.19, "goals": 0.18, "odds": 0.10, "homeAdv": 0.10, "h2h": 0.10, "streak": 0.05}'),
  ('crown_jewel_criteria', '{"min_odds": 2.0, "max_odds": 3.0, "min_probability": 0.55}')
ON CONFLICT (config_key) DO NOTHING;

SELECT 'All 10 tables created successfully!' as status;
