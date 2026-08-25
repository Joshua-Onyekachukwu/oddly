-- ============================================
-- DRAW CALIBRATION INFRASTRUCTURE
-- Date: August 26, 2026
--
-- League-specific draw calibration with shrinkage,
-- champion/challenger, and versioning.
-- ============================================

-- 1. League draw calibration table
CREATE TABLE IF NOT EXISTS league_draw_calibration (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id UUID REFERENCES leagues(id),
  league_name TEXT NOT NULL,
  calibration_version TEXT NOT NULL,
  training_start DATE,
  training_end DATE,
  sample_size INTEGER DEFAULT 0,
  global_draw_rate NUMERIC(5,4),
  league_draw_rate NUMERIC(5,4),
  model_draw_rate NUMERIC(5,4),
  calibration_method TEXT DEFAULT 'bayesian_shrinkage',
  calibration_parameters JSONB,
  validation_metrics JSONB,
  status TEXT DEFAULT 'challenger' CHECK (status IN ('champion', 'challenger', 'retired')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(league_id, calibration_version)
);

ALTER TABLE league_draw_calibration ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role manages draw calibration" ON league_draw_calibration
  FOR ALL USING (public.is_service_role());
CREATE POLICY "Authenticated can read draw calibration" ON league_draw_calibration
  FOR SELECT USING (auth.role() = 'authenticated');

-- 2. Materialized view: draw confusion matrix by league
DROP MATERIALIZED VIEW IF EXISTS mv_draw_performance;
CREATE MATERIALIZED VIEW mv_draw_performance AS
WITH settled AS (
  SELECT
    p.id,
    p.fixture_id,
    p.market,
    p.selection,
    p.model_probability,
    p.model_version,
    p.result,
    p.created_at,
    f.home_score,
    f.away_score,
    f.league_id,
    l.name as league_name,
    CASE
      WHEN f.home_score > f.away_score THEN 'home'
      WHEN f.home_score = f.away_score THEN 'draw'
      ELSE 'away'
    END as actual_outcome,
    CASE
      WHEN p.selection = 'home' THEN 'home'
      WHEN p.selection = 'draw' THEN 'draw'
      WHEN p.selection = 'away' THEN 'away'
      ELSE 'other'
    END as predicted_outcome
  FROM predictions p
  JOIN fixtures f ON f.id = p.fixture_id
  LEFT JOIN leagues l ON l.id = f.league_id
  WHERE p.market = '1X2'
    AND p.result IN ('correct', 'wrong')
    AND f.home_score IS NOT NULL
    AND f.away_score IS NOT NULL
)
SELECT
  league_id,
  league_name,
  COUNT(*) as total_predictions,
  COUNT(*) FILTER (WHERE actual_outcome = 'home') as actual_homes,
  COUNT(*) FILTER (WHERE actual_outcome = 'draw') as actual_draws,
  COUNT(*) FILTER (WHERE actual_outcome = 'away') as actual_aways,
  COUNT(*) FILTER (WHERE predicted_outcome = 'home') as predicted_homes,
  COUNT(*) FILTER (WHERE predicted_outcome = 'draw') as predicted_draws,
  COUNT(*) FILTER (WHERE predicted_outcome = 'away') as predicted_aways,
  -- Correct predictions per outcome
  COUNT(*) FILTER (WHERE predicted_outcome = 'home' AND actual_outcome = 'home') as correct_homes,
  COUNT(*) FILTER (WHERE predicted_outcome = 'draw' AND actual_outcome = 'draw') as correct_draws,
  COUNT(*) FILTER (WHERE predicted_outcome = 'away' AND actual_outcome = 'away') as correct_aways,
  -- Missed draws (predicted home/away but actual draw)
  COUNT(*) FILTER (WHERE predicted_outcome = 'home' AND actual_outcome = 'draw') as home_to_draw_errors,
  COUNT(*) FILTER (WHERE predicted_outcome = 'away' AND actual_outcome = 'draw') as away_to_draw_errors,
  -- False draws (predicted draw but actual home/away)
  COUNT(*) FILTER (WHERE predicted_outcome = 'draw' AND actual_outcome = 'home') as draw_to_home_errors,
  COUNT(*) FILTER (WHERE predicted_outcome = 'draw' AND actual_outcome = 'away') as draw_to_away_errors,
  -- Draw precision/recall
  CASE
    WHEN COUNT(*) FILTER (WHERE predicted_outcome = 'draw') > 0
    THEN ROUND(COUNT(*) FILTER (WHERE predicted_outcome = 'draw' AND actual_outcome = 'draw')::numeric /
         COUNT(*) FILTER (WHERE predicted_outcome = 'draw'), 4)
    ELSE 0
  END as draw_precision,
  CASE
    WHEN COUNT(*) FILTER (WHERE actual_outcome = 'draw') > 0
    THEN ROUND(COUNT(*) FILTER (WHERE predicted_outcome = 'draw' AND actual_outcome = 'draw')::numeric /
         COUNT(*) FILTER (WHERE actual_outcome = 'draw'), 4)
    ELSE 0
  END as draw_recall,
  -- Rates
  ROUND(COUNT(*) FILTER (WHERE actual_outcome = 'draw')::numeric / NULLIF(COUNT(*), 0), 4) as actual_draw_rate,
  ROUND(COUNT(*) FILTER (WHERE predicted_outcome = 'draw')::numeric / NULLIF(COUNT(*), 0), 4) as predicted_draw_rate,
  MIN(created_at) as first_prediction,
  MAX(created_at) as last_prediction
FROM settled
GROUP BY league_id, league_name
ORDER BY total_predictions DESC;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_draw_perf_league ON mv_draw_performance(league_id);

-- 3. Materialized view: draw probability buckets
DROP MATERIALIZED VIEW IF EXISTS mv_draw_probability_buckets;
CREATE MATERIALIZED VIEW mv_draw_probability_buckets AS
WITH settled AS (
  SELECT
    model_probability,
    CASE
      WHEN selection = 'draw' THEN model_probability
      ELSE NULL
    END as draw_probability,
    result,
    CASE
      WHEN home_score > away_score THEN 'home'
      WHEN home_score = away_score THEN 'draw'
      ELSE 'away'
    END as actual_outcome,
    selection
  FROM predictions p
  JOIN fixtures f ON f.id = p.fixture_id
  WHERE p.market = '1X2'
    AND p.result IN ('correct', 'wrong')
    AND f.home_score IS NOT NULL
    AND f.away_score IS NOT NULL
)
SELECT
  CASE
    WHEN draw_probability IS NULL THEN 'no_draw_pred'
    WHEN draw_probability < 0.10 THEN '0-10%'
    WHEN draw_probability < 0.20 THEN '10-20%'
    WHEN draw_probability < 0.25 THEN '20-25%'
    WHEN draw_probability < 0.30 THEN '25-30%'
    WHEN draw_probability < 0.35 THEN '30-35%'
    WHEN draw_probability < 0.40 THEN '35-40%'
    ELSE '40%+'
  END as prob_bucket,
  CASE
    WHEN draw_probability IS NULL THEN 0
    WHEN draw_probability < 0.10 THEN 1
    WHEN draw_probability < 0.20 THEN 2
    WHEN draw_probability < 0.25 THEN 3
    WHEN draw_probability < 0.30 THEN 4
    WHEN draw_probability < 0.35 THEN 5
    WHEN draw_probability < 0.40 THEN 6
    ELSE 7
  END as sort_order,
  COUNT(*) as total_matches,
  COUNT(*) FILTER (WHERE actual_outcome = 'draw') as actual_draws,
  ROUND(COUNT(*) FILTER (WHERE actual_outcome = 'draw')::numeric / NULLIF(COUNT(*), 0), 4) as observed_draw_rate,
  ROUND(AVG(draw_probability), 4) as avg_predicted_draw_prob,
  -- Calibration error
  ROUND(ABS(AVG(draw_probability) - COUNT(*) FILTER (WHERE actual_outcome = 'draw')::numeric / NULLIF(COUNT(*), 0)), 4) as calibration_error,
  -- Brier score for draw predictions
  ROUND(AVG(
    CASE
      WHEN actual_outcome = 'draw' THEN POWER(COALESCE(draw_probability, 0) - 1, 2)
      ELSE POWER(COALESCE(draw_probability, 0), 2)
    END
  ), 4) as brier_score
FROM settled
GROUP BY prob_bucket, sort_order
ORDER BY sort_order;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_draw_buckets ON mv_draw_probability_buckets(prob_bucket);

-- 4. Materialized view: draw trend over time
DROP MATERIALIZED VIEW IF EXISTS mv_draw_trend;
CREATE MATERIALIZED VIEW mv_draw_trend AS
WITH settled AS (
  SELECT
    date_trunc('week', p.created_at)::date as week,
    p.selection,
    p.result,
    p.model_probability,
    CASE
      WHEN f.home_score > f.away_score THEN 'home'
      WHEN f.home_score = f.away_score THEN 'draw'
      ELSE 'away'
    END as actual_outcome
  FROM predictions p
  JOIN fixtures f ON f.id = p.fixture_id
  WHERE p.market = '1X2'
    AND p.result IN ('correct', 'wrong')
    AND f.home_score IS NOT NULL
    AND f.away_score IS NOT NULL
    AND p.created_at >= NOW() - INTERVAL '90 days'
)
SELECT
  week,
  COUNT(*) as total_predictions,
  COUNT(*) FILTER (WHERE actual_outcome = 'draw') as actual_draws,
  COUNT(*) FILTER (WHERE selection = 'draw') as predicted_draws,
  COUNT(*) FILTER (WHERE selection = 'draw' AND actual_outcome = 'draw') as correct_draws,
  ROUND(COUNT(*) FILTER (WHERE actual_outcome = 'draw')::numeric / NULLIF(COUNT(*), 0), 4) as actual_draw_rate,
  ROUND(COUNT(*) FILTER (WHERE selection = 'draw')::numeric / NULLIF(COUNT(*), 0), 4) as predicted_draw_rate,
  CASE
    WHEN COUNT(*) FILTER (WHERE selection = 'draw') > 0
    THEN ROUND(COUNT(*) FILTER (WHERE selection = 'draw' AND actual_outcome = 'draw')::numeric /
         COUNT(*) FILTER (WHERE selection = 'draw'), 4)
    ELSE 0
  END as draw_accuracy
FROM settled
GROUP BY week
ORDER BY week DESC;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_draw_trend_week ON mv_draw_trend(week);

-- 5. Refresh function
CREATE OR REPLACE FUNCTION refresh_draw_views()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_draw_performance;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_draw_probability_buckets;
  REFRESH MATERIALIZED VIEW mv_draw_trend;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. Grants
GRANT SELECT ON league_draw_calibration TO authenticated;
GRANT SELECT ON mv_draw_performance TO authenticated;
GRANT SELECT ON mv_draw_probability_buckets TO authenticated;
GRANT SELECT ON mv_draw_trend TO authenticated;
GRANT EXECUTE ON FUNCTION refresh_draw_views() TO service_role;
REVOKE ALL ON league_draw_calibration FROM anon;
REVOKE ALL ON mv_draw_performance FROM anon;
REVOKE ALL ON mv_draw_probability_buckets FROM anon;
REVOKE ALL ON mv_draw_trend FROM anon;

COMMENT ON TABLE league_draw_calibration IS 'League-specific draw calibration parameters with versioning';
COMMENT ON MATERIALIZED VIEW mv_draw_performance IS 'Draw confusion matrix by league (1X2 predictions only)';
COMMENT ON MATERIALIZED VIEW mv_draw_probability_buckets IS 'Draw probability calibration buckets';
COMMENT ON MATERIALIZED VIEW mv_draw_trend IS 'Draw performance trends over time';
