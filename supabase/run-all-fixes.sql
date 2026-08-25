-- ============================================
-- ODDLY — COMPLETE DATABASE FIXES
-- Date: August 26, 2026
--
-- Paste this ENTIRE file into Supabase SQL Editor and click Run.
--
-- What it does:
--   1. Creates missing tables (referee_profiles, match_stats, etc.)
--   2. Adds prediction snapshot columns for traceability
--   3. Adds indexes for disk I/O optimization
--   4. Creates materialized views for analytics
--   5. Enables RLS on ALL existing tables with proper policies
--   6. Revokes broad grants, re-grants minimum permissions
--   7. Creates security helper functions
--
-- Safe to run multiple times. Missing tables are silently skipped.
-- ============================================


-- ══════════════════════════════════════════════════════════════════
-- PART 1: SECURITY HELPER FUNCTIONS
-- ══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin');
$$;

CREATE OR REPLACE FUNCTION public.is_service_role()
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT coalesce(current_setting('request.jwt.claims', true)::json->>'role', '') = 'service_role';
$$;

CREATE OR REPLACE FUNCTION public.check_rls_status()
RETURNS TABLE (table_name text, rls_enabled boolean, policy_count bigint)
LANGUAGE sql SECURITY DEFINER AS $$
  SELECT t.tablename::text, c.relrowsecurity,
    (SELECT count(*) FROM pg_policy WHERE polrelid = c.oid)
  FROM pg_tables t JOIN pg_class c ON c.relname = t.tablename
  WHERE t.schemaname = 'public' ORDER BY t.tablename;
$$;


-- ══════════════════════════════════════════════════════════════════
-- PART 2: CREATE MISSING TABLES
-- ══════════════════════════════════════════════════════════════════

-- Add referee columns to fixtures
ALTER TABLE fixtures ADD COLUMN IF NOT EXISTS referee_name TEXT;
ALTER TABLE fixtures ADD COLUMN IF NOT EXISTS referee_id TEXT;
DO $$ BEGIN CREATE INDEX IF NOT EXISTS idx_fixtures_referee ON fixtures(referee_name); EXCEPTION WHEN duplicate_table THEN NULL; END $$;

-- referee_profiles
CREATE TABLE IF NOT EXISTS referee_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referee_name TEXT NOT NULL UNIQUE,
  total_matches INTEGER DEFAULT 0,
  home_win_pct DECIMAL(5,4), draw_pct DECIMAL(5,4), away_win_pct DECIMAL(5,4),
  avg_total_goals DECIMAL(5,3), avg_home_goals DECIMAL(5,3), avg_away_goals DECIMAL(5,3),
  avg_yellow_per_match DECIMAL(5,2), avg_red_per_match DECIMAL(5,3), avg_fouls_per_match DECIMAL(5,2),
  btts_pct DECIMAL(5,4), over_2_5_pct DECIMAL(5,4), over_1_5_pct DECIMAL(5,4),
  home_bias DECIMAL(5,4), leagues_officiated TEXT[],
  last_match_date DATE, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
);
DO $$ BEGIN CREATE INDEX IF NOT EXISTS idx_referee_profiles_name ON referee_profiles(referee_name); EXCEPTION WHEN duplicate_table THEN NULL; END $$;

-- match_stats
CREATE TABLE IF NOT EXISTS match_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fixture_id UUID NOT NULL REFERENCES fixtures(id) ON DELETE CASCADE UNIQUE,
  referee_name TEXT,
  home_shots INTEGER, away_shots INTEGER, home_shots_on_target INTEGER, away_shots_on_target INTEGER,
  home_fouls INTEGER, away_fouls INTEGER, home_corners INTEGER, away_corners INTEGER,
  home_yellow_cards INTEGER, away_yellow_cards INTEGER, home_red_cards INTEGER, away_red_cards INTEGER,
  ht_home_goals INTEGER, ht_away_goals INTEGER, ht_result TEXT, ft_result TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
);
DO $$ BEGIN CREATE INDEX IF NOT EXISTS idx_match_stats_fixture ON match_stats(fixture_id); EXCEPTION WHEN duplicate_table THEN NULL; END $$;
DO $$ BEGIN CREATE INDEX IF NOT EXISTS idx_match_stats_referee ON match_stats(referee_name); EXCEPTION WHEN duplicate_table THEN NULL; END $$;

