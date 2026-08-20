-- ODDLY Betting Intelligence Platform
-- Initial Database Schema
-- Version: 3.0
-- Date: August 19, 2026

-- Extensions
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- ============================================
-- PROFILES & AUTH
-- ============================================

create table profiles (
  id uuid primary key references auth.users(id),
  role text default 'user' check (role in ('user', 'admin')),
  display_name text,
  bankroll decimal(12,2) default 0,
  subscription_tier text default 'free' check (subscription_tier in ('free', 'premium', 'elite')),
  subscription_expires_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table profiles enable row level security;

create policy "Users see own profile" on profiles
  for select using (auth.uid() = id);

create policy "Users update own profile" on profiles
  for update using (auth.uid() = id);

create policy "Admins see all profiles" on profiles
  for all using (
    exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  );

-- ============================================
-- CORE TABLES
-- ============================================

-- Leagues
create table leagues (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  country text,
  sport text default 'football',
  is_active boolean default true,
  priority int default 0,
  created_at timestamptz default now()
);

alter table leagues enable row level security;
create policy "Anyone can view active leagues" on leagues
  for select using (is_active = true);
create policy "Admins can manage leagues" on leagues
  for all using (
    exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  );

-- Teams
create table teams (
  id uuid primary key default uuid_generate_v4(),
  canonical_name text unique not null,
  country text,
  league_id uuid references leagues(id),
  created_at timestamptz default now()
);

alter table teams enable row level security;
create policy "Anyone can view teams" on teams
  for select using (true);
create policy "Admins can manage teams" on teams
  for all using (
    exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  );

-- Team Aliases
create table team_aliases (
  canonical_name text not null,
  alias text not null unique,
  source text
);

alter table team_aliases enable row level security;
create policy "Anyone can view team aliases" on team_aliases
  for select using (true);
create policy "Admins can manage team aliases" on team_aliases
  for all using (
    exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  );

-- Fixtures
create table fixtures (
  id uuid primary key default uuid_generate_v4(),
  external_id text,
  home_team_id uuid references teams(id),
  away_team_id uuid references teams(id),
  league_id uuid references leagues(id),
  kickoff_time timestamptz not null,
  status text default 'scheduled' check (status in ('scheduled', 'live', 'halftime', 'finished', 'postponed', 'cancelled')),
  home_score int,
  away_score int,
  is_featured boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index idx_fixtures_kickoff on fixtures(kickoff_time);
create index idx_fixtures_status on fixtures(status);
create index idx_fixtures_league on fixtures(league_id);

alter table fixtures enable row level security;
create policy "Anyone can view fixtures" on fixtures
  for select using (true);
create policy "Admins can manage fixtures" on fixtures
  for all using (
    exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  );

-- ============================================
-- ODDS
-- ============================================

create table odds_snapshots (
  id uuid primary key default uuid_generate_v4(),
  fixture_id uuid references fixtures(id) not null,
  bookmaker text not null,
  market text not null,
  selection text not null,
  odds decimal(10,4) not null,
  snapshot_time timestamptz default now()
);

create index idx_odds_fixture on odds_snapshots(fixture_id, market, snapshot_time);

alter table odds_snapshots enable row level security;
create policy "Anyone can view odds" on odds_snapshots
  for select using (true);
create policy "Admins can manage odds" on odds_snapshots
  for all using (
    exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  );

-- ============================================
-- PREDICTIONS
-- ============================================

create table predictions (
  id uuid primary key default uuid_generate_v4(),
  fixture_id uuid references fixtures(id) not null,
  market text not null,
  selection text not null,
  model_probability decimal(5,4) not null,
  confidence_lower decimal(5,4),
  confidence_upper decimal(5,4),
  model_version text not null,
  training_data_cutoff date,
  features_used jsonb,
  sub_model_probabilities jsonb,
  model_disagreement decimal(5,4),
  data_quality_score int,
  data_quality_breakdown jsonb,
  result text default 'pending' check (result in ('pending', 'correct', 'wrong', 'void')),
  created_at timestamptz default now(),
  settled_at timestamptz
);

create index idx_predictions_fixture on predictions(fixture_id);
create index idx_predictions_result on predictions(result);
create index idx_predictions_market on predictions(market);

alter table predictions enable row level security;
create policy "Anyone can view predictions" on predictions
  for select using (true);
create policy "Admins can manage predictions" on predictions
  for all using (
    exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  );

-- ============================================
-- RECOMMENDATIONS
-- ============================================

create table recommendations (
  id uuid primary key default uuid_generate_v4(),
  fixture_id uuid references fixtures(id) not null,
  prediction_id uuid references predictions(id),
  market text not null,
  selection text not null,
  bookmaker_odds decimal(10,4) not null,
  raw_implied_probability decimal(5,4) not null,
  fair_implied_probability decimal(5,4),
  model_probability decimal(5,4) not null,
  edge decimal(5,4) not null,
  opportunity_score int,
  opportunity_breakdown jsonb,
  risk_tier text not null check (risk_tier in ('low', 'medium', 'high')),
  confidence_tier text not null check (confidence_tier in ('very_high', 'high', 'medium', 'low')),
  kelly_fraction decimal(6,4),
  is_recommended boolean default false,
  is_avoid boolean default false,
  explanation jsonb,
  created_at timestamptz default now()
);

create index idx_recs_edge on recommendations(edge desc);
create index idx_recs_score on recommendations(opportunity_score desc);
create index idx_recs_recommended on recommendations(is_recommended) where is_recommended = true;

alter table recommendations enable row level security;
create policy "Anyone can view recommendations" on recommendations
  for select using (true);
create policy "Admins can manage recommendations" on recommendations
  for all using (
    exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  );

-- ============================================
-- USER BETS
-- ============================================

create table user_bets (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) not null,
  recommendation_id uuid references recommendations(id),
  fixture_id uuid references fixtures(id),
  market text not null,
  selection text not null,
  bookmaker text,
  odds_at_placement decimal(10,4),
  stake decimal(12,2),
  status text default 'pending' check (status in ('pending', 'won', 'lost', 'void')),
  profit decimal(12,2),
  placed_at timestamptz default now(),
  settled_at timestamptz
);

alter table user_bets enable row level security;
create policy "Users see own bets" on user_bets
  for all using (auth.uid() = user_id);
create policy "Admins see all bets" on user_bets
  for all using (
    exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  );

-- ============================================
-- ACCUMULATORS
-- ============================================

create table accumulators (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) not null,
  name text,
  selections jsonb not null,
  combined_odds decimal(12,4),
  estimated_probability decimal(5,4),
  monte_carlo_probability decimal(5,4),
  risk_adjusted_ev decimal(8,4),
  strategy text check (strategy in ('conservative', 'balanced', 'aggressive', 'longshot')),
  stake decimal(12,2),
  status text default 'pending' check (status in ('pending', 'won', 'lost', 'partial')),
  result text,
  profit decimal(12,2),
  created_at timestamptz default now(),
  settled_at timestamptz
);

