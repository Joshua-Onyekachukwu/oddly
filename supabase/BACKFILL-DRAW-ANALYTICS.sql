-- ============================================
-- BACKFILL-DRAW-ANALYTICS.sql
-- Fixes case sensitivity + populates draw analytics
-- Run in Supabase SQL Editor
-- ============================================

-- Step 1: Drop unique constraint temporarily
ALTER TABLE predictions DROP CONSTRAINT IF EXISTS uq_prediction_fixture_market_selection;

-- Step 2: Delete capital-letter duplicates where lowercase already exists
DELETE FROM predictions p1 USING predictions p2
WHERE p1.fixture_id = p2.fixture_id
  AND p1.market = p2.market
  AND p1.market = '1X2'
  AND p2.selection = LOWER(p1.selection)
  AND p1.selection IN ('Home', 'Draw', 'Away');

-- Step 3: Normalize remaining capital selections to lowercase
UPDATE predictions
SET selection = LOWER(selection)
WHERE market = '1X2'
  AND selection IN ('Home', 'Draw', 'Away');

-- Step 4: Re-add unique constraint
ALTER TABLE predictions
  ADD CONSTRAINT uq_prediction_fixture_market_selection
  UNIQUE (fixture_id, market, selection);

-- Step 5: Drop and rebuild draw materialized views (using LOWER for safety)

DROP MATERIALIZED VIEW IF EXISTS mv_draw_performance;
CREATE MATERIALIZED VIEW mv_draw_performance AS
WITH settled AS (
  SELECT p.id, p.fixture_id, p.market, p.selection, p.model_probability, p.result,
    f.home_score, f.away_score, f.league_id, l.name as league_name,
    CASE WHEN f.home_score > f.away_score THEN 'home'
         WHEN f.home_score = f.away_score THEN 'draw'
         ELSE 'away' END as actual_outcome,
    CASE WHEN LOWER(p.selection) = 'home' THEN 'home'
         WHEN LOWER(p.selection) = 'draw' THEN 'draw'
         WHEN LOWER(p.selection) = 'away' THEN 'away'
         ELSE 'other' END as predicted_outcome
  FROM predictions p
  JOIN fixtures f ON f.id = p.fixture_id
  LEFT JOIN leagues l ON l.id = f.league_id
  WHERE p.market = '1X2' AND p.result IN ('correct', 'wrong')
    AND f.home_score IS NOT NULL AND f.away_score IS NOT NULL
)
SELECT league_id, league_name,
  COUNT(*) as total_predictions,
  COUNT(*) FILTER (WHERE actual_outcome = 'home') as actual_homes,
  COUNT(*) FILTER (WHERE actual_outcome = 'draw') as actual_draws,
  COUNT(*) FILTER (WHERE actual_outcome = 'away') as actual_aways,
  COUNT(*) FILTER (WHERE predicted_outcome = 'home') as predicted_homes,
  COUNT(*) FILTER (WHERE predicted_outcome = 'draw') as predicted_draws,
  COUNT(*) FILTER (WHERE predicted_outcome = 'away') as predicted_aways,
  COUNT(*) FILTER (WHERE predicted_outcome = 'home' AND actual_outcome = 'home') as correct_homes,
  COUNT(*) FILTER (WHERE predicted_outcome = 'draw' AND actual_outcome = 'draw') as correct_draws,
  COUNT(*) FILTER (WHERE predicted_outcome = 'away' AND actual_outcome = 'away') as correct_aways,
  COUNT(*) FILTER (WHERE predicted_outcome = 'home' AND actual_outcome = 'draw') as home_to_draw_errors,
  COUNT(*) FILTER (WHERE predicted_outcome = 'away' AND actual_outcome = 'draw') as away_to_draw_errors,
  COUNT(*) FILTER (WHERE predicted_outcome = 'draw' AND actual_outcome = 'home') as draw_to_home_errors,
  COUNT(*) FILTER (WHERE predicted_outcome = 'draw' AND actual_outcome = 'away') as draw_to_away_errors,
  CASE WHEN COUNT(*) FILTER (WHERE predicted_outcome = 'draw') > 0
    THEN ROUND(COUNT(*) FILTER (WHERE predicted_outcome = 'draw' AND actual_outcome = 'draw')::numeric
      / COUNT(*) FILTER (WHERE predicted_outcome = 'draw'), 4)
    ELSE 0 END as draw_precision,
  CASE WHEN COUNT(*) FILTER (WHERE actual_outcome = 'draw') > 0
    THEN ROUND(COUNT(*) FILTER (WHERE predicted_outcome = 'draw' AND actual_outcome = 'draw')::numeric
      / COUNT(*) FILTER (WHERE actual_outcome = 'draw'), 4)
    ELSE 0 END as draw_recall,
  ROUND(COUNT(*) FILTER (WHERE actual_outcome = 'draw')::numeric / NULLIF(COUNT(*), 0), 4) as actual_draw_rate,
  ROUND(COUNT(*) FILTER (WHERE predicted_outcome = 'draw')::numeric / NULLIF(COUNT(*), 0), 4) as predicted_draw_rate
FROM settled GROUP BY league_id, league_name ORDER BY total_predictions DESC;
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_draw_perf_league ON mv_draw_performance(league_id);