-- team_referee_stats
CREATE TABLE IF NOT EXISTS team_referee_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  referee_name TEXT NOT NULL,
  matches_under_referee INTEGER DEFAULT 0, wins INTEGER DEFAULT 0, draws INTEGER DEFAULT 0, losses INTEGER DEFAULT 0,
  goals_scored INTEGER DEFAULT 0, goals_conceded INTEGER DEFAULT 0,
  yellow_cards INTEGER DEFAULT 0, red_cards INTEGER DEFAULT 0, fouls_committed INTEGER DEFAULT 0,
  win_pct DECIMAL(5,4), referee_advantage DECIMAL(5,4),
  last_match_date DATE, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(team_id, referee_name)
);
DO $$ BEGIN CREATE INDEX IF NOT EXISTS idx_team_referee_team ON team_referee_stats(team_id); EXCEPTION WHEN duplicate_table THEN NULL; END $$;
DO $$ BEGIN CREATE INDEX IF NOT EXISTS idx_team_referee_name ON team_referee_stats(referee_name); EXCEPTION WHEN duplicate_table THEN NULL; END $$;

-- referee_match_history
CREATE TABLE IF NOT EXISTS referee_match_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referee_name TEXT NOT NULL, fixture_id UUID REFERENCES fixtures(id), match_date DATE,
  home_goals INTEGER, away_goals INTEGER, ft_result TEXT,
  home_yellow INTEGER DEFAULT 0, away_yellow INTEGER DEFAULT 0, home_red INTEGER DEFAULT 0, away_red INTEGER DEFAULT 0,
  total_cards INTEGER DEFAULT 0, home_fouls INTEGER, away_fouls INTEGER,
  home_shots INTEGER, away_shots INTEGER, home_corners INTEGER, away_corners INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
DO $$ BEGIN CREATE INDEX IF NOT EXISTS idx_referee_history_name ON referee_match_history(referee_name); EXCEPTION WHEN duplicate_table THEN NULL; END $$;
DO $$ BEGIN CREATE INDEX IF NOT EXISTS idx_referee_history_date ON referee_match_history(match_date); EXCEPTION WHEN duplicate_table THEN NULL; END $$;

-- Views
CREATE OR REPLACE VIEW referee_analysis AS
SELECT r.referee_name, r.total_matches, r.home_win_pct, r.draw_pct, r.away_win_pct,
  r.avg_yellow_per_match, r.avg_red_per_match, r.avg_total_goals, r.btts_pct,
  r.over_2_5_pct, r.home_bias, r.leagues_officiated, r.last_match_date
FROM referee_profiles r WHERE r.total_matches >= 5 ORDER BY r.total_matches DESC;

CREATE OR REPLACE VIEW team_referee_analysis AS
SELECT t.canonical_name as team_name, tr.referee_name, tr.matches_under_referee,
  tr.wins, tr.draws, tr.losses, tr.win_pct, tr.goals_scored, tr.goals_conceded,
  tr.referee_advantage, tr.last_match_date
FROM team_referee_stats tr JOIN teams t ON t.id = tr.team_id
WHERE tr.matches_under_referee >= 3 ORDER BY tr.referee_advantage DESC;


-- ══════════════════════════════════════════════════════════════════
-- PART 3: PREDICTION SNAPSHOT COLUMNS
-- ══════════════════════════════════════════════════════════════════

ALTER TABLE predictions ADD COLUMN IF NOT EXISTS feature_snapshot JSONB;
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS ensemble_outputs JSONB;
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS market_odds_snapshot JSONB;
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS fixture_snapshot JSONB;
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS prediction_context JSONB;