alter table accumulators enable row level security;
create policy "Users see own accumulators" on accumulators
  for all using (auth.uid() = user_id);
create policy "Admins see all accumulators" on accumulators
  for all using (
    exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  );

-- ============================================
-- ROLLOVER CHAINS
-- ============================================

create table rollover_chains (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id),
  name text,
  starting_stake decimal(12,2),
  current_balance decimal(12,2),
  banked_amount decimal(12,2) default 0,
  target_days int,
  current_day int default 0,
  odds_range_min decimal(4,2),
  odds_range_max decimal(4,2),
  min_probability decimal(5,4),
  rollover_percentage decimal(3,2) default 1.00,
  status text default 'active' check (status in ('active', 'completed', 'broken', 'paused')),
  started_at timestamptz default now(),
  ended_at timestamptz
);

alter table rollover_chains enable row level security;
create policy "Users see own chains" on rollover_chains
  for all using (auth.uid() = user_id);
create policy "Admins see all chains" on rollover_chains
  for all using (
    exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  );

-- Rollover Picks
create table rollover_picks (
  id uuid primary key default uuid_generate_v4(),
  chain_id uuid references rollover_chains(id),
  day_number int not null,
  fixture_id uuid references fixtures(id),
  prediction_id uuid references predictions(id),
  market text,
  selection text,
  odds decimal(10,4),
  model_probability decimal(5,4),
  opportunity_score int,
  stake decimal(12,2),
  potential_return decimal(12,2),
  result text default 'pending' check (result in ('pending', 'won', 'lost', 'skipped')),
  actual_return decimal(12,2),
  user_marked boolean default false,
  settled_at timestamptz
);

