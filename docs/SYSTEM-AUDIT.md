# ODDLY — Complete System Audit

**Date:** 2026-11-26
**Method:** Direct code inspection of ~570 files, git history, migrations, worker scripts, API routes, and prior audit reports (Aug 25, 2026). Live Supabase queries could not be executed from this environment (network fetch failed); live DB state is marked UNVERIFIED where it could not be confirmed.

---

## 1. Executive Summary

ODDLY is a Next.js 15 + Supabase + Convex football prediction platform with a Python/Node.js ML research layer. Since the August 2026 audits, a large remediation effort landed (git log: RLS enforcement, cron registration, rate limiting, auth on admin routes, centralized ensemble wrapper, injury system, walk-forward validation). The platform is substantially more mature than the August docs suggest, but it is **not yet a coherent, verified production system**:

- **Two prediction engines coexist**: `worker/ensemble-model.js` (v5.0, Poisson+Elo+Regression+isotonic) and `worker/models/meta-ensemble.js` (v2.0 meta-ensemble of market-specific models) used by `src/lib/models/ensemble.ts`. Python XGBoost v6 models exist as candidates. Which model actually produces live predictions must be confirmed per code path.
- **Prediction traceability is computed but not persisted**: `predictMatchEnsemble` returns `featureSnapshot`/`ensembleOutputs`, but the predict cron inserts only `fixture_id, market, selection, model_probability, model_version` — snapshots are discarded. The immutable-snapshot requirement is NOT met.
- **The 2-odds rollover strategy is not implemented as an engine.** The `/rollover` page is a user-managed compounding tracker fed by a `recommendations` table with no automated qualification, combination search, or backtesting.
- **Screenshot-to-analysis is not implemented** (no OCR/parsing code exists).
- **Zero automated tests exist** (no `.test.`/`.spec.` files, no Jest config despite jest deps in package.json).
- **Live DB state unverifiable** from this environment; all row counts below are from August docs and marked accordingly.

### Severity Summary (current)

| Severity | Count | Examples |
|---|---|---|
| P0 | 4 | No tests; traceability snapshots discarded; dual prediction engines; rollover strategy absent |
| P1 | 7 | Unverified live DB; model-version sprawl; local-JSON data layer; no data-snapshot immutability; Convex slim-schema migration incomplete; odds coverage near zero; no champion/challenger promotion |
| P2 | 6 | UX inconsistency; admin pages partially decorative; settlement only last 7 days; injury data freshness unverified; no market-specific calibration in prod path; no notifications pipeline verification |
| P3 | 4 | Stale docs (MASTER-DOCUMENTATION predates Sept changes); Trezo template unused; duplicated worker scripts; .next build artifacts in repo root context |

---

## 2. Actual Architecture (verified from code)

```
DATA SOURCES                          STORAGE                     COMPUTE                     PRODUCT
─────────────                          ───────                     ───────                     ───────
football-data.org ──┐
StatsBomb (xG)     ──┤                                                        ┌─ Next.js 15 App Router
API-Football       ──┤    ┌──────────────┐    ┌──────────────────┐         │   (marketing/auth/dashboard/admin)
The Odds API       ──┤───▶│  Supabase    │───▶│  Cron routes     │         │
Understat (broken) ──┤    │  (hot/live)  │    │  /api/v1/cron/*  │         ├─ API routes /api/v1/*
Transfermarkt      ──┤    │  ~30 tables  │    │  (9 registered)  │         │
OpenWeatherMap     ──┤    └──────┬───────┘    └────────┬─────────┘         │
web scrapers       ──┘           │                     │                   │
                                 │              ┌──────▼───────┐           │
                    ┌────────────▼─────┐        │ ensemble.ts  │           │
                    │ Local JSON /data │        │ wrapper      │           │
                    │ (60+ files)      │        └──────┬───────┘           │
                    └──────────────────┘               │                   │
                                              ┌────────▼────────┐          │
                                              │ meta-ensemble  │          │
                                              │ v2.0 (market   │          │
                                              │ models + draw  │          │
                                              │ + cross-signals│          │
                                              └─────────────────┘          │
                                                                   ┌────────▼────────┐
                                                                   │ Convex (slim)   │
                                                                   │ livePick,       │
                                                                   │ valuePicks,     │
                                                                   │ settlementFeed, │
                                                                   │ liveStats       │
                                                                   └─────────────────┘
```

**Key correction vs `docs/ARCHITECTURE.md`:** Convex is no longer the cold-storage warehouse described in August. `convex/schema.ts` is now a deliberately slim 5-table realtime schema; historical data lives in Supabase. The old `docs/ARCHITECTURE.md` data-ownership matrix is stale.

### Prediction data flow (verified)

