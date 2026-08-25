-- ============================================
-- ODDLY — RUN ALL 4 CRITICAL FIXES
-- Date: August 26, 2026
--
-- Paste this ENTIRE file into Supabase SQL Editor and click Run.
-- It will:
--   1. Create referee_profiles, match_stats, team_referee_stats tables
--   2. Enable RLS on ALL tables that exist with proper policies
--   3. Revoke broad anon/authenticated grants
--   4. Create audit functions
--
-- Safe to run multiple times (uses IF NOT EXISTS / exception handling)
-- ============================================

-- ============================================
-- FIX 1: SECURITY HELPER FUNCTIONS (must exist before policies)
-- ============================================

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE
AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin');
$$;

CREATE OR REPLACE FUNCTION public.is_service_role()
RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE
AS $$
  SELECT coalesce(current_setting('request.jwt.claims', true)::json->>'role', '') = 'service_role';
$$;

CREATE OR REPLACE FUNCTION public.check_rls_status()
RETURNS TABLE (table_name text, rls_enabled boolean, policy_count bigint)
LANGUAGE sql SECURITY DEFINER
AS $$
  SELECT t.tablename::text, c.relrowsecurity,
    (SELECT count(*) FROM pg_policy WHERE polrelid = c.oid)
  FROM pg_tables t JOIN pg_class c ON c.relname = t.tablename
  WHERE t.schemaname = 'public' ORDER BY t.tablename;
$$;


-- ============================================
-- FIX 2: CREATE MISSING REFEREE TABLES
-- ============================================

ALTER TABLE fixtures ADD COLUMN IF NOT EXISTS referee_name TEXT;
ALTER TABLE fixtures ADD COLUMN IF NOT EXISTS referee_id TEXT;
DO $$ BEGIN CREATE INDEX IF NOT EXISTS idx_fixtures_referee ON fixtures(referee_name); EXCEPTION WHEN duplicate_table THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS referee_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referee_name TEXT NOT NULL UNIQUE,
  total_matches INTEGER DEFAULT 0,
  home_win_pct DECIMAL(5,4),
  draw_pct DECIMAL(5,4),
  away_win_pct DECIMAL(5,4),
  avg_total_goals DECIMAL(5,3),
  avg_home_goals DECIMAL(5,3),
  avg_away_goals DECIMAL(5,3),
  avg_yellow_per_match DECIMAL(5,2),
  avg_red_per_match DECIMAL(5,3),
  avg_fouls_per_match DECIMAL(5,2),
  btts_pct DECIMAL(5,4),
  over_2_5_pct DECIMAL(5,4),
  over_1_5_pct DECIMAL(5,4),
  home_bias DECIMAL(5,4),
  leagues_officiated TEXT[],
  last_match_date DATE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
DO $$ BEGIN CREATE INDEX IF NOT EXISTS idx_referee_profiles_name ON referee_profiles(referee_name); EXCEPTION WHEN duplicate_table THEN NULL; END $$;
DO $$ BEGIN CREATE INDEX IF NOT EXISTS idx_referee_profiles_matches ON referee_profiles(total_matches DESC); EXCEPTION WHEN duplicate_table THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS match_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fixture_id UUID NOT NULL REFERENCES fixtures(id) ON DELETE CASCADE UNIQUE,
  referee_name TEXT,
  home_shots INTEGER, away_shots INTEGER,
  home_shots_on_target INTEGER, away_shots_on_target INTEGER,
  home_fouls INTEGER, away_fouls INTEGER,
  home_corners INTEGER, away_corners INTEGER,
  home_yellow_cards INTEGER, away_yellow_cards INTEGER,
  home_red_cards INTEGER, away_red_cards INTEGER,
  ht_home_goals INTEGER, ht_away_goals INTEGER,
  ht_result TEXT, ft_result TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
