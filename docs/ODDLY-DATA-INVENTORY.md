# ODDLY — Data Inventory

Audit date: 2026-10-02. Two databases exist:

- **OLD project** (`ulelicr...supabase.co`) — production data: ~599,080
  predictions, ~13,986 fixtures, ~14,984 odds snapshots (as of 2026-08-25 audit).
- **NEW project** (`xruhvekcowdwocydqnmp.supabase.co`) — provisioned 2026-10-02.
  Full schema applied (**67 tables**), RLS enforced, pg_cron enabled, **zero
  football data rows** (seed demo data removed). `.env.local` now points here.

> ⚠️ **Critical:** all historical/operational data still lives in the old
> project and in local `data/` JSONs. Nothing has been migrated yet. Until a
> backfill runs, the new DB produces predictions with no team history.

## 1. New-project schema (67 tables, grouped)

| Domain | Tables |
|--------|--------|
| Core platform | `profiles`, `leagues` (20 seeded), `teams` (35 seeded), `team_aliases` (21), `fixtures`, `odds_snapshots`, `predictions`, `recommendations`, `user_bets`, `accumulators`, `rollover_chains`, `rollover_picks`, `notifications`, `announcements`, `admin_activity_log`, `ai_cache`, `scoring_config` (11 rows), `agent_audit_log` |
| Learning/self-training | `training_log`, `feature_importance`, `model_learning_history`, `crown_jewel_history`, `model_versions`, `model_performance`, `model_performance_history`, `learning_snapshots`, `validation_results`, `prediction_history`, `league_draw_calibration` |
| Historical/backtest store | `historical_matches`, `team_match_stats`, `model_predictions`, `match_features`, `elo_ratings` — **all EMPTY** |
| Feature store | `team_feature_profiles`, `referee_feature_profiles`, `league_model_params`, `model_weight_config`, `odds_feature_cache`, `player_injury_data` — **all EMPTY** |
| Referee | `referee_profiles`, `match_stats`, `team_referee_stats`, `referee_match_history` — **empty** |
| Injury | `player_availability`, `player_injury_data`, `injury_snapshots`, `team_injury_features`, `fixture_injury_features`, `injury_collection_log` + views `team_injury_summary_v2`, `injury_dashboard_summary` — **empty** |
| Players/xG | `players`, `player_appearances`, `player_impact`, `player_impact_scores`, `xg_features`, `team_strengths` — **empty** |
| Realtime | `live_pick`, `value_picks`, `settlement_feed`, `live_stats` (auto-trim 500) — enabled in `supabase_realtime` publication |
| Cron/ops | `cron_runs`, `cron_locks`, `cron_alerts` + MVs `mv_calibration_buckets`, `mv_market_accuracy`, `mv_daily_accuracy`, `mv_model_accuracy`, `mv_settlement_summary`, `mv_draw_*`, `mv_cron_*` + RPCs (`refresh_analytics_views`, `start/complete_cron_run`, `get_today_fixtures`, `is_admin`, `is_service_role`, …) |

## 2. Local `data/` datasets (the real research store)

| File | Contents | Records | Usable for backtest? |
|------|----------|---------|---------------------|
| `research-dataset.json` | 27,314 matches × 95 features, 17 leagues, 2021-07→2026-05 | 27,314 | **Yes — but xG/referee/injury blocks are zeroed placeholders**; ~60 usable features |
| `research-audit-report.json` | Coverage audit vs old DB (generated 2026-08-25) | — | Reference |
| `football-data-referee-stats-full.json` | Per-match referee+stats | ~25K matches | Yes |
| `referee-features-built.json` / `referee-relationship-features.json` | Referee features | 9,740 / 14,285 matches | Yes (ablation showed **zero lift**) |
| `statsbomb-xg.json`, `statsbomb-progress.json` | Per-match xG events | 2,183 matches, 147 teams | Yes (small coverage) |
| `understat-xg.json` | Team-season xG aggregates | 484 team-seasons | Partial (aggregates only; match files EMPTY) |
| `injuries-suspensions.json` | API-Football injury records | 20,257 | Partial (fixture-dated, unverified in DB) |
| `player-stats.json` | Season stats | 265 players / 116 teams / 8 leagues | Partial |
| `team-composite-ratings.json` | Form/attack/defense ratings | 405 teams | Yes |
| `weather-features.json` | Open-Meteo per-fixture | 9,729 fixtures | **No — forward-looking only, no history** |
| `ah-odds.json` / `ah-features.json` | Asian handicap | 59 / 52 matches | Too thin |
| `market-consensus.json` | Vig-free consensus | 103 fixtures | Too thin |
| `clv-snapshots.json` | Pre-match odds | handful (Aug-25) | Too thin |
| `optimized-weights.json` | Regression weights (10,722 matches) | — | Feeds `model_weight_config` |
| `per-league-models.json` | Per-league logistic weights | ~10 leagues | Yes |
| `model-comparison.json` | v3.0 vs v5.1 (10,672 matches) | — | Reference |
| `benchmark-results.json` | Poisson vs XGB | — | Reference |
| `xgboost-results/` | 12 walk-forward/ablation/calibration artifacts | up to 103,868 rows | Yes (offline experiments) |
| `walk-forward-report.json` | **EMPTY — 0 predictions (broken run)** | 0 | No |
| `models/*.json` | Trained XGB/LGBM per-market models + isotonic calibrator | 10,403 matches, 95 feats | Offline only — **not wired to prod** |
| `1x2_training_data.csv` | Wide feature matrix | thousands of rows | Yes |

