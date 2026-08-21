-- This SQL seeds the historical matches table with real fixture data
-- Run this AFTER you have fixtures in the database from sync:fixtures

-- First, check how many fixtures we have
SELECT count(*) as total_fixtures, 
       count(CASE WHEN status = 'finished' THEN 1 END) as finished,
       count(CASE WHEN status = 'scheduled' THEN 1 END) as scheduled
FROM fixtures;

-- Check odds coverage
SELECT count(*) as total_odds, 
       count(DISTINCT fixture_id) as fixtures_with_odds
FROM odds_snapshots;
