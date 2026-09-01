-- ============================================
-- PREDICTION FEATURE SNAPSHOTS
-- Date: August 26, 2026
--
-- Adds columns to predictions so every prediction is permanently
-- traceable: what features were used, what the ensemble thought,
-- what odds were available, and what context existed at prediction time.
--
-- This makes predictions auditable, reproducible, and debuggable.
-- ============================================

-- ── Feature snapshot: exact input features used for this prediction ──
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS feature_snapshot JSONB;

-- ── Ensemble outputs: sub-model probabilities and cross-model signals ──
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS ensemble_outputs JSONB;

-- ── Market odds at prediction time: what odds were available ──
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS market_odds_snapshot JSONB;

-- ── Fixture context: match metadata at prediction time ──
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS fixture_snapshot JSONB;

-- ── Prediction metadata: timing, environment, data freshness ──
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS prediction_context JSONB;

-- Index for querying by model version + feature quality
CREATE INDEX IF NOT EXISTS idx_predictions_model_version ON predictions(model_version);
CREATE INDEX IF NOT EXISTS idx_predictions_feature_snapshot ON predictions USING gin(feature_snapshot);
CREATE INDEX IF NOT EXISTS idx_predictions_ensemble_outputs ON predictions USING gin(ensemble_outputs);

-- Comment the new columns
COMMENT ON COLUMN predictions.feature_snapshot IS 'Exact input features used: Elo, form, xG, weather, referee, odds, etc.';
COMMENT ON COLUMN predictions.ensemble_outputs IS 'Sub-model outputs: 1X2 model, Goals model, BTTS model, DC model, cross-model signals';
COMMENT ON COLUMN predictions.market_odds_snapshot IS 'Bookmaker odds at prediction time for this market (home/draw/away odds)';
COMMENT ON COLUMN predictions.fixture_snapshot IS 'Fixture metadata at prediction time: kickoff, league, teams, venue';
COMMENT ON COLUMN predictions.prediction_context IS 'Prediction timing: when predicted, pipeline phase, data freshness';
