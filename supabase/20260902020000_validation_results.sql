-- ============================================================
-- validation_results: stores daily walk-forward validation metrics
-- ============================================================

CREATE TABLE IF NOT EXISTS validation_results (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  validation_date DATE NOT NULL DEFAULT CURRENT_DATE,
  
  -- Baseline metrics
  baseline_accuracy NUMERIC(5,4),
  baseline_balanced_accuracy NUMERIC(5,4),
  baseline_log_loss NUMERIC(6,4),
  baseline_brier_score NUMERIC(6,4),
  baseline_sample_size INTEGER DEFAULT 0,
  
  -- Injury-enhanced metrics
  injury_accuracy NUMERIC(5,4),
  injury_balanced_accuracy NUMERIC(5,4),
  injury_log_loss NUMERIC(6,4),
  injury_brier_score NUMERIC(6,4),
  injury_sample_size INTEGER DEFAULT 0,
  
  -- Improvement deltas
  improvement_accuracy NUMERIC(5,4),
  improvement_balanced_accuracy NUMERIC(5,4),
  improvement_log_loss NUMERIC(6,4),
  improvement_brier_score NUMERIC(6,4),
  
  -- Full metrics JSON
  metrics_json JSONB DEFAULT '{}',
  
  -- Metadata
  model_version TEXT DEFAULT 'v2.0-meta-ensemble',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Prevent duplicate daily runs
CREATE UNIQUE INDEX IF NOT EXISTS idx_validation_results_date_model
  ON validation_results (validation_date, model_version);

-- Index for dashboard queries
CREATE INDEX IF NOT EXISTS idx_validation_results_created
  ON validation_results (created_at DESC);

-- RLS
ALTER TABLE validation_results ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Service role manages validation results" ON validation_results;
DROP POLICY IF EXISTS "Public read validation results" ON validation_results;

CREATE POLICY "Public read validation results" 
  ON validation_results FOR SELECT USING (true);
  
CREATE POLICY "Service role manages validation results" 
  ON validation_results FOR ALL USING (auth.role() = 'service_role');

-- Refresh the schema cache
SELECT 'validation_results table created successfully' AS status;
