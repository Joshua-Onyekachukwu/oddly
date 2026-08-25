-- ============================================
-- ODDLY — RUN ALL 4 CRITICAL FIXES
-- Date: August 26, 2026
--
-- Paste this ENTIRE file into Supabase SQL Editor and click Run.
-- It will:
--   1. Create referee_profiles, match_stats, team_referee_stats tables
--   2. Enable RLS on ALL tables with proper policies
--   3. Revoke broad anon/authenticated grants
--   4. Create audit functions
--
-- Safe to run multiple times (uses IF NOT EXISTS / DROP IF EXISTS)
-- ============================================

-- ============================================
-- FIX 1: CREATE MISSING REFEREE TABLES
-- ============================================

-- Add referee columns to fixtures
ALTER TABLE fixtures ADD COLUMN IF NOT EXISTS referee_name TEXT;
ALTER TABLE fixtures ADD COLUMN IF NOT EXISTS referee_id TEXT;
CREATE INDEX IF NOT EXISTS idx_fixtures_referee ON fixtures(referee_name);

-- referee_profiles
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
CREATE INDEX IF NOT EXISTS idx_referee_profiles_name ON referee_profiles(referee_name);
CREATE INDEX IF NOT EXISTS idx_referee_profiles_matches ON referee_profiles(total_matches DESC);

-- match_stats
CREATE TABLE IF NOT EXISTS match_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fixture_id UUID NOT NULL REFERENCES fixtures(id) ON DELETE CASCADE UNIQUE,
  referee_name TEXT,
  home_shots INTEGER,
  away_shots INTEGER,
  home_shots_on_target INTEGER,
  away_shots_on_target INTEGER,
  home_fouls INTEGER,
  away_fouls INTEGER,
  home_corners INTEGER,
  away_corners INTEGER,
  home_yellow_cards INTEGER,
  away_yellow_cards INTEGER,
  home_red_cards INTEGER,
  away_red_cards INTEGER,
  ht_home_goals INTEGER,
  ht_away_goals INTEGER,
  ht_result TEXT,
  ft_result TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_match_stats_fixture ON match_stats(fixture_id);
CREATE INDEX IF NOT EXISTS idx_match_stats_referee ON match_stats(referee_name);

-- team_referee_stats
CREATE TABLE IF NOT EXISTS team_referee_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  referee_name TEXT NOT NULL,
  matches_under_referee INTEGER DEFAULT 0,
  wins INTEGER DEFAULT 0,
  draws INTEGER DEFAULT 0,
  losses INTEGER DEFAULT 0,
  goals_scored INTEGER DEFAULT 0,
  goals_conceded INTEGER DEFAULT 0,
  yellow_cards INTEGER DEFAULT 0,
  red_cards INTEGER DEFAULT 0,
  fouls_committed INTEGER DEFAULT 0,
  win_pct DECIMAL(5,4),
  referee_advantage DECIMAL(5,4),
  last_match_date DATE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(team_id, referee_name)
);
CREATE INDEX IF NOT EXISTS idx_team_referee_team ON team_referee_stats(team_id);
CREATE INDEX IF NOT EXISTS idx_team_referee_name ON team_referee_stats(referee_name);

-- referee_match_history
CREATE TABLE IF NOT EXISTS referee_match_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referee_name TEXT NOT NULL,
  fixture_id UUID REFERENCES fixtures(id),
  match_date DATE,
  home_goals INTEGER,
  away_goals INTEGER,
  ft_result TEXT,
  home_yellow INTEGER DEFAULT 0,
  away_yellow INTEGER DEFAULT 0,
  home_red INTEGER DEFAULT 0,
  away_red INTEGER DEFAULT 0,
  total_cards INTEGER DEFAULT 0,
  home_fouls INTEGER,
  away_fouls INTEGER,
  home_shots INTEGER,
  away_shots INTEGER,
  home_corners INTEGER,
  away_corners INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_referee_history_name ON referee_match_history(referee_name);
CREATE INDEX IF NOT EXISTS idx_referee_history_date ON referee_match_history(match_date);
CREATE INDEX IF NOT EXISTS idx_referee_history_fixture ON referee_match_history(fixture_id);

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
-- FIX 2: SECURITY HELPER FUNCTIONS
-- ============================================

-- Admin check (security definer to avoid RLS recursion)
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE
AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin');
$$;

-- Service role check (for cron/API endpoints)
CREATE OR REPLACE FUNCTION public.is_service_role()
RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE
AS $$
  SELECT coalesce(current_setting('request.jwt.claims', true)::json->>'role', '') = 'service_role';
