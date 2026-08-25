-- ============================================
-- COMPREHENSIVE RLS ENFORCEMENT
-- Date: August 26, 2026
--
-- This migration:
--   1. Enables RLS on EVERY table (if not already)
--   2. Drops ALL overly permissive policies (FOR ALL USING (true))
--   3. Creates proper policies per table category
--
-- CATEGORIES:
--   PUBLIC_READ: Anyone can read (anon + authenticated). Admin/service can write.
--   USER_SCOPED: Users see only their own data. Admins see all.
--   ADMIN_ONLY: Only admins can read/write.
--   SYSTEM_INTERNAL: Only service_role can read/write (no anon access).
--   SERVICE_WRITE: Anon can read, only service_role can write.
-- ============================================

-- ============================================
-- SECURITY HELPER FUNCTION
-- ============================================

-- Re-create is_admin() as security definer to avoid RLS recursion
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  );
$$;

-- Check if caller is service_role (for cron/API endpoints)
CREATE OR REPLACE FUNCTION public.is_service_role()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT coalesce(current_setting('request.jwt.claims', true)::json->>'role', '') = 'service_role';
$$;

-- ============================================
-- 1. PROFILES (USER_SCOPED)
-- ============================================
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users see own profile" ON profiles;
DROP POLICY IF EXISTS "Users update own profile" ON profiles;
DROP POLICY IF EXISTS "Admins see all profiles" ON profiles;
DROP POLICY IF EXISTS "Service role full access profiles" ON profiles;

CREATE POLICY "Users see own profile" ON profiles
  FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users update own profile" ON profiles
  FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Service role manages profiles" ON profiles
  FOR ALL USING (public.is_service_role());

-- ============================================
-- 2. LEAGUES (PUBLIC_READ)
-- ============================================
ALTER TABLE leagues ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can view active leagues" ON leagues;
DROP POLICY IF EXISTS "Admins can manage leagues" ON leagues;
DROP POLICY IF EXISTS "Admins can manage leagues" ON leagues;
DROP POLICY IF EXISTS "svc_elo" ON leagues;

CREATE POLICY "Anyone can view leagues" ON leagues
  FOR SELECT USING (true);
CREATE POLICY "Service role manages leagues" ON leagues
  FOR ALL USING (public.is_service_role());

-- ============================================
-- 3. TEAMS (PUBLIC_READ)
-- ============================================
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can view teams" ON teams;
DROP POLICY IF EXISTS "Admins can manage teams" ON teams;

CREATE POLICY "Anyone can view teams" ON teams
  FOR SELECT USING (true);
CREATE POLICY "Service role manages teams" ON teams
  FOR ALL USING (public.is_service_role());

-- ============================================
-- 4. TEAM_ALIASES (PUBLIC_READ)
-- ============================================
ALTER TABLE team_aliases ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can view team aliases" ON team_aliases;
DROP POLICY IF EXISTS "Admins can manage team aliases" ON team_aliases;

CREATE POLICY "Anyone can view team aliases" ON team_aliases
  FOR SELECT USING (true);
CREATE POLICY "Service role manages team aliases" ON team_aliases
  FOR ALL USING (public.is_service_role());

-- ============================================
-- 5. FIXTURES (PUBLIC_READ)
-- ============================================
ALTER TABLE fixtures ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can view fixtures" ON fixtures;
DROP POLICY IF EXISTS "Admins can manage fixtures" ON fixtures;

CREATE POLICY "Anyone can view fixtures" ON fixtures
  FOR SELECT USING (true);
CREATE POLICY "Service role manages fixtures" ON fixtures
  FOR ALL USING (public.is_service_role());

-- ============================================
-- 6. ODDS_SNAPSHOTS (PUBLIC_READ, SERVICE_WRITE)
-- ============================================
ALTER TABLE odds_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can view odds" ON odds_snapshots;
DROP POLICY IF EXISTS "Admins can manage odds" ON odds_snapshots;
DROP POLICY IF EXISTS "svc_odds" ON odds_snapshots;
DROP POLICY IF EXISTS "anon_odds" ON odds_snapshots;

CREATE POLICY "Anyone can view odds" ON odds_snapshots
  FOR SELECT USING (true);
CREATE POLICY "Service role manages odds" ON odds_snapshots
  FOR ALL USING (public.is_service_role());

