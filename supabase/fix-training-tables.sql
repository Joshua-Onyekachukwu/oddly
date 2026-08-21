-- ═══════════════════════════════════════════════════════════════════════════════
-- FIX: Add missing columns to existing tables
-- Run this INSTEAD of the full create script if tables already exist
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─── FIX training_log ───────────────────────────────────────────────────────
ALTER TABLE training_log ADD COLUMN IF NOT EXISTS training_type text default 'daily';
ALTER TABLE training_log ADD COLUMN IF NOT EXISTS elite_count int default 0;
ALTER TABLE training_log ADD COLUMN IF NOT EXISTS elite_correct int default 0;
ALTER TABLE training_log ADD COLUMN IF NOT EXISTS high_count int default 0;
ALTER TABLE training_log ADD COLUMN IF NOT EXISTS high_correct int default 0;
ALTER TABLE training_log ADD COLUMN IF NOT EXISTS medium_count int default 0;
ALTER TABLE training_log ADD COLUMN IF NOT EXISTS medium_correct int default 0;
ALTER TABLE training_log ADD COLUMN IF NOT EXISTS dc_accuracy decimal(5,4);
ALTER TABLE training_log ADD COLUMN IF NOT EXISTS xgb_accuracy decimal(5,4);
ALTER TABLE training_log ADD COLUMN IF NOT EXISTS elo_accuracy decimal(5,4);
ALTER TABLE training_log ADD COLUMN IF NOT EXISTS ensemble_accuracy decimal(5,4);

-- ─── FIX model_learning_history ─────────────────────────────────────────────
ALTER TABLE model_learning_history ADD COLUMN IF NOT EXISTS fixture_id uuid;
ALTER TABLE model_learning_history ADD COLUMN IF NOT EXISTS market text;
ALTER TABLE model_learning_history ADD COLUMN IF NOT EXISTS selection text;
ALTER TABLE model_learning_history ADD COLUMN IF NOT EXISTS actual_score text;
ALTER TABLE model_learning_history ADD COLUMN IF NOT EXISTS actual_total_goals int;
ALTER TABLE model_learning_history ADD COLUMN IF NOT EXISTS actual_home_goals int;
ALTER TABLE model_learning_history ADD COLUMN IF NOT EXISTS actual_away_goals int;
ALTER TABLE model_learning_history ADD COLUMN IF NOT EXISTS model_disagreement decimal(5,4);
ALTER TABLE model_learning_history ADD COLUMN IF NOT EXISTS opportunity_score int;
ALTER TABLE model_learning_history ADD COLUMN IF NOT EXISTS data_quality_score int;
ALTER TABLE model_learning_history ADD COLUMN IF NOT EXISTS predicted_at timestamptz default now();
ALTER TABLE model_learning_history ADD COLUMN IF NOT EXISTS settled_at timestamptz;

-- ─── FIX crown_jewel_history ────────────────────────────────────────────────
ALTER TABLE crown_jewel_history ADD COLUMN IF NOT EXISTS chain_day int default 1;
ALTER TABLE crown_jewel_history ADD COLUMN IF NOT EXISTS chain_balance decimal(10,4);
ALTER TABLE crown_jewel_history ADD COLUMN IF NOT EXISTS chain_banked decimal(10,4) default 0;

-- ─── FIX model_versions ─────────────────────────────────────────────────────
ALTER TABLE model_versions ADD COLUMN IF NOT EXISTS ensemble_weights jsonb;
ALTER TABLE model_versions ADD COLUMN IF NOT EXISTS feature_weights jsonb;
ALTER TABLE model_versions ADD COLUMN IF NOT EXISTS dixon_coles_params jsonb;
ALTER TABLE model_versions ADD COLUMN IF NOT EXISTS backtest_accuracy decimal(5,4);
ALTER TABLE model_versions ADD COLUMN IF NOT EXISTS backtest_elite_accuracy decimal(5,4);
ALTER TABLE model_versions ADD COLUMN IF NOT EXISTS training_samples int;
ALTER TABLE model_versions ADD COLUMN IF NOT EXISTS training_period text;
ALTER TABLE model_versions ADD COLUMN IF NOT EXISTS training_date date;
ALTER TABLE model_versions ADD COLUMN IF NOT EXISTS status text default 'active';
ALTER TABLE model_versions ADD COLUMN IF NOT EXISTS notes text;

-- ─── FIX feature_importance ─────────────────────────────────────────────────
ALTER TABLE feature_importance ADD COLUMN IF NOT EXISTS direction text;
ALTER TABLE feature_importance ADD COLUMN IF NOT EXISTS league_id uuid;
ALTER TABLE feature_importance ADD COLUMN IF NOT EXISTS odds_range text;
ALTER TABLE feature_importance ADD COLUMN IF NOT EXISTS correct_when_present decimal(5,4);
ALTER TABLE feature_importance ADD COLUMN IF NOT EXISTS wrong_when_present decimal(5,4);

