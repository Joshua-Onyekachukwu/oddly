-- Add confidence_tier to predictions table
-- Run in Supabase SQL Editor

ALTER TABLE predictions ADD COLUMN IF NOT EXISTS confidence_tier TEXT DEFAULT 'LOW';

-- Update existing predictions with calculated tiers
UPDATE predictions SET confidence_tier = CASE
  WHEN model_probability >= 0.70 THEN 'ELITE'
  WHEN model_probability >= 0.60 THEN 'HIGH'
  WHEN model_probability >= 0.50 THEN 'MEDIUM'
  ELSE 'LOW'
END;

-- Add index for fast filtering
CREATE INDEX IF NOT EXISTS idx_predictions_confidence_tier ON predictions(confidence_tier);
