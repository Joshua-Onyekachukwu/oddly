-- ============================================
-- FIX DISK I/O — Indexes & Materialized Views
-- Date: August 26, 2026
--
-- Problem: Analytics queries fetch 50K rows from 599K-row predictions
-- table, causing full table scans and disk I/O spikes.
--
-- Solution:
--   1. Add composite indexes for common query patterns
--   2. Create materialized views for expensive aggregations
--   3. Create RPC functions for analytics (DB-side processing)
-- ============================================

-- ── 1. CRITICAL INDEXES ────────────────────────────────────────

-- Composite index: settled predictions by date + result (calibration queries)
CREATE INDEX IF NOT EXISTS idx_predictions_settled_date
  ON predictions(created_at DESC, result)
  WHERE result IN ('correct', 'wrong');

-- Composite index: market + result for accuracy by market
CREATE INDEX IF NOT EXISTS idx_predictions_market_result
  ON predictions(market, result, created_at DESC)
  WHERE result IN ('correct', 'wrong');

-- Composite index: model_version + result for model comparison
CREATE INDEX IF NOT EXISTS idx_predictions_model_result
  ON predictions(model_version, result, created_at DESC)
  WHERE result IN ('correct', 'wrong');

-- Composite index: fixture + market for settlement lookups
CREATE INDEX IF NOT EXISTS idx_predictions_fixture_market
  ON predictions(fixture_id, market, result);

-- Partial index: only pending predictions (for settlement cron)
CREATE INDEX IF NOT EXISTS idx_predictions_pending
  ON predictions(fixture_id, created_at DESC)
  WHERE result = 'pending' OR result IS NULL;

-- Index on created_at for date range queries
CREATE INDEX IF NOT EXISTS idx_predictions_created_at
  ON predictions(created_at DESC);

-- ── 2. MATERIALIZED VIEWS ──────────────────────────────────────

-- Calibration buckets: pre-computed accuracy by probability range
-- Refresh: runs as part of weekly learn cron
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
  round(
    (count(*) FILTER (WHERE result = 'correct')::numeric / nullif(count(*), 0)),
    4
  ) as actual_accuracy
FROM predictions
WHERE result IN ('correct', 'wrong')
GROUP BY prob_range, sort_order
ORDER BY sort_order;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_calibration_range ON mv_calibration_buckets(prob_range);

-- Market accuracy: pre-computed accuracy by market
DROP MATERIALIZED VIEW IF EXISTS mv_market_accuracy;
CREATE MATERIALIZED VIEW mv_market_accuracy AS
SELECT
  market,
  count(*) as total,
  count(*) FILTER (WHERE result = 'correct') as correct,
  count(*) FILTER (WHERE result = 'wrong') as wrong,
  round(avg(model_probability)::numeric, 4) as avg_probability,
  round(
    (count(*) FILTER (WHERE result = 'correct')::numeric / nullif(count(*), 0)),
    4
  ) as accuracy
FROM predictions
WHERE result IN ('correct', 'wrong')
GROUP BY market
ORDER BY total DESC;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_market_accuracy_market ON mv_market_accuracy(market);

-- Daily accuracy: pre-computed accuracy by day
DROP MATERIALIZED VIEW IF EXISTS mv_daily_accuracy;
CREATE MATERIALIZED VIEW mv_daily_accuracy AS
SELECT
  date_trunc('day', created_at)::date as pred_date,
  count(*) as total,
  count(*) FILTER (WHERE result = 'correct') as correct,
  count(*) FILTER (WHERE result = 'wrong') as wrong,
  round(
    (count(*) FILTER (WHERE result = 'correct')::numeric / nullif(count(*), 0)),
    4
  ) as accuracy,
  round(avg(model_probability)::numeric, 4) as avg_probability
FROM predictions
WHERE result IN ('correct', 'wrong')
  AND created_at >= now() - interval '90 days'
GROUP BY pred_date
ORDER BY pred_date DESC;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_daily_date ON mv_daily_accuracy(pred_date);

-- Model version accuracy: compare model versions
DROP MATERIALIZED VIEW IF EXISTS mv_model_accuracy;
CREATE MATERIALIZED VIEW mv_model_accuracy AS
SELECT
  model_version,
  count(*) as total,
  count(*) FILTER (WHERE result = 'correct') as correct,
  count(*) FILTER (WHERE result = 'wrong') as wrong,
  round(avg(model_probability)::numeric, 4) as avg_probability,
  round(
    (count(*) FILTER (WHERE result = 'correct')::numeric / nullif(count(*), 0)),
    4
  ) as accuracy
