-- ═══════════════════════════════════════════════════════════════════════════════
-- ODDLY SELF-TRAINING ENGINE — Database Schema
-- Run this ONCE in Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════════════════════════

-- 1. TRAINING LOG — Every learning cycle recorded
CREATE TABLE IF NOT EXISTS training_log (
  id uuid primary key default uuid_generate_v4(),
  model_version text not null,
  training_date date not null,
  training_type text not null default 'daily', -- daily, weekly, monthly, crown_jewel
  
  -- Accuracy metrics
  predictions_count int default 0,
  correct_count int default 0,
  accuracy decimal(5,4),
  
  -- Performance by tier
  elite_count int default 0,
  elite_correct int default 0,
  high_count int default 0,
  high_correct int default 0,
  medium_count int default 0,
  medium_correct int default 0,
  
  -- What was learned
  lessons_learned jsonb default '[]'::jsonb,
  adjustments_made jsonb default '[]'::jsonb,
  
  -- Model state at this training point
  model_weights jsonb,
  feature_weights jsonb,
  market_performance jsonb,
  league_performance jsonb,
  calibration jsonb,
  
  -- Model comparison
  dc_accuracy decimal(5,4),  -- Dixon-Coles accuracy
  xgb_accuracy decimal(5,4), -- XGBoost accuracy
  elo_accuracy decimal(5,4), -- Elo accuracy
  ensemble_accuracy decimal(5,4),
  
  notes text,
  created_at timestamptz default now()
);

-- 2. FEATURE IMPORTANCE — Which features matter most
CREATE TABLE IF NOT EXISTS feature_importance (
  id uuid primary key default uuid_generate_v4(),
  model_version text not null,
  market text, -- which market this importance is for (or NULL for overall)
  feature_name text not null,
  importance decimal(5,4),
  direction text, -- positive = helps correct predictions, negative = hurts
  league_id uuid,
  odds_range text,
  sample_size int default 0,
  correct_when_present decimal(5,4),
  wrong_when_present decimal(5,4),
  updated_at timestamptz default now(),
  
  UNIQUE(model_version, feature_name, market, league_id)
);

-- 3. MODEL LEARNING HISTORY — Every prediction-outcome pair
CREATE TABLE IF NOT EXISTS model_learning_history (
  id uuid primary key default uuid_generate_v4(),
  model_version text not null,
  prediction_id uuid references predictions(id),
  fixture_id uuid references fixtures(id),
  
  -- What we predicted
  market text not null,
  selection text not null,
  predicted_probability decimal(5,4),
  
  -- The EXACT features used (critical for retraining)
  features_snapshot jsonb not null,
  
  -- What actually happened
  actual_outcome text, -- correct, wrong, void
  actual_score text, -- e.g., "2-1"
  actual_total_goals int,
  actual_home_goals int,
  actual_away_goals int,
  
  -- Analysis
  was_correct boolean,
  error_analysis jsonb,
  model_disagreement decimal(5,4),
  opportunity_score int,
  data_quality_score int,
  
  -- Timing
  predicted_at timestamptz default now(),
  settled_at timestamptz,
  created_at timestamptz default now()
);

-- 4. CROWN JEWEL TRACKER — Track the daily 2-odds pick performance
CREATE TABLE IF NOT EXISTS crown_jewel_history (
  id uuid primary key default uuid_generate_v4(),
  pick_date date not null unique,
  
  -- The pick
  fixture_id uuid references fixtures(id),
  market text not null,
  selection text not null,
  odds decimal(10,4),
  model_probability decimal(5,4),
  edge decimal(5,4),
  opportunity_score int,
  data_quality_score int,
  
  -- Features that led to this pick
  features_snapshot jsonb,
  patterns text[],
  
  -- Result
  result text default 'pending', -- pending, won, lost, void
  actual_score text,
  profit_loss decimal(10,4), -- +odds for win, -1 for loss
  
  -- Running chain
  chain_day int default 1,
  chain_balance decimal(10,4),
  chain_banked decimal(10,4) default 0,
  
  created_at timestamptz default now(),
  settled_at timestamptz
);

