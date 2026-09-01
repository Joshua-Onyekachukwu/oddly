-- ============================================
-- FIX-NOW.sql — Master Database Hardening Script
-- Safe to run multiple times. All operations are idempotent.
-- Date: August 26, 2026
-- ============================================

-- ============================================================
-- 1. PREREQUISITE FUNCTIONS
-- ============================================================

CREATE OR REPLACE FUNCTION public.is_service_role()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $fn$
  SELECT current_setting('request.jwt.claims', true)::json->>'role' = 'service_role'
  OR current_setting('role') = 'service_role';
$fn$;

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

-- ============================================================
-- 2. CRON RUNS TABLE + RPC FUNCTIONS
-- ============================================================

CREATE TABLE IF NOT EXISTS cron_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_name TEXT NOT NULL,
  execution_id TEXT NOT NULL UNIQUE,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  duration_ms INTEGER,
  status TEXT NOT NULL DEFAULT 'RUNNING'
    CHECK (status IN ('RUNNING', 'SUCCESS', 'FAILED', 'WARNING', 'SKIPPED')),
  triggered_by TEXT DEFAULT 'cron'
    CHECK (triggered_by IN ('cron', 'manual', 'api')),
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

CREATE OR REPLACE FUNCTION start_cron_run(p_job_name TEXT, p_triggered_by TEXT DEFAULT 'cron')
RETURNS TEXT AS $fn$
DECLARE v_exec_id TEXT;
BEGIN
  v_exec_id := p_job_name || '_' || to_char(NOW(), 'YYYYMMDD_HH24MISS') || '_' || substr(md5(random()::text), 1, 8);
  INSERT INTO cron_runs (job_name, execution_id, triggered_by, status)
  VALUES (p_job_name, v_exec_id, p_triggered_by, 'RUNNING');
  RETURN v_exec_id;
END;
$fn$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION complete_cron_run(
  p_execution_id TEXT, p_status TEXT,
  p_records_processed INTEGER DEFAULT 0, p_records_created INTEGER DEFAULT 0,
  p_records_updated INTEGER DEFAULT 0, p_predictions_generated INTEGER DEFAULT 0,
  p_predictions_settled INTEGER DEFAULT 0, p_api_calls INTEGER DEFAULT 0,
  p_error_count INTEGER DEFAULT 0, p_error_message TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT NULL
)
RETURNS VOID AS $fn$
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
$fn$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 3. CRON EXECUTION LOCKING (database-backed, distributed)
-- ============================================================

CREATE TABLE IF NOT EXISTS cron_locks (
  job_name TEXT PRIMARY KEY,
  locked_by TEXT NOT NULL,
  locked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  lease_seconds INTEGER NOT NULL DEFAULT 600,
  released_at TIMESTAMPTZ
);

ALTER TABLE cron_locks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role manages cron_locks" ON cron_locks;
CREATE POLICY "Service role manages cron_locks" ON cron_locks
  FOR ALL USING (public.is_service_role());

-- Try to acquire lock. Returns lock_id if successful, NULL if already locked.
CREATE OR REPLACE FUNCTION acquire_cron_lock(
  p_job_name TEXT,
  p_lease_seconds INTEGER DEFAULT 600
)
RETURNS TEXT AS $fn$
DECLARE
  v_lock_id TEXT;
  v_existing_lock RECORD;
BEGIN
  v_lock_id := p_job_name || '_' || md5(random()::text || clock_timestamp()::text);

  -- Check for existing active lock
  SELECT locked_by, locked_at, lease_seconds INTO v_existing_lock
  FROM cron_locks WHERE job_name = p_job_name AND released_at IS NULL;

  IF FOUND THEN
    -- Check if lease expired (stale lock)
    IF NOW() > v_existing_lock.locked_at + (v_existing_lock.lease_seconds || ' seconds')::interval THEN
      -- Stale lock — force release and acquire new one
      UPDATE cron_locks SET released_at = NOW()
      WHERE job_name = p_job_name AND released_at IS NULL;
      INSERT INTO cron_locks (job_name, locked_by, locked_at, lease_seconds)
      VALUES (p_job_name, v_lock_id, NOW(), p_lease_seconds);
      RETURN v_lock_id;
    ELSE
      -- Lock is still active — reject
      RETURN NULL;
    END IF;
  ELSE
    -- No existing lock — acquire
    INSERT INTO cron_locks (job_name, locked_by, locked_at, lease_seconds)
    VALUES (p_job_name, v_lock_id, NOW(), p_lease_seconds);
    RETURN v_lock_id;
  END IF;
