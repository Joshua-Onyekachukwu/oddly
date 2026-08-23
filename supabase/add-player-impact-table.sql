-- Player Impact Scores Table
-- Stores computed player impact metrics per team for prediction model

CREATE TABLE IF NOT EXISTS player_impact_scores (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  team_name TEXT UNIQUE NOT NULL,
  league TEXT,
  player_count INTEGER DEFAULT 0,
  avg_rating NUMERIC(4,2) DEFAULT 6.5,
  attack_strength NUMERIC(6,3) DEFAULT 0,
  shot_accuracy NUMERIC(4,3) DEFAULT 0.4,
  key_pass_creation NUMERIC(5,2) DEFAULT 0,
  defensive_solidity NUMERIC(5,2) DEFAULT 0,
  discipline_risk NUMERIC(4,3) DEFAULT 0,
  total_goals INTEGER DEFAULT 0,
  total_assists INTEGER DEFAULT 0,
  squad_depth INTEGER DEFAULT 0,
  top_player TEXT,
  top_player_goals INTEGER DEFAULT 0,
  player_impact_score NUMERIC(6,3) DEFAULT 0,
  pis_1x2_impact NUMERIC(6,3) DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE player_impact_scores ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read
CREATE POLICY "Allow read access" ON player_impact_scores
  FOR SELECT USING (true);

-- Allow service role to write
CREATE POLICY "Allow service write" ON player_impact_scores
  FOR ALL USING (auth.role() = 'service_role');

-- Index for fast lookups by team name
CREATE INDEX IF NOT EXISTS idx_player_impact_team ON player_impact_scores(team_name);
CREATE INDEX IF NOT EXISTS idx_player_impact_score ON player_impact_scores(player_impact_score DESC);
