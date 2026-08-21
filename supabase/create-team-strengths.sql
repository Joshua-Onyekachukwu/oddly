-- Create team_strengths table for storing xG and team quality features
-- Run this in Supabase SQL Editor before running collect-statsbomb-xg.js

CREATE TABLE IF NOT EXISTS team_strengths (
  team_id UUID PRIMARY KEY REFERENCES teams(id) ON DELETE CASCADE,
  elo_rating NUMERIC DEFAULT 1500,
  form_score NUMERIC DEFAULT 0.5,
  attack_strength NUMERIC DEFAULT 1.0,
  defense_strength NUMERIC DEFAULT 1.0,
  home_advantage NUMERIC DEFAULT 1.1,
  xg_features JSONB DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS but allow all authenticated + service role access
ALTER TABLE team_strengths ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access" ON team_strengths
  FOR ALL
  USING (true)
  WITH CHECK (true);
