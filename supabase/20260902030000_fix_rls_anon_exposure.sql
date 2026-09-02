-- ============================================================
-- FIX: Block anon key read access to internal model tables
--
-- These 4 tables are only accessed by backend API routes and
-- cron jobs using the service_role key. No frontend page reads
-- from them directly. Blocking anon read prevents competitors
-- from scraping model internals.
-- ============================================================

-- ── player_injury_data ──────────────────────────────────────
-- Already has RLS enabled; just needs proper policies.

-- Drop overly permissive existing policies if they exist
DROP POLICY IF EXISTS "Public read player availability" ON player_injury_data;
DROP POLICY IF EXISTS "Allow public read" ON player_injury_data;
DROP POLICY IF EXISTS "anon can read player_injury_data" ON player_injury_data;

-- Ensure RLS is enabled
ALTER TABLE player_injury_data ENABLE ROW LEVEL SECURITY;

-- Service role can do everything
DROP POLICY IF EXISTS "Service role manages player_injury_data" ON player_injury_data;
CREATE POLICY "Service role manages player_injury_data"
  ON player_injury_data FOR ALL
  USING (auth.role() = 'service_role');

-- Authenticated users can read (for the /admin/injuries dashboard)
DROP POLICY IF EXISTS "Authenticated read player_injury_data" ON player_injury_data;
CREATE POLICY "Authenticated read player_injury_data"
  ON player_injury_data FOR SELECT
  USING (auth.role() = 'authenticated');

-- ── league_model_params ─────────────────────────────────────

DROP POLICY IF EXISTS "Public read league model params" ON league_model_params;
DROP POLICY IF EXISTS "Allow public read" ON league_model_params;
DROP POLICY IF EXISTS "anon can read league_model_params" ON league_model_params;

ALTER TABLE league_model_params ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role manages league_model_params" ON league_model_params;
CREATE POLICY "Service role manages league_model_params"
  ON league_model_params FOR ALL
  USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Authenticated read league_model_params" ON league_model_params;
CREATE POLICY "Authenticated read league_model_params"
  ON league_model_params FOR SELECT
  USING (auth.role() = 'authenticated');

-- ── model_weight_config ─────────────────────────────────────

DROP POLICY IF EXISTS "Public read model_weight_config" ON model_weight_config;
DROP POLICY IF EXISTS "Allow public read" ON model_weight_config;
DROP POLICY IF EXISTS "anon can read model_weight_config" ON model_weight_config;

ALTER TABLE model_weight_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role manages model_weight_config" ON model_weight_config;
CREATE POLICY "Service role manages model_weight_config"
  ON model_weight_config FOR ALL
  USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Authenticated read model_weight_config" ON model_weight_config;
CREATE POLICY "Authenticated read model_weight_config"
  ON model_weight_config FOR SELECT
  USING (auth.role() = 'authenticated');

-- ── team_feature_profiles ───────────────────────────────────

DROP POLICY IF EXISTS "Public read team feature profiles" ON team_feature_profiles;
DROP POLICY IF EXISTS "Allow public read" ON team_feature_profiles;
DROP POLICY IF EXISTS "anon can read team_feature_profiles" ON team_feature_profiles;

ALTER TABLE team_feature_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role manages team_feature_profiles" ON team_feature_profiles;
CREATE POLICY "Service role manages team_feature_profiles"
  ON team_feature_profiles FOR ALL
  USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Authenticated read team_feature_profiles" ON team_feature_profiles;
CREATE POLICY "Authenticated read team_feature_profiles"
  ON team_feature_profiles FOR SELECT
  USING (auth.role() = 'authenticated');

-- Verify
SELECT 'RLS policies applied to 4 tables — anon read blocked' AS status;
