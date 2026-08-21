-- Add missing columns to match_features
-- Run this in Supabase SQL Editor

-- Add columns that may be missing
ALTER TABLE match_features ADD COLUMN IF NOT EXISTS away_avg_goals decimal(4,3);
ALTER TABLE match_features ADD COLUMN IF NOT EXISTS away_avg_conceded decimal(4,3);
ALTER TABLE match_features ADD COLUMN IF NOT EXISTS home_streak int default 0;
ALTER TABLE match_features ADD COLUMN IF NOT EXISTS away_streak int default 0;
ALTER TABLE match_features ADD COLUMN IF NOT EXISTS home_clean_sheet_pct decimal(4,3);
ALTER TABLE match_features ADD COLUMN IF NOT EXISTS home_btts_pct decimal(4,3);
ALTER TABLE match_features ADD COLUMN IF NOT EXISTS fatigue_days int;
ALTER TABLE match_features ADD COLUMN IF NOT EXISTS market_home_prob decimal(5,4);
ALTER TABLE match_features ADD COLUMN IF NOT EXISTS predicted_side text;
ALTER TABLE match_features ADD COLUMN IF NOT EXISTS predicted_prob decimal(5,4);
ALTER TABLE match_features ADD COLUMN IF NOT EXISTS prediction_correct boolean;
ALTER TABLE match_features ADD COLUMN IF NOT EXISTS patterns text[];
ALTER TABLE match_features ADD COLUMN IF NOT EXISTS computed_at timestamptz default now();

-- Create elo_ratings table
CREATE TABLE IF NOT EXISTS elo_ratings (
  id uuid primary key default uuid_generate_v4(),
  team_id uuid references teams(id) not null,
  rating decimal(10,2) not null default 1500,
  match_date date not null,
  fixture_id uuid references fixtures(id),
  opponent_name text,
  result text,
  created_at timestamptz default now(),
  UNIQUE(team_id, match_date, fixture_id)
);

-- Create prediction_history table
CREATE TABLE IF NOT EXISTS prediction_history (
  id uuid primary key default uuid_generate_v4(),
  fixture_id uuid references fixtures(id) not null,
  predicted_side text not null,
  predicted_prob decimal(5,4) not null,
  confidence_tier text not null,
  actual_result text,
  correct boolean,
  features_snapshot jsonb,
  patterns text[],
  model_version text default 'v3.0',
  model_weights jsonb,
  predicted_at timestamptz default now(),
  checked_at timestamptz,
  UNIQUE(fixture_id, predicted_side)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_elo_team_date ON elo_ratings(team_id, match_date);
CREATE INDEX IF NOT EXISTS idx_predhist_tier ON prediction_history(confidence_tier);
CREATE INDEX IF NOT EXISTS idx_predhist_correct ON prediction_history(correct);
CREATE INDEX IF NOT EXISTS idx_mf_correct ON match_features(prediction_correct);

-- RLS
ALTER TABLE elo_ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE prediction_history ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "svc elo" ON elo_ratings FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE POLICY "svc predhist" ON prediction_history FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE POLICY "anon elo" ON elo_ratings FOR SELECT USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE POLICY "anon predhist" ON prediction_history FOR SELECT USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

SELECT 'All tables and columns ready!' as status;