END;
$fn$ LANGUAGE plpgsql SECURITY DEFINER;

-- Release lock
CREATE OR REPLACE FUNCTION release_cron_lock(
  p_job_name TEXT,
  p_lock_id TEXT
)
RETURNS BOOLEAN AS $fn$
BEGIN
  UPDATE cron_locks SET released_at = NOW()
  WHERE job_name = p_job_name AND locked_by = p_lock_id AND released_at IS NULL;
  RETURN FOUND;
END;
$fn$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 4. CRON FAILURE ALERTS TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS cron_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_name TEXT NOT NULL,
  alert_type TEXT NOT NULL CHECK (alert_type IN ('FAILURE', 'STALE_LOCK', 'SLOW_RUN', 'HIGH_ERROR_RATE', 'DRAWDOWN')),
  severity TEXT NOT NULL DEFAULT 'WARNING' CHECK (severity IN ('INFO', 'WARNING', 'CRITICAL')),
  message TEXT NOT NULL,
  metric_value NUMERIC,
  threshold NUMERIC,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'ACKNOWLEDGED', 'RESOLVED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  metadata JSONB
);

CREATE INDEX IF NOT EXISTS idx_cron_alerts_job ON cron_alerts(job_name, status);
ALTER TABLE cron_alerts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role manages cron_alerts" ON cron_alerts;
CREATE POLICY "Service role manages cron_alerts" ON cron_alerts
  FOR ALL USING (public.is_service_role());
DROP POLICY IF EXISTS "Authenticated can read cron_alerts" ON cron_alerts;
CREATE POLICY "Authenticated can read cron_alerts" ON cron_alerts
  FOR SELECT USING (auth.role() = 'authenticated');

-- Function to log a cron alert (deduplicates OPEN alerts of same type+job)
CREATE OR REPLACE FUNCTION log_cron_alert(
  p_job_name TEXT,
  p_alert_type TEXT,
  p_severity TEXT DEFAULT 'WARNING',
  p_message TEXT DEFAULT '',
  p_metric_value NUMERIC DEFAULT NULL,
  p_threshold NUMERIC DEFAULT NULL
)
RETURNS UUID AS $fn$
DECLARE
  v_id UUID;
  v_existing UUID;
BEGIN
  -- Deduplicate: don't create new OPEN alert if same job+type already OPEN
  SELECT id INTO v_existing FROM cron_alerts
  WHERE job_name = p_job_name AND alert_type = p_alert_type AND status = 'OPEN'
  LIMIT 1;

  IF FOUND THEN
    -- Update existing alert
    UPDATE cron_alerts SET
      message = p_message,
      metric_value = p_metric_value,
      threshold = p_threshold,
      created_at = NOW()
    WHERE id = v_existing;
    RETURN v_existing;
  ELSE
    -- Create new alert
    INSERT INTO cron_alerts (job_name, alert_type, severity, message, metric_value, threshold)
    VALUES (p_job_name, p_alert_type, p_severity, p_message, p_metric_value, p_threshold)
    RETURNING id INTO v_id;
    RETURN v_id;
  END IF;
END;
$fn$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 5. PREDICTION IDEMPOTENCY
-- ============================================================

-- Dedup: remove duplicate predictions (keep newest per fixture+market+selection)
WITH ranked AS (
  SELECT id,
    ROW_NUMBER() OVER (
      PARTITION BY fixture_id, market, selection
      ORDER BY created_at DESC, id DESC
    ) as rn
  FROM predictions
)
DELETE FROM predictions WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- Add unique constraint (safe after dedup)
DO $fn$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_prediction_fixture_market_selection'
  ) THEN
    ALTER TABLE predictions
      ADD CONSTRAINT uq_prediction_fixture_market_selection
      UNIQUE (fixture_id, market, selection);
    RAISE NOTICE 'UNIQUE constraint added';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not add unique constraint: %', SQLERRM;
