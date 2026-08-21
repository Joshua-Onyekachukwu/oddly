-- Player tables for player-level analysis

CREATE TABLE IF NOT EXISTS players (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  statsbomb_id int UNIQUE,
  name text NOT NULL,
  nickname text,
  position text,
  position_group text,
  nationality text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS player_appearances (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  player_id uuid REFERENCES players(id),
  fixture_id uuid REFERENCES fixtures(id),
  team_id uuid,
  is_starter boolean,
  is_substitute boolean,
  substitute_in_minute int,
  substitute_out_minute int,
  minutes_played int,
  position text,
  goals int DEFAULT 0,
  assists int DEFAULT 0,
  shots int DEFAULT 0,
  shots_on_target int DEFAULT 0,
  key_passes int DEFAULT 0,
  passes_completed int DEFAULT 0,
  passes_attempted int DEFAULT 0,
  tackles int DEFAULT 0,
  interceptions int DEFAULT 0,
  blocks int DEFAULT 0,
  clearances int DEFAULT 0,
  recoveries int DEFAULT 0,
  xg decimal(5,4) DEFAULT 0,
  xa decimal(5,4) DEFAULT 0,
  progressive_passes int DEFAULT 0,
  progressive_carries int DEFAULT 0,
  yellow_cards int DEFAULT 0,
  red_cards int DEFAULT 0,
  aerial_duels_won int DEFAULT 0,
  aerial_duels_lost int DEFAULT 0,
  ground_duels_won int DEFAULT 0,
  ground_duels_lost int DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  UNIQUE(player_id, fixture_id)
);

CREATE TABLE IF NOT EXISTS player_impact (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  player_id uuid REFERENCES players(id),
  team_id uuid,
  season text DEFAULT 'all',
  matches_started int,
  team_win_rate_with decimal(5,4),
  team_win_rate_without decimal(5,4),
  team_goals_per_90_with decimal(5,4),
  team_goals_per_90_without decimal(5,4),
  team_conceded_per_90_with decimal(5,4),
  team_conceded_per_90_without decimal(5,4),
  impact_score int,
  impact_tier text,
  total_minutes int,
  starts_count int,
  calculated_at timestamptz DEFAULT now(),
  UNIQUE(player_id, team_id, season)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_pa_player ON player_appearances(player_id);
CREATE INDEX IF NOT EXISTS idx_pa_fixture ON player_appearances(fixture_id);
CREATE INDEX IF NOT EXISTS idx_pa_team ON player_appearances(team_id);
CREATE INDEX IF NOT EXISTS idx_pi_player ON player_impact(player_id);
CREATE INDEX IF NOT EXISTS idx_pi_score ON player_impact(impact_score);

-- RLS
ALTER TABLE players ENABLE ROW LEVEL SECURITY;
ALTER TABLE player_appearances ENABLE ROW LEVEL SECURITY;
ALTER TABLE player_impact ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN CREATE POLICY "svc players" ON players FOR ALL USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "svc pa" ON player_appearances FOR ALL USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "svc pi" ON player_impact FOR ALL USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "anon players" ON players FOR SELECT USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "anon pa" ON player_appearances FOR SELECT USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "anon pi" ON player_impact FOR SELECT USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

SELECT 'Player tables created!' as status;
