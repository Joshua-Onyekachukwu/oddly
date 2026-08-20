-- ============================================
-- ODDLY — COMPLETE DATABASE SETUP
-- Run this SINGLE file in Supabase SQL Editor
-- Combines: initial schema + self-training + RLS fix + performance optimization
-- ============================================

-- Extensions
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- ============================================
-- 1. TABLES
-- ============================================

-- PROFILES & AUTH
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

-- LEAGUES
create table leagues (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  country text,
  sport text default 'football',
  is_active boolean default true,
  priority int default 0,
  created_at timestamptz default now()
);

-- TEAMS
create table teams (
  id uuid primary key default uuid_generate_v4(),
  canonical_name text unique not null,
  country text,
  league_id uuid references leagues(id),
  created_at timestamptz default now()
);

-- TEAM ALIASES
create table team_aliases (
  canonical_name text not null,
  alias text not null unique,
  source text
);

-- FIXTURES
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

-- ODDS SNAPSHOTS
create table odds_snapshots (
  id uuid primary key default uuid_generate_v4(),
  fixture_id uuid references fixtures(id) not null,
  bookmaker text not null,
  market text not null,
  selection text not null,
  odds decimal(10,4) not null,
  snapshot_time timestamptz default now()
);

-- PREDICTIONS
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

-- RECOMMENDATIONS
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

-- USER BETS
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

-- ACCUMULATORS
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

-- ROLLOVER CHAINS
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

-- ROLLOVER PICKS
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

-- MODEL PERFORMANCE
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

-- AI CACHE
create table ai_cache (
  cache_key text primary key,
  response text not null,
  model_used text,
  created_at timestamptz default now()
);

-- NOTIFICATIONS
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

-- SCORING CONFIGURATION
create table scoring_config (
  id uuid primary key default uuid_generate_v4(),
  config_key text unique not null,
  config_value jsonb not null,
  updated_by uuid references profiles(id),
  updated_at timestamptz default now()
);

-- ANNOUNCEMENTS
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

-- ADMIN ACTIVITY LOG
create table admin_activity_log (
  id uuid primary key default uuid_generate_v4(),
  admin_id uuid references profiles(id),
  action text not null,
  target_type text,
  target_id text,
  details jsonb,
  created_at timestamptz default now()
);

-- TRAINING LOG (self-training engine)
create table training_log (
  id uuid primary key default uuid_generate_v4(),
  model_version text not null,
  training_date date not null,
  predictions_count int,
  correct_count int,
  accuracy decimal(5,4),
  lessons_learned jsonb,
  adjustments_made jsonb,
  feature_weights jsonb,
  market_performance jsonb,
  league_performance jsonb,
  calibration jsonb,
  notes text,
  created_at timestamptz default now()
);

-- FEATURE IMPORTANCE
create table feature_importance (
  id uuid primary key default uuid_generate_v4(),
  model_version text not null,
  market text,
  feature_name text not null,
  importance decimal(5,4),
  league_id uuid,
  odds_range text,
  sample_size int,
  updated_at timestamptz default now()
);

-- MODEL LEARNING HISTORY
create table model_learning_history (
  id uuid primary key default uuid_generate_v4(),
  model_version text not null,
  prediction_id uuid references predictions(id),
  features_snapshot jsonb not null,
  predicted_probability decimal(5,4),
  actual_outcome text,
  actual_score text,
  actual_total_goals int,
  was_correct boolean,
  error_analysis jsonb,
  created_at timestamptz default now()
);

-- ============================================
-- 2. INDEXES
-- ============================================

-- Fixtures
create index idx_fixtures_kickoff on fixtures(kickoff_time);
create index idx_fixtures_status on fixtures(status);
create index idx_fixtures_league on fixtures(league_id);
create index idx_fixtures_home_team on fixtures(home_team_id);
create index idx_fixtures_away_team on fixtures(away_team_id);
create index idx_fixtures_league_kickoff on fixtures(league_id, kickoff_time);
create index idx_fixtures_status_kickoff on fixtures(status, kickoff_time);
create index idx_fixtures_featured on fixtures(id, kickoff_time) where is_featured = true;

-- Odds
create index idx_odds_fixture on odds_snapshots(fixture_id, market, snapshot_time);
create index idx_odds_fixture_market_time on odds_snapshots(fixture_id, market, snapshot_time desc);

-- Predictions
create index idx_predictions_fixture on predictions(fixture_id);
create index idx_predictions_result on predictions(result);
create index idx_predictions_market on predictions(market);
create index idx_predictions_fixture_probability on predictions(fixture_id, model_probability desc);
create index idx_predictions_result_created on predictions(result, created_at desc);
create index idx_predictions_pending on predictions(fixture_id, created_at) where result = 'pending';

-- Recommendations
create index idx_recs_edge on recommendations(edge desc);
create index idx_recs_score on recommendations(opportunity_score desc);
create index idx_recs_recommended on recommendations(is_recommended) where is_recommended = true;
create index idx_recs_fixture_id on recommendations(fixture_id);
create index idx_recs_prediction_id on recommendations(prediction_id);
create index idx_recs_fixture_edge on recommendations(fixture_id, edge desc);

