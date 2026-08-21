-- Create elo_ratings and prediction_history tables
-- Run this in Supabase SQL Editor

create table if not exists elo_ratings (
  id uuid primary key default uuid_generate_v4(),
  team_id uuid references teams(id) not null,
  rating decimal(10,2) not null default 1500,
  match_date date not null,
  fixture_id uuid references fixtures(id),
  opponent_name text,
  result text,
  created_at timestamptz default now(),
  unique(team_id, match_date, fixture_id)
);

create table if not exists prediction_history (
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
  unique(fixture_id, predicted_side)
);

-- Indexes
create index if not exists idx_elo_ratings_team_date on elo_ratings(team_id, match_date);
create index if not exists idx_prediction_history_tier on prediction_history(confidence_tier);
create index if not exists idx_prediction_history_correct on prediction_history(correct);

-- RLS
alter table elo_ratings enable row level security;
alter table prediction_history enable row level security;

create policy "Service role full access elo" on elo_ratings for all using (true) with check (true);
create policy "Service role full access predhist" on prediction_history for all using (true) with check (true);
create policy "Anon read elo" on elo_ratings for select using (true);
create policy "Anon read predhist" on prediction_history for select using (true);

select 'Tables created!' as status;
