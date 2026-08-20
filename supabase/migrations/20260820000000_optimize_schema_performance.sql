-- ============================================
-- ODDLY Schema Performance Optimization
-- Based on Supabase Postgres Best Practices
-- Date: August 20, 2026
-- ============================================

-- ============================================
-- 1. OPTIMIZE ADMIN CHECK FUNCTION
-- (security-rls-performance: wrap in security definer)
-- ============================================

-- Replace per-row subquery with cached security definer function
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

-- Revoke direct execution from public roles (only use in RLS policies)
revoke execute on function public.is_admin() from PUBLIC, anon, authenticated;

-- ============================================
-- 2. ADD MISSING FOREIGN KEY INDEXES
-- (schema-foreign-key-indexes: always index FK columns)
-- ============================================

-- Teams
create index if not exists idx_teams_league_id on teams(league_id);

-- Fixtures
create index if not exists idx_fixtures_home_team on fixtures(home_team_id);
create index if not exists idx_fixtures_away_team on fixtures(away_team_id);

-- Predictions (already has idx_predictions_fixture, but add composite)
-- Recommendations
create index if not exists idx_recs_fixture_id on recommendations(fixture_id);
create index if not exists idx_recs_prediction_id on recommendations(prediction_id);

-- User Bets
create index if not exists idx_user_bets_user_id on user_bets(user_id);
create index if not exists idx_user_bets_recommendation_id on user_bets(recommendation_id);
create index if not exists idx_user_bets_fixture_id on user_bets(fixture_id);
create index if not exists idx_user_bets_user_status on user_bets(user_id, status);

-- Accumulators
create index if not exists idx_accumulators_user_id on accumulators(user_id);
create index if not exists idx_accumulators_user_status on accumulators(user_id, status);

-- Rollover Chains
create index if not exists idx_rollover_chains_user_id on rollover_chains(user_id);
create index if not exists idx_rollover_chains_user_status on rollover_chains(user_id, status);

-- Rollover Picks
create index if not exists idx_rollover_picks_chain_id on rollover_picks(chain_id);
create index if not exists idx_rollover_picks_fixture_id on rollover_picks(fixture_id);
create index if not exists idx_rollover_picks_prediction_id on rollover_picks(prediction_id);

-- ============================================
-- 3. ADD COMPOSITE INDEXES FOR COMMON QUERIES
-- (query-composite-indexes: multi-column indexes for filtered queries)
-- ============================================

-- Fixtures: league + kickoff time (for "today's matches by league")
create index if not exists idx_fixtures_league_kickoff
  on fixtures(league_id, kickoff_time);

-- Fixtures: status + kickoff time (for live/upcoming matches)
create index if not exists idx_fixtures_status_kickoff
  on fixtures(status, kickoff_time);

-- Predictions: fixture + probability (for value bet detection)
create index if not exists idx_predictions_fixture_probability
  on predictions(fixture_id, model_probability desc);

-- Predictions: result + created_at (for settled predictions)
create index if not exists idx_predictions_result_created
  on predictions(result, created_at desc);

-- Recommendations: edge desc + is_recommended (for top value bets)
create index if not exists idx_recs_edge_recommended
  on recommendations(edge desc) where is_recommended = true;

-- Recommendations: fixture_id + edge (for fixture recommendations)
create index if not exists idx_recs_fixture_edge
  on recommendations(fixture_id, edge desc);

-- Odds: fixture + market + time (for odds comparison)
create index if not exists idx_odds_fixture_market_time
  on odds_snapshots(fixture_id, market, snapshot_time desc);

-- ============================================
-- 4. ADD PARTIAL INDEXES FOR COMMON FILTERS
-- (query-partial-indexes: smaller, faster indexes for filtered queries)
-- ============================================

-- Active leagues only (most queries filter on is_active = true)
create index if not exists idx_leagues_active
  on leagues(id) where is_active = true;

-- Featured fixtures
create index if not exists idx_fixtures_featured
  on fixtures(id, kickoff_time) where is_featured = true;

-- Pending predictions (need settling)
create index if not exists idx_predictions_pending
  on predictions(fixture_id, created_at) where result = 'pending';