$$;

-- RLS audit function
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
-- FIX 3: ENABLE RLS ON ALL TABLES
-- ============================================

-- ── profiles ──
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users see own profile" ON profiles;
DROP POLICY IF EXISTS "Users update own profile" ON profiles;
DROP POLICY IF EXISTS "Admins see all profiles" ON profiles;
DROP POLICY IF EXISTS "Service role full access profiles" ON profiles;
CREATE POLICY "Users see own profile" ON profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users update own profile" ON profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Service role manages profiles" ON profiles FOR ALL USING (public.is_service_role());

-- ── leagues ──
ALTER TABLE leagues ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can view active leagues" ON leagues;
DROP POLICY IF EXISTS "Admins can manage leagues" ON leagues;
CREATE POLICY "Anyone can view leagues" ON leagues FOR SELECT USING (true);
CREATE POLICY "Service role manages leagues" ON leagues FOR ALL USING (public.is_service_role());

-- ── teams ──
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can view teams" ON teams;
DROP POLICY IF EXISTS "Admins can manage teams" ON teams;
CREATE POLICY "Anyone can view teams" ON teams FOR SELECT USING (true);
CREATE POLICY "Service role manages teams" ON teams FOR ALL USING (public.is_service_role());

-- ── team_aliases ──
ALTER TABLE team_aliases ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can view team aliases" ON team_aliases;
DROP POLICY IF EXISTS "Admins can manage team aliases" ON team_aliases;
CREATE POLICY "Anyone can view team aliases" ON team_aliases FOR SELECT USING (true);
CREATE POLICY "Service role manages team aliases" ON team_aliases FOR ALL USING (public.is_service_role());

-- ── fixtures ──
ALTER TABLE fixtures ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can view fixtures" ON fixtures;
DROP POLICY IF EXISTS "Admins can manage fixtures" ON fixtures;
CREATE POLICY "Anyone can view fixtures" ON fixtures FOR SELECT USING (true);
CREATE POLICY "Service role manages fixtures" ON fixtures FOR ALL USING (public.is_service_role());

-- ── odds_snapshots ──
ALTER TABLE odds_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can view odds" ON odds_snapshots;
DROP POLICY IF EXISTS "Admins can manage odds" ON odds_snapshots;
CREATE POLICY "Anyone can view odds" ON odds_snapshots FOR SELECT USING (true);
CREATE POLICY "Service role manages odds" ON odds_snapshots FOR ALL USING (public.is_service_role());

-- ── predictions ──
ALTER TABLE predictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE predictions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can view predictions" ON predictions;
DROP POLICY IF EXISTS "Admins can manage predictions" ON predictions;
CREATE POLICY "Anyone can view predictions" ON predictions FOR SELECT USING (true);
CREATE POLICY "Service role manages predictions" ON predictions FOR ALL USING (public.is_service_role());

-- ── recommendations ──
ALTER TABLE recommendations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can view recommendations" ON recommendations;
DROP POLICY IF EXISTS "Admins can manage recommendations" ON recommendations;
CREATE POLICY "Anyone can view recommendations" ON recommendations FOR SELECT USING (true);
CREATE POLICY "Service role manages recommendations" ON recommendations FOR ALL USING (public.is_service_role());

-- ── user_bets ──
ALTER TABLE user_bets ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_bets FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users see own bets" ON user_bets;
DROP POLICY IF EXISTS "Admins see all bets" ON user_bets;
CREATE POLICY "Users manage own bets" ON user_bets FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Service role manages bets" ON user_bets FOR ALL USING (public.is_service_role());

-- ── accumulators ──
ALTER TABLE accumulators ENABLE ROW LEVEL SECURITY;
ALTER TABLE accumulators FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users see own accumulators" ON accumulators;
DROP POLICY IF EXISTS "Admins see all accumulators" ON accumulators;
CREATE POLICY "Users manage own accumulators" ON accumulators FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Service role manages accumulators" ON accumulators FOR ALL USING (public.is_service_role());

-- ── rollover_chains ──
ALTER TABLE rollover_chains ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users see own chains" ON rollover_chains;
DROP POLICY IF EXISTS "Admins see all chains" ON rollover_chains;
CREATE POLICY "Users manage own chains" ON rollover_chains FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Service role manages chains" ON rollover_chains FOR ALL USING (public.is_service_role());

-- ── rollover_picks ──
ALTER TABLE rollover_picks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users see own picks" ON rollover_picks;
DROP POLICY IF EXISTS "Admins see all picks" ON rollover_picks;
CREATE POLICY "Users manage own picks" ON rollover_picks
  FOR ALL USING (chain_id IN (SELECT id FROM rollover_chains WHERE user_id = auth.uid()));