-- User Bets
create index idx_user_bets_user_id on user_bets(user_id);
create index idx_user_bets_recommendation_id on user_bets(recommendation_id);
create index idx_user_bets_fixture_id on user_bets(fixture_id);
create index idx_user_bets_user_status on user_bets(user_id, status);

-- Accumulators
create index idx_accumulators_user_id on accumulators(user_id);
create index idx_accumulators_user_status on accumulators(user_id, status);
create index idx_accumulators_active on accumulators(user_id, created_at) where status = 'pending';

-- Rollover
create index idx_rollover_chains_user_id on rollover_chains(user_id);
create index idx_rollover_chains_user_status on rollover_chains(user_id, status);
create index idx_rollover_chains_active on rollover_chains(user_id, started_at) where status = 'active';
create index idx_rollover_picks_chain_id on rollover_picks(chain_id);
create index idx_rollover_picks_fixture_id on rollover_picks(fixture_id);
create index idx_rollover_picks_prediction_id on rollover_picks(prediction_id);

-- Teams
create index idx_teams_league_id on teams(league_id);

-- Leagues
create index idx_leagues_active on leagues(id) where is_active = true;

-- Notifications
create index idx_notifications_user on notifications(user_id, is_read, created_at desc);

-- Learning History
create index idx_learning_version on model_learning_history(model_version);
create index idx_learning_correct on model_learning_history(was_correct);
create index idx_learning_created on model_learning_history(created_at);

-- ============================================
-- 3. RLS POLICIES (with security definer for admin check)
-- ============================================

-- Enable RLS on all tables
alter table profiles enable row level security;
alter table leagues enable row level security;
alter table teams enable row level security;
alter table team_aliases enable row level security;
alter table fixtures enable row level security;
alter table odds_snapshots enable row level security;
alter table predictions enable row level security;
alter table recommendations enable row level security;
alter table user_bets enable row level security;
alter table accumulators enable row level security;
alter table rollover_chains enable row level security;
alter table rollover_picks enable row level security;
alter table model_performance enable row level security;
alter table ai_cache enable row level security;
alter table notifications enable row level security;
alter table scoring_config enable row level security;
alter table announcements enable row level security;
alter table admin_activity_log enable row level security;
alter table training_log enable row level security;
alter table feature_importance enable row level security;
alter table model_learning_history enable row level security;

-- Admin check function (security definer avoids RLS recursion)
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'admin'
  );
$$;

revoke execute on function public.is_admin() from PUBLIC, anon, authenticated;

-- Profiles
create policy "Users see own profile" on profiles
  for select using ((select auth.uid()) = id);
create policy "Users update own profile" on profiles
  for update using ((select auth.uid()) = id);
create policy "Admins see all profiles" on profiles
  for all using (public.is_admin());

-- Leagues
create policy "Anyone can view active leagues" on leagues
  for select using (is_active = true);
create policy "Admins can manage leagues" on leagues
  for all using (public.is_admin());

-- Teams
create policy "Anyone can view teams" on teams
  for select using (true);
create policy "Admins can manage teams" on teams
  for all using (public.is_admin());

-- Team Aliases
create policy "Anyone can view team aliases" on team_aliases
  for select using (true);
create policy "Admins can manage team aliases" on team_aliases
  for all using (public.is_admin());

-- Fixtures
create policy "Anyone can view fixtures" on fixtures
  for select using (true);
create policy "Admins can manage fixtures" on fixtures
  for all using (public.is_admin());

-- Odds
create policy "Anyone can view odds" on odds_snapshots
  for select using (true);
create policy "Admins can manage odds" on odds_snapshots
  for all using (public.is_admin());

-- Predictions
create policy "Anyone can view predictions" on predictions
  for select using (true);
create policy "Admins can manage predictions" on predictions
  for all using (public.is_admin());

-- Recommendations
create policy "Anyone can view recommendations" on recommendations
  for select using (true);
create policy "Admins can manage recommendations" on recommendations
  for all using (public.is_admin());

-- User Bets
create policy "Users see own bets" on user_bets
  for all using ((select auth.uid()) = user_id);
create policy "Admins see all bets" on user_bets
  for all using (public.is_admin());

-- Accumulators
create policy "Users see own accumulators" on accumulators
  for all using ((select auth.uid()) = user_id);
create policy "Admins see all accumulators" on accumulators
  for all using (public.is_admin());

-- Rollover Chains
create policy "Users see own chains" on rollover_chains
  for all using ((select auth.uid()) = user_id);
create policy "Admins see all chains" on rollover_chains
  for all using (public.is_admin());

-- Rollover Picks
create policy "Users see own picks" on rollover_picks
  for all using (
    chain_id in (
      select id from rollover_chains where user_id = (select auth.uid())
    )
  );
create policy "Admins see all picks" on rollover_picks
  for all using (public.is_admin());

-- Model Performance
create policy "Anyone can view model performance" on model_performance
  for select using (true);
