-- ============================================
-- FIX-NOW: Run this ONE script in Supabase SQL Editor
-- Fixes: is_service_role(), cron_runs table, materialized views
-- ============================================

-- 1. Create is_service_role() function
CREATE OR REPLACE FUNCTION public.is_service_role()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $fn$
  SELECT current_setting('request.jwt.claims', true)::json->>'role' = 'service_role'
  OR current_setting('role') = 'service_role';
$fn$;

-- 2. Create is_admin() function
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  );
$fn$;

-- 3. Create cron_runs table
CREATE TABLE IF NOT EXISTS cron_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_name TEXT NOT NULL,
  execution_id TEXT NOT NULL UNIQUE,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  duration_ms INTEGER,
  status TEXT NOT NULL DEFAULT 'RUNNING' CHECK (status IN ('RUNNING', 'SUCCESS', 'FAILED', 'WARNING', 'SKIPPED')),
  triggered_by TEXT DEFAULT 'cron' CHECK (triggered_by IN ('cron', 'manual', 'api')),
  records_processed INTEGER DEFAULT 0,
  records_created INTEGER DEFAULT 0,
  records_updated INTEGER DEFAULT 0,
  predictions_generated INTEGER DEFAULT 0,
  predictions_settled INTEGER DEFAULT 0,
  api_calls INTEGER DEFAULT 0,
  error_count INTEGER DEFAULT 0,
  error_message TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cron_runs_job_name ON cron_runs(job_name, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_cron_runs_started ON cron_runs(started_at DESC);

ALTER TABLE cron_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role manages cron_runs" ON cron_runs;
CREATE POLICY "Service role manages cron_runs" ON cron_runs
  FOR ALL USING (public.is_service_role());
DROP POLICY IF EXISTS "Authenticated can read cron_runs" ON cron_runs;
CREATE POLICY "Authenticated can read cron_runs" ON cron_runs
  FOR SELECT USING (auth.role() = 'authenticated');

-- 4. Cron RPC functions
CREATE OR REPLACE FUNCTION start_cron_run(p_job_name TEXT, p_triggered_by TEXT DEFAULT 'cron')
RETURNS TEXT AS $$
DECLARE v_exec_id TEXT;
BEGIN
  v_exec_id := p_job_name || '_' || to_char(NOW(), 'YYYYMMDD_HH24MISS') || '_' || substr(md5(random()::text), 1, 8);
  INSERT INTO cron_runs (job_name, execution_id, triggered_by, status)
  VALUES (p_job_name, v_exec_id, p_triggered_by, 'RUNNING');
  RETURN v_exec_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION complete_cron_run(
  p_execution_id TEXT, p_status TEXT,
  p_records_processed INTEGER DEFAULT 0, p_records_created INTEGER DEFAULT 0,
  p_records_updated INTEGER DEFAULT 0, p_predictions_generated INTEGER DEFAULT 0,
  p_predictions_settled INTEGER DEFAULT 0, p_api_calls INTEGER DEFAULT 0,
  p_error_count INTEGER DEFAULT 0, p_error_message TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT NULL
)
RETURNS VOID AS $$
BEGIN
  UPDATE cron_runs SET
    completed_at = NOW(),
    duration_ms = EXTRACT(EPOCH FROM (NOW() - started_at)) * 1000,
    status = p_status, records_processed = p_records_processed,
    records_created = p_records_created, records_updated = p_records_updated,
    predictions_generated = p_predictions_generated, predictions_settled = p_predictions_settled,
    api_calls = p_api_calls, error_count = p_error_count,
    error_message = p_error_message, metadata = p_metadata
  WHERE execution_id = p_execution_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. CRITICAL: Materialized views (reduces Disk IO by pre-computing analytics)
-- These replace fallback queries that scan 599K rows

DROP MATERIALIZED VIEW IF EXISTS mv_calibration_buckets;
CREATE MATERIALIZED VIEW mv_calibration_buckets AS
SELECT
  CASE
    WHEN model_probability >= 0.85 THEN '85%+'
    WHEN model_probability >= 0.80 THEN '80-84%'
    WHEN model_probability >= 0.75 THEN '75-79%'
    WHEN model_probability >= 0.70 THEN '70-74%'
    WHEN model_probability >= 0.65 THEN '65-69%'
    WHEN model_probability >= 0.60 THEN '60-64%'
    WHEN model_probability >= 0.50 THEN '50-59%'
    ELSE 'Other'
  END as prob_range,
  CASE
    WHEN model_probability >= 0.85 THEN 7
    WHEN model_probability >= 0.80 THEN 6
    WHEN model_probability >= 0.75 THEN 5
    WHEN model_probability >= 0.70 THEN 4
    WHEN model_probability >= 0.65 THEN 3
    WHEN model_probability >= 0.60 THEN 2
    WHEN model_probability >= 0.50 THEN 1
    ELSE 0
  END as sort_order,
  count(*) as total,
  count(*) FILTER (WHERE result = 'correct') as correct,
  round(avg(model_probability)::numeric, 4) as avg_predicted,
  round((count(*) FILTER (WHERE result = 'correct')::numeric / nullif(count(*), 0)), 4) as actual_accuracy
FROM predictions
WHERE result IN ('correct', 'wrong')
GROUP BY prob_range, sort_order
ORDER BY sort_order;
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_calibration_range ON mv_calibration_buckets(prob_range);

DROP MATERIALIZED VIEW IF EXISTS mv_market_accuracy;
CREATE MATERIALIZED VIEW mv_market_accuracy AS
SELECT market, count(*) as total,
  count(*) FILTER (WHERE result = 'correct') as correct,
  count(*) FILTER (WHERE result = 'wrong') as wrong,
  round(avg(model_probability)::numeric, 4) as avg_probability,
  round((count(*) FILTER (WHERE result = 'correct')::numeric / nullif(count(*), 0)), 4) as accuracy
FROM predictions WHERE result IN ('correct', 'wrong')
GROUP BY market ORDER BY total DESC;
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_market_accuracy_market ON mv_market_accuracy(market);

DROP MATERIALIZED VIEW IF EXISTS mv_daily_accuracy;
CREATE MATERIALIZED VIEW mv_daily_accuracy AS
SELECT date_trunc('day', created_at)::date as pred_date, count(*) as total,
  count(*) FILTER (WHERE result = 'correct') as correct,
  count(*) FILTER (WHERE result = 'wrong') as wrong,
  round((count(*) FILTER (WHERE result = 'correct')::numeric / nullif(count(*), 0)), 4) as accuracy,
  round(avg(model_probability)::numeric, 4) as avg_probability
FROM predictions WHERE result IN ('correct', 'wrong') AND created_at >= now() - interval '90 days'
GROUP BY pred_date ORDER BY pred_date DESC;
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_daily_date ON mv_daily_accuracy(pred_date);

DROP MATERIALIZED VIEW IF EXISTS mv_model_accuracy;
CREATE MATERIALIZED VIEW mv_model_accuracy AS
SELECT model_version, count(*) as total,
  count(*) FILTER (WHERE result = 'correct') as correct,
  count(*) FILTER (WHERE result = 'wrong') as wrong,
  round(avg(model_probability)::numeric, 4) as avg_probability,
  round((count(*) FILTER (WHERE result = 'correct')::numeric / nullif(count(*), 0)), 4) as accuracy
FROM predictions WHERE result IN ('correct', 'wrong')
GROUP BY model_version ORDER BY total DESC;
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_model_version ON mv_model_accuracy(model_version);

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

-- 6. Draw performance views
DROP MATERIALIZED VIEW IF EXISTS mv_draw_performance;
CREATE MATERIALIZED VIEW mv_draw_performance AS
WITH settled AS (
  SELECT p.id, p.fixture_id, p.market, p.selection, p.model_probability, p.result, p.created_at,
    f.home_score, f.away_score, f.league_id, l.name as league_name,
    CASE WHEN f.home_score > f.away_score THEN 'home' WHEN f.home_score = f.away_score THEN 'draw' ELSE 'away' END as actual_outcome,
    CASE WHEN p.selection = 'home' THEN 'home' WHEN p.selection = 'draw' THEN 'draw' WHEN p.selection = 'away' THEN 'away' ELSE 'other' END as predicted_outcome
  FROM predictions p
  JOIN fixtures f ON f.id = p.fixture_id
  LEFT JOIN leagues l ON l.id = f.league_id
  WHERE p.market = '1X2' AND p.result IN ('correct', 'wrong') AND f.home_score IS NOT NULL AND f.away_score IS NOT NULL
)
SELECT league_id, league_name, COUNT(*) as total_predictions,
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
  CASE WHEN COUNT(*) FILTER (WHERE predicted_outcome = 'draw') > 0 THEN ROUND(COUNT(*) FILTER (WHERE predicted_outcome = 'draw' AND actual_outcome = 'draw')::numeric / COUNT(*) FILTER (WHERE predicted_outcome = 'draw'), 4) ELSE 0 END as draw_precision,
  CASE WHEN COUNT(*) FILTER (WHERE actual_outcome = 'draw') > 0 THEN ROUND(COUNT(*) FILTER (WHERE predicted_outcome = 'draw' AND actual_outcome = 'draw')::numeric / COUNT(*) FILTER (WHERE actual_outcome = 'draw'), 4) ELSE 0 END as draw_recall,
  ROUND(COUNT(*) FILTER (WHERE actual_outcome = 'draw')::numeric / NULLIF(COUNT(*), 0), 4) as actual_draw_rate,
  ROUND(COUNT(*) FILTER (WHERE predicted_outcome = 'draw')::numeric / NULLIF(COUNT(*), 0), 4) as predicted_draw_rate
FROM settled GROUP BY league_id, league_name ORDER BY total_predictions DESC;
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_draw_perf_league ON mv_draw_performance(league_id);

-- 7. RPC functions
CREATE OR REPLACE FUNCTION get_calibration_buckets(days_back integer DEFAULT 30)
RETURNS TABLE (prob_range text, total bigint, correct bigint, avg_predicted numeric, actual_accuracy numeric)
LANGUAGE sql STABLE AS $$
  SELECT prob_range, total, correct, avg_predicted, actual_accuracy FROM mv_calibration_buckets WHERE prob_range != 'Other' ORDER BY sort_order;
$$;

CREATE OR REPLACE FUNCTION get_market_accuracy()
RETURNS TABLE (market text, total bigint, correct bigint, wrong bigint, avg_probability numeric, accuracy numeric)
LANGUAGE sql STABLE AS $$
  SELECT market, total, correct, wrong, avg_probability, accuracy FROM mv_market_accuracy;
$$;

CREATE OR REPLACE FUNCTION get_daily_accuracy(days_back integer DEFAULT 30)
RETURNS TABLE (pred_date date, total bigint, correct bigint, wrong bigint, accuracy numeric, avg_probability numeric)
LANGUAGE sql STABLE AS $$
  SELECT pred_date, total, correct, wrong, accuracy, avg_probability FROM mv_daily_accuracy WHERE pred_date >= (current_date - days_back * interval '1 day') ORDER BY pred_date DESC;
$$;

CREATE OR REPLACE FUNCTION get_settlement_summary()
RETURNS TABLE (total_predictions bigint, correct bigint, wrong bigint, pending bigint, void_count bigint, accuracy numeric, avg_probability numeric, first_prediction timestamptz, last_prediction timestamptz)
LANGUAGE sql STABLE AS $$
  SELECT total_predictions, correct, wrong, pending, void_count, accuracy, avg_probability, first_prediction, last_prediction FROM mv_settlement_summary;
$$;

CREATE OR REPLACE FUNCTION refresh_analytics_views()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_calibration_buckets;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_market_accuracy;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_daily_accuracy;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_model_accuracy;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_settlement_summary;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_draw_performance;
  RAISE NOTICE 'All analytics views refreshed';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 8. Grants
GRANT SELECT ON cron_runs TO authenticated;
GRANT SELECT ON mv_calibration_buckets TO authenticated;
GRANT SELECT ON mv_market_accuracy TO authenticated;
GRANT SELECT ON mv_daily_accuracy TO authenticated;
GRANT SELECT ON mv_model_accuracy TO authenticated;
GRANT SELECT ON mv_settlement_summary TO authenticated;
GRANT SELECT ON mv_draw_performance TO authenticated;
GRANT EXECUTE ON FUNCTION get_calibration_buckets(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION get_market_accuracy() TO authenticated;
GRANT EXECUTE ON FUNCTION get_daily_accuracy(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION get_settlement_summary() TO authenticated;
GRANT EXECUTE ON FUNCTION refresh_analytics_views() TO service_role;
GRANT EXECUTE ON FUNCTION start_cron_run(TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION complete_cron_run(TEXT, TEXT, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, TEXT, JSONB) TO service_role;
REVOKE ALL ON cron_runs FROM anon;

-- 9. Verify
SELECT 'FIX-NOW complete. Run: SELECT matviewname FROM pg_matviews WHERE schemaname = ''public'';' as status;
