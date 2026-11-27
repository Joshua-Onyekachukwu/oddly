# ODDLY — Autonomous Learning & Continuous Improvement Architecture

**Date:** 2026-11-26 · **Status:** DESIGN — awaiting approval before implementation
**Integrates with:** MASTER-PLAN.md, IMPLEMENTATION-ROADMAP.md, DATABASE-AND-SUPABASE-PLAN.md, ROLLOVER-STRATEGY-PLAN.md

---

## 1. Design Philosophy

Football prediction is a **probabilistic forecasting** problem, not a sequential decision problem. Therefore:

- **Primary learning = periodic batch retraining + recalibration** on accumulated settled predictions.
- **Online learning is limited to sufficient statistics** (Elo updates, rolling form, running calibration stats) — not gradient updates in production.
- **Reinforcement learning is rejected** — no meaningful reward signal exists per-decision that wouldn't just re-derive from match outcomes, and it adds unacceptable instability for a forecasting product.
- **Incremental learning** is used only where it's mathematically safe: Elo/strength ratings, exponentially-weighted form stats.
- **All model changes go through champion/challenger** — the system proposes, validates, and only promotes on statistical evidence.

The system optimizes for **calibrated probability + positive expected value**, never for "more wins."

## 2. Complete Autonomous Operating Architecture

```
                    ┌────────────────────────────────────────────┐
                    │            SCHEDULER (durable)              │
                    │  Vercel Cron (trigger) → job queue          │
                    │  Supabase pg_cron / cron_executions table   │
                    └──────┬──────────────┬──────────────┬────────┘
                           │              │              │
              ┌────────────▼───┐  ┌───────▼────────┐  ┌──▼─────────────┐
              │ DATA COLLECTION │  │ PREDICTION     │  │ SETTLEMENT &   │
              │ (fixtures, odds,│  │ GENERATION     │  │ MONITORING     │
              │  injuries, xG)  │  │ (central       │  │ (results, HT,  │
              │                  │  │  engine)       │  │  events, stats)│
              └────────┬─────────┘  └───────┬────────┘  └───────┬────────┘
                       │                    │                   │
                       ▼                    ▼                   ▼
              ┌────────────────────────────────────────────────────┐
              │              SUPABASE (system of record)             │
              │  fixtures · odds_snapshots · predictions ·          │
              │  prediction_inputs (immutable) · settlements ·      │
              │  model_versions · experiments · evaluation_results  │
              └───────────────┬───────────────────────┬────────────┘
                              │                       │
                   ┌──────────▼─────────┐   ┌─────────▼──────────┐
                   │ ANALYTICS/RESEARCH │   │ REALTIME FAN-OUT   │
                   │ (Python workers,   │   │ (Convex or Supabase│
                   │  walk-forward,     │   │  Realtime for UI)  │
                   │  challenger train) │   └────────────────────┘
                   └──────────┬─────────┘
                              │
                   ┌──────────▼─────────┐
                   │ LEARNING SUBSYSTEM │
                   │ perf analyzer ·    │
                   │ error intelligence │
                   │ experiment engine  │
                   │ model registry     │
                   │ promotion gate     │
                   └────────────────────┘
```

### 2.1 Daily lifecycle (the 10-stage cycle, mapped to implementation)

| Stage | Implementation | Schedule |
|---|---|---|
| 1. Data collection | Collector services → `ingest()` → validation → `ingestion_runs` log | Every 1–6h staggered by data type |
| 2. Match analysis | Feature builder reads feature store + snapshots | On-demand per fixture in predict run |
| 3. Prediction generation | `/api/v1/cron/predict` → `predictMatchEnsemble` → predictions + `prediction_inputs` snapshot | Every 4h (existing) |
| 4. Match monitoring | Status poller: scheduled→live→HT→FT; exponential backoff; skip completed | Every 15–30min on match days |
| 5. Settlement | `/api/v1/cron/settle` → verified results → per-market rules incl. push/void/postpone | Every 30–60min |
| 6. Evaluation | `evaluation` job: Brier/log-loss/ECE/accuracy per market×league×confidence-band×model_version | Daily after settlement |
| 7. Error investigation | Error-intelligence job: slice settled preds by feature buckets, flag systematic bias (n≥threshold) | Daily/weekly |
| 8. Experiment proposal | Rule-based + analyst-triggered experiments recorded in `experiments` | Weekly review + auto-candidates |
| 9. Validation & promotion | Walk-forward challenger eval → promotion gate → deploy or reject | Weekly retrain cycle |
| 10. Repeat | All jobs idempotent; cron locks; failure alerts | Continuous |

## 3. Prediction Lifecycle & Versioning

