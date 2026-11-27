# ODDLY — Phased Implementation Roadmap

**Date:** 2026-11-26 · Depends on: SYSTEM-AUDIT, PREDICTION-ENGINE-PLAN, DATABASE-AND-SUPABASE-PLAN, DATA-INTELLIGENCE-PLAN, ROLLOVER-STRATEGY-PLAN

Complexity: S(<1d) M(1–3d) L(3–7d) XL(>1wk). Status: ⬜ not started.

---

## Phase A — Foundation & Truth (do first; everything depends on this)

| ID | Task | Pri | Cx | Deps | Acceptance |
|---|---|---|---|---|---|
| A1 | Set up Jest + first unit tests (checkPrediction, team-normalizer, odds math) | P0 | M | — | `npm test` runs green |
| A2 | Persist prediction input snapshots (featureSnapshot, ensembleOutputs, odds, data_quality) on insert | P0 | M | new column/table | 100% of new predictions traceable |
| A3 | Unify Elo/form builder shared by predict+settle (career-to-date, not 7-day window) | P0 | M | A2 | settle & predict use identical team state |
| A4 | Re-baseline production accuracy by model_version/market/league from settled rows | P0 | S | — | Report with n + CIs; published internally |
| A5 | Fix `model_performance` Brier computation bug | P1 | S | — | Unit-tested correct pairing |
| A6 | Decide Convex fate: keep slim realtime vs fold into Supabase Realtime | P1 | S | — | ADR recorded |
| A7 | Git hygiene: commit or discard untracked Sep migrations/scripts; single migration authority | P1 | S | — | Clean `supabase/migrations/` only |
| A8 | New Supabase project: schema baseline + RLS + service-role pattern | P0 | L | A7 | M0–M3 migration plan executed |
| A9 | Data export/backup of old project before any cutover | P0 | M | A8 | Verified backups + row counts |
| A10 | Env/config cutover to new project; grep-verify no old refs | P0 | S | A9 | All services on new DB |

**Phase A exit:** new DB live, snapshots persisting, tests running, accuracy baseline known.

## Phase B — Data Intelligence

| ID | Task | Pri | Cx | Deps |
|---|---|---|---|---|
| B1 | Odds ingestion fix: paid The Odds API tier OR API-Football odds — open decision | P0 | M | A10, decision |
| B2 | Odds snapshots at T-24h/T-2h/T-1h + CLV computation | P0 | M | B1 |
| B3 | Consolidated ingest() service: validate→dedupe→stamp→upsert→log | P1 | L | A10 |
| B4 | Injury/lineup pipeline: verify Sep system collectors run on schedule; confirmed-lineup ingestion | P1 | M | B3 |
| B5 | xG coverage expansion (StatsBomb comps + API-Football) | P1 | M | B3 |
| B6 | Cross-source fixture validation + conflict queue | P1 | M | B3 |
| B7 | Wire xG/referee/standings/odds-implied features into prod feature path | P1 | M | B2,B5,A2 |
| B8 | Feature store: DB-backed versioned features aligned to snapshots | P2 | L | A2,B3 |

## Phase C — Prediction Intelligence

| ID | Task | Pri | Cx | Deps |
|---|---|---|---|---|
| C1 | Per-market calibration layer (isotonic/platt, walk-forward fitted) | P0 | M | A4 |
| C2 | Dixon-Coles sub-model for 1X2/DC | P1 | L | B7,A4 |
| C3 | XGBoost v6 → formal challenger; walk-forward + calibration eval | P1 | M | A4,C1 |
| C4 | Champion/challenger registry + promotion gate (model_versions, experiments) | P1 | M | C3 |
| C5 | `NO_PREDICTION` quality gate (data completeness, model agreement, calibration bounds) | P1 | M | C1,A2 |
| C6 | Retire legacy engines (ensemble-model.js v5.0, daily-loop.js) or archive formally | P1 | S | C4 |
| C7 | Confidence framework v2: probability × calibration × data-quality × agreement | P2 | M | C1,C5 |
| C8 | Market-implied probability model (devigged odds baseline) | P2 | M | B2 |

## Phase D — Rollover Intelligence

| ID | Task | Pri | Cx | Deps |
|---|---|---|---|---|
| D1 | Candidate generator: all fixtures × markets → p, odds, EV, data-quality | P0 | M | B2,C5 |
| D2 | Qualification engine with fitted thresholds | P0 | M | D1,A4 |
| D3 | Combination search (~2.00 band) + correlation handling | P0 | L | D2 |
| D4 | `rollover_tickets` schema + daily cron + settlement | P0 | M | new schema (A8) |
| D5 | Backtest harness (walk-forward, pessimistic/optimistic odds bounds) | P0 | L | D1–D4, odds history |
| D6 | Honest first backtest report (ROI, drawdown, streaks, CIs) | P0 | M | D5 |
| D7 | Rollover performance dashboard (admin + user) | P1 | M | D4,D6 |