alter table rollover_picks enable row level security;
create policy "Users see own picks" on rollover_picks
  for all using (
    chain_id in (select id from rollover_chains where user_id = auth.uid())
  );
create policy "Admins see all picks" on rollover_picks
  for all using (
    exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  );

-- ============================================
-- MODEL PERFORMANCE
-- ============================================

create table model_performance (
  id uuid primary key default uuid_generate_v4(),
  model_version text not null,
  period_start date,
  period_end date,
  market text,
  league_id uuid,
  total_predictions int,
  correct_predictions int,
  brier_score decimal(6,4),
  calibration_data jsonb,
  roi decimal(8,4),
  created_at timestamptz default now()
);

alter table model_performance enable row level security;
create policy "Anyone can view model performance" on model_performance
  for select using (true);
create policy "Admins can manage model performance" on model_performance
  for all using (
    exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  );

-- ============================================
-- AI CACHE
-- ============================================

create table ai_cache (
  cache_key text primary key,
  response text not null,
  model_used text,
  created_at timestamptz default now()
);

alter table ai_cache enable row level security;
create policy "Anyone can view ai cache" on ai_cache
  for select using (true);
create policy "System can manage ai cache" on ai_cache
  for all using (true);

-- ============================================
-- NOTIFICATIONS
-- ============================================

create table notifications (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id),
  type text not null check (type in ('new_picks', 'rollover_pick', 'result_settled', 'chain_milestone', 'chain_broken', 'accumulator_settled', 'model_alert', 'announcement', 'drawdown_warning')),
  title text not null,
  body text not null,
  data jsonb,
  is_read boolean default false,
  created_at timestamptz default now()
);

create index idx_notifications_user on notifications(user_id, is_read, created_at desc);

alter table notifications enable row level security;
create policy "Users see own notifications" on notifications
  for all using (auth.uid() = user_id);
create policy "System can insert notifications" on notifications
  for insert with check (true);

-- ============================================
-- SCORING CONFIGURATION
-- ============================================

create table scoring_config (
  id uuid primary key default uuid_generate_v4(),
  config_key text unique not null,
  config_value jsonb not null,
  updated_by uuid references profiles(id),
  updated_at timestamptz default now()
);

alter table scoring_config enable row level security;
create policy "Anyone can view scoring config" on scoring_config
  for select using (true);
create policy "Admins can manage scoring config" on scoring_config
  for all using (
    exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  );

-- ============================================
-- ANNOUNCEMENTS
-- ============================================

create table announcements (
  id uuid primary key default uuid_generate_v4(),
  title text not null,
  body text not null,
  target text default 'all' check (target in ('all', 'free', 'premium', 'elite')),
  is_active boolean default true,
  scheduled_at timestamptz,
  expires_at timestamptz,
  created_by uuid references profiles(id),
  created_at timestamptz default now()
);

alter table announcements enable row level security;
create policy "Anyone can view active announcements" on announcements
  for select using (is_active = true);
create policy "Admins can manage announcements" on announcements
  for all using (
    exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  );

-- ============================================
-- ADMIN ACTIVITY LOG
-- ============================================