1. `GET /api/v1/cron/predict` (every 4h, Vercel cron) → loads fixtures 0–48h out → rebuilds Elo + form from last 2,000 finished fixtures → `predictMatchEnsemble()` per fixture → inserts one `predictions` row per market (≈24 markets/fixture).
2. `predictMatchEnsemble` (`src/lib/models/ensemble.ts`) → `worker/models/meta-ensemble.js` → `market-1x2`, `market-goals`, `market-btts`, `market-dc`, `market-draw`, `cross-model-signals`.
3. `GET /api/v1/cron/settle` (every 4h) → last 7 days of finished fixtures → rebuilds Elo/form **chronologically over only those fixtures** (⚠️ Elo state is windowed, not career-to-date — a correctness concern) → `predictMatchEnsemble` → `checkPrediction` → writes `result`, `settled_at`, failure diagnostics on wrong picks → archives to `settlement_feed` → updates `model_performance`.
4. `GET /api/v1/cron/sync` (every 6h), `/cron/pipeline` (hourly), `/cron/daily` (6am), `/cron/learn` (Sun 3am), `/cron/archive` (every 4h), `/cron/cleanup` (4am), `/cron/validate` (5am).

### Parallel/duplicate compute paths (technical debt)

| Path | Purpose | Status |
|---|---|---|
| `src/lib/models/ensemble.ts` + `worker/models/*` | Production predictions via crons | ACTIVE |
| `worker/ensemble-model.js` (v5.0) | Standalone ensemble w/ isotonic calibrator | LEGACY — still runnable via `npm run ensemble` |
| `worker/daily-loop.js` | predict/settle/learn daily loop | LEGACY — overlaps cron routes |
| `worker/betting-pipeline.js` | Phase orchestrator (24h/1h/15min/post) | PARTIAL — runs via `/api/v1/cron/pipeline` hourly |
| `scripts/train-*.py`, `worker/train-*.js` | XGBoost/LightGBM training | RESEARCH — candidates never promoted |
| `worker/market-models.js`, `predict-v2.js`, `predict-enhanced.js` | Alternate predictors | EXPERIMENTAL |
| `src/lib/nvidia/*` | NVIDIA NIM AI explanations/chat | PARTIAL — ai-chat route only |

---

## 3. Feature Inventory

Status key: ✅ COMPLETE · 🟡 PARTIAL · 🔴 BROKEN · ⬜ NOT IMPLEMENTED · ♻️ DEPRECATED · ❓ UNVERIFIED

### Data & Ingestion

| Feature | Status | Evidence / Notes |
|---|---|---|
| Fixture sync (football-data.org) | ✅ | `scripts/sync-football-data-org.js`, `/api/v1/cron/sync` |
| Historical backfill (30K+ matches claimed) | ❓ | `scripts/collect-historical-data.js`, `backfill-historical.js`; count unverified |
| StatsBomb xG collection | ✅ | `scripts/collect-statsbomb*.js`, `data/statsbomb-xg.json` |
| Understat xG scraping | 🔴 | Aug audit: 0 teams/matches; `data/understat-*.json` still present but scraping failed |
| Injury collection (multi-source) | 🟡 | New Sep-2026 system: `scripts/collect-injuries-*.js`, `supabase/20260902*_enhanced_injury_system*.sql`, `src/lib/injury/` — migrations are **untracked files**, may not be applied |
| Referee data | 🟡 | `scripts/analyze-referees.js`, `collect-football-data.js`; referee tables created in migration `20260826010000`; Supabase usage unverified |
| Odds collection (The Odds API) | 🟡 | `scripts/fetch-odds-*.js`, `worker/fetch-odds-smart.js`; Aug audit: quota exhausted, 16 fixtures w/ features |
| Asian Handicap odds scraping | 🟡 | `worker/scrape-ah-odds.js`, `data/ah-odds.json` — exists but production use unverified |
| Weather collection | 🟡 | `worker/collect-weather.js`, `data/weather-features.json` — script exists; integration into features unverified |
| Player stats collection | 🟡 | `scripts/collect-player-stats*.js`, `data/player-stats.json` (265 players claimed) |
| Lineup prediction | 🟡 | `worker/predicted-lineups.js`; no confirmed-lineup ingestion |
| Team logo sync | ✅ | `scripts/sync-logos*.js`, `fetch-logos-v2.js` |
| Data validation framework | 🟡 | `scripts/audit-*.js`, `/api/v1/cron/validate`, `validation_results` table (migration `20260902020000`, untracked file at root) |
| Timestamped prediction snapshots | 🔴 | Computed in `ensemble.ts` but **discarded at insert** (predict route lines 147–156) |

### Prediction Engine

