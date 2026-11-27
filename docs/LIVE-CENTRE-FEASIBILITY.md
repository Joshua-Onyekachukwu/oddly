# Live Centre — Feasibility Assessment

**Question:** can we ship a `/live` page (in-play fixtures + live scores) on the
current free-tier stack?

## What already exists

- `fixtures` table already stores `status` (`scheduled | live | halftime |
  finished | postponed | cancelled`) and `home_score` / `away_score`, updated by
  `src/lib/sync/fixtures.ts` (`syncTodayFixtures`, run by cron
  `/api/v1/cron/sync`).
- `mapStatus()` already maps API-Football short codes (`1H`, `2H`, `HT`, `ET`,
  `P`, `BT`) to `live`/`halftime` — live statuses are handled end-to-end.
- `src/hooks/useLiveScores.ts` subscribes to Supabase Realtime `postgres_changes`
  on `fixtures` and is already used by `MatchesList` / `MatchDetail`, so a
  `/live` page gets push score updates for free once rows change.
- The Odds API (`src/lib/sync/odds.ts`) syncs pre-match odds; it does **not**
  provide live scores — its value for a live centre is limited to halftimes/
  pre-match lines.

## Data source options (free tier)

- **API-Football**: supports `GET /fixtures?live=all` returning all in-play
  fixtures with `goals.home/away` and `fixture.status.short`. Free plan:
  ~100 requests/day. One call per sync covers every live match across all
  tracked leagues — very cheap. Current code only calls
  `/fixtures?league=…&date=…`; adding a `live=all` path (or
  `?date=<today>` which already returns live scores for today's games) is a
  small change to `src/lib/api/football.ts` + `sync/fixtures.ts`.
- **The Odds API**: no live-score endpoint on any tier; skip for scores.

## Cadence constraints

- `vercel.json` schedules `/api/v1/cron/sync` at `0 */6 * * *` (every 6 h) —
  far too slow for live scores, and **Vercel Hobby only allows daily crons**;
  the `*/4` and `*/6` entries already exceed Hobby limits (they work on Pro,
  or not at all on Hobby).
- Realistic free options for live cadence:
  1. **External cron pinger** (cron-job.org, GitHub Actions schedule, UptimeRobot)
     hitting `POST /api/v1/cron/sync` (or a new lightweight
     `/api/v1/cron/live-scores` route) every 1–5 min during match windows.
     Each run costs 1 API-Football call (`live=all`) — well inside 100/day if
     limited to ~match hours, or use `?date=` for today only.
  2. Supabase `pg_cron`/`pg_net` calling the route — same effect, no Vercel
     plan needed.
- API-Football free-tier rate limit is per-day, not per-minute, so 1–5 min
  polling during ~8 h of daily football is fine (≈100–480 calls/day worst case;
  trim by only polling when live fixtures exist or restrict hours).

## Verdict

**Feasible on free tier**, with caveats:

- Scores will be near-live (1–5 min stale), not second-by-second — fine for a
  "Live" page.
- Requires an external scheduler; Vercel Hobby crons alone are insufficient.
- Recommended minimal build: `/live` page querying
  `fixtures.status IN ('live','halftime')` + Supabase Realtime subscription
  (pattern already proven by `useLiveScores`), plus a slim cron route that calls
  API-Football `fixtures?live=all` (or today's date) and reuses
  `syncTodayFixtures`' upsert logic so scores/status flow into the same table.
- The Odds API stays pre-match only; optionally show live-ish market context
  from the last pre-match sync.
