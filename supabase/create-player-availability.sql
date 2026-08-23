-- Player Availability Table — standalone, no dependencies
-- Creates the table, RLS policies, and indexes for injury/suspension tracking

CREATE TABLE IF NOT EXISTS player_availability (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  player_name TEXT NOT NULL,
  player_id INTEGER,
  team_name TEXT NOT NULL,
  team_id_api INTEGER,
  status TEXT DEFAULT 'available' CHECK (status IN ('available', 'injured', 'suspended', 'doubtful')),
  reason TEXT,
  injury_type TEXT,
  fixture_date TIMESTAMPTZ,
  league TEXT,
  source TEXT DEFAULT 'unknown',
  fetched_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS
ALTER TABLE player_availability ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read" ON player_availability FOR SELECT USING (true);
CREATE POLICY "Service write" ON player_availability FOR ALL USING (auth.role() = 'service_role');

-- Indexes
CREATE INDEX IF NOT EXISTS idx_pa_team ON player_availability(team_name);
CREATE INDEX IF NOT EXISTS idx_pa_player ON player_availability(player_name);
CREATE INDEX IF NOT EXISTS idx_pa_status ON player_availability(status);
CREATE INDEX IF NOT EXISTS idx_pa_fixture_date ON player_availability(fixture_date);
CREATE INDEX IF NOT EXISTS idx_pa_league ON player_availability(league);
