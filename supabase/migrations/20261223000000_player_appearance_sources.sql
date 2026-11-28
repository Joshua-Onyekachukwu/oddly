-- Player appearance ingestion support (StatsBomb open data lineups).
--
-- player_appearances already had the relational skeleton
-- (player_id / fixture_id / team_id / is_starter / minutes_played /
-- position / substitution minutes). External sources are text-keyed, so
-- add denormalized name/date/source columns that let us store real
-- lineup rows even when no stable players/teams/fixtures row exists.
--
-- All new columns are nullable → append-friendly; existing rows
-- (none today) are unaffected.

alter table player_appearances
  add column if not exists team_name text,
  add column if not exists team_name_normalized text,
  add column if not exists player_name text,
  add column if not exists player_name_normalized text,
  add column if not exists match_date date,
  add column if not exists source text,
  add column if not exists external_match_id text,
  add column if not exists external_player_id integer,
  add column if not exists raw_json jsonb;

comment on column player_appearances.team_name is
  'Team display name as reported by the source (e.g. StatsBomb).';
comment on column player_appearances.team_name_normalized is
  'normalizeTeamName(team_name) — join key used by lineup ranking.';
comment on column player_appearances.player_name is
  'Player display name as reported by the source.';
comment on column player_appearances.player_name_normalized is
  'personKey(player_name) — fuzzy person join key.';
comment on column player_appearances.match_date is
  'Match date (UTC) when fixture_id could not be resolved.';
comment on column player_appearances.source is
  'Ingestion source, e.g. statsbomb-open-data.';
comment on column player_appearances.external_match_id is
  'Source-native match id (StatsBomb match_id as text).';
comment on column player_appearances.external_player_id is
  'Source-native player id (StatsBomb player_id).';
comment on column player_appearances.raw_json is
  'Slim raw source payload for audit/reprocessing.';

-- Bounded lookups for predicted-lineup ranking: last N matches per team.
create index if not exists idx_pa_team_date
  on player_appearances (team_name_normalized, match_date desc);

-- Fixture-linked lookups.
create index if not exists idx_pa_fixture_id
  on player_appearances (fixture_id);

-- Dedupe / idempotent re-ingest per source match + player + team.
create unique index if not exists idx_pa_source_dedupe
  on player_appearances (source, external_match_id, external_player_id, team_name_normalized)
  where source is not null and external_match_id is not null;

-- RLS: appearances feed predicted lineups on public match pages, so
-- allow public read like player_importance; writes stay service-role.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'player_appearances' and policyname = 'Public read player appearances'
  ) then
    create policy "Public read player appearances" on player_appearances
      for select using (true);
  end if;
end $$;