create table admin_activity_log (
  id uuid primary key default uuid_generate_v4(),
  admin_id uuid references profiles(id),
  action text not null,
  target_type text,
  target_id text,
  details jsonb,
  created_at timestamptz default now()
);

alter table admin_activity_log enable row level security;
create policy "Admins can view activity log" on admin_activity_log
  for select using (
    exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  );
create policy "Admins can insert activity log" on admin_activity_log
  for insert with check (
    exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  );

-- ============================================
-- FUNCTIONS & TRIGGERS
-- ============================================

-- Update updated_at timestamp
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- Apply to tables with updated_at
create trigger update_profiles_updated_at
  before update on profiles
  for each row
  execute function update_updated_at();

create trigger update_fixtures_updated_at
  before update on fixtures
  for each row
  execute function update_updated_at();

-- Update user credits when credit transaction occurs
create or replace function update_user_credits()
returns trigger as $$
begin
  update profiles
  set bankroll = bankroll + new.amount,
      updated_at = now()
  where id = new.user_id;
  return new;
end;
$$ language plpgsql security definer;

-- ============================================
-- SEED DATA
-- ============================================

-- Insert default scoring config
insert into scoring_config (config_key, config_value) values
  ('opportunity_score_weights', '{"model_probability": 20, "edge": 20, "market_agreement": 10, "data_quality": 15, "model_calibration": 10, "odds_stability": 8, "injury_certainty": 7, "historical_accuracy": 5, "correlation_risk": 3, "model_disagreement": 2}'),
  ('thresholds', '{"min_edge_low": 5, "min_edge_medium": 8, "min_model_probability": 65, "disagreement_cap_threshold": 25, "disagreement_score_cap": 65, "rollover_min_probability": 90, "rollover_odds_min": 2.0, "rollover_odds_max": 2.5}'),
  ('confidence_tiers', '{"very_high_min": 85, "very_high_max": 95, "high_min": 75, "high_max": 85, "medium_min": 65, "medium_max": 75}'),
  ('subscription_limits', '{"free_accumulator_legs": 10, "free_ai_questions_daily": 3, "premium_accumulator_legs": -1, "premium_ai_questions_daily": -1, "elite_accumulator_legs": -1, "elite_ai_questions_daily": -1}');

-- Insert sample leagues
insert into leagues (name, country, sport, priority) values
  ('Premier League', 'England', 'football', 1),
  ('La Liga', 'Spain', 'football', 2),
  ('Bundesliga', 'Germany', 'football', 3),
  ('Serie A', 'Italy', 'football', 4),
  ('Ligue 1', 'France', 'football', 5),
  ('Eredivisie', 'Netherlands', 'football', 6),
  ('Primeira Liga', 'Portugal', 'football', 7),
  ('NPFL', 'Nigeria', 'football', 8),
  ('Brasileirão', 'Brazil', 'football', 9),
  ('MLS', 'USA', 'football', 10);

-- ============================================
-- COMMENTS
-- ============================================

comment on table profiles is 'User profiles with role-based access and subscription tiers';
comment on table leagues is 'Football leagues and competitions';
comment on table teams is 'Football teams with canonical names';
comment on table team_aliases is 'Alternative team names for normalization';
comment on table fixtures is 'Football matches and fixtures';
comment on table odds_snapshots is 'Historical odds data from multiple bookmakers';
comment on table predictions is 'AI-generated predictions with confidence intervals';
comment on table recommendations is 'Value bet recommendations with opportunity scores';
comment on table user_bets is 'User-tracked external bets';
comment on table accumulators is 'User-built accumulator slips';
comment on table rollover_chains is 'Rollover challenge chains';
comment on table rollover_picks is 'Daily picks for rollover chains';
comment on table model_performance is 'Model accuracy and calibration metrics';
comment on table ai_cache is 'Cached AI responses to reduce API calls';
comment on table notifications is 'User notifications and alerts';
comment on table scoring_config is 'Configurable scoring weights and thresholds';
comment on table announcements is 'Admin announcements and broadcasts';
comment on table admin_activity_log is 'Admin action audit trail';
