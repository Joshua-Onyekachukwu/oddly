-- Add unique constraint on external_id for fixtures table
-- Run in Supabase SQL Editor

-- First, remove any duplicate external_ids (keep the first one)
DELETE FROM fixtures
WHERE id NOT IN (
  SELECT MIN(id)
  FROM fixtures
  WHERE external_id IS NOT NULL
  GROUP BY external_id
);

-- Add unique constraint
ALTER TABLE fixtures ADD CONSTRAINT fixtures_external_id_unique UNIQUE (external_id);

-- Verify
SELECT 'Constraint added successfully' as result;