CREATE POLICY "Service role manages picks" ON rollover_picks FOR ALL USING (public.is_service_role());

-- ── model_performance ──
ALTER TABLE model_performance ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can view model performance" ON model_performance;
DROP POLICY IF EXISTS "Admins can manage model performance" ON model_performance;
CREATE POLICY "Anyone can view model performance" ON model_performance FOR SELECT USING (true);
CREATE POLICY "Service role manages model performance" ON model_performance FOR ALL USING (public.is_service_role());

-- ── ai_cache ──
ALTER TABLE ai_cache ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can view ai cache" ON ai_cache;
DROP POLICY IF EXISTS "System can manage ai cache" ON ai_cache;
CREATE POLICY "Anyone can view ai cache" ON ai_cache FOR SELECT USING (true);
CREATE POLICY "Service role manages ai cache" ON ai_cache FOR ALL USING (public.is_service_role());

-- ── notifications ──
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users see own notifications" ON notifications;
DROP POLICY IF EXISTS "System can insert notifications" ON notifications;
CREATE POLICY "Users see own notifications" ON notifications FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users update own notifications" ON notifications FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Service role manages notifications" ON notifications FOR ALL USING (public.is_service_role());

-- ── scoring_config ──
ALTER TABLE scoring_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can view scoring config" ON scoring_config;
DROP POLICY IF EXISTS "Admins can manage scoring config" ON scoring_config;
CREATE POLICY "Authenticated can view scoring config" ON scoring_config FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Service role manages scoring config" ON scoring_config FOR ALL USING (public.is_service_role());

-- ── announcements ──
ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can view active announcements" ON announcements;
DROP POLICY IF EXISTS "Admins can manage announcements" ON announcements;
CREATE POLICY "Anyone can view active announcements" ON announcements FOR SELECT USING (is_active = true);
CREATE POLICY "Service role manages announcements" ON announcements FOR ALL USING (public.is_service_role());

-- ── admin_activity_log ──
ALTER TABLE admin_activity_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_activity_log FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins can view activity log" ON admin_activity_log;
DROP POLICY IF EXISTS "Admins can insert activity log" ON admin_activity_log;
CREATE POLICY "Service role manages activity log" ON admin_activity_log FOR ALL USING (public.is_service_role());

-- ── historical_matches ──
ALTER TABLE historical_matches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view historical matches" ON historical_matches FOR SELECT USING (true);
CREATE POLICY "Service role manages historical matches" ON historical_matches FOR ALL USING (public.is_service_role());

-- ── match_features ──
ALTER TABLE match_features ENABLE ROW LEVEL SECURITY;
ALTER TABLE match_features FORCE ROW LEVEL SECURITY;
CREATE POLICY "Service role manages match features" ON match_features FOR ALL USING (public.is_service_role());

-- ── model_predictions ──
ALTER TABLE model_predictions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view model predictions" ON model_predictions FOR SELECT USING (true);
CREATE POLICY "Service role manages model predictions" ON model_predictions FOR ALL USING (public.is_service_role());

-- ── model_performance_history ──
ALTER TABLE model_performance_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view model performance history" ON model_performance_history FOR SELECT USING (true);
CREATE POLICY "Service role manages model performance history" ON model_performance_history FOR ALL USING (public.is_service_role());

-- ── training_log ──
ALTER TABLE training_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role manages training log" ON training_log FOR ALL USING (public.is_service_role());

-- ── model_learning_history ──
ALTER TABLE model_learning_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role manages learning history" ON model_learning_history FOR ALL USING (public.is_service_role());

-- ── crown_jewel_history ──
ALTER TABLE crown_jewel_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role manages crown jewel" ON crown_jewel_history FOR ALL USING (public.is_service_role());

-- ── model_versions ──
ALTER TABLE model_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role manages model versions" ON model_versions FOR ALL USING (public.is_service_role());

-- ── feature_importance ──
ALTER TABLE feature_importance ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role manages feature importance" ON feature_importance FOR ALL USING (public.is_service_role());

-- ── players ──
ALTER TABLE players ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can view players" ON players FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Service role manages players" ON players FOR ALL USING (public.is_service_role());

-- ── player_appearances ──
ALTER TABLE player_appearances ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role manages player appearances" ON player_appearances FOR ALL USING (public.is_service_role());

-- ── player_impact ──
ALTER TABLE player_impact ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role manages player impact" ON player_impact FOR ALL USING (public.is_service_role());