DROP MATERIALIZED VIEW IF EXISTS mv_draw_probability_buckets;
CREATE MATERIALIZED VIEW mv_draw_probability_buckets AS
WITH settled AS (
  SELECT
    p.model_probability,
    CASE WHEN LOWER(p.selection) = 'draw' THEN p.model_probability ELSE NULL END as draw_probability,
    CASE WHEN f.home_score > f.away_score THEN 'home'
         WHEN f.home_score = f.away_score THEN 'draw'
         ELSE 'away' END as actual_outcome
  FROM predictions p
  JOIN fixtures f ON f.id = p.fixture_id
  WHERE p.market = '1X2' AND p.result IN ('correct', 'wrong')
    AND f.home_score IS NOT NULL AND f.away_score IS NOT NULL
)
SELECT
  CASE
    WHEN draw_probability IS NULL THEN 'no_draw_pred'
    WHEN draw_probability < 0.15 THEN '0-15%'
    WHEN draw_probability < 0.20 THEN '15-20%'
    WHEN draw_probability < 0.25 THEN '20-25%'
    WHEN draw_probability < 0.30 THEN '25-30%'
    WHEN draw_probability < 0.35 THEN '30-35%'
    WHEN draw_probability < 0.40 THEN '35-40%'
    ELSE '40%+'
  END as prob_bucket,
  CASE
    WHEN draw_probability IS NULL THEN 0
    WHEN draw_probability < 0.15 THEN 1
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
  ROUND(ABS(AVG(draw_probability) - COUNT(*) FILTER (WHERE actual_outcome = 'draw')::numeric / NULLIF(COUNT(*), 0)), 4) as calibration_error,
  ROUND(AVG(CASE WHEN actual_outcome = 'draw' THEN POWER(COALESCE(draw_probability, 0) - 1, 2) ELSE POWER(COALESCE(draw_probability, 0), 2) END), 4) as brier_score
FROM settled GROUP BY prob_bucket, sort_order ORDER BY sort_order;
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_draw_buckets ON mv_draw_probability_buckets(prob_bucket);

DROP MATERIALIZED VIEW IF EXISTS mv_draw_trend;
CREATE MATERIALIZED VIEW mv_draw_trend AS
WITH settled AS (
  SELECT date_trunc('week', p.created_at)::date as week,
    p.selection,
    CASE WHEN f.home_score > f.away_score THEN 'home'
         WHEN f.home_score = f.away_score THEN 'draw'
         ELSE 'away' END as actual_outcome
  FROM predictions p
  JOIN fixtures f ON f.id = p.fixture_id
  WHERE p.market = '1X2' AND p.result IN ('correct', 'wrong')
    AND f.home_score IS NOT NULL AND f.away_score IS NOT NULL
    AND p.created_at >= NOW() - INTERVAL '90 days'
)
SELECT week, COUNT(*) as total_predictions,
  COUNT(*) FILTER (WHERE actual_outcome = 'draw') as actual_draws,
  COUNT(*) FILTER (WHERE LOWER(selection) = 'draw') as predicted_draws,
  COUNT(*) FILTER (WHERE LOWER(selection) = 'draw' AND actual_outcome = 'draw') as correct_draws,
  ROUND(COUNT(*) FILTER (WHERE actual_outcome = 'draw')::numeric / NULLIF(COUNT(*), 0), 4) as actual_draw_rate,
  ROUND(COUNT(*) FILTER (WHERE LOWER(selection) = 'draw')::numeric / NULLIF(COUNT(*), 0), 4) as predicted_draw_rate,
  CASE WHEN COUNT(*) FILTER (WHERE LOWER(selection) = 'draw') > 0
    THEN ROUND(COUNT(*) FILTER (WHERE LOWER(selection) = 'draw' AND actual_outcome = 'draw')::numeric
      / COUNT(*) FILTER (WHERE LOWER(selection) = 'draw'), 4)
    ELSE 0 END as draw_accuracy
FROM settled GROUP BY week ORDER BY week DESC;
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_draw_trend_week ON mv_draw_trend(week);

-- Step 6: Refresh all analytics views
REFRESH MATERIALIZED VIEW CONCURRENTLY mv_calibration_buckets;
REFRESH MATERIALIZED VIEW CONCURRENTLY mv_market_accuracy;
REFRESH MATERIALIZED VIEW CONCURRENTLY mv_daily_accuracy;
REFRESH MATERIALIZED VIEW CONCURRENTLY mv_model_accuracy;
REFRESH MATERIALIZED VIEW CONCURRENTLY mv_settlement_summary;

-- Step 7: Verify
SELECT league_name, total_predictions, actual_draws, predicted_draws, correct_draws,
  ROUND(draw_precision * 100, 1) as precision_pct,
  ROUND(draw_recall * 100, 1) as recall_pct,
  ROUND(actual_draw_rate * 100, 1) as actual_draw_rate_pct,
  ROUND(predicted_draw_rate * 100, 1) as predicted_draw_rate_pct
FROM mv_draw_performance ORDER BY total_predictions DESC;

SELECT 'BACKFILL-DRAW-ANALYTICS complete' as status;