DO $$ BEGIN CREATE INDEX IF NOT EXISTS idx_predictions_model_version ON predictions(model_version); EXCEPTION WHEN duplicate_table THEN NULL; END $$;
DO $$ BEGIN CREATE INDEX IF NOT EXISTS idx_predictions_feature_snapshot ON predictions USING gin(feature_snapshot); EXCEPTION WHEN duplicate_table THEN NULL; END $$;
DO $$ BEGIN CREATE INDEX IF NOT EXISTS idx_predictions_ensemble_outputs ON predictions USING gin(ensemble_outputs); EXCEPTION WHEN duplicate_table THEN NULL; END $$;


-- ══════════════════════════════════════════════════════════════════
-- PART 4: DISK I/O OPTIMIZATION (INDEXES)
-- ══════════════════════════════════════════════════════════════════

DO $$ BEGIN CREATE INDEX IF NOT EXISTS idx_predictions_settled_date ON predictions(created_at DESC, result) WHERE result IN ('correct', 'wrong'); EXCEPTION WHEN duplicate_table THEN NULL; END $$;
DO $$ BEGIN CREATE INDEX IF NOT EXISTS idx_predictions_market_result ON predictions(market, result, created_at DESC) WHERE result IN ('correct', 'wrong'); EXCEPTION WHEN duplicate_table THEN NULL; END $$;
DO $$ BEGIN CREATE INDEX IF NOT EXISTS idx_predictions_model_result ON predictions(model_version, result, created_at DESC) WHERE result IN ('correct', 'wrong'); EXCEPTION WHEN duplicate_table THEN NULL; END $$;
DO $$ BEGIN CREATE INDEX IF NOT EXISTS idx_predictions_fixture_market ON predictions(fixture_id, market, result); EXCEPTION WHEN duplicate_table THEN NULL; END $$;
DO $$ BEGIN CREATE INDEX IF NOT EXISTS idx_predictions_pending ON predictions(fixture_id, created_at DESC) WHERE result = 'pending' OR result IS NULL; EXCEPTION WHEN duplicate_table THEN NULL; END $$;
DO $$ BEGIN CREATE INDEX IF NOT EXISTS idx_predictions_created_at ON predictions(created_at DESC); EXCEPTION WHEN duplicate_table THEN NULL; END $$;


-- ══════════════════════════════════════════════════════════════════
-- PART 5: MATERIALIZED VIEWS (zero-disk-I/O analytics)
-- ══════════════════════════════════════════════════════════════════

DROP MATERIALIZED VIEW IF EXISTS mv_calibration_buckets;
CREATE MATERIALIZED VIEW mv_calibration_buckets AS
SELECT
  CASE
    WHEN model_probability >= 0.50 AND model_probability < 0.60 THEN '50-59%'
    WHEN model_probability >= 0.60 AND model_probability < 0.65 THEN '60-64%'
    WHEN model_probability >= 0.65 AND model_probability < 0.70 THEN '65-69%'
    WHEN model_probability >= 0.70 AND model_probability < 0.75 THEN '70-74%'
    WHEN model_probability >= 0.75 AND model_probability < 0.80 THEN '75-79%'
    WHEN model_probability >= 0.80 AND model_probability < 0.85 THEN '80-84%'
    WHEN model_probability >= 0.85 THEN '85%+'
    ELSE 'Other'
  END as prob_range,
  CASE
    WHEN model_probability >= 0.50 AND model_probability < 0.60 THEN 1
    WHEN model_probability >= 0.60 AND model_probability < 0.65 THEN 2
    WHEN model_probability >= 0.65 AND model_probability < 0.70 THEN 3
    WHEN model_probability >= 0.70 AND model_probability < 0.75 THEN 4
    WHEN model_probability >= 0.75 AND model_probability < 0.80 THEN 5
    WHEN model_probability >= 0.80 AND model_probability < 0.85 THEN 6
    WHEN model_probability >= 0.85 THEN 7
    ELSE 0
  END as sort_order,
  count(*) as total,
  count(*) FILTER (WHERE result = 'correct') as correct,
  round(avg(model_probability)::numeric, 4) as avg_predicted,
  round((count(*) FILTER (WHERE result = 'correct')::numeric / nullif(count(*), 0)), 4) as actual_accuracy