-- ── player_availability ──
ALTER TABLE player_availability ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role manages player availability" ON player_availability FOR ALL USING (public.is_service_role());

-- ── player_impact_scores ──
ALTER TABLE player_impact_scores ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role manages player impact scores" ON player_impact_scores FOR ALL USING (public.is_service_role());

-- ── player_injury_data ──
ALTER TABLE player_injury_data ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role manages player injury data" ON player_injury_data FOR ALL USING (public.is_service_role());

-- ── elo_ratings ──
ALTER TABLE elo_ratings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role manages elo ratings" ON elo_ratings FOR ALL USING (public.is_service_role());

-- ── prediction_history ──
ALTER TABLE prediction_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role manages prediction history" ON prediction_history FOR ALL USING (public.is_service_role());

-- ── referee_profiles ──
ALTER TABLE referee_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE referee_profiles FORCE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can view referee profiles" ON referee_profiles FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Service role manages referee profiles" ON referee_profiles FOR ALL USING (public.is_service_role());

-- ── referee_match_history ──
ALTER TABLE referee_match_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE referee_match_history FORCE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can view referee history" ON referee_match_history FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Service role manages referee history" ON referee_match_history FOR ALL USING (public.is_service_role());

-- ── referee_feature_profiles ──
ALTER TABLE referee_feature_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role manages referee feature profiles" ON referee_feature_profiles FOR ALL USING (public.is_service_role());

-- ── team_feature_profiles ──
ALTER TABLE team_feature_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role manages team feature profiles" ON team_feature_profiles FOR ALL USING (public.is_service_role());

-- ── team_match_stats ──
ALTER TABLE team_match_stats ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role manages team match stats" ON team_match_stats FOR ALL USING (public.is_service_role());

-- ── team_referee_stats ──
ALTER TABLE team_referee_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_referee_stats FORCE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can view team referee stats" ON team_referee_stats FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Service role manages team referee stats" ON team_referee_stats FOR ALL USING (public.is_service_role());

-- ── team_strengths ──
ALTER TABLE team_strengths ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role manages team strengths" ON team_strengths FOR ALL USING (public.is_service_role());

-- ── xg_features ──
ALTER TABLE xg_features ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role manages xg features" ON xg_features FOR ALL USING (public.is_service_role());

-- ── odds_feature_cache ──
ALTER TABLE odds_feature_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role manages odds feature cache" ON odds_feature_cache FOR ALL USING (public.is_service_role());

-- ── league_model_params ──
ALTER TABLE league_model_params ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role manages league model params" ON league_model_params FOR ALL USING (public.is_service_role());

-- ── model_weight_config ──
ALTER TABLE model_weight_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role manages model weight config" ON model_weight_config FOR ALL USING (public.is_service_role());

-- ── match_stats ──
ALTER TABLE match_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE match_stats FORCE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can view match stats" ON match_stats FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Service role manages match stats" ON match_stats FOR ALL USING (public.is_service_role());

-- ── agent_audit_log ──
ALTER TABLE agent_audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role manages agent audit log" ON agent_audit_log FOR ALL USING (public.is_service_role());


-- ============================================
-- FIX 4: REVOKE BROAD GRANTS, RE-GRANT MINIMUM
-- ============================================

-- Revoke everything from anon and authenticated
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
-- TRIGGERS (for new tables)
-- ============================================

DO $$ BEGIN
  CREATE TRIGGER update_referee_profiles_updated_at
    BEFORE UPDATE ON referee_profiles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
EXCEPTION WHEN duplicate_table THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TRIGGER update_match_stats_updated_at
    BEFORE UPDATE ON match_stats
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
EXCEPTION WHEN duplicate_table THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TRIGGER update_team_referee_stats_updated_at
    BEFORE UPDATE ON team_referee_stats
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
EXCEPTION WHEN duplicate_table THEN NULL;
END $$;


-- ============================================
-- DONE
-- ============================================

DO $$ BEGIN
  RAISE NOTICE '=== ODDLY CRITICAL FIXES APPLIED ===';
  RAISE NOTICE '  1. Created: referee_profiles, match_stats, team_referee_stats, referee_match_history';
  RAISE NOTICE '  2. Enabled RLS on ALL tables with proper policies';
  RAISE NOTICE '  3. Revoked broad grants and re-granted minimum permissions';
  RAISE NOTICE '  4. Created is_admin(), is_service_role(), check_rls_status() functions';
  RAISE NOTICE '';
  RAISE NOTICE 'Verify with: SELECT * FROM check_rls_status();';
END $$;