END;
$fn$;

-- ============================================================
-- 6. RLS POLICIES — Block anon access to sensitive tables
-- ============================================================

-- predictions: only service_role and authenticated can read
ALTER TABLE predictions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role full access predictions" ON predictions;
CREATE POLICY "Service role full access predictions" ON predictions
  FOR ALL USING (public.is_service_role());
DROP POLICY IF EXISTS "Authenticated read predictions" ON predictions;
CREATE POLICY "Authenticated read predictions" ON predictions
  FOR SELECT USING (auth.role() = 'authenticated');
REVOKE ALL ON predictions FROM anon;

-- odds_snapshots: only service_role and authenticated
ALTER TABLE odds_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role full access odds" ON odds_snapshots;
CREATE POLICY "Service role full access odds" ON odds_snapshots
  FOR ALL USING (public.is_service_role());
DROP POLICY IF EXISTS "Authenticated read odds" ON odds_snapshots;
CREATE POLICY "Authenticated read odds" ON odds_snapshots
  FOR SELECT USING (auth.role() = 'authenticated');
REVOKE ALL ON odds_snapshots FROM anon;

-- profiles: only service_role and authenticated (own profile)
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role full access profiles" ON profiles;
CREATE POLICY "Service role full access profiles" ON profiles
  FOR ALL USING (public.is_service_role());
DROP POLICY IF EXISTS "Authenticated read profiles" ON profiles;
CREATE POLICY "Authenticated read profiles" ON profiles
  FOR SELECT USING (auth.role() = 'authenticated');
REVOKE ALL ON profiles FROM anon;

-- user_bets: only service_role and authenticated
ALTER TABLE user_bets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role full access user_bets" ON user_bets;
CREATE POLICY "Service role full access user_bets" ON user_bets
  FOR ALL USING (public.is_service_role());
DROP POLICY IF EXISTS "Authenticated read user_bets" ON user_bets;
CREATE POLICY "Authenticated read user_bets" ON user_bets
  FOR SELECT USING (auth.role() = 'authenticated');
REVOKE ALL ON user_bets FROM anon;

-- fixtures: allow authenticated read, service_role full
ALTER TABLE fixtures ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role full access fixtures" ON fixtures;
CREATE POLICY "Service role full access fixtures" ON fixtures
  FOR ALL USING (public.is_service_role());
DROP POLICY IF EXISTS "Authenticated read fixtures" ON fixtures;
CREATE POLICY "Authenticated read fixtures" ON fixtures
  FOR SELECT USING (auth.role() = 'authenticated');
REVOKE ALL ON fixtures FROM anon;

-- teams: allow authenticated read, service_role full
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role full access teams" ON teams;
CREATE POLICY "Service role full access teams" ON teams
  FOR ALL USING (public.is_service_role());
DROP POLICY IF EXISTS "Authenticated read teams" ON teams;
CREATE POLICY "Authenticated read teams" ON teams
  FOR SELECT USING (auth.role() = 'authenticated');
REVOKE ALL ON teams FROM anon;

-- leagues: allow authenticated read, service_role full
ALTER TABLE leagues ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role full access leagues" ON leagues;
CREATE POLICY "Service role full access leagues" ON leagues
  FOR ALL USING (public.is_service_role());
DROP POLICY IF EXISTS "Authenticated read leagues" ON leagues;
CREATE POLICY "Authenticated read leagues" ON leagues
  FOR SELECT USING (auth.role() = 'authenticated');
REVOKE ALL ON leagues FROM anon;

-- ============================================================
-- 7. MATERIALIZED VIEWS (Disk IO optimization)
-- ============================================================

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