FROM predictions WHERE result IN ('correct', 'wrong')
GROUP BY prob_range, sort_order ORDER BY sort_order;

DROP MATERIALIZED VIEW IF EXISTS mv_market_accuracy;
CREATE MATERIALIZED VIEW mv_market_accuracy AS
SELECT market, count(*) as total,
  count(*) FILTER (WHERE result = 'correct') as correct,
  count(*) FILTER (WHERE result = 'wrong') as wrong,
  round(avg(model_probability)::numeric, 4) as avg_probability,
  round((count(*) FILTER (WHERE result = 'correct')::numeric / nullif(count(*), 0)), 4) as accuracy
FROM predictions WHERE result IN ('correct', 'wrong')
GROUP BY market ORDER BY total DESC;

DROP MATERIALIZED VIEW IF EXISTS mv_daily_accuracy;
CREATE MATERIALIZED VIEW mv_daily_accuracy AS
SELECT date_trunc('day', created_at)::date as pred_date,
  count(*) as total,
  count(*) FILTER (WHERE result = 'correct') as correct,
  count(*) FILTER (WHERE result = 'wrong') as wrong,
  round((count(*) FILTER (WHERE result = 'correct')::numeric / nullif(count(*), 0)), 4) as accuracy,
  round(avg(model_probability)::numeric, 4) as avg_probability
FROM predictions WHERE result IN ('correct', 'wrong') AND created_at >= now() - interval '90 days'
GROUP BY pred_date ORDER BY pred_date DESC;

DROP MATERIALIZED VIEW IF EXISTS mv_model_accuracy;
CREATE MATERIALIZED VIEW mv_model_accuracy AS
SELECT model_version, count(*) as total,
  count(*) FILTER (WHERE result = 'correct') as correct,
  count(*) FILTER (WHERE result = 'wrong') as wrong,
  round(avg(model_probability)::numeric, 4) as avg_probability,
  round((count(*) FILTER (WHERE result = 'correct')::numeric / nullif(count(*), 0)), 4) as accuracy
FROM predictions WHERE result IN ('correct', 'wrong')
GROUP BY model_version ORDER BY total DESC;

DROP MATERIALIZED VIEW IF EXISTS mv_settlement_summary;
CREATE MATERIALIZED VIEW mv_settlement_summary AS
SELECT count(*) as total_predictions,
  count(*) FILTER (WHERE result = 'correct') as correct,
  count(*) FILTER (WHERE result = 'wrong') as wrong,
  count(*) FILTER (WHERE result = 'pending' OR result IS NULL) as pending,
  count(*) FILTER (WHERE result = 'void') as void_count,
  round((count(*) FILTER (WHERE result = 'correct')::numeric / nullif(count(*) FILTER (WHERE result IN ('correct', 'wrong')), 0)), 4) as accuracy,
  round(avg(model_probability)::numeric, 4) as avg_probability,
  min(created_at) as first_prediction, max(created_at) as last_prediction
FROM predictions;

-- RPC functions
CREATE OR REPLACE FUNCTION get_calibration_buckets(days_back integer DEFAULT 30)
RETURNS TABLE (prob_range text, total bigint, correct bigint, avg_predicted numeric, actual_accuracy numeric)
LANGUAGE sql STABLE AS $$ SELECT prob_range, total, correct, avg_predicted, actual_accuracy FROM mv_calibration_buckets WHERE prob_range != 'Other' ORDER BY sort_order; $$;

CREATE OR REPLACE FUNCTION get_market_accuracy()
RETURNS TABLE (market text, total bigint, correct bigint, wrong bigint, avg_probability numeric, accuracy numeric)
LANGUAGE sql STABLE AS $$ SELECT market, total, correct, wrong, avg_probability, accuracy FROM mv_market_accuracy; $$;

