-- ============================================
-- DEDUP PREDICTIONS
-- Run this BEFORE adding the unique constraint.
-- Safe to run multiple times.
--
-- Strategy: Keep the NEWEST prediction per
-- (fixture_id, market, selection), remove older duplicates.
-- ============================================

-- Step 1: Count duplicates
DO $fn$
DECLARE
  v_total INTEGER;
  v_duplicates INTEGER;
BEGIN
  SELECT count(*) INTO v_total FROM predictions;
  SELECT count(*) INTO v_duplicates FROM (
    SELECT fixture_id, market, selection
    FROM predictions
    GROUP BY fixture_id, market, selection
    HAVING count(*) > 1
  ) dups;

  RAISE NOTICE 'Total predictions: %', v_total;
  RAISE NOTICE 'Duplicate groups: %', v_duplicates;
END;
$fn$;

-- Step 2: Remove duplicates (keep newest per group)
-- This uses a CTE to identify which rows to keep (the newest one)
-- and deletes all others.
WITH ranked AS (
  SELECT id,
    ROW_NUMBER() OVER (
      PARTITION BY fixture_id, market, selection
      ORDER BY created_at DESC, id DESC
    ) as rn
  FROM predictions
)
DELETE FROM predictions
WHERE id IN (
  SELECT id FROM ranked WHERE rn > 1
);

-- Step 3: Verify no duplicates remain
DO $fn$
DECLARE
  v_remaining INTEGER;
BEGIN
  SELECT count(*) INTO v_remaining FROM (
    SELECT fixture_id, market, selection
    FROM predictions
    GROUP BY fixture_id, market, selection
    HAVING count(*) > 1
  ) dups;

  IF v_remaining > 0 THEN
    RAISE WARNING 'Still % duplicate groups remaining!', v_remaining;
  ELSE
    RAISE NOTICE 'All duplicates removed. Safe to add UNIQUE constraint.';
  END IF;
END;
$fn$;

-- Step 4: Add unique constraint (if not already present)
DO $fn$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_prediction_fixture_market_selection'
  ) THEN
    ALTER TABLE predictions
      ADD CONSTRAINT uq_prediction_fixture_market_selection
      UNIQUE (fixture_id, market, selection);
    RAISE NOTICE 'UNIQUE constraint added.';
  ELSE
    RAISE NOTICE 'UNIQUE constraint already exists.';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not add constraint: %', SQLERRM;
END;
$fn$;

-- Step 5: Report final state
SELECT
  (SELECT count(*) FROM predictions) as total_predictions,
  (SELECT count(*) FROM (
    SELECT fixture_id, market, selection
    FROM predictions
    GROUP BY fixture_id, market, selection
    HAVING count(*) > 1
  ) dups) as remaining_duplicates;