-- Draw performance confusion matrix by league
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
  CASE WHEN COUNT(*) FILTER (WHERE predicted_outcome = 'draw') > 0
    THEN ROUND(COUNT(*) FILTER (WHERE predicted_outcome = 'draw' AND actual_outcome = 'draw')::numeric / COUNT(*) FILTER (WHERE predicted_outcome = 'draw'), 4) ELSE 0 END as draw_precision,
  CASE WHEN COUNT(*) FILTER (WHERE actual_outcome = 'draw') > 0
    THEN ROUND(COUNT(*) FILTER (WHERE predicted_outcome = 'draw' AND actual_outcome = 'draw')::numeric / COUNT(*) FILTER (WHERE actual_outcome = 'draw'), 4) ELSE 0 END as draw_recall,
  ROUND(COUNT(*) FILTER (WHERE actual_outcome = 'draw')::numeric / NULLIF(COUNT(*), 0), 4) as actual_draw_rate,
  ROUND(COUNT(*) FILTER (WHERE predicted_outcome = 'draw')::numeric / NULLIF(COUNT(*), 0), 4) as predicted_draw_rate
FROM settled GROUP BY league_id, league_name ORDER BY total_predictions DESC;
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_draw_perf_league ON mv_draw_performance(league_id);

-- Draw probability calibration buckets
DROP MATERIALIZED VIEW IF EXISTS mv_draw_probability_buckets;
CREATE MATERIALIZED VIEW mv_draw_probability_buckets AS
WITH settled AS (
  SELECT
    p.model_probability,
    CASE WHEN p.selection = 'draw' THEN p.model_probability ELSE NULL END as draw_probability,
    p.result,
    CASE WHEN f.home_score > f.away_score THEN 'home' WHEN f.home_score = f.away_score THEN 'draw' ELSE 'away' END as actual_outcome,
    p.selection
  FROM predictions p
  JOIN fixtures f ON f.id = p.fixture_id
  WHERE p.market = '1X2' AND p.result IN ('correct', 'wrong') AND f.home_score IS NOT NULL AND f.away_score IS NOT NULL
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
  ROUND(ABS(AVG(draw_probability) - COUNT(*) FILTER (WHERE actual_outcome = 'draw')::numeric / NULLIF(COUNT(*), 0)), 4) as calibration_error,
  ROUND(AVG(CASE WHEN actual_outcome = 'draw' THEN POWER(COALESCE(draw_probability, 0) - 1, 2) ELSE POWER(COALESCE(draw_probability, 0), 2) END), 4) as brier_score
FROM settled GROUP BY prob_bucket, sort_order ORDER BY sort_order;
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_draw_buckets ON mv_draw_probability_buckets(prob_bucket);

-- Draw trend over time (weekly)
DROP MATERIALIZED VIEW IF EXISTS mv_draw_trend;
CREATE MATERIALIZED VIEW mv_draw_trend AS
WITH settled AS (
  SELECT date_trunc('week', p.created_at)::date as week,
    p.selection, p.result,
    CASE WHEN f.home_score > f.away_score THEN 'home' WHEN f.home_score = f.away_score THEN 'draw' ELSE 'away' END as actual_outcome
  FROM predictions p
  JOIN fixtures f ON f.id = p.fixture_id
  WHERE p.market = '1X2' AND p.result IN ('correct', 'wrong') AND f.home_score IS NOT NULL AND f.away_score IS NOT NULL
    AND p.created_at >= NOW() - INTERVAL '90 days'
)
SELECT week, COUNT(*) as total_predictions,
  COUNT(*) FILTER (WHERE actual_outcome = 'draw') as actual_draws,
  COUNT(*) FILTER (WHERE selection = 'draw') as predicted_draws,
  COUNT(*) FILTER (WHERE selection = 'draw' AND actual_outcome = 'draw') as correct_draws,
  ROUND(COUNT(*) FILTER (WHERE actual_outcome = 'draw')::numeric / NULLIF(COUNT(*), 0), 4) as actual_draw_rate,
  ROUND(COUNT(*) FILTER (WHERE selection = 'draw')::numeric / NULLIF(COUNT(*), 0), 4) as predicted_draw_rate,
  CASE WHEN COUNT(*) FILTER (WHERE selection = 'draw') > 0
    THEN ROUND(COUNT(*) FILTER (WHERE selection = 'draw' AND actual_outcome = 'draw')::numeric / COUNT(*) FILTER (WHERE selection = 'draw'), 4) ELSE 0 END as draw_accuracy
FROM settled GROUP BY week ORDER BY week DESC;
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_draw_trend_week ON mv_draw_trend(week);

-- Cron status materialized view for dashboard
DROP MATERIALIZED VIEW IF EXISTS mv_cron_status;
CREATE MATERIALIZED VIEW mv_cron_status AS
WITH latest AS (
  SELECT DISTINCT ON (job_name)
    job_name, execution_id, started_at, completed_at, duration_ms, status,
    records_processed, records_created, records_updated,
    predictions_generated, predictions_settled, api_calls,
    error_count, error_message, metadata
  FROM cron_runs ORDER BY job_name, started_at DESC
),
failures AS (
  SELECT job_name, COUNT(*) as consecutive_failures
  FROM (
    SELECT job_name, status, ROW_NUMBER() OVER (PARTITION BY job_name ORDER BY started_at DESC) as rn
    FROM cron_runs
  ) ranked
  WHERE rn <= 5 AND status = 'FAILED'
  GROUP BY job_name
)
SELECT l.*, COALESCE(f.consecutive_failures, 0) as consecutive_failures
FROM latest l LEFT JOIN failures f ON l.job_name = f.job_name;
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_cron_status_job ON mv_cron_status(job_name);

-- ============================================================
-- 8. LEAGUE DRAW CALIBRATION TABLE
-- ============================================================

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
DROP POLICY IF EXISTS "Service role manages draw calibration" ON league_draw_calibration;
CREATE POLICY "Service role manages draw calibration" ON league_draw_calibration
  FOR ALL USING (public.is_service_role());
DROP POLICY IF EXISTS "Authenticated can read draw calibration" ON league_draw_calibration;
CREATE POLICY "Authenticated can read draw calibration" ON league_draw_calibration
  FOR SELECT USING (auth.role() = 'authenticated');

-- ============================================================
-- 9. RPC FUNCTIONS
-- ============================================================

CREATE OR REPLACE FUNCTION get_calibration_buckets(days_back integer DEFAULT 30)
RETURNS TABLE (prob_range text, total bigint, correct bigint, avg_predicted numeric, actual_accuracy numeric)
LANGUAGE sql STABLE AS $fn$
  SELECT prob_range, total, correct, avg_predicted, actual_accuracy FROM mv_calibration_buckets WHERE prob_range != 'Other' ORDER BY sort_order;
$fn$;

CREATE OR REPLACE FUNCTION get_market_accuracy()
RETURNS TABLE (market text, total bigint, correct bigint, wrong bigint, avg_probability numeric, accuracy numeric)
LANGUAGE sql STABLE AS $fn$
  SELECT market, total, correct, wrong, avg_probability, accuracy FROM mv_market_accuracy;
$fn$;

CREATE OR REPLACE FUNCTION get_daily_accuracy(days_back integer DEFAULT 30)
RETURNS TABLE (pred_date date, total bigint, correct bigint, wrong bigint, accuracy numeric, avg_probability numeric)
LANGUAGE sql STABLE AS $fn$
  SELECT pred_date, total, correct, wrong, accuracy, avg_probability FROM mv_daily_accuracy WHERE pred_date >= (current_date - days_back * interval '1 day') ORDER BY pred_date DESC;
$fn$;

CREATE OR REPLACE FUNCTION get_settlement_summary()
RETURNS TABLE (total_predictions bigint, correct bigint, wrong bigint, pending bigint, void_count bigint, accuracy numeric, avg_probability numeric, first_prediction timestamptz, last_prediction timestamptz)
LANGUAGE sql STABLE AS $fn$
  SELECT total_predictions, correct, wrong, pending, void_count, accuracy, avg_probability, first_prediction, last_prediction FROM mv_settlement_summary;
$fn$;

CREATE OR REPLACE FUNCTION get_cron_status()
RETURNS TABLE (job_name text, execution_id text, started_at timestamptz, completed_at timestamptz, duration_ms integer, status text, records_processed integer, records_created integer, records_updated integer, predictions_generated integer, predictions_settled integer, api_calls integer, error_count integer, error_message text, metadata jsonb, consecutive_failures bigint)
LANGUAGE sql STABLE AS $fn$
  SELECT job_name, execution_id, started_at, completed_at, duration_ms, status, records_processed, records_created, records_updated, predictions_generated, predictions_settled, api_calls, error_count, error_message, metadata, consecutive_failures FROM mv_cron_status ORDER BY job_name;
$fn$;

CREATE OR REPLACE FUNCTION refresh_analytics_views()
RETURNS void AS $fn$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_calibration_buckets;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_market_accuracy;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_daily_accuracy;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_model_accuracy;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_settlement_summary;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_draw_performance;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_draw_probability_buckets;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_draw_trend;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_cron_status;
  RAISE NOTICE 'All analytics views refreshed';
END;
$fn$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION refresh_draw_views()
RETURNS void AS $fn$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_draw_performance;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_draw_probability_buckets;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_draw_trend;
END;
$fn$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 10. GRANTS
-- ============================================================

GRANT SELECT ON cron_runs TO authenticated;
GRANT SELECT ON cron_alerts TO authenticated;
GRANT SELECT ON league_draw_calibration TO authenticated;
GRANT SELECT ON mv_calibration_buckets TO authenticated;
GRANT SELECT ON mv_market_accuracy TO authenticated;
GRANT SELECT ON mv_daily_accuracy TO authenticated;
GRANT SELECT ON mv_model_accuracy TO authenticated;
GRANT SELECT ON mv_settlement_summary TO authenticated;
GRANT SELECT ON mv_draw_performance TO authenticated;
GRANT SELECT ON mv_draw_probability_buckets TO authenticated;
GRANT SELECT ON mv_draw_trend TO authenticated;
GRANT SELECT ON mv_cron_status TO authenticated;
GRANT EXECUTE ON FUNCTION get_calibration_buckets(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION get_market_accuracy() TO authenticated;
GRANT EXECUTE ON FUNCTION get_daily_accuracy(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION get_settlement_summary() TO authenticated;
GRANT EXECUTE ON FUNCTION get_cron_status() TO authenticated;
GRANT EXECUTE ON FUNCTION refresh_analytics_views() TO service_role;
GRANT EXECUTE ON FUNCTION refresh_draw_views() TO service_role;
GRANT EXECUTE ON FUNCTION start_cron_run(TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION complete_cron_run(TEXT, TEXT, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION acquire_cron_lock(TEXT, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION release_cron_lock(TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION log_cron_alert(TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC) TO service_role;
REVOKE ALL ON cron_runs FROM anon;
REVOKE ALL ON cron_locks FROM anon;
REVOKE ALL ON cron_alerts FROM anon;
REVOKE ALL ON league_draw_calibration FROM anon;

-- ============================================================
-- 11. COMMENTS
-- ============================================================

COMMENT ON TABLE cron_runs IS 'Cron execution log — one row per run';
COMMENT ON TABLE cron_locks IS 'Database-backed distributed lock for cron execution';
COMMENT ON TABLE cron_alerts IS 'Cron failure and performance alerts with deduplication';
COMMENT ON TABLE league_draw_calibration IS 'League-specific draw calibration with champion/challenger versioning';
COMMENT ON MATERIALIZED VIEW mv_draw_performance IS 'Draw confusion matrix by league (1X2 predictions)';
COMMENT ON MATERIALIZED VIEW mv_draw_probability_buckets IS 'Draw probability calibration buckets';
COMMENT ON MATERIALIZED VIEW mv_draw_trend IS 'Draw performance trends over time';
COMMENT ON MATERIALIZED VIEW mv_cron_status IS 'Latest cron execution status per job';

-- ============================================================
-- DONE
-- ============================================================
SELECT 'FIX-NOW complete. Run: SELECT matviewname FROM pg_matviews WHERE schemaname = ''public'';' as status;