CREATE OR REPLACE FUNCTION get_daily_accuracy(days_back integer DEFAULT 30)
RETURNS TABLE (pred_date date, total bigint, correct bigint, wrong bigint, accuracy numeric, avg_probability numeric)
LANGUAGE sql STABLE AS $$ SELECT pred_date, total, correct, wrong, accuracy, avg_probability FROM mv_daily_accuracy WHERE pred_date >= (current_date - days_back * interval '1 day') ORDER BY pred_date DESC; $$;

CREATE OR REPLACE FUNCTION get_settlement_summary()
RETURNS TABLE (total_predictions bigint, correct bigint, wrong bigint, pending bigint, void_count bigint, accuracy numeric, avg_probability numeric, first_prediction timestamptz, last_prediction timestamptz)
LANGUAGE sql STABLE AS $$ SELECT total_predictions, correct, wrong, pending, void_count, accuracy, avg_probability, first_prediction, last_prediction FROM mv_settlement_summary; $$;

CREATE OR REPLACE FUNCTION refresh_analytics_views()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_calibration_buckets;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_market_accuracy;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_daily_accuracy;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_model_accuracy;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_settlement_summary;
END;
$$;


-- ══════════════════════════════════════════════════════════════════
-- PART 6: ENABLE RLS ON ALL EXISTING TABLES
-- ══════════════════════════════════════════════════════════════════

-- Helper function: enables RLS on a table if it exists, silently skips if not
CREATE OR REPLACE FUNCTION _enable_rls(tbl text, sel_pol text, sel_using text, man_pol text DEFAULT NULL, man_using text DEFAULT NULL, force boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = tbl) THEN RETURN; END IF;
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
  IF force THEN EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tbl); END IF;
  EXECUTE format('DROP POLICY IF EXISTS %s ON %I', quote_literal(sel_pol), tbl);
  IF man_pol IS NOT NULL THEN EXECUTE format('DROP POLICY IF EXISTS %s ON %I', quote_literal(man_pol), tbl); END IF;
  EXECUTE format('CREATE POLICY %s ON %I FOR SELECT USING (%s)', quote_literal(sel_pol), tbl, sel_using);
  IF man_pol IS NOT NULL AND man_using IS NOT NULL THEN
    EXECUTE format('CREATE POLICY %s ON %I FOR ALL USING (%s)', quote_literal(man_pol), tbl, man_using);
  END IF;
END;
$$;

-- PUBLIC_READ tables
SELECT _enable_rls('leagues',             'Anyone can view leagues',          'true', 'Service role manages leagues',         'public.is_service_role()');
SELECT _enable_rls('teams',               'Anyone can view teams',            'true', 'Service role manages teams',           'public.is_service_role()');
SELECT _enable_rls('team_aliases',        'Anyone can view team aliases',     'true', 'Service role manages team aliases',    'public.is_service_role()');
SELECT _enable_rls('fixtures',            'Anyone can view fixtures',         'true', 'Service role manages fixtures',        'public.is_service_role()');
SELECT _enable_rls('odds_snapshots',      'Anyone can view odds',             'true', 'Service role manages odds',            'public.is_service_role()');
SELECT _enable_rls('predictions',         'Anyone can view predictions',      'true', 'Service role manages predictions',     'public.is_service_role()', true);
SELECT _enable_rls('recommendations',     'Anyone can view recommendations',  'true', 'Service role manages recommendations', 'public.is_service_role()');
SELECT _enable_rls('model_performance',   'Anyone can view model performance','true', 'Service role manages model performance','public.is_service_role()');
SELECT _enable_rls('model_performance_history','Anyone can view mph',          'true', 'Service role manages mph',             'public.is_service_role()');
SELECT _enable_rls('model_predictions',   'Anyone can view model predictions','true', 'Service role manages model predictions','public.is_service_role()');
SELECT _enable_rls('historical_matches',  'Anyone can view historical','true','Service role manages historical','public.is_service_role()');
SELECT _enable_rls('ai_cache',            'Anyone can view ai cache',         'true', 'Service role manages ai cache',        'public.is_service_role()');
SELECT _enable_rls('announcements',       'Anyone can view announcements',    'is_active = true', 'Service role manages announcements','public.is_service_role()');
SELECT _enable_rls('players',             'Authenticated can view players',   'auth.role() = ''authenticated''', 'Service role manages players', 'public.is_service_role()');

