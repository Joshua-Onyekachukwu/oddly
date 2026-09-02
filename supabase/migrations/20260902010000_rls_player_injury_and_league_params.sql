-- ============================================
-- RLS POLICIES: player_injury_data & league_model_params
-- Date: September 2, 2026
--
-- These tables are read by the ensemble model for predictions.
-- Anon access must be blocked; service_role writes, authenticated reads.
-- ============================================

-- 1. player_injury_data — injury status used by ensemble for match predictions
ALTER TABLE player_injury_data ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role manages player_injury_data" ON player_injury_data;
CREATE POLICY "Service role manages player_injury_data"
  ON player_injury_data FOR ALL
  USING (public.is_service_role());

DROP POLICY IF EXISTS "Authenticated can read player_injury_data" ON player_injury_data;
CREATE POLICY "Authenticated can read player_injury_data"
  ON player_injury_data FOR SELECT
  USING (auth.role() = 'authenticated');

REVOKE ALL ON player_injury_data FROM anon;

-- 2. league_model_params — per-league model parameters (home advantage, goal expectancy)
ALTER TABLE league_model_params ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role manages league_model_params" ON league_model_params;
CREATE POLICY "Service role manages league_model_params"
  ON league_model_params FOR ALL
  USING (public.is_service_role());

DROP POLICY IF EXISTS "Authenticated can read league_model_params" ON league_model_params;
CREATE POLICY "Authenticated can read league_model_params"
  ON league_model_params FOR SELECT
  USING (auth.role() = 'authenticated');

REVOKE ALL ON league_model_params FROM anon;

-- Grants
GRANT SELECT ON player_injury_data TO authenticated;
GRANT SELECT ON league_model_params TO authenticated;

COMMENT ON TABLE player_injury_data IS 'Player injury status — used by ensemble model. RLS blocks anon.';
COMMENT ON TABLE league_model_params IS 'Per-league model parameters (home advantage, goal expectancy). RLS blocks anon.';
