-- ============================================
-- ODDLY Enhanced Injury System - Complete Migration
-- Creates all tables, views, and functions
-- ============================================

-- 1. Player Availability (base table)
CREATE TABLE IF NOT EXISTS player_availability (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  player_name TEXT NOT NULL,
  player_id INTEGER,
  team_name TEXT NOT NULL,
  team_id_api INTEGER,
  status TEXT DEFAULT 'available' CHECK (status IN ('available', 'injured', 'suspended', 'doubtful', 'out')),
  reason TEXT,
  injury_type TEXT,
  expected_return DATE,
  fixture_date TIMESTAMPTZ,
  league TEXT,
  source TEXT DEFAULT 'unknown',
  is_key_player BOOLEAN DEFAULT false,
  matches_missed INTEGER DEFAULT 0,
  last_seen_date DATE,
  fetched_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(player_name, team_name)
);

-- RLS for player_availability
ALTER TABLE player_availability ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read player availability" ON player_availability FOR SELECT USING (true);
CREATE POLICY "Service write player availability" ON player_availability FOR ALL USING (auth.role() = 'service_role');

-- Indexes for player_availability
CREATE INDEX IF NOT EXISTS idx_pa_team ON player_availability(team_name);
CREATE INDEX IF NOT EXISTS idx_pa_player ON player_availability(player_name);
CREATE INDEX IF NOT EXISTS idx_pa_status ON player_availability(status);
CREATE INDEX IF NOT EXISTS idx_pa_fixture_date ON player_availability(fixture_date);
CREATE INDEX IF NOT EXISTS idx_pa_league ON player_availability(league);
CREATE INDEX IF NOT EXISTS idx_pa_updated ON player_availability(updated_at);

