-- Prediction snapshots: immutable record of model inputs at prediction time.
-- Enables leakage-free replay, calibration audits, and challenger evaluation.

ALTER TABLE predictions
  ADD COLUMN IF NOT EXISTS input_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS feature_version text,
  ADD COLUMN IF NOT EXISTS data_quality_score decimal(4,3);

COMMENT ON COLUMN predictions.input_snapshot IS
  'JSON snapshot of model inputs (Elo, form, odds, league) at prediction time';
COMMENT ON COLUMN predictions.feature_version IS
  'Feature-engineering version used for this prediction';
COMMENT ON COLUMN predictions.data_quality_score IS
  '0-1 score of input data completeness/quality at prediction time';

-- Index for evaluation queries by model version + result
CREATE INDEX IF NOT EXISTS idx_predictions_model_result
  ON predictions (model_version, result);
CREATE INDEX IF NOT EXISTS idx_predictions_fixture
  ON predictions (fixture_id);
