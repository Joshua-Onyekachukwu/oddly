-- ODDLY BULLETPROOF DATABASE SETUP
-- This ONE file handles everything. Run it in Supabase SQL Editor.
-- If a table exists, it skips. If a column is missing, it adds it.

-- ═══════════════════════════════════════════════════════════════
-- TABLES (create only if not exists)
-- ═══════════════════════════════════════════════════════════════

DO $$ BEGIN
  CREATE TABLE match_features (
    id uuid primary key default uuid_generate_v4(),
    fixture_id uuid,
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
EXCEPTION WHEN duplicate_table THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TABLE training_log (
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
    model_weights jsonb,
    feature_weights jsonb,
    market_performance jsonb,
    notes text,
    created_at timestamptz default now()
  );
EXCEPTION WHEN duplicate_table THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TABLE model_learning_history (
    id uuid primary key default uuid_generate_v4(),
    model_version text default 'v1.0',
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
EXCEPTION WHEN duplicate_table THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TABLE crown_jewel_history (
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
EXCEPTION WHEN duplicate_table THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TABLE model_versions (
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
EXCEPTION WHEN duplicate_table THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TABLE feature_importance (
    id uuid primary key default uuid_generate_v4(),
    model_version text,
    feature_name text,
    importance decimal(5,4),
    sample_size int default 0,
    updated_at timestamptz default now()
  );
EXCEPTION WHEN duplicate_table THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TABLE scoring_config (
    config_key text primary key,
    config_value jsonb,
    updated_at timestamptz default now()
  );
EXCEPTION WHEN duplicate_table THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TABLE players (
    id uuid primary key default uuid_generate_v4(),
    statsbomb_id int unique,
    name text not null,
    nickname text,
    position text,
    nationality text,
    created_at timestamptz default now()
  );
EXCEPTION WHEN duplicate_table THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TABLE player_appearances (
    id uuid primary key default uuid_generate_v4(),
    player_id uuid,
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
EXCEPTION WHEN duplicate_table THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TABLE player_impact (
    id uuid primary key default uuid_generate_v4(),
    player_id uuid,
    team_id uuid,
    season text default 'all',
    matches_started int,
    team_win_rate_with decimal(5,4),
    team_win_rate_without decimal(5,4),
    impact_score int,
    impact_tier text,
    calculated_at timestamptz default now()
  );
EXCEPTION WHEN duplicate_table THEN NULL;
END $$;

-- ═══════════════════════════════════════════════════════════════
-- ADD MISSING COLUMNS (safe to run multiple times)
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE training_log ADD COLUMN IF NOT EXISTS training_type text default 'daily';
ALTER TABLE training_log ADD COLUMN IF NOT EXISTS elite_count int default 0;
ALTER TABLE training_log ADD COLUMN IF NOT EXISTS elite_correct int default 0;
ALTER TABLE training_log ADD COLUMN IF NOT EXISTS high_count int default 0;
ALTER TABLE training_log ADD COLUMN IF NOT EXISTS high_correct int default 0;
ALTER TABLE training_log ADD COLUMN IF NOT EXISTS medium_count int default 0;
ALTER TABLE training_log ADD COLUMN IF NOT EXISTS medium_correct int default 0;

ALTER TABLE model_learning_history ADD COLUMN IF NOT EXISTS fixture_id uuid;
ALTER TABLE model_learning_history ADD COLUMN IF NOT EXISTS market text;
ALTER TABLE model_learning_history ADD COLUMN IF NOT EXISTS selection text;
ALTER TABLE model_learning_history ADD COLUMN IF NOT EXISTS actual_score text;
ALTER TABLE model_learning_history ADD COLUMN IF NOT EXISTS actual_total_goals int;
ALTER TABLE model_learning_history ADD COLUMN IF NOT EXISTS predicted_at timestamptz default now();
ALTER TABLE model_learning_history ADD COLUMN IF NOT EXISTS settled_at timestamptz;

ALTER TABLE model_versions ADD COLUMN IF NOT EXISTS ensemble_weights jsonb;
ALTER TABLE model_versions ADD COLUMN IF NOT EXISTS feature_weights jsonb;
ALTER TABLE model_versions ADD COLUMN IF NOT EXISTS backtest_accuracy decimal(5,4);
ALTER TABLE model_versions ADD COLUMN IF NOT EXISTS training_samples int;
ALTER TABLE model_versions ADD COLUMN IF NOT EXISTS training_date date;
ALTER TABLE model_versions ADD COLUMN IF NOT EXISTS status text default 'active';

ALTER TABLE match_features ADD COLUMN IF NOT EXISTS fixture_id uuid;
ALTER TABLE match_features ADD COLUMN IF NOT EXISTS home_team_name text;
ALTER TABLE match_features ADD COLUMN IF NOT EXISTS away_team_name text;
ALTER TABLE match_features ADD COLUMN IF NOT EXISTS home_elo decimal(10,2);
ALTER TABLE match_features ADD COLUMN IF NOT EXISTS away_elo decimal(10,2);
ALTER TABLE match_features ADD COLUMN IF NOT EXISTS elo_diff decimal(10,2);
ALTER TABLE match_features ADD COLUMN IF NOT EXISTS elo_home_prob decimal(5,4);
ALTER TABLE match_features ADD COLUMN IF NOT EXISTS home_form_ppg decimal(4,3);
ALTER TABLE match_features ADD COLUMN IF NOT EXISTS away_form_ppg decimal(4,3);
ALTER TABLE match_features ADD COLUMN IF NOT EXISTS home_win_rate decimal(4,3);
ALTER TABLE match_features ADD COLUMN IF NOT EXISTS away_win_rate decimal(4,3);
ALTER TABLE match_features ADD COLUMN IF NOT EXISTS home_avg_goals decimal(4,3);
ALTER TABLE match_features ADD COLUMN IF NOT EXISTS home_avg_conceded decimal(4,3);
ALTER TABLE match_features ADD COLUMN IF NOT EXISTS away_avg_goals decimal(4,3);
ALTER TABLE match_features ADD COLUMN IF NOT EXISTS away_avg_conceded decimal(4,3);
ALTER TABLE match_features ADD COLUMN IF NOT EXISTS home_streak int default 0;
ALTER TABLE match_features ADD COLUMN IF NOT EXISTS away_streak int default 0;
ALTER TABLE match_features ADD COLUMN IF NOT EXISTS goal_diff decimal(4,3);
ALTER TABLE match_features ADD COLUMN IF NOT EXISTS home_clean_sheet_pct decimal(4,3);
ALTER TABLE match_features ADD COLUMN IF NOT EXISTS home_btts_pct decimal(4,3);
ALTER TABLE match_features ADD COLUMN IF NOT EXISTS fatigue_days int;
ALTER TABLE match_features ADD COLUMN IF NOT EXISTS home_odds decimal(10,4);
ALTER TABLE match_features ADD COLUMN IF NOT EXISTS draw_odds decimal(10,4);
ALTER TABLE match_features ADD COLUMN IF NOT EXISTS away_odds decimal(10,4);
ALTER TABLE match_features ADD COLUMN IF NOT EXISTS market_home_prob decimal(5,4);
ALTER TABLE match_features ADD COLUMN IF NOT EXISTS home_score int;
ALTER TABLE match_features ADD COLUMN IF NOT EXISTS away_score int;
ALTER TABLE match_features ADD COLUMN IF NOT EXISTS actual_result text;
ALTER TABLE match_features ADD COLUMN IF NOT EXISTS predicted_side text;
ALTER TABLE match_features ADD COLUMN IF NOT EXISTS predicted_prob decimal(5,4);
ALTER TABLE match_features ADD COLUMN IF NOT EXISTS prediction_correct boolean;
ALTER TABLE match_features ADD COLUMN IF NOT EXISTS patterns text[];
ALTER TABLE match_features ADD COLUMN IF NOT EXISTS computed_at timestamptz default now();

-- ═══════════════════════════════════════════════════════════════
-- INDEXES
-- ═══════════════════════════════════════════════════════════════

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

-- ═══════════════════════════════════════════════════════════════
-- RLS POLICIES
-- ═══════════════════════════════════════════════════════════════

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

DO $$ BEGIN CREATE POLICY "svc_mf" ON match_features FOR ALL USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "svc_tl" ON training_log FOR ALL USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "svc_mlh" ON model_learning_history FOR ALL USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "svc_cj" ON crown_jewel_history FOR ALL USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "svc_mv" ON model_versions FOR ALL USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "svc_fi" ON feature_importance FOR ALL USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "svc_sc" ON scoring_config FOR ALL USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "svc_pl" ON players FOR ALL USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "svc_pa" ON player_appearances FOR ALL USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "svc_pi" ON player_impact FOR ALL USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE POLICY "anon_mf" ON match_features FOR SELECT USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "anon_tl" ON training_log FOR SELECT USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "anon_mlh" ON model_learning_history FOR SELECT USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "anon_cj" ON crown_jewel_history FOR SELECT USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "anon_mv" ON model_versions FOR SELECT USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "anon_fi" ON feature_importance FOR SELECT USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "anon_sc" ON scoring_config FOR SELECT USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "anon_pl" ON players FOR SELECT USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "anon_pa" ON player_appearances FOR SELECT USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "anon_pi" ON player_impact FOR SELECT USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ═══════════════════════════════════════════════════════════════
-- DEFAULT CONFIG
-- ═══════════════════════════════════════════════════════════════

INSERT INTO scoring_config (config_key, config_value) VALUES
  ('current_model_version', '"v1.0"'),
  ('ensemble_weights', '{"elo": 0.29, "form": 0.19, "goals": 0.18, "odds": 0.10, "homeAdv": 0.10, "h2h": 0.10, "streak": 0.05}'),
  ('crown_jewel_criteria', '{"min_odds": 2.0, "max_odds": 3.0, "min_probability": 0.55}')
ON CONFLICT (config_key) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════
-- VERIFICATION
-- ═══════════════════════════════════════════════════════════════

SELECT 
  'All 10 tables ready!' as status,
  (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('match_features','training_log','model_learning_history','crown_jewel_history','model_versions','feature_importance','scoring_config','players','player_appearances','player_impact')) as tables_created;