| Feature | Status | Evidence / Notes |
|---|---|---|
| Meta-ensemble v2.0 (production path) | ✅ | `worker/models/meta-ensemble.js` + 5 market models + cross-signals |
| 1X2 model | ✅ | `worker/models/market-1x2.js` |
| Goals/OU model (0.5–3.5) | ✅ | `worker/models/market-goals.js` |
| BTTS model | ✅ | `worker/models/market-btts.js` |
| Double Chance model | ✅ | `worker/models/market-dc.js` |
| Dedicated draw model | ✅ | `worker/models/market-draw.js` (added post-Aug) |
| Ensemble v5.0 (Poisson+Elo+Reg+isotonic) | ♻️ | `worker/ensemble-model.js` — legacy, isotonic calibrator in `models/isotonic-calibrator.json` |
| XGBoost v6 (47 features) | 🟡 | Trained models in `models/xgboost_*.json`, `data/xgboost-results/*`; reported 68.6% on **test set** (leakage risk per Aug audit); never promoted |
| Per-league models | 🟡 | `scripts/train-per-league.py`, `worker/train-per-league.js`, `data/per-league-models.json` — experimental |
| Dixon-Coles | ⬜ | Spec'd in SELF_TRAINING_ENGINE.md and DATA-POINTS.md; **no implementation found** |
| Bayesian/Elo dynamic strength | 🟡 | Elo implemented inline (simple 32-K update); no Bayesian hierarchical model |
| Calibration (isotonic) | 🟡 | Exists for legacy v5.0; meta-ensemble path has no calibration step |
| Market-implied probability features | 🔴 | Odds features exist in data files but odds API exhausted; not wired into ensemble features |
| Champion/challenger promotion | ⬜ | `experiment-registry.js`, `data/experiment-registry.json` track experiments; no automated promotion gate |
| Confidence framework | 🟡 | `confidence_tier` (ELITE/HIGH/MEDIUM/LOW) = probability thresholds only; no data-quality/uncertainty composite |
| "No reliable prediction" output | ⬜ | Not implemented — every fixture gets predictions unconditionally |

### Settlement & Evaluation

| Feature | Status | Notes |
|---|---|---|
| Prediction settlement | ✅ | `/api/v1/cron/settle` uses shared `checkPrediction` (fixed since Aug) |
| Settlement window | 🟡 | Only last 7 days, limit 500 fixtures/run |
| Settlement idempotency | ✅ | `.eq("result","pending")` guard + cron locks (`lib/cron/lock.ts`) |
| Failure diagnostics | 🟡 | Stores sub-model probs/disagreement on wrong picks — but only when ensemble succeeds |
| `model_performance` updates | 🟡 | Rolling 24h window only; Brier computation has an O(n²) `find` bug risk and mismatched prob↔result pairing |
| Walk-forward validation | ✅ | `worker/walk-forward.py`, `scripts/walk-forward-*.js`, `/api/v1/cron/validate`, `admin/walk-forward` page |
| CLV tracking | 🟡 | `worker/clv-tracker.js`, `data/clv-snapshots.json`; limited by odds data |
| Prediction archiving | ✅ | `settlement_feed` table + archive cron |

### Product / UX

| Feature | Status | Notes |
|---|---|---|
| Marketing site | ✅ | `src/app/(marketing)` + `components/landing/*` |
| Auth (login/signup/forgot) | ✅ | Supabase Auth, middleware-protected |
| Dashboard | ✅ | `(dashboard)/dashboard` |
| Matches list/upcoming/results/[id] | ✅ | Match detail drawer w/ H2H, form, markets |
| Predictions page | ✅ | Lists generated predictions |
| Accumulator builder | 🟡 | `accumulator` pages + `actions/bets.ts`; manual, no optimizer found |
| **2-odds rollover engine** | 🔴 | `/rollover` = user-managed chains + `recommendations` table; **no qualification engine, no ~2.00 combination search, no backtest, no auto daily pick** |
| Performance/tracking pages | 🟡 | Exist; metrics source unverified |
| Notifications | 🟡 | Pages + `lib/notifications`; delivery pipeline unverified |
| AI chat | 🟡 | `ai-chat` page + `/api/v1/ai-chat` + `lib/nvidia` (NVIDIA NIM) |
| Betting agent | 🟡 | `betting-agent` page + 3 API routes + `worker/betting-agent.js`; Nigerian-bookmaker research doc exists; booking-code generation unverified |
| Stripe billing | 🟡 | Routes + `lib/stripe` exist; `.env.example` marks optional/disabled; subscription gating unverified |
| Admin panel (13+ pages) | 🟡 | Pages exist for accuracy, pipeline, referees, users, rls, security, model-health, walk-forward, injuries, etc.; depth varies; some metrics may be placeholders |
| Screenshot-to-analysis | ⬜ | **Not implemented** — no OCR/parsing anywhere |
| Design system | 🟡 | `DESIGN.md` + `components/ui/*` (Card, Badge, StatCard, EmptyState, PageHeader); consistent but unverified coverage |