DO $$ BEGIN CREATE INDEX IF NOT EXISTS idx_match_stats_fixture ON match_stats(fixture_id); EXCEPTION WHEN duplicate_table THEN NULL; END $$;
DO $$ BEGIN CREATE INDEX IF NOT EXISTS idx_match_stats_referee ON match_stats(referee_name); EXCEPTION WHEN duplicate_table THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS team_referee_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  referee_name TEXT NOT NULL,
  matches_under_referee INTEGER DEFAULT 0,
  wins INTEGER DEFAULT 0, draws INTEGER DEFAULT 0, losses INTEGER DEFAULT 0,
  goals_scored INTEGER DEFAULT 0, goals_conceded INTEGER DEFAULT 0,
  yellow_cards INTEGER DEFAULT 0, red_cards INTEGER DEFAULT 0,
  fouls_committed INTEGER DEFAULT 0,
  win_pct DECIMAL(5,4),
  referee_advantage DECIMAL(5,4),
  last_match_date DATE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(team_id, referee_name)
);
DO $$ BEGIN CREATE INDEX IF NOT EXISTS idx_team_referee_team ON team_referee_stats(team_id); EXCEPTION WHEN duplicate_table THEN NULL; END $$;
DO $$ BEGIN CREATE INDEX IF NOT EXISTS idx_team_referee_name ON team_referee_stats(referee_name); EXCEPTION WHEN duplicate_table THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS referee_match_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referee_name TEXT NOT NULL,
  fixture_id UUID REFERENCES fixtures(id),
  match_date DATE,
  home_goals INTEGER, away_goals INTEGER, ft_result TEXT,
  home_yellow INTEGER DEFAULT 0, away_yellow INTEGER DEFAULT 0,
  home_red INTEGER DEFAULT 0, away_red INTEGER DEFAULT 0,
  total_cards INTEGER DEFAULT 0,
  home_fouls INTEGER, away_fouls INTEGER,
  home_shots INTEGER, away_shots INTEGER,
  home_corners INTEGER, away_corners INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
DO $$ BEGIN CREATE INDEX IF NOT EXISTS idx_referee_history_name ON referee_match_history(referee_name); EXCEPTION WHEN duplicate_table THEN NULL; END $$;
DO $$ BEGIN CREATE INDEX IF NOT EXISTS idx_referee_history_date ON referee_match_history(match_date); EXCEPTION WHEN duplicate_table THEN NULL; END $$;
DO $$ BEGIN CREATE INDEX IF NOT EXISTS idx_referee_history_fixture ON referee_match_history(fixture_id); EXCEPTION WHEN duplicate_table THEN NULL; END $$;

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


-- ============================================
-- FIX 3: ENABLE RLS ON ALL EXISTING TABLES
--
-- Each table is wrapped in a DO block so missing tables
-- are silently skipped instead of causing errors.
-- ============================================

-- Helper: enable RLS + policies for a table (skips if table missing)
CREATE OR REPLACE FUNCTION _enable_rls_for_table(
  tbl text,
  select_policy text,
  select_using text,
  manage_policy text DEFAULT NULL,
  manage_using text DEFAULT NULL,
  force_rls boolean DEFAULT false
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  -- Check table exists
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = tbl) THEN
    RAISE NOTICE '  Skipped % (table does not exist)', tbl;
    RETURN;
  END IF;

  -- Enable RLS
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
  IF force_rls THEN
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tbl);
  END IF;

  -- Drop old policies that might conflict
  EXECUTE format('DROP POLICY IF EXISTS %s ON %I', quote_literal(select_policy), tbl);
  IF manage_policy IS NOT NULL THEN
    EXECUTE format('DROP POLICY IF EXISTS %s ON %I', quote_literal(manage_policy), tbl);
  END IF;

  -- Create select policy
  EXECUTE format('CREATE POLICY %s ON %I FOR SELECT USING (%s)', quote_literal(select_policy), tbl, select_using);

  -- Create manage policy
  IF manage_policy IS NOT NULL AND manage_using IS NOT NULL THEN
    EXECUTE format('CREATE POLICY %s ON %I FOR ALL USING (%s)', quote_literal(manage_policy), tbl, manage_using);
  END IF;

  RAISE NOTICE '  Enabled RLS on %', tbl;
END;
$$;

-- Now apply RLS to every table that exists

-- PUBLIC_READ tables: anyone can read, service role manages
SELECT _enable_rls_for_table('leagues',             'Anyone can view leagues',          'true', 'Service role manages leagues',         'public.is_service_role()');
SELECT _enable_rls_for_table('teams',               'Anyone can view teams',            'true', 'Service role manages teams',           'public.is_service_role()');
SELECT _enable_rls_for_table('team_aliases',        'Anyone can view team aliases',     'true', 'Service role manages team aliases',    'public.is_service_role()');
SELECT _enable_rls_for_table('fixtures',            'Anyone can view fixtures',         'true', 'Service role manages fixtures',        'public.is_service_role()');
SELECT _enable_rls_for_table('odds_snapshots',      'Anyone can view odds',             'true', 'Service role manages odds',            'public.is_service_role()');
SELECT _enable_rls_for_table('predictions',         'Anyone can view predictions',      'true', 'Service role manages predictions',     'public.is_service_role()', true);
SELECT _enable_rls_for_table('recommendations',     'Anyone can view recommendations',  'true', 'Service role manages recommendations', 'public.is_service_role()');
SELECT _enable_rls_for_table('model_performance',   'Anyone can view model performance','true', 'Service role manages model performance','public.is_service_role()');
SELECT _enable_rls_for_table('model_performance_history','Anyone can view mph',          'true', 'Service role manages mph',             'public.is_service_role()');
SELECT _enable_rls_for_table('model_predictions',   'Anyone can view model predictions','true', 'Service role manages model predictions','public.is_service_role()');
SELECT _enable_rls_for_table('historical_matches',  'Anyone can view historical matches','true','Service role manages historical matches','public.is_service_role()');
SELECT _enable_rls_for_table('ai_cache',            'Anyone can view ai cache',         'true', 'Service role manages ai cache',        'public.is_service_role()');
SELECT _enable_rls_for_table('announcements',       'Anyone can view announcements',    'is_active = true', 'Service role manages announcements','public.is_service_role()');
SELECT _enable_rls_for_table('players',             'Authenticated can view players',   'auth.role() = ''authenticated''', 'Service role manages players', 'public.is_service_role()');

