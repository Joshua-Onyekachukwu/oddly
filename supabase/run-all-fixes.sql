-- ============================================
-- ODDLY: Add confidence_tier to predictions
-- Run this in Supabase SQL Editor
-- ============================================

-- 1. Add confidence_tier column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'predictions' AND column_name = 'confidence_tier'
  ) THEN
    ALTER TABLE predictions ADD COLUMN confidence_tier TEXT;
    RAISE NOTICE 'Added confidence_tier column';
  ELSE
    RAISE NOTICE 'confidence_tier column already exists';
  END IF;
END $$;

-- 2. Backfill confidence tiers based on model_probability
UPDATE predictions SET confidence_tier = CASE
  WHEN model_probability >= 0.70 THEN 'ELITE'
  WHEN model_probability >= 0.60 THEN 'HIGH'
  WHEN model_probability >= 0.50 THEN 'MEDIUM'
  ELSE 'LOW'
END
WHERE confidence_tier IS NULL;

-- 3. Add index for fast filtering
CREATE INDEX IF NOT EXISTS idx_predictions_confidence_tier ON predictions(confidence_tier);

-- 4. Add unique constraint on external_id if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'fixtures_external_id_unique'
  ) THEN
    -- Remove duplicates first
    DELETE FROM fixtures WHERE id NOT IN (
      SELECT MIN(id) FROM fixtures WHERE external_id IS NOT NULL GROUP BY external_id
    );
    ALTER TABLE fixtures ADD CONSTRAINT fixtures_external_id_unique UNIQUE (external_id);
    RAISE NOTICE 'Added external_id unique constraint';
  ELSE
    RAISE NOTICE 'external_id constraint already exists';
  END IF;
END $$;

-- 5. Verify
SELECT 
  confidence_tier,
  COUNT(*) as count,
  ROUND(AVG(model_probability) * 100, 1) as avg_probability
FROM predictions 
GROUP BY confidence_tier 
ORDER BY avg_probability DESC;