-- ============================================
-- 7. PREDICTIONS (PUBLIC_READ, SERVICE_WRITE)
-- ============================================
ALTER TABLE predictions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can view predictions" ON predictions;
DROP POLICY IF EXISTS "Admins can manage predictions" ON predictions;
DROP POLICY IF EXISTS "svc_pred" ON predictions;
DROP POLICY IF EXISTS "anon_pred" ON predictions;

CREATE POLICY "Anyone can view predictions" ON predictions
  FOR SELECT USING (true);
CREATE POLICY "Service role manages predictions" ON predictions
  FOR ALL USING (public.is_service_role());

-- ============================================
-- 8. RECOMMENDATIONS (PUBLIC_READ, SERVICE_WRITE)
-- ============================================
ALTER TABLE recommendations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can view recommendations" ON recommendations;
DROP POLICY IF EXISTS "Admins can manage recommendations" ON recommendations;

CREATE POLICY "Anyone can view recommendations" ON recommendations
  FOR SELECT USING (true);
CREATE POLICY "Service role manages recommendations" ON recommendations
  FOR ALL USING (public.is_service_role());

-- ============================================
-- 9. USER_BETS (USER_SCOPED)
-- ============================================
ALTER TABLE user_bets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users see own bets" ON user_bets;
DROP POLICY IF EXISTS "Admins see all bets" ON user_bets;
DROP POLICY IF EXISTS "Service role full access bets" ON user_bets;

CREATE POLICY "Users manage own bets" ON user_bets
  FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Service role manages bets" ON user_bets
  FOR ALL USING (public.is_service_role());

-- ============================================
-- 10. ACCUMULATORS (USER_SCOPED)
-- ============================================
ALTER TABLE accumulators ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users see own accumulators" ON accumulators;
DROP POLICY IF EXISTS "Admins see all accumulators" ON accumulators;
DROP POLICY IF EXISTS "Service role full access accumulators" ON accumulators;

CREATE POLICY "Users manage own accumulators" ON accumulators
  FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Service role manages accumulators" ON accumulators
  FOR ALL USING (public.is_service_role());

-- ============================================
-- 11. ROLLOVER_CHAINS (USER_SCOPED)
-- ============================================
ALTER TABLE rollover_chains ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users see own chains" ON rollover_chains;
DROP POLICY IF EXISTS "Admins see all chains" ON rollover_chains;

CREATE POLICY "Users manage own chains" ON rollover_chains
  FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Service role manages chains" ON rollover_chains
  FOR ALL USING (public.is_service_role());

-- ============================================
-- 12. ROLLOVER_PICKS (USER_SCOPED via chain)
-- ============================================
ALTER TABLE rollover_picks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users see own picks" ON rollover_picks;
DROP POLICY IF EXISTS "Admins see all picks" ON rollover_picks;

CREATE POLICY "Users manage own picks" ON rollover_picks
  FOR ALL USING (
    chain_id IN (SELECT id FROM rollover_chains WHERE user_id = auth.uid())
  );
CREATE POLICY "Service role manages picks" ON rollover_picks
  FOR ALL USING (public.is_service_role());

-- ============================================
-- 13. MODEL_PERFORMANCE (PUBLIC_READ, SERVICE_WRITE)
-- ============================================
ALTER TABLE model_performance ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can view model performance" ON model_performance;
DROP POLICY IF EXISTS "Admins can manage model performance" ON model_performance;
DROP POLICY IF EXISTS "svc_mp" ON model_performance;
DROP POLICY IF EXISTS "anon_mp" ON model_performance;

CREATE POLICY "Anyone can view model performance" ON model_performance
  FOR SELECT USING (true);
CREATE POLICY "Service role manages model performance" ON model_performance
  FOR ALL USING (public.is_service_role());

-- ============================================
-- 14. AI_CACHE (SERVICE_WRITE, PUBLIC_READ)
-- ============================================
ALTER TABLE ai_cache ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can view ai cache" ON ai_cache;
DROP POLICY IF EXISTS "System can manage ai cache" ON ai_cache;
DROP POLICY IF EXISTS "svc_ai" ON ai_cache;
DROP POLICY IF EXISTS "anon_ai" ON ai_cache;

CREATE POLICY "Anyone can view ai cache" ON ai_cache
  FOR SELECT USING (true);
CREATE POLICY "Service role manages ai cache" ON ai_cache
  FOR ALL USING (public.is_service_role());