### Infrastructure / Ops

| Feature | Status | Notes |
|---|---|---|
| Vercel crons | ✅ | 9 jobs registered in `vercel.json` (fixed since Aug) |
| Cron auth + locking + logging | ✅ | `VERCEL_CRON_SECRET`, `lib/cron/lock.ts`, `lib/cron/logger.ts`, `cron_executions` infra |
| Rate limiting | ✅ | `lib/api/rate-limits.ts` (sliding window, per git log) |
| Admin auth middleware | ✅ | `src/middleware.ts` role check + `requireAdmin` in API utils |
| RLS | ❓ | Migrations `20260826000000_enforce_rls`, `20260902030000_fix_rls_anon_exposure`, `20260902010000_rls_player_injury_and_league_params` exist; **whether applied to live DB unverified** |
| Input validation | 🟡 | `lib/api/validation.ts` (zod) on some routes |
| Error boundaries | ✅ | `error.tsx` files + `GlobalErrorBoundary` |
| Tests | 🔴 | **Zero test files; jest deps installed but no config/tests** |
| CI/CD | 🔴 | No GitHub Actions workflows found |
| TypeScript build | ✅ | `tsconfig.tsbuildinfo` present; `npm run type-check` available |
| Observability | 🟡 | `lib/observability/tracer.ts` exists; coverage unknown |
| Backup/DR | ⬜ | No documented backup strategy |

---

## 4. Documentation Drift

| Doc | Reality gap |
|---|---|
| `docs/MASTER-DOCUMENTATION.md` (Aug 25) | Pre-dates Sept injury system, draw model, walk-forward cron, slim Convex schema, 9-cron vercel.json. Its "Critical NOT FIXED" list is largely resolved. |
| `docs/FULL-SYSTEM-AUDIT.md`, `QA-STRESS-TEST-REPORT.md`, `SECURITY-AUDIT-REPORT.md` | Same vintage; many findings fixed (see git log Aug 26–Sep 2). Still useful as baseline. |
| `docs/ARCHITECTURE.md` | Describes Convex as cold-storage warehouse — now slim realtime-only. Data ownership matrix stale. |
| `docs/DEVELOPMENT_PLAN.md` | V3.0 plan (Dixon-Coles, NVIDIA, Paystack) partially diverged: Stripe (not Paystack) chosen, Dixon-Coles never built, meta-ensemble replaced Poisson-centric design. |
| `docs/SELF_TRAINING_ENGINE.md` | Spec for daily/weekly/monthly retrain loop — only partially realized (`/cron/learn`, `weekly-retrain.js` exist; champion/challenger does not). |
| Root-level `supabase/*.sql` (~30 files) | Many ad-hoc fix scripts (`FIX-NOW.sql`, `fix-everything.sql`, `run-all-*.sql`) alongside canonical `supabase/migrations/` — migration history is not clean/version-controlled end-to-end. Two injury migrations and three root migrations are **untracked in git**. |
| `data/*.json` (60+ files) | Research artifacts mixed with quasi-database state; no provenance/versioning. |

---

## 5. Top Risks (ranked)

1. **No test coverage** — every model/settlement change is unverifiable regression risk.
2. **Silent snapshot loss** — predictions cannot be reproduced or leakage-audited after the fact.
3. **Engine sprawl** — 3+ JS predictors + Python candidates; unclear which is authoritative per environment.
4. **Odds data starvation** — value/rollover/CLV features depend on an exhausted free API.
5. **Unverifiable live state** — cannot confirm which migrations/RLS/data actually exist in the current Supabase project (and the project is being replaced anyway).
6. **Settlement Elo windowing** — settle cron rebuilds Elo from only the last 7 days of fixtures, producing different team strengths than the predict cron's 2,000-match window. Accuracy attribution is biased.
7. **Rollover strategy absent** — the stated #1 product objective has no engine.

---

## 6. What Is Worth Keeping

- Meta-ensemble architecture (market-specific models + cross-signals + draw specialist) — genuinely good design.
- Walk-forward validation framework + experiment registry concept.
- Cron infrastructure (locks, logging, idempotent settlement).
- Injury intelligence system (tables, feature pipeline, admin UI) — newest, most complete subsystem.
- 30K+ historical matches, team/league/referee/xG datasets in `/data` and DB.
- UI component library + page inventory.
- NVIDIA NIM integration for explanations/chat.
