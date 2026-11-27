-- Computed player importance scores (0-1), replacing manual 1-10 guesses.
--
-- Source: src/lib/players/importance.ts engine, persisted by
-- scripts/compute-player-importance.js and worker/feature-store-sync.js.
--
-- confidence tiers:
--   stats   — performance stats (minutes, G+A, rating) from player-stats data
--   history — absence-record regularity proxy from injuries-suspensions data
--   neutral — no data; score is the neutral 0.5 prior
--
-- importance_1_10 mirrors the legacy player_injury_data.player_importance
-- scale (round(score01 * 10, 1)) so existing consumers (avgImp/5, is_key_player
-- >= 7) keep working unchanged.

create table if not exists player_importance (
  id uuid primary key default gen_random_uuid(),
  team_name text not null,
  player_name text not null,
  player_id integer,
  team_id_api integer,
  league text,
  score_0_1 numeric(4,3) not null,
  score_1_10 numeric(4,1) not null,
  confidence text not null default 'neutral'
    check (confidence in ('stats', 'history', 'neutral')),
  method text,
  signals jsonb,
  computed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (team_name, player_name)
);

create index if not exists idx_player_importance_team on player_importance (team_name);
create index if not exists idx_player_importance_confidence on player_importance (confidence);
create index if not exists idx_player_importance_player_id on player_importance (player_id) where player_id is not null;

comment on table player_importance is
  'Computed per-player importance (0-1 + legacy 1-10). Written by scripts/compute-player-importance.js; read by injury feature pipeline.';
