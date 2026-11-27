# scripts/legacy — retired one-off / dead scripts

These files were moved out of `worker/`, `scripts/`-adjacent locations, `convex/`,
and `lib/convex/` during the dead-code cleanup. They are **not** wired into
`package.json`, `vercel.json` crons, or any `src/` import. Nothing in the Next.js
build, Jest suite, or cron routes references them.

> ⚠️ Paths inside these scripts assume their **original** location
> (`worker/`, repo-root `convex/`, repo-root `lib/convex/`). Helpers that do
> `path.join(__dirname, "..", ".env.local")` or `"../data"` will resolve one
> level too shallow from `scripts/legacy/worker/` — adjust to `"../.."` if you
> ever need to run one again.

## worker/ (30 files)

### Convex migration / cleanup (Convex fully removed — Supabase only now)
- `migrate-to-convex.js`, `migrate-to-convex-fast.js` — one-shot data migration
  into Convex. Their npm scripts (`migrate:convex*`) were removed.
- `migrate-preds-to-convex.js`, `migrate-preds-resumable.js`,
  `migrate-preds-convex-final.js`, `migrate-referee-matches.js`,
  `convex-cleanup.js` — same; hit `limitless-mole-387.convex.cloud` over raw HTTP.

### Schema-broken / superseded odds & CLV scripts
- `collect-closing-odds.js` — **verified broken**: upserts `snapshot_type`/`source`
  columns and filters `.eq("snapshot_type", ...)` on `odds_snapshots`, but the
  table has neither column (see `src/lib/supabase/database.types.ts`). CLV is
  handled by the live `worker/clv-tracker.js` instead.
- `compute-market-consensus.js`, `add-odds-features.js`,
  `sync-odds-new-leagues.js`, `fetch-odds-smart.js` — earlier odds-pipeline
  iterations superseded by `src/lib/sync/odds.ts` (cron `/api/v1/cron/sync`).

### Orphaned analysis / benchmark one-offs (zero inbound references)
- `add-more-leagues.js`, `backfill-model-performance.js`, `benchmark-models.js`,
  `benchmark-v2.js`, `build-referee-features.js`, `compare-models.js`,
  `compare-referee-impact.js`, `experiment-registry.js`, `live-xg-predictions.js`,
  `optimize-weights.js`, `predict-enhanced.js`, `predict-upcoming.js`,
  `research-audit.js`, `settle-with-referees.js`, `sync-referee-data.js`,
  `train-per-league.js`, `train-xgboost-referee.js`, `collect-statsbomb-fast.js`
  (duplicate of `scripts/collect-statsbomb-fast.js`).

## convex/ (deployed Convex backend, now unused)
- `schema.ts`, `predictions.ts`, `realtime.ts`, `_generated/` — the slim
  realtime schema. Nothing in `src/` imports `convex/react` anymore;
  `src/hooks/useSupabaseRealtime.ts` polls Supabase instead. Kept for reference;
  delete the Convex deployment/dashboard project separately if desired.

## lib/convex/ (Node client helpers used only by migrate-to-convex*.js)
- `connection.js`, `data-layer.js`
