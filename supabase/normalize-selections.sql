-- Normalize capitalized selections in predictions table
-- Safe: only updates text selection field where it differs from lowercase version

-- Count affected rows
SELECT COUNT(*) as affected_rows
FROM predictions
WHERE selection IN ('Home', 'Away', 'Draw')
   OR selection ~ '[A-Z]';  -- Any row with uppercase letters

-- Update Home → home
UPDATE predictions SET selection = 'home' WHERE selection = 'Home';

-- Update Away → away  
UPDATE predictions SET selection = 'away' WHERE selection = 'Away';

-- Update Draw → draw
UPDATE predictions SET selection = 'draw' WHERE selection = 'Draw';

-- Verify no uppercase remains (should return 0)
SELECT COUNT(*) as remaining_uppercase
FROM predictions
WHERE selection ~ '[A-Z]';