-- USER_SCOPED tables
SELECT _enable_rls('profiles',            'Users see own profile',            'auth.uid() = id', 'Service role manages profiles', 'public.is_service_role()', true);
SELECT _enable_rls('user_bets',           'Users manage own bets',            'auth.uid() = user_id', 'Service role manages bets', 'public.is_service_role()', true);
SELECT _enable_rls('accumulators',        'Users manage own accumulators',    'auth.uid() = user_id', 'Service role manages accumulators', 'public.is_service_role()', true);
SELECT _enable_rls('rollover_chains',     'Users manage own chains',          'auth.uid() = user_id', 'Service role manages chains', 'public.is_service_role()');
SELECT _enable_rls('notifications',       'Users see own notifications',      'auth.uid() = user_id', 'Service role manages notifications', 'public.is_service_role()');

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'rollover_picks') THEN
    ALTER TABLE rollover_picks ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS 'Users manage own picks' ON rollover_picks;
    DROP POLICY IF EXISTS 'Service role manages picks' ON rollover_picks;
    CREATE POLICY 'Users manage own picks' ON rollover_picks FOR ALL USING (chain_id IN (SELECT id FROM rollover_chains WHERE user_id = auth.uid()));
    CREATE POLICY 'Service role manages picks' ON rollover_picks FOR ALL USING (public.is_service_role());
  END IF;
END $$;

-- SERVICE_INTERNAL tables
SELECT _enable_rls('admin_activity_log',  'Service role manages activity log','public.is_service_role()', NULL, NULL, true);
SELECT _enable_rls('scoring_config',      'Authenticated can view scoring config','auth.role() = ''authenticated''', 'Service role manages scoring config','public.is_service_role()');
SELECT _enable_rls('match_features',      'Service role manages match features','public.is_service_role()', NULL, NULL, true);
SELECT _enable_rls('training_log',        'Service role manages training log','public.is_service_role()');
SELECT _enable_rls('model_learning_history','Service role manages learning history','public.is_service_role()');
SELECT _enable_rls('crown_jewel_history', 'Service role manages crown jewel', 'public.is_service_role()');
SELECT _enable_rls('model_versions',      'Service role manages model versions','public.is_service_role()');
SELECT _enable_rls('feature_importance',  'Service role manages feature importance','public.is_service_role()');
SELECT _enable_rls('elo_ratings',         'Service role manages elo ratings', 'public.is_service_role()', NULL, NULL, true);
SELECT _enable_rls('prediction_history',  'Service role manages prediction history','public.is_service_role()', NULL, NULL, true);
SELECT _enable_rls('referee_profiles',    'Authenticated can view referee profiles','auth.role() = ''authenticated''', 'Service role manages referee profiles','public.is_service_role()', true);
SELECT _enable_rls('referee_match_history','Authenticated can view referee history','auth.role() = ''authenticated''', 'Service role manages referee history','public.is_service_role()', true);
SELECT _enable_rls('team_referee_stats',  'Authenticated can view team referee stats','auth.role() = ''authenticated''', 'Service role manages team referee stats','public.is_service_role()', true);
SELECT _enable_rls('match_stats',         'Authenticated can view match stats','auth.role() = ''authenticated''', 'Service role manages match stats','public.is_service_role()', true);