-- ============================================
-- 15. NOTIFICATIONS (USER_SCOPED)
-- ============================================
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users see own notifications" ON notifications;
DROP POLICY IF EXISTS "System can insert notifications" ON notifications;
DROP POLICY IF EXISTS "svc_notif" ON notifications;
DROP POLICY IF EXISTS "anon_notif" ON notifications;

CREATE POLICY "Users see own notifications" ON notifications
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users update own notifications" ON notifications
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Service role manages notifications" ON notifications
  FOR ALL USING (public.is_service_role());

-- ============================================
-- 16. SCORING_CONFIG (ADMIN_ONLY)
-- ============================================
ALTER TABLE scoring_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can view scoring config" ON scoring_config;
DROP POLICY IF EXISTS "Admins can manage scoring config" ON scoring_config;
DROP POLICY IF EXISTS "svc_sc" ON scoring_config;
DROP POLICY IF EXISTS "anon_sc" ON scoring_config;

CREATE POLICY "Authenticated can view scoring config" ON scoring_config
  FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Service role manages scoring config" ON scoring_config
  FOR ALL USING (public.is_service_role());

-- ============================================
-- 17. ANNOUNCEMENTS (PUBLIC_READ, ADMIN_WRITE)
-- ============================================
ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can view active announcements" ON announcements;
DROP POLICY IF EXISTS "Admins can manage announcements" ON announcements;

CREATE POLICY "Anyone can view active announcements" ON announcements
  FOR SELECT USING (is_active = true);
CREATE POLICY "Service role manages announcements" ON announcements
  FOR ALL USING (public.is_service_role());

-- ============================================
-- 18. ADMIN_ACTIVITY_LOG (ADMIN_ONLY)
-- ============================================
ALTER TABLE admin_activity_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins can view activity log" ON admin_activity_log;
DROP POLICY IF EXISTS "Admins can insert activity log" ON admin_activity_log;
DROP POLICY IF EXISTS "svc_aal" ON admin_activity_log;
DROP POLICY IF EXISTS "anon_aal" ON admin_activity_log;

CREATE POLICY "Service role manages activity log" ON admin_activity_log
  FOR ALL USING (public.is_service_role());

-- ============================================
-- 19. HISTORICAL_MATCHES (PUBLIC_READ, SERVICE_WRITE)
-- ============================================
ALTER TABLE historical_matches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "svc_hist" ON historical_matches;
DROP POLICY IF EXISTS "anon_hist" ON historical_matches;

CREATE POLICY "Anyone can view historical matches" ON historical_matches
  FOR SELECT USING (true);
CREATE POLICY "Service role manages historical matches" ON historical_matches
  FOR ALL USING (public.is_service_role());

-- ============================================
-- 20. MATCH_FEATURES (SERVICE_INTERNAL)
-- ============================================
ALTER TABLE match_features ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "svc_mf" ON match_features;
DROP POLICY IF EXISTS "anon_mf" ON match_features;
DROP POLICY IF EXISTS "Service role full access match_features" ON match_features;
DROP POLICY IF EXISTS "Anon read match_features" ON match_features;

CREATE POLICY "Service role manages match features" ON match_features
  FOR ALL USING (public.is_service_role());

-- ============================================
-- 21. MODEL_PREDICTIONS (PUBLIC_READ, SERVICE_WRITE)
-- ============================================
ALTER TABLE model_predictions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view model predictions" ON model_predictions
  FOR SELECT USING (true);
CREATE POLICY "Service role manages model predictions" ON model_predictions
  FOR ALL USING (public.is_service_role());

-- ============================================
-- 22. MODEL_PERFORMANCE_HISTORY (PUBLIC_READ, SERVICE_WRITE)
-- ============================================
ALTER TABLE model_performance_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view model performance history" ON model_performance_history
  FOR SELECT USING (true);
CREATE POLICY "Service role manages model performance history" ON model_performance_history
  FOR ALL USING (public.is_service_role());

-- ============================================
-- SYSTEM INTERNAL TABLES (SERVICE_ROLE ONLY)
-- No anon or authenticated access at all
-- ============================================

-- 23. TRAINING_LOG
ALTER TABLE training_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "svc_tl" ON training_log;
DROP POLICY IF EXISTS "anon_tl" ON training_log;

CREATE POLICY "Service role manages training log" ON training_log
  FOR ALL USING (public.is_service_role());

-- 24. MODEL_LEARNING_HISTORY
ALTER TABLE model_learning_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "svc_mlh" ON model_learning_history;
DROP POLICY IF EXISTS "anon_mlh" ON model_learning_history;

