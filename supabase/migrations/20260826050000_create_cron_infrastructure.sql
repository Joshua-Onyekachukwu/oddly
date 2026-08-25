-- ============================================
-- CRON EXECUTION LOGGING INFRASTRUCTURE
-- Date: August 26, 2026
--
-- Centralized cron execution tracking:
-- - One table for all cron run records
-- - RPC functions for logging and querying
-- - Materialized view for /admin/crons dashboard
-- ============================================

-- 1. Cron execution log table
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

-- Indexes for dashboard queries
CREATE INDEX IF NOT EXISTS idx_cron_runs_job_name ON cron_runs(job_name, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_cron_runs_status ON cron_runs(status, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_cron_runs_started ON cron_runs(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_cron_runs_execution ON cron_runs(execution_id);

-- 2. RLS
ALTER TABLE cron_runs ENABLE ROW LEVEL SECURITY;

-- Service role manages all cron runs
CREATE POLICY "Service role manages cron_runs" ON cron_runs
  FOR ALL USING (public.is_service_role());

-- Authenticated can read (for admin dashboard)
CREATE POLICY "Authenticated can read cron_runs" ON cron_runs
  FOR SELECT USING (auth.role() = 'authenticated');

-- 3. RPC: Start a cron run
CREATE OR REPLACE FUNCTION start_cron_run(
  p_job_name TEXT,
  p_triggered_by TEXT DEFAULT 'cron'
)
RETURNS TEXT AS $$
DECLARE
  v_exec_id TEXT;
BEGIN
  v_exec_id := p_job_name || '_' || to_char(NOW(), 'YYYYMMDD_HH24MISS') || '_' || substr(md5(random()::text), 1, 8);

  INSERT INTO cron_runs (job_name, execution_id, triggered_by, status)
  VALUES (p_job_name, v_exec_id, p_triggered_by, 'RUNNING');

  RETURN v_exec_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. RPC: Complete a cron run
CREATE OR REPLACE FUNCTION complete_cron_run(
  p_execution_id TEXT,
  p_status TEXT,
  p_records_processed INTEGER DEFAULT 0,
  p_records_created INTEGER DEFAULT 0,
  p_records_updated INTEGER DEFAULT 0,
  p_predictions_generated INTEGER DEFAULT 0,
  p_predictions_settled INTEGER DEFAULT 0,
  p_api_calls INTEGER DEFAULT 0,
  p_error_count INTEGER DEFAULT 0,
  p_error_message TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT NULL
)
RETURNS VOID AS $$
BEGIN
  UPDATE cron_runs SET
    completed_at = NOW(),
    duration_ms = EXTRACT(EPOCH FROM (NOW() - started_at)) * 1000,
    status = p_status,
    records_processed = p_records_processed,
    records_created = p_records_created,
    records_updated = p_records_updated,
    predictions_generated = p_predictions_generated,
    predictions_settled = p_predictions_settled,
    api_calls = p_api_calls,
    error_count = p_error_count,
    error_message = p_error_message,
    metadata = p_metadata
  WHERE execution_id = p_execution_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. Materialized view: latest run per job
DROP MATERIALIZED VIEW IF EXISTS mv_cron_status;
CREATE MATERIALIZED VIEW mv_cron_status AS
WITH latest_runs AS (
  SELECT DISTINCT ON (job_name)
    job_name,
    execution_id,
    started_at,
    completed_at,
    duration_ms,
    status,
    records_processed,
    records_created,
    records_updated,
    predictions_generated,
    predictions_settled,
    api_calls,
    error_count,
    error_message,
    metadata
  FROM cron_runs
  ORDER BY job_name, started_at DESC
),
failure_counts AS (
  SELECT job_name, COUNT(*) as consecutive_failures
  FROM cron_runs
  WHERE status = 'FAILED'
    AND started_at > NOW() - INTERVAL '24 hours'
  GROUP BY job_name
)
SELECT
  l.*,
  COALESCE(f.consecutive_failures, 0) as consecutive_failures,
  (SELECT COUNT(*) FROM cron_runs c WHERE c.job_name = l.job_name AND c.status = 'SUCCESS') as total_successes,
  (SELECT COUNT(*) FROM cron_runs c WHERE c.job_name = l.job_name AND c.status = 'FAILED') as total_failures
FROM latest_runs l
LEFT JOIN failure_counts f ON f.job_name = l.job_name;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_cron_status_job ON mv_cron_status(job_name);

-- 6. Materialized view: cron history (last 100 runs per job)
DROP MATERIALIZED VIEW IF EXISTS mv_cron_history;
CREATE MATERIALIZED VIEW mv_cron_history AS
SELECT
  job_name,
  execution_id,
  started_at,
  completed_at,
  duration_ms,
  status,
  records_processed,
  predictions_generated,
  predictions_settled,
  error_count,
  error_message
FROM cron_runs
ORDER BY started_at DESC
LIMIT 500;

CREATE INDEX IF NOT EXISTS idx_mv_cron_history_job ON mv_cron_history(job_name, started_at DESC);

-- 7. Refresh function
CREATE OR REPLACE FUNCTION refresh_cron_views()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_cron_status;
  REFRESH MATERIALIZED VIEW mv_cron_history;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 8. Cleanup: delete runs older than 30 days
CREATE OR REPLACE FUNCTION cleanup_old_cron_runs()
RETURNS void AS $$
BEGIN
  DELETE FROM cron_runs WHERE started_at < NOW() - INTERVAL '30 days';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 9. Grants
GRANT SELECT ON cron_runs TO authenticated;
GRANT SELECT ON mv_cron_status TO authenticated;
GRANT SELECT ON mv_cron_history TO authenticated;
GRANT EXECUTE ON FUNCTION start_cron_run(TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION complete_cron_run(TEXT, TEXT, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION refresh_cron_views() TO service_role;
GRANT EXECUTE ON FUNCTION cleanup_old_cron_runs() TO service_role;
REVOKE ALL ON cron_runs FROM anon;
REVOKE ALL ON mv_cron_status FROM anon;
REVOKE ALL ON mv_cron_history FROM anon;

COMMENT ON TABLE cron_runs IS 'Centralized cron execution logging — one record per run';
COMMENT ON FUNCTION start_cron_run IS 'Start a new cron execution, returns execution_id';
COMMENT ON FUNCTION complete_cron_run IS 'Mark a cron execution as complete with metrics';
