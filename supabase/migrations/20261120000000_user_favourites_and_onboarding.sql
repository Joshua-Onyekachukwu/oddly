-- User favourites + onboarding flag
--
-- Adds:
--   * user_favourites: per-user saved teams / leagues / players.
--     entity_id  = canonical id (team/league UUID) or raw name (player)
--     entity_key = normalized value used for matching/dedup
--     entity_name= display label captured at favourite time
--   * profiles.onboarding_completed: NULL/false → user has not finished
--     (or skipped) the first-run onboarding flow.
--
-- RLS: owner-only CRUD. All reads/writes go through auth.uid() so the
-- anon key can never expose another user's favourites.

-- ============================================
-- 1. profiles.onboarding_completed
-- ============================================

alter table profiles
  add column if not exists onboarding_completed boolean;

comment on column profiles.onboarding_completed is
  'NULL = legacy user (treat as completed); false = needs onboarding; true = done';

-- Backfill: existing users predate onboarding — mark them completed so they
-- are not pushed through the flow. Only brand-new signups stay NULL/false.
update profiles set onboarding_completed = true where onboarding_completed is null;

alter table profiles
  alter column onboarding_completed set default false;

-- ============================================
-- 2. user_favourites
-- ============================================

create table if not exists user_favourites (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  entity_type text not null check (entity_type in ('team', 'league', 'player')),
  entity_id text not null,
  entity_key text not null,
  entity_name text,
  created_at timestamptz not null default now(),
  unique (user_id, entity_type, entity_key)
);

create index if not exists user_favourites_user_idx
  on user_favourites (user_id);

create index if not exists user_favourites_type_key_idx
  on user_favourites (entity_type, entity_key);

alter table user_favourites enable row level security;

drop policy if exists "Users can view own favourites" on user_favourites;
create policy "Users can view own favourites" on user_favourites
  for select using (auth.uid() = user_id);

drop policy if exists "Users can insert own favourites" on user_favourites;
create policy "Users can insert own favourites" on user_favourites
  for insert with check (auth.uid() = user_id);

drop policy if exists "Users can update own favourites" on user_favourites;
create policy "Users can update own favourites" on user_favourites
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users can delete own favourites" on user_favourites;
create policy "Users can delete own favourites" on user_favourites
  for delete using (auth.uid() = user_id);