-- 2. Injury Snapshots (Historical records for ML validation)
CREATE TABLE IF NOT EXISTS injury_snapshots (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  snapshot_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  player_name TEXT NOT NULL,
  player_id INTEGER,
  team_name TEXT NOT NULL,
  team_id UUID,
  fixture_id UUID,
  fixture_date TIMESTAMPTZ,
  league TEXT,
  status TEXT NOT NULL CHECK (status IN ('injured', 'doubtful', 'suspended', 'out', 'questionable', 'fit', 'returned', 'unknown')),
  injury_type TEXT,
  reason TEXT,
  expected_return DATE,
  actual_return DATE,
  source TEXT NOT NULL,
  source_url TEXT,
  source_confidence NUMERIC(3,2) DEFAULT 0.8,
  publication_timestamp TIMESTAMPTZ,
  collection_timestamp TIMESTAMPTZ DEFAULT NOW(),
  last_updated TIMESTAMPTZ DEFAULT NOW(),
  is_historical BOOLEAN DEFAULT false,
  expires_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for injury_snapshots
CREATE INDEX IF NOT EXISTS idx_injury_snapshots_date ON injury_snapshots(snapshot_date);
CREATE INDEX IF NOT EXISTS idx_injury_snapshots_team ON injury_snapshots(team_name);
CREATE INDEX IF NOT EXISTS idx_injury_snapshots_fixture ON injury_snapshots(fixture_id);
CREATE INDEX IF NOT EXISTS idx_injury_snapshots_player ON injury_snapshots(player_name);
CREATE INDEX IF NOT EXISTS idx_injury_snapshots_status ON injury_snapshots(status);
CREATE INDEX IF NOT EXISTS idx_injury_snapshots_historical ON injury_snapshots(is_historical, snapshot_date);

-- RLS for injury_snapshots
ALTER TABLE injury_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read injury snapshots" ON injury_snapshots FOR SELECT USING (true);
CREATE POLICY "Service write injury snapshots" ON injury_snapshots FOR ALL USING (auth.role() = 'service_role');

-- 3. Team Injury Features (Computed features for ML)
CREATE TABLE IF NOT EXISTS team_injury_features (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  team_name TEXT NOT NULL,
  team_id UUID,
  fixture_id UUID,
  fixture_date TIMESTAMPTZ,
  snapshot_date TIMESTAMPTZ NOT NULL,
  
  -- Availability counts
  total_unavailable INTEGER DEFAULT 0,
  injured_count INTEGER DEFAULT 0,
  suspended_count INTEGER DEFAULT 0,
  doubtful_count INTEGER DEFAULT 0,
  out_count INTEGER DEFAULT 0,
  
  -- Squad impact
  availability_pct NUMERIC(5,2) DEFAULT 100.0,
  missing_starters INTEGER DEFAULT 0,
  missing_key_players INTEGER DEFAULT 0,
  missing_goalkeeper BOOLEAN DEFAULT false,
  missing_defenders INTEGER DEFAULT 0,
  missing_midfielders INTEGER DEFAULT 0,
  missing_attackers INTEGER DEFAULT 0,
  
  -- Historical impact
  missing_minutes_season INTEGER DEFAULT 0,
  missing_goals_season INTEGER DEFAULT 0,
  missing_assists_season INTEGER DEFAULT 0,
  missing_xg_season NUMERIC(5,2) DEFAULT 0,
  missing_xa_season NUMERIC(5,2) DEFAULT 0,
  
  -- Relative impact
  injury_impact_score NUMERIC(5,2) DEFAULT 0,
  key_player_impact NUMERIC(5,2) DEFAULT 0,
  
  -- Metadata
  data_freshness_hours NUMERIC(5,2),
  source_count INTEGER DEFAULT 0,
  confidence_score NUMERIC(3,2) DEFAULT 0.8,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(team_name, fixture_id, snapshot_date)
);

-- Indexes for team_injury_features
CREATE INDEX IF NOT EXISTS idx_tif_team ON team_injury_features(team_name);
CREATE INDEX IF NOT EXISTS idx_tif_fixture ON team_injury_features(fixture_id);
CREATE INDEX IF NOT EXISTS idx_tif_date ON team_injury_features(snapshot_date);

-- RLS for team_injury_features
ALTER TABLE team_injury_features ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read team injury features" ON team_injury_features FOR SELECT USING (true);
CREATE POLICY "Service write team injury features" ON team_injury_features FOR ALL USING (auth.role() = 'service_role');

-- 4. Fixture Injury Features (Combined home/away features)
CREATE TABLE IF NOT EXISTS fixture_injury_features (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  fixture_id UUID NOT NULL,
  snapshot_date TIMESTAMPTZ NOT NULL,
  
  -- Home team features
  home_unavailable INTEGER DEFAULT 0,
  home_injured INTEGER DEFAULT 0,
  home_suspended INTEGER DEFAULT 0,
  home_doubtful INTEGER DEFAULT 0,
  home_availability_pct NUMERIC(5,2) DEFAULT 100.0,
  home_missing_starters INTEGER DEFAULT 0,
  home_missing_key_players INTEGER DEFAULT 0,
  home_missing_goalkeeper BOOLEAN DEFAULT false,
  home_missing_defenders INTEGER DEFAULT 0,
  home_missing_midfielders INTEGER DEFAULT 0,
  home_missing_attackers INTEGER DEFAULT 0,
  home_injury_impact NUMERIC(5,2) DEFAULT 0,
  
  -- Away team features
  away_unavailable INTEGER DEFAULT 0,
  away_injured INTEGER DEFAULT 0,
  away_suspended INTEGER DEFAULT 0,
  away_doubtful INTEGER DEFAULT 0,
  away_availability_pct NUMERIC(5,2) DEFAULT 100.0,
  away_missing_starters INTEGER DEFAULT 0,
  away_missing_key_players INTEGER DEFAULT 0,
  away_missing_goalkeeper BOOLEAN DEFAULT false,
  away_missing_defenders INTEGER DEFAULT 0,
  away_missing_midfielders INTEGER DEFAULT 0,
  away_missing_attackers INTEGER DEFAULT 0,
  away_injury_impact NUMERIC(5,2) DEFAULT 0,
  
  -- Relative features
  injury_difference NUMERIC(5,2) DEFAULT 0,
  availability_difference NUMERIC(5,2) DEFAULT 0,
  key_player_absence_difference NUMERIC(5,2) DEFAULT 0,
  attacking_absence_difference NUMERIC(5,2) DEFAULT 0,
  defensive_absence_difference NUMERIC(5,2) DEFAULT 0,
  
  -- Metadata
  data_freshness_hours NUMERIC(5,2),
  confidence_score NUMERIC(3,2) DEFAULT 0.8,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(fixture_id, snapshot_date)
);

-- Indexes for fixture_injury_features
CREATE INDEX IF NOT EXISTS idx_fif_fixture ON fixture_injury_features(fixture_id);
CREATE INDEX IF NOT EXISTS idx_fif_date ON fixture_injury_features(snapshot_date);

-- RLS for fixture_injury_features
ALTER TABLE fixture_injury_features ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read fixture injury features" ON fixture_injury_features FOR SELECT USING (true);
CREATE POLICY "Service write fixture injury features" ON fixture_injury_features FOR ALL USING (auth.role() = 'service_role');

-- 5. Injury Collection Log (Monitoring and data quality)
CREATE TABLE IF NOT EXISTS injury_collection_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  source TEXT NOT NULL,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  status TEXT DEFAULT 'running' CHECK (status IN ('running', 'success', 'failed', 'partial')),
  records_found INTEGER DEFAULT 0,
  records_inserted INTEGER DEFAULT 0,
  records_updated INTEGER DEFAULT 0,
  records_rejected INTEGER DEFAULT 0,
  error_message TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for injury_collection_log
CREATE INDEX IF NOT EXISTS idx_icl_source ON injury_collection_log(source);
CREATE INDEX IF NOT EXISTS idx_icl_status ON injury_collection_log(status);
CREATE INDEX IF NOT EXISTS idx_icl_date ON injury_collection_log(created_at);

-- RLS for injury_collection_log
ALTER TABLE injury_collection_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read injury collection log" ON injury_collection_log FOR SELECT USING (true);
CREATE POLICY "Service write injury collection log" ON injury_collection_log FOR ALL USING (auth.role() = 'service_role');

-- 6. Team Injury Summary View
CREATE OR REPLACE VIEW team_injury_summary_v2 AS
SELECT
  team_name,
  COUNT(*) as total_injuries,
  COUNT(*) FILTER (WHERE status = 'injured') as injured_count,
  COUNT(*) FILTER (WHERE status = 'suspended') as suspended_count,
  COUNT(*) FILTER (WHERE status = 'doubtful') as doubtful_count,
  COUNT(*) FILTER (WHERE status = 'out') as out_count,
  COUNT(*) FILTER (WHERE injury_type ILIKE '%knee%' OR injury_type ILIKE '%ACL%' OR injury_type ILIKE '%rupture%') as impact_injuries,
  COUNT(*) FILTER (WHERE injury_type ILIKE '%muscle%' OR injury_type ILIKE '%hamstring%') as muscle_injuries,
  COUNT(*) FILTER (WHERE injury_type ILIKE '%groin%' OR injury_type ILIKE '%hip%') as groin_injuries,
  COUNT(*) FILTER (WHERE injury_type ILIKE '%ankle%' OR injury_type ILIKE '%foot%') as ankle_injuries,
  MAX(updated_at) as last_updated,
  (
    COUNT(*) FILTER (WHERE injury_type ILIKE '%knee%' OR injury_type ILIKE '%ACL%' OR injury_type ILIKE '%rupture%') * 3.0 +
    COUNT(*) FILTER (WHERE injury_type ILIKE '%muscle%' OR injury_type ILIKE '%hamstring%') * 2.0 +
    COUNT(*) FILTER (WHERE status = 'injured') * 1.5 +
    COUNT(*) FILTER (WHERE status = 'suspended') * 2.0 +
    COUNT(*) FILTER (WHERE status = 'doubtful') * 0.5
  ) / 25.0 as injury_impact_score
FROM player_availability
WHERE status IN ('injured', 'suspended', 'doubtful', 'out')
  AND updated_at > NOW() - INTERVAL '30 days'
GROUP BY team_name
ORDER BY injury_impact_score DESC;

-- 7. Function to validate injury data freshness
CREATE OR REPLACE FUNCTION check_injury_data_freshness()
RETURNS TABLE (
  team_name TEXT,
  last_updated TIMESTAMPTZ,
  hours_since_update NUMERIC,
  freshness_status TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    pa.team_name,
    MAX(pa.updated_at) as last_updated,
    EXTRACT(EPOCH FROM (NOW() - MAX(pa.updated_at))) / 3600 as hours_since_update,
    CASE
      WHEN MAX(pa.updated_at) > NOW() - INTERVAL '24 hours' THEN 'fresh'
      WHEN MAX(pa.updated_at) > NOW() - INTERVAL '72 hours' THEN 'stale'
      WHEN MAX(pa.updated_at) > NOW() - INTERVAL '7 days' THEN 'very_stale'
      ELSE 'missing'
    END as freshness_status
  FROM player_availability pa
  WHERE pa.status IN ('injured', 'suspended', 'doubtful', 'out')
  GROUP BY pa.team_name
  ORDER BY last_updated DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 8. Injury Dashboard Summary View
CREATE OR REPLACE VIEW injury_dashboard_summary AS
SELECT
  (SELECT COUNT(DISTINCT team_name) FROM player_availability WHERE status IN ('injured', 'suspended', 'doubtful', 'out')) as affected_teams,
  (SELECT COUNT(*) FROM player_availability WHERE status = 'injured') as total_injured,
  (SELECT COUNT(*) FROM player_availability WHERE status = 'suspended') as total_suspended,
  (SELECT COUNT(*) FROM player_availability WHERE status = 'doubtful') as total_doubtful,
  (SELECT COUNT(*) FROM player_availability WHERE status = 'out') as total_out,
  (SELECT MAX(created_at) FROM injury_collection_log WHERE status = 'success') as last_successful_collection,
  (SELECT MAX(created_at) FROM injury_collection_log WHERE status = 'failed') as last_failed_collection,
  (SELECT COUNT(*) FROM injury_snapshots WHERE snapshot_date > NOW() - INTERVAL '24 hours') as snapshots_last_24h;

-- 9. Add injury-related columns to predictions table if not exists
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='predictions' AND column_name='injury_features_used') THEN
    ALTER TABLE predictions ADD COLUMN injury_features_used JSONB;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='predictions' AND column_name='injury_snapshot_date') THEN
    ALTER TABLE predictions ADD COLUMN injury_snapshot_date TIMESTAMPTZ;
  END IF;
END $$;

-- 10. Verify
SELECT 'Enhanced injury system created successfully!' AS status;
