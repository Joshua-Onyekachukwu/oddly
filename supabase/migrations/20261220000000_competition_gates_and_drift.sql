-- ============================================
-- COMPETITION GATES + MODEL DRIFT STATUS
-- Date: December 20, 2026
--
-- Strategic requirements (docs/ODDLY-STRATEGIC-ASSESSMENT.md §2, §5):
--  * per-league model performance gating (trusted / watch / exclude /
--    insufficient) so we don't force predictions where the model doesn't
--    perform — detection only, predictions are still recorded immutably.
--  * model drift detection distinguishing variance from deterioration —
--    detection + alerting only, NO automatic model changes.
--
-- NOTE: requires is_service_role() from cron infrastructure migration.
-- ============================================

-- 1. Per-league model gate verdicts (refreshed weekly by /api/v1/cron/learn)
CREATE TABLE IF NOT EXISTS league_model_gates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_key TEXT NOT NULL,               -- fixtures.league_id or 'unknown'
  league_id UUID REFERENCES leagues(id),
  league_name TEXT,
  market TEXT NOT NULL DEFAULT 'ALL',     -- 'ALL' = aggregate across markets
  model_version TEXT NOT NULL DEFAULT 'unknown',
  verdict TEXT NOT NULL CHECK (verdict IN ('trusted', 'watch', 'exclude', 'insufficient')),
  metrics JSONB NOT NULL DEFAULT '{}'::jsonb, -- accuracy, brier, calibration_gap, per_market, coverage, reasons
  sample_size INTEGER NOT NULL DEFAULT 0,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (league_key, market, model_version)
);

CREATE INDEX IF NOT EXISTS idx_league_model_gates_verdict
  ON league_model_gates(verdict);
CREATE INDEX IF NOT EXISTS idx_league_model_gates_league
  ON league_model_gates(league_key);

ALTER TABLE league_model_gates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role manages league gates" ON league_model_gates;
CREATE POLICY "Service role manages league gates" ON league_model_gates
  FOR ALL USING (public.is_service_role());
DROP POLICY IF EXISTS "Authenticated can read league gates" ON league_model_gates;
CREATE POLICY "Authenticated can read league gates" ON league_model_gates
  FOR SELECT USING (auth.role() = 'authenticated');

-- 2. Model drift status (latest per model_version + market)
CREATE TABLE IF NOT EXISTS model_drift_status (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_version TEXT NOT NULL,
  market TEXT NOT NULL,
  recent_window_start TIMESTAMPTZ NOT NULL,
  recent_window_end TIMESTAMPTZ NOT NULL,
  prior_window_start TIMESTAMPTZ NOT NULL,
  prior_window_end TIMESTAMPTZ NOT NULL,
  recent_n INTEGER NOT NULL DEFAULT 0,
  prior_n INTEGER NOT NULL DEFAULT 0,
  recent_accuracy NUMERIC(6,4),
  prior_accuracy NUMERIC(6,4),
  recent_brier NUMERIC(8,5),
  prior_brier NUMERIC(8,5),
  brier_delta NUMERIC(8,5),
  accuracy_delta NUMERIC(6,4),
  z_score DOUBLE PRECISION,
  p_value DOUBLE PRECISION,
  drift_status TEXT NOT NULL CHECK (drift_status IN ('stable', 'watch', 'drift_suspected', 'insufficient_data')),
  reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (model_version, market)
);

CREATE INDEX IF NOT EXISTS idx_model_drift_status_status
  ON model_drift_status(drift_status);

ALTER TABLE model_drift_status ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role manages model drift status" ON model_drift_status;
CREATE POLICY "Service role manages model drift status" ON model_drift_status
  FOR ALL USING (public.is_service_role());
DROP POLICY IF EXISTS "Authenticated can read model drift status" ON model_drift_status;
CREATE POLICY "Authenticated can read model drift status" ON model_drift_status
  FOR SELECT USING (auth.role() = 'authenticated');

-- 3. Extend cron_alerts alert_type CHECK to allow DRIFT alerts.
--    Detection/alerting only — no automatic model changes.
--    Guarded: cron_alerts is created by FIX-NOW.sql, not the numbered
--    migrations, so it may be absent in some environments.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'cron_alerts'
  ) THEN
    ALTER TABLE cron_alerts DROP CONSTRAINT IF EXISTS cron_alerts_alert_type_check;
    ALTER TABLE cron_alerts
      ADD CONSTRAINT cron_alerts_alert_type_check
      CHECK (alert_type IN ('FAILURE', 'STALE_LOCK', 'SLOW_RUN', 'HIGH_ERROR_RATE', 'DRAWDOWN', 'DRIFT'));
  END IF;
END $$;
