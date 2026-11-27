# ODDLY — New Supabase Architecture & Migration Plan

**Date:** 2026-11-26 · Status: PLAN (no migration executed)

---

## 1. Current State (from code, not assumptions)

- Live project: `ulelicrbgicgnhmuulup` (Aug docs). **Being replaced** — treat all row counts as historical reference only.
- Tables referenced in code/migrations (~30+): `profiles, leagues, teams, team_aliases, fixtures, predictions, odds_snapshots, accumulators, model_performance, recommendations, rollover_chains, rollover_picks, user_bets, notifications, notification_preferences, announcements, admin_activity_log, ai_cache, scoring_config, elo_ratings, match_features, prediction_history, training_log, model_learning_history, settlement_feed, cron_executions, cron_locks, validation_results, learning_snapshots, player_injury_data, player_availability, injury_snapshots, team_injury_features, fixture_injury_features, injury_collection_log, league_model_params, model_weight_config` + views (`team_injury_summary_v2`, `injury_dashboard_summary`, `fixture_injury_overview`, daily-refresh views).
- Schema definition is fragmented: canonical migrations in `supabase/migrations/` (14 files) + ~30 ad-hoc root SQL files, several **untracked in git**. There is no single authoritative DDL.
- Convex currently holds a slim realtime schema (5 tables) — decision needed whether it stays (see DECISIONS doc).

## 2. Design Principles for New Schema

1. **Single source of truth**: Supabase Postgres holds ALL persistent data. Convex reduced to optional realtime fan-out or removed.
2. **Immutable fact tables**: predictions, snapshots, odds, results are append-only; corrections via new rows, never UPDATE of history.
3. **Every prediction traceable**: `prediction_snapshots` stores the exact feature vector + odds + model versions at generation time.
4. **Normalized but pragmatic**: reference data normalized; feature payloads as JSONB with a canonical feature dictionary.
5. **RLS from day one**: every table has explicit policies; service-role only for workers.
6. **Version-controlled migrations only**: one directory, sequential, no root-level fix scripts.

## 3. Proposed Schema (domain-grouped)

### Reference & football data
- `leagues` (id, external_id, name, country, tier, season_config JSONB)
- `seasons` (id, league_id, label, start/end) — *new*
- `teams` (id, canonical_name, external_ids JSONB, country, logo_url)
- `team_aliases` (alias → team_id) — *keep*
- `players` (id, name, team_id, position, external_ids) — *new, minimal*
- `referees` (id, name, external_id) + `referee_stats` (season aggregates)
- `fixtures` (id, league_id, season_id, home_team_id, away_team_id, kickoff_utc, venue, status, home_score, away_score, ht_score, external_id, raw JSONB)
- `match_events` (fixture_id, type, minute, team_id, player_id) — optional phase 2
- `match_stats` (fixture_id, team_id, shots, shots_on_target, possession, corners, fouls, cards, xg, xga) — *replaces ad-hoc match_stats*
- `team_match_stats` — derived/aggregated as needed (or computed views)

### Market & odds
- `bookmakers` (id, name, slug)
- `markets` (id, key e.g. `1x2`, `ou25`, `btts`, `ah`) — *lookup*
- `odds_snapshots` (id, fixture_id, bookmaker_id, market, selection, decimal_odds, captured_at, source) — **append-only, indexed (fixture_id, captured_at)**
- `odds_movements` — derived view or table for open→close deltas
- `market_consensus` — aggregated implied probs per fixture/market/time

### Prediction core (the important part)
- `prediction_runs` (id, trigger, started_at, finished_at, model_versions JSONB, fixtures_processed, status) — *new, observability*
- `predictions` (id, fixture_id, run_id, market, selection, probability, confidence_tier, data_quality_score, model_version, feature_version, created_at, result, settled_at) — slimmed; **one row per market-selection per run**
- `prediction_inputs` (prediction_id or run_id+fixture_id, snapshot JSONB) — **immutable**: feature vector, Elo/form state, injury snapshot ref, odds snapshot ref, lineups, weather, h2h — stored ONCE per fixture-run, referenced by all market rows (avoids 24× duplication)
- `prediction_settlements` (prediction_id, result, actual_score, settled_at, settlement_version) — append-only settlement log
- `model_versions` (id, name, version, algorithm, trained_at, metrics JSONB, status: champion|challenger|retired, artifact_path)
- `model_evaluations` (model_version_id, market, period, n, accuracy, brier, logloss, ece, roi, clv) — walk-forward + live windows
- `experiments` / `experiment_runs` — formalize `experiment-registry`