## 3. Coverage summary (best available evidence)

| Category | Have | Missing / weak |
|----------|------|----------------|
| Matches | 30,340 football-data + 27,314 research rows (local); **0 in new DB** | Migration/backfill needed |
| Leagues | 17 research codes; 20 seeded league rows | Coverage uneven — biggest leagues best |
| Teams | 405 rated; 35 seeded rows | Seed list is only top-flight clubs |
| Players | 265 stat rows; StatsBomb tables empty | No lineup/minutes history at scale |
| Lineups | **0% — never collected** | API-Football lineups endpoint unused |
| xG | 2,183 StatsBomb matches + 484 Understat team-seasons | Not joined into research set; thin coverage |
| Injuries | 20,257 historical records (local JSON) + empty DB tables | No production wiring; no point-in-time guarantee |
| Referee | 9,740 matches tagged, 177 refs, 147 profiles (local) | DB tables empty on new project; **ablation: zero predictive lift** |
| Odds | 14,984 snapshots old DB (~1h retention); ~16 usable feature rows | **Historical odds ≈ 0** — biggest market-intelligence gap |
| Weather | 9,729 forward-looking records | No history; unused by model |
| Predictions | 599,080 old DB (with known duplicates) | **0 in new DB**; dedup SQL applied but not run on old data |

## 4. Data-quality issues (carried over + new)

1. **Schema drift**: ~45 loose SQL files vs 15 canonical migrations; two
   incompatible `match_features` definitions existed (resolved by
   `fix-match-features.sql`); duplicate `model_performance` definitions.
2. **Duplicate predictions** in old DB (`duplicate-prediction-ids.json`);
   `DEDUP-PREDICTIONS.sql` now applied on new DB (empty anyway).
3. **Market/selection naming chaos**: `1X2`/`match_result`/`h2h`,
   `Home`/`home`, `OU`/`over_under`, `DC`/`DNB` — cross-source joins fragile.
   `normalize-selections.sql` applied.
4. **NULL-heavy columns**: legacy predictions lack `features_used`,
   `sub_model_probabilities`, `data_quality_*`; snapshot columns only populate
   for predictions made after 2026-10-02.
5. **`data_quality_score` type conflict**: `int` (initial schema) vs
   `decimal(4,3)` (snapshot migration) — verify which survived.
6. **`settled_at` can precede `created_at`** (integrity bug, old DB).
7. **Team-name normalization risk**: `team-normalizer.ts` exists but injury/odds
   files use raw names; `&amp;` HTML entities present in Transfermarkt data.
8. **Understat pipeline broken**: match/team-level exports empty.
9. **StatsBomb scrape incomplete**: ~15 of ~40 comp-seasons done.
10. **Old DB RLS was open** until Aug-26; residual exposure fixes applied
    (`20260902030000_fix_rls_anon_exposure.sql`).

## 5. What exists where — decision needed

| Data | Location | Action needed |
|------|----------|---------------|
| Schema | New Supabase ✅ | Done |
| Leagues/teams/aliases/scoring config | New Supabase ✅ (seeded) | Done |
| Historical matches + features | Old Supabase + `data/` JSONs | **Backfill new DB or re-point env** |
| 599K predictions + settlement history | Old Supabase (+ Convex copy) | Migrate or accept fresh start |
| Feature store tables | Empty; source JSONs in `data/` | Run `worker/feature-store-sync.js` |
| Model weights (`production_v5`) | `data/optimized-weights.json` etc. | Sync into `model_weight_config` |
| Odds history | Old DB (pruned) + thin JSONs | Going forward: fix retention + cron |