CREATE POLICY "Service role manages learning history" ON model_learning_history
  FOR ALL USING (public.is_service_role());

-- 25. CROWN_JEWEL_HISTORY
ALTER TABLE crown_jewel_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "svc_cj" ON crown_jewel_history;
DROP POLICY IF EXISTS "anon_cj" ON crown_jewel_history;

CREATE POLICY "Service role manages crown jewel" ON crown_jewel_history
  FOR ALL USING (public.is_service_role());

-- 26. MODEL_VERSIONS
ALTER TABLE model_versions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "svc_mv" ON model_versions;
DROP POLICY IF EXISTS "anon_mv" ON model_versions;

CREATE POLICY "Service role manages model versions" ON model_versions
  FOR ALL USING (public.is_service_role());

-- 27. FEATURE_IMPORTANCE
ALTER TABLE feature_importance ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "svc_fi" ON feature_importance;
DROP POLICY IF EXISTS "anon_fi" ON feature_importance;

CREATE POLICY "Service role manages feature importance" ON feature_importance
  FOR ALL USING (public.is_service_role());

-- 28. PLAYERS
ALTER TABLE players ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "svc_pl" ON players;
DROP POLICY IF EXISTS "anon_pl" ON players;

CREATE POLICY "Authenticated can view players" ON players
  FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Service role manages players" ON players
  FOR ALL USING (public.is_service_role());

-- 29. PLAYER_APPEARANCES
ALTER TABLE player_appearances ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "svc_pa" ON player_appearances;
DROP POLICY IF EXISTS "anon_pa" ON player_appearances;

CREATE POLICY "Service role manages player appearances" ON player_appearances
  FOR ALL USING (public.is_service_role());

-- 30. PLAYER_IMPACT
ALTER TABLE player_impact ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "svc_pi" ON player_impact;
DROP POLICY IF EXISTS "anon_pi" ON player_impact;

CREATE POLICY "Service role manages player impact" ON player_impact
  FOR ALL USING (public.is_service_role());

-- 31. PLAYER_AVAILABILITY
ALTER TABLE player_availability ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages player availability" ON player_availability
  FOR ALL USING (public.is_service_role());

-- 32. PLAYER_IMPACT_SCORES
ALTER TABLE player_impact_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages player impact scores" ON player_impact_scores
  FOR ALL USING (public.is_service_role());

-- 33. PLAYER_INJURY_DATA
ALTER TABLE player_injury_data ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages player injury data" ON player_injury_data
  FOR ALL USING (public.is_service_role());

-- 34. ELO_RATINGS
ALTER TABLE elo_ratings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role full access elo" ON elo_ratings;
DROP POLICY IF EXISTS "Anon read elo" ON elo_ratings;
DROP POLICY IF EXISTS "svc elo" ON elo_ratings;
DROP POLICY IF EXISTS "anon elo" ON elo_ratings;

CREATE POLICY "Service role manages elo ratings" ON elo_ratings
  FOR ALL USING (public.is_service_role());

-- 35. PREDICTION_HISTORY
ALTER TABLE prediction_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role full access predhist" ON prediction_history;
DROP POLICY IF EXISTS "Anon read predhist" ON prediction_history;
DROP POLICY IF EXISTS "svc predhist" ON prediction_history;
DROP POLICY IF EXISTS "anon predhist" ON prediction_history;

CREATE POLICY "Service role manages prediction history" ON prediction_history
  FOR ALL USING (public.is_service_role());

-- 36. REFEREE_PROFILES
ALTER TABLE referee_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "referee_profiles_read" ON referee_profiles;

CREATE POLICY "Authenticated can view referee profiles" ON referee_profiles
  FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Service role manages referee profiles" ON referee_profiles
  FOR ALL USING (public.is_service_role());

-- 37. REFEREE_MATCH_HISTORY
ALTER TABLE referee_match_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages referee match history" ON referee_match_history
  FOR ALL USING (public.is_service_role());

-- 38. REFEREE_FEATURE_PROFILES
ALTER TABLE referee_feature_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages referee feature profiles" ON referee_feature_profiles
  FOR ALL USING (public.is_service_role());

-- 39. TEAM_FEATURE_PROFILES
ALTER TABLE team_feature_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages team feature profiles" ON team_feature_profiles
  FOR ALL USING (public.is_service_role());

-- 40. TEAM_MATCH_STATS
ALTER TABLE team_match_stats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages team match stats" ON team_match_stats
  FOR ALL USING (public.is_service_role());