-- Tables that may or may not exist
SELECT _enable_rls('player_appearances',     'Service role manages player appearances', 'public.is_service_role()');
SELECT _enable_rls('player_impact',          'Service role manages player impact',      'public.is_service_role()');
SELECT _enable_rls('player_availability',    'Service role manages player availability','public.is_service_role()');
SELECT _enable_rls('player_impact_scores',   'Service role manages player impact scores','public.is_service_role()');
SELECT _enable_rls('player_injury_data',     'Service role manages player injury data', 'public.is_service_role()');
SELECT _enable_rls('referee_feature_profiles','Service role manages referee feature profiles','public.is_service_role()');
SELECT _enable_rls('team_feature_profiles',  'Service role manages team feature profiles','public.is_service_role()');
SELECT _enable_rls('team_match_stats',       'Service role manages team match stats',   'public.is_service_role()');
SELECT _enable_rls('team_strengths',         'Service role manages team strengths',     'public.is_service_role()');
SELECT _enable_rls('xg_features',            'Service role manages xg features',        'public.is_service_role()');
SELECT _enable_rls('odds_feature_cache',     'Service role manages odds feature cache', 'public.is_service_role()');
SELECT _enable_rls('league_model_params',    'Service role manages league model params', 'public.is_service_role()');
SELECT _enable_rls('model_weight_config',    'Service role manages model weight config', 'public.is_service_role()');
SELECT _enable_rls('agent_audit_log',        'Service role manages agent audit log',     'public.is_service_role()');

-- Cleanup
DROP FUNCTION IF EXISTS _enable_rls(text,text,text,text,text,boolean);


-- ══════════════════════════════════════════════════════════════════
-- PART 7: REVOKE BROAD GRANTS, RE-GRANT MINIMUM
-- ══════════════════════════════════════════════════════════════════

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated;

-- Anon: SELECT only on public-read tables
GRANT SELECT ON leagues, teams, team_aliases, fixtures, odds_snapshots, predictions,
  recommendations, model_performance, model_performance_history, model_predictions,
  historical_matches, ai_cache, announcements TO anon;

-- Authenticated: SELECT on public-read + INSERT/UPDATE on user tables
GRANT SELECT ON leagues, teams, team_aliases, fixtures, odds_snapshots, predictions,
  recommendations, model_performance, model_performance_history, model_predictions,
  historical_matches, scoring_config, announcements, players, referee_profiles, profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE ON user_bets, accumulators TO authenticated;
GRANT SELECT, UPDATE ON notifications TO authenticated;
GRANT SELECT, INSERT, UPDATE ON rollover_chains, rollover_picks TO authenticated;
GRANT SELECT, INSERT, UPDATE ON match_stats, team_referee_stats TO authenticated;
GRANT SELECT, INSERT ON referee_match_history TO authenticated;


-- ══════════════════════════════════════════════════════════════════
-- PART 8: GRANTS FOR MATERIALIZED VIEWS & RPC
-- ══════════════════════════════════════════════════════════════════

GRANT SELECT ON mv_calibration_buckets, mv_market_accuracy, mv_daily_accuracy,
  mv_model_accuracy, mv_settlement_summary TO authenticated;
GRANT EXECUTE ON FUNCTION get_calibration_buckets(integer), get_market_accuracy(),
  get_daily_accuracy(integer), get_settlement_summary() TO authenticated;
GRANT EXECUTE ON FUNCTION refresh_analytics_views() TO service_role;


-- ══════════════════════════════════════════════════════════════════
-- DONE
-- ══════════════════════════════════════════════════════════════════

DO $$ BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '=== ODDLY DATABASE FIXES COMPLETE ===';
  RAISE NOTICE '  Tables created: referee_profiles, match_stats, team_referee_stats, referee_match_history';
  RAISE NOTICE '  Columns added: predictions.feature_snapshot, ensemble_outputs, market_odds_snapshot';
  RAISE NOTICE '  Indexes added: 6 composite indexes on predictions';
  RAISE NOTICE '  Views created: mv_calibration_buckets, mv_market_accuracy, mv_daily_accuracy, mv_model_accuracy, mv_settlement_summary';
  RAISE NOTICE '  RLS enabled on all existing tables (missing tables silently skipped)';
  RAISE NOTICE '  Grants locked down: anon + authenticated';
  RAISE NOTICE '';
  RAISE NOTICE 'Verify: SELECT * FROM check_rls_status();';
END $$;