- **Never overwrite.** Each prediction row belongs to a `prediction_run`. Re-prediction before kickoff (new info) creates a new run's rows; old rows remain for evaluation of "what we knew when."
- **`prediction_inputs`** stores the immutable snapshot ONCE per fixture per run (feature vector, odds, injuries, lineups, weather, versions). All ~24 market rows reference it — avoids duplication.
- **`prediction_settlements`** is append-only: result, actual score, settled_at, settlement_version. Pushes/voids/postponed/abandoned handled explicitly per market rules.
- **Evaluation only on settled rows**, joined back to their input snapshots — enabling "what did the model see" forensics.

## 4. Prediction Memory (schema — see DATABASE plan)

`prediction_runs` → `prediction_inputs` (1 per fixture-run) → `predictions` (N markets) → `prediction_settlements` → `evaluation_results` (per market/league/band/model_version/period). Plus `model_versions`, `experiments`, `experiment_runs`, `model_promotions` (audit of every deploy/rollback).

This is the permanent foundation: every claim about performance is recomputable from these tables.

## 5. Performance Analyzer

Daily job computes, per market × league × confidence-band × model_version × period:
- n, accuracy, Brier, log-loss, ECE, calibration curve points
- ROI/CLV where odds exist
- Drift detection: rolling 30d vs prior 90d metrics; alert on significant degradation (statistical test, not raw delta)

Output → `evaluation_results` + admin Model Intelligence dashboard + daily report.

## 6. Error Intelligence Engine

Slices settled predictions by hypothesis buckets and tests for systematic bias (only when n ≥ ~100 per bucket):

| Hypothesis class | Slice examples |
|---|---|
| Draw under/over-estimation | predicted draw prob vs actual draw rate |
| Home bias | home-win calibration by league/home-advantage |
| Goal expectation | xG-predicted vs actual totals by league |
| Injury impact | error rate when key players out vs not |
| Congestion/fatigue | error rate by rest-days bucket |
| Odds movement | error rate by odds-drift bucket |
| Data quality | error rate by snapshot completeness bucket |
| High-confidence miscalibration | ECE in top confidence band |

Output: ranked `error_reports` (pattern, slice, n, effect size, p-value-ish significance, recommended experiment). Distinguishes signal (recurring, large-n) from noise (single matches).

## 7. Experimentation Engine (champion/challenger)

```
weakness identified → hypothesis → experiment spec
  → challenger trained/configured offline (Python/Node workers)
  → walk-forward eval on identical folds as champion
  → promotion gate check → PROMOTE | EXTEND | REJECT
  → record everything in experiments/experiment_runs/model_promotions
```

Experiment types supported: weight retune, feature add/remove, calibrator refit, new sub-model (e.g., Dixon-Coles), per-league params, odds-feature inclusion, XGBoost challenger.

## 8. Model Registry & Promotion Gate

`model_versions`: name, version, algorithm, feature_version, training_window, artifact_ref, metrics JSONB, status (`champion|challenger|retired|rolled_back`), parent_version.

**Promotion gate (all required):**
1. Walk-forward on ≥3 chronological folds, out-of-fold only.
2. n ≥ minimum per market (e.g., ≥500 settled-equivalent predictions).
3. Beats champion on ≥2 of {Brier, log-loss, ECE} with no market regressing beyond tolerance.
4. Calibration check (ECE not worse).
5. Stability: performance not driven by a single fold/league.
6. Leakage checklist passed (as-of-kickoff attestation per feature).
7. Human or policy approval recorded (auto-promote allowed only for calibration-only changes initially — decision D-autonomy).

Rollback: previous champion retained; one-command revert; `model_promotions` logs every transition.

## 9. Data-Leakage Prevention (hard requirements)

- Every feature carries `as_of` timestamp; CI test asserts `as_of ≤ kickoff_utc` for all features used at prediction time.
- Odds features use only snapshots captured before prediction run.
- Confirmed lineups usable ONLY in post-lineup prediction runs (T-1h), never in T-24h runs — versioned by run time.
- Training data built from `prediction_inputs` snapshots (what the model actually saw), not reconstructed hindsight.
- Untouched holdout: most recent ~10% of seasons reserved for final eval, never trained on until explicitly released.
- Walk-forward folds are strictly chronological; no random splits anywhere in promotion path.

## 10. 90-Day Unattended Operation Architecture

