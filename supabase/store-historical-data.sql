-- ODDLY Historical Data Storage
-- Run this ONCE to create tables for storing computed data.
-- After this, the self-learning system loads from these tables instead of recomputing.

-- 1. Team Elo Ratings over time (tracks how ratings changed match-by-match)
create table if not exists elo_ratings (
  id uuid primary key default uuid_generate_v4(),
  team_id uuid references teams(id) not null,
  rating decimal(10,2) not null default 1500,
  match_date date not null,
  fixture_id uuid references fixtures(id),
  opponent_name text,
  result text, -- W, D, L
  created_at timestamptz default now(),
  unique(team_id, match_date, fixture_id)
);

-- 2. Computed features per match (stored once, loaded instantly)
create table if not exists match_features (
  id uuid primary key default uuid_generate_v4(),
  fixture_id uuid references fixtures(id) not null unique,

  -- Team identifiers
  home_team_name text not null,
  away_team_name text not null,

  -- Elo features
  home_elo decimal(10,2),
  away_elo decimal(10,2),
  elo_diff decimal(10,2),
  elo_home_prob decimal(5,4),

  -- Form features (computed BEFORE the match was played)
  home_form_ppg decimal(4,3),
  away_form_ppg decimal(4,3),
  home_win_rate decimal(4,3),
  away_win_rate decimal(4,3),
  home_avg_goals decimal(4,3),
  home_avg_conceded decimal(4,3),
  away_avg_goals decimal(4,3),
  away_avg_conceded decimal(4,3),
  home_streak int default 0,
  away_streak int default 0,

  -- Advanced features
  goal_diff decimal(4,3), -- home scoring advantage
  home_clean_sheet_pct decimal(4,3),
  home_btts_pct decimal(4,3),
  fatigue_days int,

  -- Market features
  home_odds decimal(10,4),
  draw_odds decimal(10,4),
  away_odds decimal(10,4),
  market_home_prob decimal(5,4),

  -- Actual result (for backtesting)
  home_score int,
  away_score int,
  actual_result text, -- home, away, draw

  -- Prediction (what the model predicted)
  predicted_side text,
  predicted_prob decimal(5,4),
  prediction_correct boolean,

  -- Patterns that were active
  patterns text[], -- array of pattern names

  computed_at timestamptz default now()
);

-- 3. Model performance tracking (stores accuracy over time)
create table if not exists model_performance (
  id uuid primary key default uuid_generate_v4(),
  run_date date not null,
  model_name text not null default 'ensemble',

  -- Accuracy metrics
  total_predictions int default 0,
  correct_predictions int default 0,
  accuracy decimal(5,4),

  -- By tier
  elite_total int default 0,
  elite_correct int default 0,
  elite_accuracy decimal(5,4),
  high_total int default 0,
  high_correct int default 0,
  high_accuracy decimal(5,4),

  -- Pattern reliability (JSON)
  pattern_stats jsonb,

  -- Model weights at time of evaluation
  model_weights jsonb,

  -- Metadata
  total_matches_in_db int,
  evaluation_period text, -- e.g., "2023-2026"

  created_at timestamptz default now(),
  unique(run_date, model_name)
);

-- 4. Prediction history (every prediction ever made)
create table if not exists prediction_history (
  id uuid primary key default uuid_generate_v4(),
  fixture_id uuid references fixtures(id) not null,

  -- What we predicted
  predicted_side text not null,
  predicted_prob decimal(5,4) not null,
  confidence_tier text not null, -- ELITE, HIGH, MEDIUM, LOW

  -- What happened
  actual_result text,
  correct boolean,

  -- Features at time of prediction (JSON snapshot)
  features_snapshot jsonb,

  -- Patterns active
  patterns text[],

  -- Model version
  model_version text default 'v2.0',
  model_weights jsonb,

  predicted_at timestamptz default now(),
  checked_at timestamptz,

  unique(fixture_id, predicted_side)
);

-- Indexes for fast queries
create index if not exists idx_elo_ratings_team_date on elo_ratings(team_id, match_date);
create index if not exists idx_match_features_fixture on match_features(fixture_id);
create index if not exists idx_match_features_correct on match_features(prediction_correct);
create index if not exists idx_model_performance_date on model_performance(run_date);
create index if not exists idx_prediction_history_tier on prediction_history(confidence_tier);
create index if not exists idx_prediction_history_correct on prediction_history(correct);

-- RLS policies
alter table elo_ratings enable row level security;
alter table match_features enable row level security;
alter table model_performance enable row level security;
alter table prediction_history enable row level security;

-- Service role can do everything
create policy "Service role full access elo" on elo_ratings for all using (true) with check (true);
create policy "Service role full access features" on match_features for all using (true) with check (true);
create policy "Service role full access perf" on model_performance for all using (true) with check (true);
create policy "Service role full access predhist" on prediction_history for all using (true) with check (true);

-- Anon can read (for dashboard display)
create policy "Anon read elo" on elo_ratings for select using (true);
create policy "Anon read features" on match_features for select using (true);
create policy "Anon read perf" on model_performance for select using (true);
create policy "Anon read predhist" on prediction_history for select using (true);

-- Verification
select 'Tables created successfully!' as status,
  (select count(*) from fixtures where status = 'finished') as finished_fixtures,
  (select count(*) from teams) as teams,
  (select count(*) from leagues) as leagues;
