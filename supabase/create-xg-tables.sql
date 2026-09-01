-- Create xg_features table for storing expected goals data
-- Run this in Supabase SQL Editor before running collect-xg.js

CREATE TABLE IF NOT EXISTS xg_features (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  team_name TEXT NOT NULL,
  xg_for NUMERIC(5,3) DEFAULT 0,
  xg_against NUMERIC(5,3) DEFAULT 0,
  xg_diff NUMERIC(5,3) DEFAULT 0,
  shots_total INTEGER DEFAULT 0,
  shots_on_target INTEGER DEFAULT 0,
  deep_completions INTEGER DEFAULT 0,
  ppda NUMERIC(5,2) DEFAULT 0,
  possession_pct NUMERIC(5,2) DEFAULT 50,
  league TEXT,
  season TEXT,
  match_date DATE,
  source TEXT DEFAULT 'estimated',
  fetched_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS
ALTER TABLE xg_features ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role manages xg_features" ON xg_features;
CREATE POLICY "Service role manages xg_features" ON xg_features FOR ALL USING (public.is_service_role());
DROP POLICY IF EXISTS "Authenticated read xg_features" ON xg_features;
CREATE POLICY "Authenticated read xg_features" ON xg_features FOR SELECT USING (auth.role() = 'authenticated');
REVOKE ALL ON xg_features FROM anon;

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_xg_team_date ON xg_features (team_name, match_date);
CREATE INDEX IF NOT EXISTS idx_xg_league ON xg_features (league, season);
CREATE INDEX IF NOT EXISTS idx_xg_source ON xg_features (source);

SELECT 'xg_features table created' as status;