-- Active accumulators
create index if not exists idx_accumulators_active
  on accumulators(user_id, created_at) where status = 'pending';

-- Active rollover chains
create index if not exists idx_rollover_chains_active
  on rollover_chains(user_id, started_at) where status = 'active';

-- ============================================
-- 5. UPDATE RLS POLICIES WITH CACHED AUTH.UID()
-- (security-rls-performance: wrap auth.uid() in SELECT)
-- ============================================

-- Profiles
drop policy if exists "Users see own profile" on profiles;
create policy "Users see own profile" on profiles
  for select using ((select auth.uid()) = id);

drop policy if exists "Users update own profile" on profiles;
create policy "Users update own profile" on profiles
  for update using ((select auth.uid()) = id);

drop policy if exists "Admins see all profiles" on profiles;
create policy "Admins see all profiles" on profiles
  for all using (public.is_admin());

-- Leagues
drop policy if exists "Admins can manage leagues" on leagues;
create policy "Admins can manage leagues" on leagues
  for all using (public.is_admin());

-- Teams
drop policy if exists "Admins can manage teams" on teams;
create policy "Admins can manage teams" on teams
  for all using (public.is_admin());

-- Team Aliases
drop policy if exists "Admins can manage team aliases" on team_aliases;
create policy "Admins can manage team aliases" on team_aliases
  for all using (public.is_admin());

-- Fixtures
drop policy if exists "Admins can manage fixtures" on fixtures;
create policy "Admins can manage fixtures" on fixtures
  for all using (public.is_admin());

-- Odds Snapshots
drop policy if exists "Admins can manage odds" on odds_snapshots;
create policy "Admins can manage odds" on odds_snapshots
  for all using (public.is_admin());

-- Predictions
drop policy if exists "Admins can manage predictions" on predictions;
create policy "Admins can manage predictions" on predictions
  for all using (public.is_admin());

-- Recommendations
drop policy if exists "Admins can manage recommendations" on recommendations;
create policy "Admins can manage recommendations" on recommendations
  for all using (public.is_admin());

-- User Bets
drop policy if exists "Users see own bets" on user_bets;
create policy "Users see own bets" on user_bets
  for all using ((select auth.uid()) = user_id);

drop policy if exists "Admins see all bets" on user_bets;
create policy "Admins see all bets" on user_bets
  for all using (public.is_admin());

-- Accumulators
drop policy if exists "Users see own accumulators" on accumulators;
create policy "Users see own accumulators" on accumulators
  for all using ((select auth.uid()) = user_id);

drop policy if exists "Admins see all accumulators" on accumulators;
create policy "Admins see all accumulators" on accumulators
  for all using (public.is_admin());

-- Rollover Chains
drop policy if exists "Users see own chains" on rollover_chains;
create policy "Users see own chains" on rollover_chains
  for all using ((select auth.uid()) = user_id);

drop policy if exists "Admins see all chains" on rollover_chains;
create policy "Admins see all chains" on rollover_chains
  for all using (public.is_admin());

-- Rollover Picks (via chain ownership)
drop policy if exists "Users see own picks" on rollover_picks;
create policy "Users see own picks" on rollover_picks
  for all using (
    chain_id in (
      select id from rollover_chains where user_id = (select auth.uid())
    )
  );

drop policy if exists "Admins see all picks" on rollover_picks;
create policy "Admins see all picks" on rollover_picks
  for all using (public.is_admin());

-- ============================================
-- 6. ADD UPDATED_AT TRIGGER FOR PROFILES
-- (schema-constraints: auto-update timestamps)
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

-- Apply trigger to profiles
drop trigger if exists set_updated_at on profiles;
create trigger set_updated_at
  before update on profiles
  for each row
  execute function public.handle_updated_at();

-- Apply trigger to fixtures
drop trigger if exists set_updated_at on fixtures;
create trigger set_updated_at
  before update on fixtures
  for each row
  execute function public.handle_updated_at();

-- ============================================
-- 7. ADD USEFUL DATABASE FUNCTIONS
-- (advanced: utility functions for common operations)
-- ============================================

-- Function to get user's bet statistics
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

-- Function to get today's fixtures with prediction count
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