### Scheduling & durability
- **Vercel Cron** remains the trigger layer (9 jobs exist) — acceptable for HTTP-triggered jobs ≤10min.
- **Durable queue for heavy work**: model training, backtests, bulk ingestion → run as scheduled worker invocations (GitHub Actions cron → worker scripts, or a small always-on worker on free-tier-friendly infra — see §11). Vercel functions are NOT suitable for multi-hour training.
- **`cron_executions` table** already exists: every job writes start/finish/status/counts/duration/error → single source for health + reporting.
- **`cron_locks`** prevents concurrent duplicate runs (exists).
- **Retries**: exponential backoff, max 3, then FAILED status + alert. Idempotent writes everywhere (natural-key upserts, pending-guard settlements).

### Failure recovery
- Provider down → job retries; stale-data SLO breach → alert + predictions flagged low data-quality (not silently wrong).
- DB unreachable → jobs fail fast, alert; no partial writes (transactions/batches).
- Deployment mid-run → locks have leases; next run resumes idempotently.

### Monitoring & alerting
- Daily ops summary (auto-generated report, §13) reviewed via admin dashboard + optional email/Telegram webhook on critical failures.
- Alerts trigger on: job failure streak, quota exhaustion (odds/API), data freshness SLO breach, settlement backlog, DB size thresholds, promotion events.

### Resource discipline
- No polling completed matches; backoff on live matches.
- Batch inserts; snapshot once per fixture-run.
- Partition/archival strategy for predictions/odds (see §12).

## 11. Infrastructure Evaluation

### 11.1 Supabase Free plan feasibility (estimates, not guarantees)

Free tier (typical): 500MB DB, ~5GB bandwidth/mo, 50k MAU auth, projects pause after ~7 days inactivity (keep-alive needed — daily cron solves this), no formal SLA, daily backups limited.

**Scenario sizing (rows ≈ heap+index bytes; rough):**

| Dataset | 10K matches | 100K matches | 1M matches |
|---|---|---|---|
| fixtures+stats | ~50MB | ~500MB | ~5GB |
| predictions (~24/match) | ~500MB | ~5GB | ~50GB |
| odds snapshots (say 5/book/day) | ~200MB | ~2GB | ~20GB |
| prediction_inputs snapshots | ~300MB | ~3GB | ~30GB |

**Verdict:** Free Supabase is sufficient for the **application layer** (auth, active predictions, UI queries) at 10–100K matches if we (a) keep only recent predictions hot, (b) store snapshots compressed/TOAST-friendly, (c) archive settled history monthly. At 1M matches or heavy odds capture it WILL exceed free tier — plan Pro ($25/mo) or archival split by then.

**Hot/cold split recommendation:**
- **Hot (Supabase):** auth, profiles, current fixtures, pending predictions + their inputs, recent settlements (90d), rollover tickets, ops tables.
- **Cold (analytical):** full prediction history, all odds snapshots, training datasets, evaluation results → columnar/analytical store or compressed archive tables in same DB (partitioned) OR object storage (R2) as parquet/CSV for training exports.

### 11.2 Alternatives evaluated

| Option | Cost | Fit | Verdict |
|---|---|---|---|
| **Supabase only (Pro when needed)** | $0→$25/mo | App+DB+auth+realtime integrated; simplest ops | **Recommended core** |
| Neon (serverless PG) | free→usage | Great for dev/analytics DB; no auth/realtime/storage | Optional analytics replica — adds complexity, skip initially |
| Self-hosted PG | VPS ~$5–10 | Full control; ops burden | Not worth it now |
| ClickHouse/DuckDB | self-host/free | Excellent for odds/prediction analytics at scale | **Phase-2 option** for research analytics; DuckDB embedded for local training is free and sufficient now |
| Cloudflare R2 | ~$0.015/GB | Object storage for data archives, model artifacts, backups | **Recommended** for cold archives + model artifacts |
| Trigger.dev / queues | free tier | Durable job orchestration | Nice-to-have; `cron_executions`+locks covers needs initially; revisit if job complexity grows |
| Upstash Redis | free tier | Queue/cache/locks | Optional; PG-backed locks already work |
| Cloud Run Jobs / GH Actions | free–low | Heavy worker execution | **Recommended** for training/backtest workers (GitHub Actions cron is free for public repo, cheap for private) |

### 11.3 Recommended architecture: **Option B — Supabase-centered hybrid (lean)**

- **Supabase (new project):** system of record — app data, predictions, snapshots, settlements, ops, auth, RLS.
- **Convex:** keep ONLY if realtime fan-out proves valuable; otherwise Supabase Realtime. Decision D2 pending — default: keep existing slim Convex for live UI, zero migration cost.
- **Workers:** GitHub Actions cron (or existing local/Vercel-triggered scripts) for collectors + training; write results to Supabase.
- **DuckDB/Parquet on R2:** research/training exports and cold archives — free, fast for pandas/ML.
- **No new always-on services.** Total new infra cost target: **$0–30/mo** (Supabase Pro only when free limits approach; R2 pennies; API costs dominate if odds API paid).