-- 5. MODEL VERSIONS — Track every model deployment
CREATE TABLE IF NOT EXISTS model_versions (
  id uuid primary key default uuid_generate_v4(),
  version text not null unique,
  created_at timestamptz default now(),
  
  -- What's in this version
  model_weights jsonb,
  ensemble_weights jsonb,
  feature_weights jsonb,
  dixon_coles_params jsonb,
  
  -- Performance at deployment
  backtest_accuracy decimal(5,4),
  backtest_elite_accuracy decimal(5,4),
  
  -- Training info
  training_samples int,
  training_period text,
  training_date date,
  
  -- Status
  status text default 'active', -- active, archived, superseded
  notes text
);

-- 6. SCORING CONFIG — System configuration
CREATE TABLE IF NOT EXISTS scoring_config (
  config_key text primary key,
  config_value jsonb not null,
  updated_at timestamptz default now()
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- INDEXES
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_training_log_date ON training_log(training_date);
CREATE INDEX IF NOT EXISTS idx_training_log_version ON training_log(model_version);
CREATE INDEX IF NOT EXISTS idx_training_log_type ON training_log(training_type);

CREATE INDEX IF NOT EXISTS idx_feature_imp_version ON feature_importance(model_version);
CREATE INDEX IF NOT EXISTS idx_feature_imp_name ON feature_importance(feature_name);
CREATE INDEX IF NOT EXISTS idx_feature_imp_market ON feature_importance(market);

CREATE INDEX IF NOT EXISTS idx_learning_version ON model_learning_history(model_version);
CREATE INDEX IF NOT EXISTS idx_learning_correct ON model_learning_history(was_correct);
CREATE INDEX IF NOT EXISTS idx_learning_created ON model_learning_history(created_at);
CREATE INDEX IF NOT EXISTS idx_learning_fixture ON model_learning_history(fixture_id);

CREATE INDEX IF NOT EXISTS idx_crown_date ON crown_jewel_history(pick_date);
CREATE INDEX IF NOT EXISTS idx_crown_result ON crown_jewel_history(result);

CREATE INDEX IF NOT EXISTS idx_model_versions_status ON model_versions(status);

-- ═══════════════════════════════════════════════════════════════════════════════
-- RLS POLICIES
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE training_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE feature_importance ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_learning_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE crown_jewel_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE scoring_config ENABLE ROW LEVEL SECURITY;

-- Service role full access
DO $$ BEGIN CREATE POLICY "svc training_log" ON training_log FOR ALL USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "svc feature_imp" ON feature_importance FOR ALL USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "svc learning" ON model_learning_history FOR ALL USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "svc crown" ON crown_jewel_history FOR ALL USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "svc versions" ON model_versions FOR ALL USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "svc config" ON scoring_config FOR ALL USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Anon read access (for dashboard)
DO $$ BEGIN CREATE POLICY "anon training_log" ON training_log FOR SELECT USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "anon feature_imp" ON feature_importance FOR SELECT USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "anon learning" ON model_learning_history FOR SELECT USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "anon crown" ON crown_jewel_history FOR SELECT USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "anon versions" ON model_versions FOR SELECT USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "anon config" ON scoring_config FOR SELECT USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- INITIAL CONFIG
-- ═══════════════════════════════════════════════════════════════════════════════

INSERT INTO scoring_config (config_key, config_value) VALUES
  ('current_model_version', '"v1.0"'::jsonb),
  ('ensemble_weights', '{"dixon_coles": 0.30, "xgboost": 0.25, "elo": 0.25, "market": 0.20}'::jsonb),
  ('crown_jewel_criteria', '{"min_odds": 2.0, "max_odds": 3.0, "min_probability": 0.55, "min_edge": 0.03, "max_disagreement": 0.15, "min_data_quality": 60, "min_opportunity_score": 70}'::jsonb),
  ('autonomous_training', '{"active": false, "start_date": null, "end_date": null, "status": "idle"}'::jsonb),
  ('last_daily_run', 'null'::jsonb),
  ('last_weekly_retrain', 'null'::jsonb),
  ('last_monthly_retrain', 'null'::jsonb)
ON CONFLICT (config_key) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════════════
-- VERIFICATION
-- ═══════════════════════════════════════════════════════════════════════════════

SELECT 
  'Self-Training Engine tables created!' as status,
  (SELECT count(*) FROM training_log) as training_logs,
  (SELECT count(*) FROM feature_importance) as feature_importance_rows,
  (SELECT count(*) FROM model_learning_history) as learning_history_rows,
  (SELECT count(*) FROM crown_jewel_history) as crown_jewel_picks,
  (SELECT count(*) FROM model_versions) as model_versions,
  (SELECT count(*) FROM scoring_config) as config_entries;