create policy "Admins can manage model performance" on model_performance
  for all using (public.is_admin());

-- AI Cache
create policy "Anyone can view ai cache" on ai_cache
  for select using (true);
create policy "System can manage ai cache" on ai_cache
  for all using (true);

-- Notifications
create policy "Users see own notifications" on notifications
  for all using ((select auth.uid()) = user_id);
create policy "System can insert notifications" on notifications
  for insert with check (true);

-- Scoring Config
create policy "Anyone can view scoring config" on scoring_config
  for select using (true);
create policy "Admins can manage scoring config" on scoring_config
  for all using (public.is_admin());

-- Announcements
create policy "Anyone can view active announcements" on announcements
  for select using (is_active = true);
create policy "Admins can manage announcements" on announcements
  for all using (public.is_admin());

-- Admin Activity Log
create policy "Admins can view activity log" on admin_activity_log
  for select using (public.is_admin());
create policy "Admins can insert activity log" on admin_activity_log
  for insert with check (public.is_admin());

-- Training Log
create policy "Anyone can view training log" on training_log
  for select using (true);
create policy "Admins can manage training log" on training_log
  for all using (public.is_admin());

-- Feature Importance
create policy "Anyone can view feature importance" on feature_importance
  for select using (true);
create policy "Admins can manage feature importance" on feature_importance
  for all using (public.is_admin());

-- Model Learning History
create policy "Anyone can view learning history" on model_learning_history
  for select using (true);
create policy "System can manage learning history" on model_learning_history
  for all using (true);

-- ============================================
-- 4. TRIGGERS
-- ============================================

create or replace function public.handle_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_updated_at on profiles;
create trigger set_updated_at
  before update on profiles
  for each row
  execute function public.handle_updated_at();

drop trigger if exists set_updated_at on fixtures;
create trigger set_updated_at
  before update on fixtures
  for each row
  execute function public.handle_updated_at();

-- ============================================
-- 5. DATABASE FUNCTIONS
-- ============================================

create or replace function public.get_user_bet_stats(p_user_id uuid)
returns jsonb
language sql
security definer
set search_path = ''
stable
as $$
  select jsonb_build_object(
    'total_bets', count(*),
    'won', count(*) filter (where status = 'won'),
    'lost', count(*) filter (where status = 'lost'),
    'pending', count(*) filter (where status = 'pending'),
    'total_stake', coalesce(sum(stake), 0),
    'total_profit', coalesce(sum(profit), 0),
    'roi', case
      when coalesce(sum(stake), 0) > 0
      then round((coalesce(sum(profit), 0) / sum(stake) * 100), 2)
      else 0
    end
  )
  from public.user_bets
  where user_id = p_user_id;
$$;

create or replace function public.get_today_fixtures()
returns table (
  fixture_id uuid,
  home_team_name text,
  away_team_name text,
  kickoff_time timestamptz,
  status text,
  league_name text,
  prediction_count bigint,
  best_edge decimal
)
language sql
security definer
set search_path = ''
stable
as $$
  select
    f.id,
    ht.canonical_name,
    at.canonical_name,
    f.kickoff_time,
    f.status,
    l.name,
    (select count(*) from predictions p where p.fixture_id = f.id),
    (select max(r.edge) from recommendations r where r.fixture_id = f.id)
  from fixtures f
  left join teams ht on ht.id = f.home_team_id
  left join teams at on at.id = f.away_team_id
  left join leagues l on l.id = f.league_id
  where f.kickoff_time::date = current_date
  order by f.kickoff_time;
$$;

-- ============================================
-- 6. SEED DATA
-- ============================================

-- Default scoring config
insert into scoring_config (config_key, config_value) values
  ('opportunity_score_weights', '{"model_probability": 20, "edge": 20, "market_agreement": 10, "data_quality": 15, "model_calibration": 10, "odds_stability": 8, "injury_certainty": 7, "historical_accuracy": 5, "correlation_risk": 3, "model_disagreement": 2}'),
  ('thresholds', '{"min_edge_low": 5, "min_edge_medium": 8, "min_model_probability": 65, "disagreement_cap_threshold": 25, "disagreement_score_cap": 65, "rollover_min_probability": 90, "rollover_odds_min": 2.0, "rollover_odds_max": 2.5}'),
  ('confidence_tiers', '{"very_high_min": 85, "very_high_max": 95, "high_min": 75, "high_max": 85, "medium_min": 65, "medium_max": 75}'),
  ('subscription_limits', '{"free_accumulator_legs": 10, "free_ai_questions_daily": 3, "premium_accumulator_legs": -1, "premium_ai_questions_daily": -1, "elite_accumulator_legs": -1, "elite_ai_questions_daily": -1}')
on conflict (config_key) do nothing;

-- Default leagues
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
  ('MLS', 'USA', 'football', 10),
  ('Champions League', 'Europe', 'football', 11),
  ('Europa League', 'Europe', 'football', 12)
on conflict do nothing;

-- ============================================
-- DONE — All tables, indexes, RLS, triggers, functions, and seed data created
-- ============================================
