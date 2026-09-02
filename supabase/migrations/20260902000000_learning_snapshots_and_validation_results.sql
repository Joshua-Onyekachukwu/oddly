-- ============================================
-- LEARNING SNAPSHOTS & VALIDATION RESULTS
-- Date: September 2, 2026
--
-- Tables used by:
-- - learn cron: learning_snapshots (performance snapshots)
-- - validate cron: validation_results (walk-forward validation)
-- ============================================

-- 1. learning_snapshots — periodic model performance snapshots from the learn cron
CREATE TABLE IF NOT EXISTS learning_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_type TEXT NOT NULL DEFAULT 'daily',
  metrics JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_learning_snapshots_type ON learning_snapshots(snapshot_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_learning_snapshots_created ON learning_snapshots(created_at DESC);

-- 2. validation_results — daily walk-forward validation from the validate cron
CREATE TABLE IF NOT EXISTS validation_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  validation_date DATE NOT NULL,
  model_version TEXT NOT NULL DEFAULT 'v2.0-meta-ensemble',

  -- Baseline metrics (1X2 market, all predictions)
  baseline_accuracy REAL,
  baseline_balanced_accuracy REAL,
  baseline_log_loss REAL,
  baseline_brier_score REAL,
  baseline_sample_size INTEGER,

  -- Injury-enhanced metrics (predictions with injury_features_used IS NOT NULL)
  injury_accuracy REAL,
  injury_balanced_accuracy REAL,
  injury_log_loss REAL,
  injury_brier_score REAL,
  injury_sample_size INTEGER,

  -- Improvement deltas (injury - baseline)
  improvement_accuracy REAL,
  improvement_balanced_accuracy REAL,
  improvement_log_loss REAL,
  improvement_brier_score REAL,

  -- Full metrics payload for programmatic access
  metrics_json JSONB,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One record per date per model version
  UNIQUE (validation_date, model_version)
);

CREATE INDEX IF NOT EXISTS idx_validation_results_date ON validation_results(validation_date DESC);
CREATE INDEX IF NOT EXISTS idx_validation_results_model ON validation_results(model_version, validation_date DESC);

-- 3. RLS — service_role writes, authenticated reads (for admin dashboard)
ALTER TABLE learning_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE validation_results ENABLE ROW LEVEL SECURITY;

-- learning_snapshots policies
CREATE POLICY "Service role manages learning_snapshots"
  ON learning_snapshots FOR ALL
  USING (public.is_service_role());

CREATE POLICY "Authenticated can read learning_snapshots"
  ON learning_snapshots FOR SELECT
  USING (auth.role() = 'authenticated');

-- validation_results policies
CREATE POLICY "Service role manages validation_results"
  ON validation_results FOR ALL
  USING (public.is_service_role());

CREATE POLICY "Authenticated can read validation_results"
  ON validation_results FOR SELECT
  USING (auth.role() = 'authenticated');

-- 4. Grants
GRANT SELECT ON learning_snapshots TO authenticated;
GRANT SELECT ON validation_results TO authenticated;
REVOKE ALL ON learning_snapshots FROM anon;
REVOKE ALL ON validation_results FROM anon;

COMMENT ON TABLE learning_snapshots IS 'Periodic model performance snapshots recorded by the learn cron';
COMMENT ON TABLE validation_results IS 'Daily walk-forward validation results from the validate cron';
