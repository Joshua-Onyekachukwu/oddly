-- xg_features: per-match xG ingestion support
--
-- The original xg_features table (supabase/create-xg-tables.sql) was designed
-- for one row per team-feature snapshot but had no way to dedupe re-ingests
-- or link a row back to the fixtures table. This migration adds the columns
-- needed to store one row per team per match (Understat open data) and to
-- link rows to fixtures when date+team matching succeeds.
--
-- New columns:
--   match_external_id    provider match id (Understat external_id) — dedupe key
--   team_name_normalized normalizeTeamName() output for reliable joins
--   opponent             raw opponent team name (display/debug)
--   is_home              whether this row is the home team's xG-for line
--   fixture_id           FK-ish link to fixtures.id when matched (nullable)
--
-- Unique index makes ingest idempotent: re-running ON CONFLICT updates in place.

alter table xg_features
  add column if not exists match_external_id text,
  add column if not exists team_name_normalized text,
  add column if not exists opponent text,
  add column if not exists is_home boolean,
  add column if not exists fixture_id uuid;

create unique index if not exists xg_features_source_ext_team_uniq
  on xg_features (source, match_external_id, team_name_normalized);

create index if not exists idx_xg_team_norm_date
  on xg_features (team_name_normalized, match_date desc);

create index if not exists idx_xg_fixture
  on xg_features (fixture_id) where fixture_id is not null;