-- 41. TEAM_REFEREE_STATS
ALTER TABLE team_referee_stats ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "team_referee_stats_read" ON team_referee_stats;

CREATE POLICY "Service role manages team referee stats" ON team_referee_stats
  FOR ALL USING (public.is_service_role());

-- 42. TEAM_STRENGTHS
ALTER TABLE team_strengths ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages team strengths" ON team_strengths
  FOR ALL USING (public.is_service_role());

-- 43. XG_FEATURES
ALTER TABLE xg_features ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages xg features" ON xg_features
  FOR ALL USING (public.is_service_role());

-- 44. ODDS_FEATURE_CACHE
ALTER TABLE odds_feature_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages odds feature cache" ON odds_feature_cache
  FOR ALL USING (public.is_service_role());

-- 45. LEAGUE_MODEL_PARAMS
ALTER TABLE league_model_params ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages league model params" ON league_model_params
  FOR ALL USING (public.is_service_role());

-- 46. MODEL_WEIGHT_CONFIG
ALTER TABLE model_weight_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages model weight config" ON model_weight_config
  FOR ALL USING (public.is_service_role());

-- 47. MATCH_STATS
ALTER TABLE match_stats ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "match_stats_read" ON match_stats;

CREATE POLICY "Service role manages match stats" ON match_stats
  FOR ALL USING (public.is_service_role());

-- 48. AGENT_AUDIT_LOG
ALTER TABLE agent_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages agent audit log" ON agent_audit_log
  FOR ALL USING (public.is_service_role());

-- ============================================
-- VERIFY: Grant minimum to anon and authenticated
-- ============================================

-- Revoke broad permissions that Supabase grants by default
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated;

-- Grant only SELECT on public-read tables to anon
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

-- Grant SELECT + INSERT/UPDATE on user-scoped tables to authenticated
GRANT SELECT, INSERT, UPDATE ON user_bets TO authenticated;
GRANT SELECT, INSERT, UPDATE ON accumulators TO authenticated;
GRANT SELECT, UPDATE ON notifications TO authenticated;
GRANT SELECT, INSERT, UPDATE ON rollover_chains TO authenticated;
GRANT SELECT, INSERT, UPDATE ON rollover_picks TO authenticated;
GRANT SELECT ON profiles TO authenticated;

-- Grant SELECT on public-read tables to authenticated
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

-- ============================================
-- AUDIT: Create a function to verify RLS status
-- ============================================

CREATE OR REPLACE FUNCTION public.check_rls_status()
RETURNS TABLE (
  table_name text,
  rls_enabled boolean,
  policy_count bigint
)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT
    t.tablename::text,
    c.relrowsecurity,
    (SELECT count(*) FROM pg_policy WHERE polrelid = c.oid)
  FROM pg_tables t
  JOIN pg_class c ON c.relname = t.tablename
  WHERE t.schemaname = 'public'
  ORDER BY t.tablename;
$$;

-- ============================================
-- FINAL: Force RLS on public schema tables
-- ============================================

-- This ensures RLS is enforced even for table owners
ALTER TABLE profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE user_bets FORCE ROW LEVEL SECURITY;
ALTER TABLE accumulators FORCE ROW LEVEL SECURITY;
ALTER TABLE notifications FORCE ROW LEVEL SECURITY;
ALTER TABLE rollover_chains FORCE ROW LEVEL SECURITY;
ALTER TABLE rollover_picks FORCE ROW LEVEL SECURITY;
ALTER TABLE admin_activity_log FORCE ROW LEVEL SECURITY;
ALTER TABLE predictions FORCE ROW LEVEL SECURITY;
ALTER TABLE odds_snapshots FORCE ROW LEVEL SECURITY;
ALTER TABLE model_performance FORCE ROW LEVEL SECURITY;
ALTER TABLE match_features FORCE ROW LEVEL SECURITY;
ALTER TABLE elo_ratings FORCE ROW LEVEL SECURITY;
ALTER TABLE prediction_history FORCE ROW LEVEL SECURITY;
ALTER TABLE training_log FORCE ROW LEVEL SECURITY;
ALTER TABLE model_learning_history FORCE ROW LEVEL SECURITY;
ALTER TABLE crown_jewel_history FORCE ROW LEVEL SECURITY;
ALTER TABLE ai_cache FORCE ROW LEVEL SECURITY;