## Phase E — Core Product

| ID | Task | Pri | Cx | Deps |
|---|---|---|---|---|
| E1 | Design-token audit + chart library + data-table/probability-cell components | P1 | M | — |
| E2 | Dashboard rebuild (rollover card, featured picks, fixtures, performance, feed) | P0 | L | D4,E1 |
| E3 | Match Intelligence full page | P1 | L | B4,B7 |
| E4 | Predictions page upgrade (quality/EV/qualification columns) | P1 | M | C5 |
| E5 | Odds Intelligence page | P1 | M | B2 |
| E6 | Analytics page (Brier/logloss/calibration/ROI/CLV, per market+league, n shown) | P1 | M | A4,C1 |
| E7 | Results & history consolidation | P2 | M | E6 |
| E8 | Rollover user UI (ticket, explanations, empty state, history) | P0 | M | D4,E1 |
| E9 | Marketing copy rewrite (verified claims only) | P1 | S | A4 |

## Phase F — Administration

| ID | Task | Pri | Cx | Deps |
|---|---|---|---|---|
| F1 | Admin reorganization into 9 sections; merge duplicates | P1 | L | — |
| F2 | Data Management section (providers, ingestion runs, quality, conflicts) | P1 | L | B3,B6 |
| F3 | Model Intelligence section (champion/challenger, training runs, calibration, promote/rollback) | P1 | L | C4 |
| F4 | Operations section (cron executions, failures, retries — surface cron_executions) | P1 | M | — |
| F5 | Remove/repair decorative admin metrics | P1 | M | F1 |

## Phase G — Advanced

| ID | Task | Pri | Cx | Deps |
|---|---|---|---|---|
| G1 | Screenshot-to-analysis (OCR → fixture/odds match → central engine → immutable record) | P2 | XL | C5,E3 |
| G2 | Notifications productization (pick settled, rollover result, movement alerts) | P2 | M | — |
| G3 | Additional markets (AH, corners, cards) — only after data+model proof | P3 | XL | B-series |
| G4 | AI explanations grounded in snapshots ("Why?") | P2 | M | A2 |
| G5 | Subscription gating decision + launch | P3 | M | product decision |
| G6 | Betting agent productization (NG market) | P3 | L | core stable |

## Phase H — Testing & Production

| ID | Task | Pri | Cx | Deps |
|---|---|---|---|---|
| H1 | Full unit suite on lib math + worker models | P0 | L | A1 |
| H2 | Integration suite (cron idempotency, settlement, RLS, auth) | P0 | L | A8 |
| H3 | Leakage test suite (as-of-kickoff feature attestation) | P0 | M | A2,B7 |
| H4 | E2E critical paths (auth, dashboard, rollover, admin) | P1 | L | E-series |
| H5 | Performance tests (cron throughput, dashboard queries) | P1 | M | — |
| H6 | Security review of new Supabase + API surface | P0 | M | A8 |
| H7 | Production cutover + 7-day soak + rollback drill | P0 | M | all above |

## Phase G′ — Autonomy & Learning (per AUTONOMOUS-LEARNING-ARCHITECTURE.md)

| ID | Task | Pri | Cx | Deps |
|---|---|---|---|---|
| G′1 | prediction_runs/inputs/settlements/evaluation_results/model_versions/experiments schema | P0 | L | A8 |
| G′2 | Monitoring job: match status polling w/ backoff; settlement backlog alerts | P0 | M | B3 |
| G′3 | Daily evaluation job (Brier/logloss/ECE per market×league×band×version) | P0 | M | G′1 |
| G′4 | Error-intelligence job (bias slices, n-gated) | P1 | L | G′3 |
| G′5 | Experiment engine + model registry + promotion gate | P1 | L | C4,G′1 |
| G′6 | Weekly retrain automation (GH Actions) + calibrator refits | P1 | M | G′5 |
| G′7 | Daily/weekly/monthly report generator | P1 | M | G′3 |
| G′8 | Alerting (dashboard + webhook) for failures/quota/promotions | P1 | M | — |
| G′9 | Retention/archival jobs (hot/cold split, R2 parquet) | P2 | M | A8 |
| G′10 | 90-day soak harness + SOAK-REPORT-90D.md | P0 | M | all above |

## Suggested sequencing rationale

A→B→C→D is the critical path to the strategic objective (2-odds rollover). E/F run in parallel once A lands. G strictly after core proven. H gates the final cutover.

## Open decisions blocking start

See `DECISIONS-AND-OPEN-QUESTIONS.md` — especially: odds provider/budget, Convex keep-or-fold, Dixon-Coles priority, subscription timing, Trezo adopt-or-remove.