-- USER_SCOPED tables: users see own data, service role manages all
SELECT _enable_rls_for_table('profiles',            'Users see own profile',            'auth.uid() = id', 'Service role manages profiles', 'public.is_service_role()', true);
SELECT _enable_rls_for_table('user_bets',           'Users manage own bets',            'auth.uid() = user_id', 'Service role manages bets', 'public.is_service_role()', true);
SELECT _enable_rls_for_table('accumulators',        'Users manage own accumulators',    'auth.uid() = user_id', 'Service role manages accumulators', 'public.is_service_role()', true);
SELECT _enable_rls_for_table('rollover_chains',     'Users manage own chains',          'auth.uid() = user_id', 'Service role manages chains', 'public.is_service_role()');
SELECT _enable_rls_for_table('notifications',       'Users see own notifications',      'auth.uid() = user_id', 'Service role manages notifications', 'public.is_service_role()');

-- rollover_picks: users see via chain ownership
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'rollover_picks') THEN
    ALTER TABLE rollover_picks ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS 'Users manage own picks' ON rollover_picks;
    DROP POLICY IF EXISTS 'Service role manages picks' ON rollover_picks;
    CREATE POLICY 'Users manage own picks' ON rollover_picks
      FOR ALL USING (chain_id IN (SELECT id FROM rollover_chains WHERE user_id = auth.uid()));
    CREATE POLICY 'Service role manages picks' ON rollover_picks
      FOR ALL USING (public.is_service_role());
    RAISE NOTICE '  Enabled RLS on rollover_picks';
  END IF;
END $$;

-- ADMIN_ONLY / SERVICE_INTERNAL tables: service role only
SELECT _enable_rls_for_table('admin_activity_log',  'Service role manages activity log','public.is_service_role()', NULL, NULL, true);
SELECT _enable_rls_for_table('scoring_config',      'Authenticated can view scoring config','auth.role() = ''authenticated''', 'Service role manages scoring config','public.is_service_role()');
SELECT _enable_rls_for_table('match_features',      'Service role manages match features','public.is_service_role()', NULL, NULL, true);
SELECT _enable_rls_for_table('training_log',        'Service role manages training log','public.is_service_role()', NULL, NULL, false);
SELECT _enable_rls_for_table('model_learning_history','Service role manages learning history','public.is_service_role()', NULL, NULL, false);
SELECT _enable_rls_for_table('crown_jewel_history', 'Service role manages crown jewel', 'public.is_service_role()', NULL, NULL, false);
SELECT _enable_rls_for_table('model_versions',      'Service role manages model versions','public.is_service_role()', NULL, NULL, false);
SELECT _enable_rls_for_table('feature_importance',  'Service role manages feature importance','public.is_service_role()', NULL, NULL, false);
SELECT _enable_rls_for_table('elo_ratings',         'Service role manages elo ratings', 'public.is_service_role()', NULL, NULL, true);
SELECT _enable_rls_for_table('prediction_history',  'Service role manages prediction history','public.is_service_role()', NULL, NULL, true);
SELECT _enable_rls_for_table('referee_profiles',    'Authenticated can view referee profiles','auth.role() = ''authenticated''', 'Service role manages referee profiles','public.is_service_role()', true);
SELECT _enable_rls_for_table('referee_match_history','Authenticated can view referee history','auth.role() = ''authenticated''', 'Service role manages referee history','public.is_service_role()', true);
SELECT _enable_rls_for_table('team_referee_stats',  'Authenticated can view team referee stats','auth.role() = ''authenticated''', 'Service role manages team referee stats','public.is_service_role()', true);
SELECT _enable_rls_for_table('match_stats',         'Authenticated can view match stats','auth.role() = ''authenticated''', 'Service role manages match stats','public.is_service_role()', true);

