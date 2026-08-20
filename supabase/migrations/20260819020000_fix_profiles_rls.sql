-- Fix infinite recursion in profiles RLS policy
-- The admin policy was querying profiles to check admin status, causing recursion

-- Drop the recursive admin policy
drop policy if exists "Admins see all profiles" on profiles;

-- Create a security definer function to check admin status
-- This bypasses RLS and avoids the recursion
create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

-- Re-create the admin policy using the function
create policy "Admins see all profiles" on profiles
  for all using (
    public.is_admin()
  );

-- Also fix any other tables that have recursive admin policies referencing profiles
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

-- Odds
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
drop policy if exists "Admins see all bets" on user_bets;
create policy "Admins see all bets" on user_bets
  for all using (public.is_admin());

-- Accumulators
drop policy if exists "Admins see all accumulators" on accumulators;
create policy "Admins see all accumulators" on accumulators
  for all using (public.is_admin());

-- Rollover Chains
drop policy if exists "Admins see all chains" on rollover_chains;
create policy "Admins see all chains" on rollover_chains
  for all using (public.is_admin());

-- Rollover Picks
drop policy if exists "Admins see all picks" on rollover_picks;
create policy "Admins see all picks" on rollover_picks
  for all using (public.is_admin());

-- Model Performance
drop policy if exists "Admins can manage model performance" on model_performance;
create policy "Admins can manage model performance" on model_performance
  for all using (public.is_admin());

-- Notifications (admin insert)
drop policy if exists "System can insert notifications" on notifications;
create policy "System can insert notifications" on notifications
  for insert with check (true);

-- Scoring Config
drop policy if exists "Admins can manage scoring config" on scoring_config;
create policy "Admins can manage scoring config" on scoring_config
  for all using (public.is_admin());

-- Announcements
drop policy if exists "Admins can manage announcements" on announcements;
create policy "Admins can manage announcements" on announcements
  for all using (public.is_admin());

-- Admin Activity Log
drop policy if exists "Admins can view activity log" on admin_activity_log;
drop policy if exists "Admins can insert activity log" on admin_activity_log;
create policy "Admins can view activity log" on admin_activity_log
  for select using (public.is_admin());
create policy "Admins can insert activity log" on admin_activity_log
  for insert with check (public.is_admin());

-- Training Log
drop policy if exists "Admins can manage training log" on training_log;
create policy "Admins can manage training log" on training_log
  for all using (public.is_admin());

-- Feature Importance
drop policy if exists "Admins can manage feature importance" on feature_importance;
create policy "Admins can manage feature importance" on feature_importance
  for all using (public.is_admin());

-- Model Learning History
drop policy if exists "System can manage learning history" on model_learning_history;
create policy "System can manage learning history" on model_learning_history
  for all using (true);
