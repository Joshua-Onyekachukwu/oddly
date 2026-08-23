-- Player Availability Table
-- Stores injury, suspension, and availability data for players
-- Used as a predictive feature in the 1X2 model

CREATE TABLE IF NOT EXISTS player_availability (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  player_name TEXT NOT NULL,
  player_id INTEGER,
  team_name TEXT NOT NULL,
  team_id_api INTEGER,
  status TEXT DEFAULT 'available' CHECK (status IN ('available', 'injured', 'suspended', 'doubtful', 'uspended')),
  reason TEXT,
  injury_type TEXT,
  fixture_date TIMESTAMPTZ,
  league TEXT,
  source TEXT DEFAULT 'unknown',
  fetched_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE player_availability ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Allow read access" ON player_availability
  FOR SELECT USING (true);

CREATE POLICY "Allow service write" ON player_availability
  FOR ALL USING (auth.role() = 'service_role');

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_pa_team ON player_availability(team_name);
CREATE INDEX IF NOT EXISTS idx_pa_player ON player_availability(player_name);
CREATE INDEX IF NOT EXISTS idx_pa_status ON player_availability(status);
CREATE INDEX IF NOT EXISTS idx_pa_fixture_date ON player_availability(fixture_date);
CREATE INDEX IF NOT EXISTS idx_pa_league ON player_availability(league);

-- Team Injury Impact View (pre-computed aggregates)
CREATE OR REPLACE VIEW team_injury_summary AS
SELECT
  team_name,
  COUNT(*) as total_injuries,
  COUNT(*) FILTER (WHERE status = 'injured') as injured_count,
  COUNT(*) FILTER (WHERE status = 'suspended') as suspended_count,
  COUNT(*) FILTER (WHERE reason ILIKE '%knee%' OR reason ILIKE '%ACL%' OR reason ILIKE '%rupture%') as impact_injuries,
  COUNT(*) FILTER (WHERE reason ILIKE '%muscle%' OR reason ILIKE '%hamstring%') as muscle_injuries,
  -- Weighted impact score
  (
    COUNT(*) FILTER (WHERE reason ILIKE '%knee%' OR reason ILIKE '%ACL%' OR reason ILIKE '%rupture%') * 3.0 +
    COUNT(*) FILTER (WHERE reason ILIKE '%muscle%' OR reason ILIKE '%hamstring%') * 2.0 +
    COUNT(*) * 1.0
  ) / 25.0 as injury_impact_score,
  -- Win probability shift (negative = worse)
  -(
    COUNT(*) FILTER (WHERE reason ILIKE '%knee%' OR reason ILIKE '%ACL%' OR reason ILIKE '%rupture%') * 3.0 +
    COUNT(*) FILTER (WHERE reason ILIKE '%muscle%' OR reason ILIKE '%hamstring%') * 2.0 +
    COUNT(*) * 1.0
  ) / 25.0 * 0.05 as win_probability_shift
FROM player_availability
WHERE status IN ('injured', 'suspended')
GROUP BY team_name
ORDER BY injury_impact_score DESC;
