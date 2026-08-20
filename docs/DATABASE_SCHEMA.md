# Oddly Database Schema — Complete Reference

## Overview

This document contains the complete Supabase (PostgreSQL) schema for the Oddly Betting Intelligence Platform.

---

## Extensions

```sql
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";
```

---

## Profiles & Auth

```sql
create table profiles (
  id uuid primary key references auth.users(id),
  role text default 'user',
  display_name text,
  bankroll decimal(12,2),
  subscription_tier text default 'free',
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
```

---

## Core Tables

### Leagues

```sql
create table leagues (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  country text,
  sport text default 'football',
  is_active boolean default true,
  priority int default 0,
  created_at timestamptz default now()
);
```

### Teams

```sql
create table teams (
  id uuid primary key default uuid_generate_v4(),
  canonical_name text unique not null,
  country text,
  league_id uuid references leagues(id),
  created_at timestamptz default now()
);
```

### Team Aliases

```sql
create table team_aliases (
  canonical_name text not null,
  alias text not null unique,
  source text
);
```

### Fixtures

```sql
create table fixtures (
  id uuid primary key default uuid_generate_v4(),
  external_id text,
  home_team_id uuid references teams(id),
  away_team_id uuid references teams(id),
  league_id uuid references leagues(id),
  kickoff_time timestamptz not null,
  status text default 'scheduled',
  home_score int,
  away_score int,
  is_featured boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index idx_fixtures_kickoff on fixtures(kickoff_time);
create index idx_fixtures_status on fixtures(status);
create index idx_fixtures_league on fixtures(league_id);
```

---

## Odds

```sql
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
```

---

## Predictions

```sql
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
  result text default 'pending',
  created_at timestamptz default now(),
  settled_at timestamptz
);

create index idx_predictions_fixture on predictions(fixture_id);
create index idx_predictions_result on predictions(result);
create index idx_predictions_market on predictions(market);
```

---

## Recommendations

```sql
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
  risk_tier text not null,
  confidence_tier text not null,
  kelly_fraction decimal(6,4),
  is_recommended boolean default false,
  is_avoid boolean default false,
  explanation jsonb,
  created_at timestamptz default now()
);

create index idx_recs_edge on recommendations(edge desc);
create index idx_recs_score on recommendations(opportunity_score desc);
create index idx_recs_recommended on recommendations(is_recommended) where is_recommended = true;
```

---

## User Bets

```sql
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
  status text default 'pending',
  profit decimal(12,2),
  placed_at timestamptz default now(),
  settled_at timestamptz
);
```

---

## Accumulators

```sql
create table accumulators (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) not null,
  name text,
  selections jsonb not null,
  combined_odds decimal(12,4),
  estimated_probability decimal(5,4),
  monte_carlo_probability decimal(5,4),
  risk_adjusted_ev decimal(8,4),
  strategy text,
  stake decimal(12,2),
  status text default 'pending',
  result text,
  profit decimal(12,2),
  created_at timestamptz default now(),
  settled_at timestamptz
);
```

---

## Rollover Chains

```sql
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
  status text default 'active',
  started_at timestamptz default now(),
  ended_at timestamptz
);
```

### Rollover Picks

```sql
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
  result text default 'pending',
  actual_return decimal(12,2),
  user_marked boolean default false,
  settled_at timestamptz
);
```

---

## Model Performance

```sql
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
```

---

## AI Cache

```sql
create table ai_cache (
  cache_key text primary key,
  response text not null,
  model_used text,
  created_at timestamptz default now()
);
```

---

## Notifications

```sql
create table notifications (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id),
  type text not null,
  title text not null,
  body text not null,
  data jsonb,
  is_read boolean default false,
  created_at timestamptz default now()
);

create index idx_notifications_user on notifications(user_id, is_read, created_at desc);
```

---

## Scoring Configuration

```sql
create table scoring_config (
  id uuid primary key default uuid_generate_v4(),
  config_key text unique not null,
  config_value jsonb not null,
  updated_by uuid references profiles(id),
  updated_at timestamptz default now()
);
```

---

## Announcements

```sql
create table announcements (
  id uuid primary key default uuid_generate_v4(),
  title text not null,
  body text not null,
  target text default 'all',
  is_active boolean default true,
  scheduled_at timestamptz,
  expires_at timestamptz,
  created_by uuid references profiles(id),
  created_at timestamptz default now()
);
```

---

## Admin Activity Log

```sql
create table admin_activity_log (
  id uuid primary key default uuid_generate_v4(),
  admin_id uuid references profiles(id),
  action text not null,
  target_type text,
  target_id text,
  details jsonb,
  created_at timestamptz default now()
);
```

---

## Row Level Security (RLS)

### User-specific tables

```sql
alter table user_bets enable row level security;
alter table accumulators enable row level security;
alter table rollover_chains enable row level security;
alter table rollover_picks enable row level security;
alter table notifications enable row level security;

create policy "Users see own bets" on user_bets for all using (auth.uid() = user_id);
create policy "Users see own accs" on accumulators for all using (auth.uid() = user_id);
create policy "Users see own chains" on rollover_chains for all using (auth.uid() = user_id);
create policy "Users see own picks" on rollover_picks for all
  using (chain_id in (select id from rollover_chains where user_id = auth.uid()));
create policy "Users see own notifications" on notifications for all using (auth.uid() = user_id);
```

### Public read tables

```sql
alter table fixtures enable row level security;
create policy "Public read fixtures" on fixtures for select using (true);

alter table recommendations enable row level security;
create policy "Public read recs" on recommendations for select using (true);

alter table predictions enable row level security;
create policy "Public read predictions" on predictions for select using (true);

alter table model_performance enable row level security;
create policy "Public read performance" on model_performance for select using (true);

alter table announcements enable row level security;
create policy "Public read active announcements" on announcements
  for select using (is_active = true);
```

---

## Useful Queries

### Today's Value Bets

```sql
SELECT
  r.*,
  f.home_score, f.away_score, f.kickoff_time, f.status,
  ht.canonical_name as home_team,
  at.canonical_name as away_team,
  l.name as league_name
FROM recommendations r
JOIN fixtures f ON r.fixture_id = f.id
JOIN teams ht ON f.home_team_id = ht.id
JOIN teams at ON f.away_team_id = at.id
JOIN leagues l ON f.league_id = l.id
WHERE DATE(f.kickoff_time) = CURRENT_DATE
  AND r.is_recommended = true
ORDER BY r.opportunity_score DESC;
```

### Model Performance Summary

```sql
SELECT
  model_version,
  market,
  SUM(total_predictions) as total,
  SUM(correct_predictions) as correct,
  ROUND(SUM(correct_predictions)::decimal / SUM(total_predictions) * 100, 1) as accuracy,
  ROUND(AVG(brier_score), 4) as avg_brier
FROM model_performance
WHERE period_end >= CURRENT_DATE - INTERVAL '30 days'
GROUP BY model_version, market
ORDER BY accuracy DESC;
```

### Admin Dashboard Stats

```sql
-- Total users
SELECT count(*) FROM profiles;

-- Active users (last 7 days)
SELECT count(DISTINCT user_id) FROM user_bets
WHERE placed_at >= NOW() - INTERVAL '7 days';

-- Predictions today
SELECT count(*) FROM predictions
WHERE created_at >= CURRENT_DATE;

-- Recommendations today
SELECT count(*), sum(case when is_recommended then 1 else 0 end) as recommended
FROM recommendations r
JOIN fixtures f ON r.fixture_id = f.id
WHERE DATE(f.kickoff_time) = CURRENT_DATE;
```

---

*Last Updated: August 2026*
