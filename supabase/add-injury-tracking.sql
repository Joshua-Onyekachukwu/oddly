-- Player availability table for injury/suspension tracking
-- Run this in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS player_availability (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  player_name TEXT NOT NULL,
  team_id UUID REFERENCES teams(id),
  team_name TEXT,
  status TEXT NOT NULL DEFAULT 'available',
  reason TEXT,
  injury_type TEXT,
  expected_return DATE,
  source TEXT DEFAULT 'api-football',
  last_seen_date DATE,
  matches_missed INTEGER DEFAULT 0,
  is_key_player BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(player_name, team_name)
);

CREATE INDEX IF NOT EXISTS idx_pa_team ON player_availability(team_id);
CREATE INDEX IF NOT EXISTS idx_pa_status ON player_availability(status);
CREATE INDEX IF NOT EXISTS idx_pa_player ON player_availability(player_name);

-- Add injury_impact column to team_strengths if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='team_strengths' AND column_name='injury_impact') THEN
    ALTER TABLE team_strengths ADD COLUMN injury_impact FLOAT DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='team_strengths' AND column_name='injured_count') THEN
    ALTER TABLE team_strengths ADD COLUMN injured_count INTEGER DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='team_strengths' AND column_name='suspended_count') THEN
    ALTER TABLE team_strengths ADD COLUMN suspended_count INTEGER DEFAULT 0;
  END IF;
END $$;
