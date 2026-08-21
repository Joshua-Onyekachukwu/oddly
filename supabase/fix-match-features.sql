-- ═══════════════════════════════════════════════════════════════════════════════
-- FIX: Add missing columns to match_features table
-- Run this if you get "column does not exist" errors
-- ═══════════════════════════════════════════════════════════════════════════════

-- Add all columns that might be missing
ALTER TABLE match_features ADD COLUMN IF NOT EXISTS fixture_id uuid REFERENCES fixtures(id);
ALTER TABLE match_features ADD COLUMN IF NOT EXISTS home_team_name text;
ALTER TABLE match_features ADD COLUMN IF NOT EXISTS away_team_name text;
ALTER TABLE match_features ADD COLUMN IF NOT EXISTS home_elo decimal(10,2);
ALTER TABLE match_features ADD COLUMN IF NOT EXISTS away_elo decimal(10,2);
ALTER TABLE match_features ADD COLUMN IF NOT EXISTS elo_diff decimal(10,2);
ALTER TABLE match_features ADD COLUMN IF NOT EXISTS elo_home_prob decimal(5,4);
ALTER TABLE match_features ADD COLUMN IF NOT EXISTS home_form_ppg decimal(4,3);
ALTER TABLE match_features ADD COLUMN IF NOT EXISTS away_form_ppg decimal(4,3);
ALTER TABLE match_features ADD COLUMN IF NOT EXISTS home_win_rate decimal(4,3);
ALTER TABLE match_features ADD COLUMN IF NOT EXISTS away_win_rate decimal(4,3);
ALTER TABLE match_features ADD COLUMN IF NOT EXISTS home_avg_goals decimal(4,3);
ALTER TABLE match_features ADD COLUMN IF NOT EXISTS home_avg_conceded decimal(4,3);
ALTER TABLE match_features ADD COLUMN IF NOT EXISTS away_avg_goals decimal(4,3);
ALTER TABLE match_features ADD COLUMN IF NOT EXISTS away_avg_conceded decimal(4,3);
ALTER TABLE match_features ADD COLUMN IF NOT EXISTS home_streak int default 0;
ALTER TABLE match_features ADD COLUMN IF NOT EXISTS away_streak int default 0;
ALTER TABLE match_features ADD COLUMN IF NOT EXISTS goal_diff decimal(4,3);
ALTER TABLE match_features ADD COLUMN IF NOT EXISTS home_clean_sheet_pct decimal(4,3);
ALTER TABLE match_features ADD COLUMN IF NOT EXISTS home_btts_pct decimal(4,3);
ALTER TABLE match_features ADD COLUMN IF NOT EXISTS fatigue_days int;
ALTER TABLE match_features ADD COLUMN IF NOT EXISTS home_odds decimal(10,4);
ALTER TABLE match_features ADD COLUMN IF NOT EXISTS draw_odds decimal(10,4);
ALTER TABLE match_features ADD COLUMN IF NOT EXISTS away_odds decimal(10,4);
ALTER TABLE match_features ADD COLUMN IF NOT EXISTS market_home_prob decimal(5,4);
ALTER TABLE match_features ADD COLUMN IF NOT EXISTS home_score int;
ALTER TABLE match_features ADD COLUMN IF NOT EXISTS away_score int;
ALTER TABLE match_features ADD COLUMN IF NOT EXISTS actual_result text;
ALTER TABLE match_features ADD COLUMN IF NOT EXISTS predicted_side text;
ALTER TABLE match_features ADD COLUMN IF NOT EXISTS predicted_prob decimal(5,4);
ALTER TABLE match_features ADD COLUMN IF NOT EXISTS prediction_correct boolean;
ALTER TABLE match_features ADD COLUMN IF NOT EXISTS patterns text[];
ALTER TABLE match_features ADD COLUMN IF NOT EXISTS computed_at timestamptz default now();

-- Add unique constraint on fixture_id if not exists
DO $$ BEGIN
  ALTER TABLE match_features ADD CONSTRAINT match_features_fixture_id_key UNIQUE (fixture_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Add index
CREATE INDEX IF NOT EXISTS idx_mf_fixture ON match_features(fixture_id);
CREATE INDEX IF NOT EXISTS idx_mf_correct ON match_features(prediction_correct);

-- Verification
SELECT 'match_features columns fixed!' as status,
  (SELECT count(*) FROM match_features) as existing_rows;
