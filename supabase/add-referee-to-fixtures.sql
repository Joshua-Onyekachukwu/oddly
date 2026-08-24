-- Add referee columns to fixtures table
ALTER TABLE fixtures ADD COLUMN IF NOT EXISTS referee_name TEXT;
ALTER TABLE fixtures ADD COLUMN IF NOT EXISTS referee_id TEXT;

-- Create referee_profiles table for storing computed referee statistics
CREATE TABLE IF NOT EXISTS referee_profiles (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  matches_officiated INTEGER DEFAULT 0,
  
  -- Outcome tendencies
  home_win_pct NUMERIC(5,4),
  draw_pct NUMERIC(5,4),
  away_win_pct NUMERIC(5,4),
  
  -- Goal tendencies
  avg_total_goals NUMERIC(4,2),
  avg_home_goals NUMERIC(4,2),
  avg_away_goals NUMERIC(4,2),
  btts_pct NUMERIC(5,4),
  over25_pct NUMERIC(5,4),
  
  -- Card tendencies
  avg_total_cards NUMERIC(4,2),
  avg_yellow_cards NUMERIC(4,2),
  avg_red_cards NUMERIC(5,3),
  avg_home_cards NUMERIC(4,2),
  avg_away_cards NUMERIC(4,2),
  
  -- Fouls
  avg_total_fouls NUMERIC(5,1),
  
  -- Home bias (positive = favors home team)
  home_bias NUMERIC(6,4),
  
  -- Leagues this referee officiates in
  leagues JSONB DEFAULT '[]'::jsonb,
  
  -- Metadata
  last_updated TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_referee_name ON referee_profiles(name);

-- Create referee_match_history for match-level observations
CREATE TABLE IF NOT EXISTS referee_match_history (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  referee_name TEXT NOT NULL,
  fixture_id UUID REFERENCES fixtures(id),
  league_id UUID,
  match_date DATE,
  
  -- Match results
  home_goals INTEGER,
  away_goals INTEGER,
  ft_result TEXT, -- H/D/A
  
  -- Card data
  home_yellow INTEGER DEFAULT 0,
  away_yellow INTEGER DEFAULT 0,
  home_red INTEGER DEFAULT 0,
  away_red INTEGER DEFAULT 0,
  total_cards INTEGER DEFAULT 0,
  
  -- Other stats
  home_fouls INTEGER,
  away_fouls INTEGER,
  home_shots INTEGER,
  away_shots INTEGER,
  home_corners INTEGER,
  away_corners INTEGER,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_referee_history_name ON referee_match_history(referee_name);
CREATE INDEX IF NOT EXISTS idx_referee_history_date ON referee_match_history(match_date);
CREATE INDEX IF NOT EXISTS idx_referee_history_fixture ON referee_match_history(fixture_id);