### 11.4 Cost optimization rules

- Snapshot once per fixture-run (not per market).
- Store odds as append-only but partition by month; aggregate to consensus views.
- Compress JSONB snapshots (they TOAST automatically); avoid indexing inside JSONB.
- Materialized daily aggregates for dashboards; never scan raw predictions for UI.
- Feature store: compute once per team-window, version, reuse across fixtures.
- Retention: raw odds snapshots >180d → archive to R2 parquet; predictions >1yr → archive (keep aggregates).
- Cache provider responses; respect rate limits; never refetch identical data.

## 12. Monitoring, Reporting & Alerting

### Daily intelligence report (auto-generated, stored + emailable)
- **Ops:** fixtures collected/analyzed, predictions generated/rejected, jobs ok/failed, data failures, DB/storage/API usage.
- **Results:** settled, correct/incorrect, per-market accuracy, calibration snapshot, rollover ticket result.
- **Learning:** error patterns flagged, experiments opened/closed, challenger metrics, promotions/rollbacks.
- **Infra:** DB size, storage, API quota usage, worker health, est. cost.
- Clearly separates ACTUAL (settled) vs PENDING vs ESTIMATED.

### Weekly/monthly
- Rolling accuracy/Brier/ROI/CLV trends, model version comparisons, league/market breakdowns, cost report, 90-day-soak metrics.

### Alerting channels
- Admin dashboard banner + `notifications` table; optional webhook (Telegram/Slack/email) for critical only (job failure streaks, quota exhaustion, credential missing, settlement backlog, promotion events).

## 13. The 90-Day Soak Test (acceptance harness)

Run after Phase D lands, before public launch claims:

| Metric | Target |
|---|---|
| Daily predict-job success | ≥99% (allow provider outages w/ retry) |
| Settlement completeness | 100% of finished fixtures settled ≤24h |
| Duplicate predictions | 0 (idempotency verified) |
| Unhandled job failures | 0 (all retried or alerted) |
| Snapshot coverage | 100% of predictions have inputs |
| Data freshness SLO | odds ≤2h, injuries ≤24h, results ≤30min post-FT |
| DB growth | within projection; archival working |
| Cost | within approved budget |
| Model events | promotions only via gate; rollbacks tested |
| Reports | daily/weekly generated automatically |

Soak produces `docs/SOAK-REPORT-90D.md` with real numbers — the honest proof of autonomy.

## 14. Implementation Roadmap (slots into IMPLEMENTATION-ROADMAP phases)

- **A:** snapshots (A2), unified team-state (A3), new schema incl. `prediction_runs/inputs/settlements/model_versions/experiments/evaluation_results`, ops tables.
- **B:** ingest service, odds feed, monitoring job, freshness SLOs.
- **C:** calibration, challenger harness, registry+gate, NO_PREDICTION gate, Dixon-Coles.
- **D:** rollover engine + backtest (consumes same prediction memory).
- **E–F:** dashboards surface evaluation_results, error reports, model registry, daily report page.
- **New Phase G′ (Autonomy):** monitoring/alerting hardening, 90-day soak harness, archival/retention jobs, weekly retrain automation via GH Actions, error-intelligence job, daily report generator.
- **H:** production gates incl. soak test.

## 15. Testing Requirements (autonomy-specific)

- Job idempotency tests (run twice → same state).
- Lock/lease tests under concurrent triggers.
- Settlement correctness incl. push/void/postpone/abandoned.
- Leakage test suite (§9) in CI.
- Promotion-gate unit tests (reject on each failed criterion).
- Failure-injection: provider down, DB timeout, mid-run deploy.
- Soak-test instrumentation from day one.

## 16. Production Acceptance Criteria

All §10 acceptance criteria in your spec, operationalized by §13 soak metrics + §15 tests + the global gates in TESTING-AND-QA-PLAN.md. Additionally: daily report generates without manual steps; every promotion/rollback is audited; a full prediction→settlement→evaluation→experiment cycle is demonstrable end-to-end on real data.

## 17. Open Decisions (added to DECISIONS doc)

- **D-autonomy:** may calibration-only challengers auto-promote, or always require approval? (Recommend: auto only for calibrator refits within ECE tolerance; everything else manual.)
- **D-realtime:** keep Convex slim schema vs Supabase Realtime (default: keep Convex).
- **D-archive:** R2 vs Supabase-partitioned archive for cold data (recommend R2 parquet, cheap).
- **D-workers:** GitHub Actions cron vs always-on worker vs Trigger.dev (recommend GH Actions to start — free, durable enough for scheduled jobs).
- **D-alerts:** which channel for critical alerts (dashboard-only vs +webhook).