-- ─── FIX match_features ─────────────────────────────────────────────────────
ALTER TABLE match_features ADD COLUMN IF NOT EXISTS away_avg_goals decimal(4,3);
ALTER TABLE match_features ADD COLUMN IF NOT EXISTS away_avg_conceded decimal(4,3);
ALTER TABLE match_features ADD COLUMN IF NOT EXISTS home_streak int default 0;
ALTER TABLE match_features ADD COLUMN IF NOT EXISTS away_streak int default 0;
ALTER TABLE match_features ADD COLUMN IF NOT EXISTS home_clean_sheet_pct decimal(4,3);
ALTER TABLE match_features ADD COLUMN IF NOT EXISTS home_btts_pct decimal(4,3);
ALTER TABLE match_features ADD COLUMN IF NOT EXISTS fatigue_days int;
ALTER TABLE match_features ADD COLUMN IF NOT EXISTS market_home_prob decimal(5,4);
ALTER TABLE match_features ADD COLUMN IF NOT EXISTS predicted_side text;
ALTER TABLE match_features ADD COLUMN IF NOT EXISTS predicted_prob decimal(5,4);
ALTER TABLE match_features ADD COLUMN IF NOT EXISTS prediction_correct boolean;
ALTER TABLE match_features ADD COLUMN IF NOT EXISTS patterns text[];
ALTER TABLE match_features ADD COLUMN IF NOT EXISTS computed_at timestamptz default now();

-- ─── CREATE elo_ratings if missing ──────────────────────────────────────────
DO $$ BEGIN
  CREATE TABLE elo_ratings (
    id uuid primary key default uuid_generate_v4(),
    team_id uuid references teams(id) not null,
    rating decimal(10,2) not null default 1500,
    match_date date not null,
    fixture_id uuid references fixtures(id),
    opponent_name text,
    result text,
    created_at timestamptz default now(),
    UNIQUE(team_id, match_date, fixture_id)
  );
EXCEPTION WHEN duplicate_table THEN NULL;
END $$;

-- ─── CREATE prediction_history if missing ───────────────────────────────────
DO $$ BEGIN
  CREATE TABLE prediction_history (
    id uuid primary key default uuid_generate_v4(),
    fixture_id uuid references fixtures(id) not null,
    predicted_side text not null,
    predicted_prob decimal(5,4) not null,
    confidence_tier text not null,
    actual_result text,
    correct boolean,
    features_snapshot jsonb,
    patterns text[],
    model_version text default 'v3.0',
    model_weights jsonb,
    predicted_at timestamptz default now(),
    checked_at timestamptz,
    UNIQUE(fixture_id, predicted_side)
  );
EXCEPTION WHEN duplicate_table THEN NULL;
END $$;

-- ─── Indexes ────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_training_log_date ON training_log(training_date);
CREATE INDEX IF NOT EXISTS idx_training_log_version ON training_log(model_version);
CREATE INDEX IF NOT EXISTS idx_training_log_type ON training_log(training_type);
CREATE INDEX IF NOT EXISTS idx_feature_imp_version ON feature_importance(model_version);
CREATE INDEX IF NOT EXISTS idx_feature_imp_name ON feature_importance(feature_name);
CREATE INDEX IF NOT EXISTS idx_learning_version ON model_learning_history(model_version);
CREATE INDEX IF NOT EXISTS idx_learning_correct ON model_learning_history(was_correct);
CREATE INDEX IF NOT EXISTS idx_learning_created ON model_learning_history(created_at);
CREATE INDEX IF NOT EXISTS idx_learning_fixture ON model_learning_history(fixture_id);
CREATE INDEX IF NOT EXISTS idx_crown_date ON crown_jewel_history(pick_date);
CREATE INDEX IF NOT EXISTS idx_crown_result ON crown_jewel_history(result);
CREATE INDEX IF NOT EXISTS idx_model_versions_status ON model_versions(status);
CREATE INDEX IF NOT EXISTS idx_mf_correct ON match_features(prediction_correct);

-- ─── RLS Policies ───────────────────────────────────────────────────────────
ALTER TABLE elo_ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE prediction_history ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN CREATE POLICY "svc elo" ON elo_ratings FOR ALL USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "svc predhist" ON prediction_history FOR ALL USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "anon elo" ON elo_ratings FOR SELECT USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "anon predhist" ON prediction_history FOR SELECT USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── Scoring Config ─────────────────────────────────────────────────────────
INSERT INTO scoring_config (config_key, config_value) VALUES
  ('current_model_version', '"v1.0"'::jsonb),
  ('ensemble_weights', '{"elo": 0.29, "form": 0.19, "goals": 0.18, "odds": 0.10, "homeAdv": 0.10, "h2h": 0.10, "streak": 0.05}'::jsonb),
  ('crown_jewel_criteria', '{"min_odds": 2.0, "max_odds": 3.0, "min_probability": 0.55, "min_edge": 0.03, "max_disagreement": 0.15}'::jsonb),
  ('last_daily_run', 'null'::jsonb),
  ('last_weekly_retrain', 'null'::jsonb),
  ('last_monthly_retrain', 'null'::jsonb)
ON CONFLICT (config_key) DO NOTHING;

-- ─── Verification ───────────────────────────────────────────────────────────
SELECT 'All columns fixed!' as status;