### Intelligence extras
- `injuries` / `player_availability` + `injury_snapshots` (as-of timestamps) — keep Sep-2026 design, normalize into above
- `lineups` (fixture_id, team_id, formation, players JSONB, confirmed_at, source)
- `weather_observations` (fixture_id, temp, wind, precipitation, source)
- `team_ratings` (team_id, as_of, elo, attack, defense, xg_for, xg_against) — materialized periodically

### Rollover (new — see ROLLOVER-STRATEGY-PLAN)
- `rollover_candidates` (run_date, fixture_id, market, selection, odds_at_selection, model_prob, ev, combined_group_id)
- `rollover_tickets` (run_date, legs JSONB, combined_odds, combined_prob, qualification JSONB, status)
- `rollover_results` (ticket_id, legs_results, pnl, settled_at)
- Keep user-facing `rollover_chains`/`rollover_picks` only if the consumer product needs them (decision)

### Product/ops
- `profiles` (auth link, role, prefs) — keep
- `subscriptions`, `user_bets`, `notifications`, `announcements`, `audit_log`, `cron_executions`, `cron_locks`, `validation_results`, `learning_snapshots` — keep/normalize

## 4. Migration Plan (old → new project)

**Phase M0 — Inventory & backup (before touching anything)**
1. Export full schema: `supabase db dump` (or pg_dump) from old project → `backups/old-schema-YYYYMMDD.sql`.
2. Row-count inventory every table; classify: MIGRATE / REBUILD / DROP (see §5).
3. Full logical export of MIGRATE tables to compressed CSV/JSON in `backups/`.

**Phase M1 — New project**
4. Create new Supabase project; record new URL/keys (never commit).
5. Apply clean migration chain (single `supabase/migrations/` directory, squashed baseline + incremental).
6. Enable RLS + policies; create service-role-only worker access pattern.

**Phase M2 — Data import**
7. Import reference data first (leagues, teams, aliases, referees).
8. Import fixtures + results + match_stats (historical truth — highest value).
9. Import predictions + settlements (needed for performance baselines) — transform old wide rows into new schema.
10. Import odds_snapshots (whatever exists), injuries, xG.
11. **Do NOT import**: stale local-JSON-derived state, duplicate prediction IDs (`data/duplicate-prediction-ids.json` flags known dupes — dedupe during import).

**Phase M3 — Verification**
12. Row-count reconciliation per table (old vs new, with documented exclusions).
13. Spot-check: 20 random fixtures — teams, scores, kickoff times match source.
14. Re-run one prediction + one settlement end-to-end against new DB.
15. Auth flow test (signup/login/admin role).
16. Update ALL env vars (Vercel, local, workers) → new project; grep codebase for old project ref `ulelicrbgicgnhmuulup`.
17. Only after 7 days of clean operation: decommission old project (export retained).

**Rollback:** old project untouched until step 17; env vars can be flipped back in minutes. Keep `backups/` immutable.

## 5. Table Disposition (draft — verify counts during M0)

| Old asset | Disposition |
|---|---|
| fixtures, teams, leagues, team_aliases | MIGRATE (rebuild into new schema) |
| historical match results/stats | MIGRATE — irreplaceable training data |
| predictions (599K claimed) | MIGRATE settled history; dedupe; archive cold rows to partitioned table |
| odds_snapshots | MIGRATE; expect sparse coverage |
| referee/xG/injury JSON+tables | MIGRATE what's verified; rebuild collectors |
| accumulators, user_bets, profiles, notifications | MIGRATE (user data) |
| ad-hoc fix tables, duplicate/empty tables | DROP after verification |
| local `/data/*.json` | NOT migrated to DB — remains research artifacts; regenerate features from DB |

## 6. Security requirements (new project)

- RLS enabled on every table; explicit policies per role (anon/auth/admin/service).
- `service_role` key only in server env + workers; never in client bundle (audit `NEXT_PUBLIC_*` usage).
- Cron endpoints: `VERCEL_CRON_SECRET` bearer + optional IP allowlist.
- Secrets via Vercel env / secrets manager; `.env.local` gitignored (verify).
- Storage buckets (if any) private by default.