-- Tables that may or may not exist in your DB
SELECT _enable_rls_for_table('player_appearances',     'Service role manages player appearances', 'public.is_service_role()');
SELECT _enable_rls_for_table('player_impact',          'Service role manages player impact',      'public.is_service_role()');
SELECT _enable_rls_for_table('player_availability',    'Service role manages player availability','public.is_service_role()');
SELECT _enable_rls_for_table('player_impact_scores',   'Service role manages player impact scores','public.is_service_role()');
SELECT _enable_rls_for_table('player_injury_data',     'Service role manages player injury data', 'public.is_service_role()');
SELECT _enable_rls_for_table('referee_feature_profiles','Service role manages referee feature profiles','public.is_service_role()');
SELECT _enable_rls_for_table('team_feature_profiles',  'Service role manages team feature profiles','public.is_service_role()');
SELECT _enable_rls_for_table('team_match_stats',       'Service role manages team match stats',   'public.is_service_role()');
SELECT _enable_rls_for_table('team_strengths',         'Service role manages team strengths',     'public.is_service_role()');
SELECT _enable_rls_for_table('xg_features',            'Service role manages xg features',        'public.is_service_role()');
SELECT _enable_rls_for_table('odds_feature_cache',     'Service role manages odds feature cache', 'public.is_service_role()');
SELECT _enable_rls_for_table('league_model_params',    'Service role manages league model params', 'public.is_service_role()');
SELECT _enable_rls_for_table('model_weight_config',    'Service role manages model weight config', 'public.is_service_role()');
SELECT _enable_rls_for_table('agent_audit_log',        'Service role manages agent audit log',     'public.is_service_role()');

-- Cleanup helper function
DROP FUNCTION IF EXISTS _enable_rls_for_table(text,text,text,text,text,boolean);


-- ============================================
-- FIX 4: REVOKE BROAD GRANTS, RE-GRANT MINIMUM
-- ============================================

-- Revoke everything first
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated;

-- Grant SELECT on public-read tables to anon
GRANT SELECT ON leagues TO anon;
GRANT SELECT ON teams TO anon;
GRANT SELECT ON team_aliases TO anon;
GRANT SELECT ON fixtures TO anon;
GRANT SELECT ON odds_snapshots TO anon;
GRANT SELECT ON predictions TO anon;
GRANT SELECT ON recommendations TO anon;
GRANT SELECT ON model_performance TO anon;
GRANT SELECT ON model_performance_history TO anon;
GRANT SELECT ON model_predictions TO anon;
GRANT SELECT ON historical_matches TO anon;
GRANT SELECT ON ai_cache TO anon;
GRANT SELECT ON announcements TO anon;

-- Grant to authenticated
GRANT SELECT ON leagues TO authenticated;
GRANT SELECT ON teams TO authenticated;
GRANT SELECT ON team_aliases TO authenticated;
GRANT SELECT ON fixtures TO authenticated;
GRANT SELECT ON odds_snapshots TO authenticated;
GRANT SELECT ON predictions TO authenticated;
GRANT SELECT ON recommendations TO authenticated;
GRANT SELECT ON model_performance TO authenticated;
GRANT SELECT ON model_performance_history TO authenticated;
GRANT SELECT ON model_predictions TO authenticated;
GRANT SELECT ON historical_matches TO authenticated;
GRANT SELECT ON scoring_config TO authenticated;
GRANT SELECT ON announcements TO authenticated;
GRANT SELECT ON players TO authenticated;
GRANT SELECT ON referee_profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE ON user_bets TO authenticated;
GRANT SELECT, INSERT, UPDATE ON accumulators TO authenticated;
GRANT SELECT, UPDATE ON notifications TO authenticated;
GRANT SELECT, INSERT, UPDATE ON rollover_chains TO authenticated;
GRANT SELECT, INSERT, UPDATE ON rollover_picks TO authenticated;
GRANT SELECT ON profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE ON match_stats TO authenticated;
GRANT SELECT, INSERT, UPDATE ON team_referee_stats TO authenticated;
GRANT SELECT, INSERT ON referee_match_history TO authenticated;


-- ============================================
-- DONE
-- ============================================

DO $$ BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '=== ODDLY CRITICAL FIXES APPLIED ===';
  RAISE NOTICE '  1. Created: referee_profiles, match_stats, team_referee_stats, referee_match_history';
  RAISE NOTICE '  2. Enabled RLS on all existing tables (missing tables silently skipped)';
  RAISE NOTICE '  3. Revoked broad grants, re-granted minimum permissions';
  RAISE NOTICE '  4. Created is_admin(), is_service_role(), check_rls_status()';
  RAISE NOTICE '';
  RAISE NOTICE 'Verify: SELECT * FROM check_rls_status();';
END $$;