FROM predictions
WHERE result IN ('correct', 'wrong')
GROUP BY model_version
ORDER BY total DESC;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_model_version ON mv_model_accuracy(model_version);

-- Settlement summary: quick stats for dashboard
DROP MATERIALIZED VIEW IF EXISTS mv_settlement_summary;
CREATE MATERIALIZED VIEW mv_settlement_summary AS
SELECT
  count(*) as total_predictions,
  count(*) FILTER (WHERE result = 'correct') as correct,
  count(*) FILTER (WHERE result = 'wrong') as wrong,
  count(*) FILTER (WHERE result = 'pending' OR result IS NULL) as pending,
  count(*) FILTER (WHERE result = 'void') as void_count,
  round(
    (count(*) FILTER (WHERE result = 'correct')::numeric /
     nullif(count(*) FILTER (WHERE result IN ('correct', 'wrong')), 0)),
    4
  ) as accuracy,
  round(avg(model_probability)::numeric, 4) as avg_probability,
  min(created_at) as first_prediction,
  max(created_at) as last_prediction
FROM predictions;

-- ── 3. RPC FUNCTIONS (DB-side aggregation) ─────────────────────

-- Get calibration data without fetching rows
CREATE OR REPLACE FUNCTION get_calibration_buckets(days_back integer DEFAULT 30)
RETURNS TABLE (
  prob_range text,
  total bigint,
  correct bigint,
  avg_predicted numeric,
  actual_accuracy numeric
)
LANGUAGE sql STABLE
AS $$
  SELECT prob_range, total, correct, avg_predicted, actual_accuracy
  FROM mv_calibration_buckets
  WHERE prob_range != 'Other'
  ORDER BY sort_order;
$$;

-- Get market accuracy without fetching rows
CREATE OR REPLACE FUNCTION get_market_accuracy()
RETURNS TABLE (
  market text,
  total bigint,
  correct bigint,
  wrong bigint,
  avg_probability numeric,
  accuracy numeric
)
LANGUAGE sql STABLE
AS $$
  SELECT market, total, correct, wrong, avg_probability, accuracy
  FROM mv_market_accuracy;
$$;

-- Get daily accuracy without fetching rows
CREATE OR REPLACE FUNCTION get_daily_accuracy(days_back integer DEFAULT 30)
RETURNS TABLE (
  pred_date date,
  total bigint,
  correct bigint,
  wrong bigint,
  accuracy numeric,
  avg_probability numeric
)
LANGUAGE sql STABLE
AS $$
  SELECT pred_date, total, correct, wrong, accuracy, avg_probability
  FROM mv_daily_accuracy
  WHERE pred_date >= (current_date - days_back * interval '1 day')
  ORDER BY pred_date DESC;
$$;

-- Get settlement summary without fetching rows
CREATE OR REPLACE FUNCTION get_settlement_summary()
RETURNS TABLE (
  total_predictions bigint,
  correct bigint,
  wrong bigint,
  pending bigint,
  void_count bigint,
  accuracy numeric,
  avg_probability numeric,
  first_prediction timestamptz,
  last_prediction timestamptz
)
LANGUAGE sql STABLE
AS $$
  SELECT total_predictions, correct, wrong, pending, void_count,
    accuracy, avg_probability, first_prediction, last_prediction
  FROM mv_settlement_summary;
$$;

-- Refresh all materialized views (call from learn cron)
CREATE OR REPLACE FUNCTION refresh_analytics_views()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_calibration_buckets;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_market_accuracy;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_daily_accuracy;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_model_accuracy;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_settlement_summary;
  RAISE NOTICE 'All analytics materialized views refreshed';
END;
$$;

-- ── 4. GRANTS ──────────────────────────────────────────────────

-- Allow authenticated to read materialized views
GRANT SELECT ON mv_calibration_buckets TO authenticated;
GRANT SELECT ON mv_market_accuracy TO authenticated;
GRANT SELECT ON mv_daily_accuracy TO authenticated;
GRANT SELECT ON mv_model_accuracy TO authenticated;
GRANT SELECT ON mv_settlement_summary TO authenticated;

-- Allow authenticated to call RPC functions
GRANT EXECUTE ON FUNCTION get_calibration_buckets(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION get_market_accuracy() TO authenticated;
GRANT EXECUTE ON FUNCTION get_daily_accuracy(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION get_settlement_summary() TO authenticated;
GRANT EXECUTE ON FUNCTION refresh_analytics_views() TO service_role;
