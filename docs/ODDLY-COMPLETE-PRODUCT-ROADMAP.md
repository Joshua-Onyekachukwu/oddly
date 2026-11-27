# ODDLY — Complete Product Roadmap (Master Implementation Plan)

**Date:** 2026-11-27 · **Source:** ODDLY-PRODUCT-AUDIT-BRIEF.md §23–24 + PRODUCT-AUDIT-FINDINGS.md
**Status:** Audit output — **awaiting user approval before any implementation.**
Cross-refs: [MASTER-PLAN.md](MASTER-PLAN.md) · [IMPLEMENTATION-ROADMAP.md](IMPLEMENTATION-ROADMAP.md) · [PRODUCT-ROADMAP.md](PRODUCT-ROADMAP.md) · [ODDLY-PREDICTION-IMPROVEMENT-ROADMAP.md](ODDLY-PREDICTION-IMPROVEMENT-ROADMAP.md) · [ODDLY-ROLLOVER-ENGINE-SPEC.md](ODDLY-ROLLOVER-ENGINE-SPEC.md) · [ODDLY-ADMIN-PLATFORM-PLAN.md](ODDLY-ADMIN-PLATFORM-PLAN.md) · [ODDLY-FEATURE-IMPLEMENTATION-TRACKER.md](ODDLY-FEATURE-IMPLEMENTATION-TRACKER.md) · [ODDLY-UI-UX-REDESIGN-PLAN.md](ODDLY-UI-UX-REDESIGN-PLAN.md) · [ODDLY-PRODUCT-ACCEPTANCE-CRITERIA.md](ODDLY-PRODUCT-ACCEPTANCE-CRITERIA.md)

Complexity: S(<1d) M(1–3d) L(3–7d) XL(>1wk). Priority: P0 essential foundation / P1 core expansion / P2 advanced.

## Global constraints (apply to every item)

- **Free-tier APIs** — Odds API quota exhausted; API-Football free tier; Open-Meteo free. No paid provider without explicit budget approval (see D1 in IMPLEMENTATION-ROADMAP).
- **Vercel serverless** — no `fs` state (migrated to `app_state`), no long-running workers, **9 crons registered in `vercel.json` vs Hobby-plan limits** (plan mismatch — consolidate or upgrade plan).
- **Freemium→paid** — `src/lib/subscription/entitlements.ts` exists; enforcement flag OFF. Roll direction: rollover=elite, ai.chat=elite, accumulator/value_bets/betting_agent/analytics.advanced=premium. User direction: leave features open for now; enforce only at paid launch.
- **Audit-first** — this document IS the audit output. Nothing here is approved for build yet.
- **Audit-first rule for data** — no invented stats, no decorative metrics, every number traceable to a query (PRODUCT-ROADMAP acceptance criteria).

---

## Feature register (P0 / P1 / P2)

### P0 — Essential foundation (truth, data, engine traceability)

| # | Feature | Status | User value | Tech / DB / backend / frontend reqs | Deps | Cx | Tests | Acceptance |
|---|---|---|---|---|---|---|---|---|
| F-01 | Test harness (Jest) + unit tests for prediction math, team-normalizer, odds math | Partial — Jest exists, **28 tests only** | Indirect (enables safe change) | `npm test` infra; tests for `src/lib` | — | M | Self-referential | AC-01 |
| F-02 | Immutable prediction input snapshots (featureSnapshot, ensemble outputs, odds, data-quality) | Partial — tables exist (`prediction_snapshots` migration), prod path coverage unverified | High — auditability of every pick | DB write in predict path; `prediction_snapshots`/`input_snapshot` | — | M | Snapshot completeness test | AC-02 |
| F-03 | Unified Elo/form builder shared by predict+settle | Unknown/partial — reported divergence risk | Medium — correctness | Refactor `src/lib` Elo/form; both crons consume | F-02 | M | Parity test predict vs settle | AC-03 |
| F-04 | Honest accuracy baseline by model_version/market/league | Done — `EVALUATION-BASELINE-2026-11.md` (41.7% 1X2 argmax vs 43.5% always-home; OU2.5 54.0%; BTTS 51.6%) | High — truthful marketing + gating | `model_performance` queries; report | — | S | Report reproducible | AC-04 |
| F-05 | Fix `model_performance` Brier computation bug (per findings) | Partial | High — metrics trustworthy | Fix rolling update query | F-04 | S | Unit test | AC-05 |
| F-06 | `recommendations` table populated from ensemble output in predict cron | **Missing wiring** — only manual NVIDIA runs populate it; value-bets/accumulator/notifications starve | High — powers 3+ user features | Write recommendations in `/api/v1/cron/predict` | F-02 | M | Cron output assertion | AC-06 |
| F-07 | Odds data flow (retention + CLV + movement) | Partial — odds_snapshots retained (dedupe+30d) but feed thin; quota constraints | High — EV, value, rollover all depend | The Odds API paid tier OR API-Football odds — **open decision D1**; snapshot at T-24h/T-2h/T-1h | Decision | M | Snapshot cadence test | AC-07 |
| F-08 | Entity resolution hardening (canonicalizer consolidation, provider-namespaced external_id, confidence-scored matching) | Partial — `normalizeTeamName` exists+tested; duplicated logic; ilike first-match; external_id collision risk | Medium — data integrity | Consolidate into one module; schema `external_id` namespace | — | M | Normalizer + collision tests | AC-08 |
| F-09 | `settlement_feed` append-only + settlement corrections auditable (never silent overwrite) | **Partial — currently delete-all rebuild; cleanup deletes finished fixtures >30d with FK NO ACTION risk** | High — trust | Migration: append-only feed + correction records; fix cleanup FK | — | M | Audit-trail test | AC-09 |
| F-10 | Cron consolidation (9 Vercel crons vs plan limit; hourly pipeline duplicates settle/predict/archive) | Partial — jobs work but overlap; plan mismatch | Medium — cost/reliability | Merge jobs or upgrade plan; keep lock+log | — | M | Idempotency tests | AC-10 |
| F-11 | Rollover engine v1 → spec-complete v2 (QUALIFIED/WAIT/SKIP, correlation-aware combos ~2.00, monthly tracker) | Partial — `src/lib/rollover/engine.ts` + `/rollover` page + recommendation API exist; spec gaps tracked | **Core strategic objective** | Engine per ODDLY-ROLLOVER-ENGINE-SPEC.md; `rollover_tickets` table; settlement | F-02, F-06, F-07 | L | Engine unit tests (28 exist); combo-prob correctness | AC-11 |
| F-12 | Database types regeneration (`database.types.ts` ~24 vs 67 tables stale) | **Missing** | Medium — dev velocity/type safety | Regenerate from Supabase | — | S | `tsc` clean | AC-12 |
| F-13 | Migrations consolidation (15 in `supabase/migrations` + ~35 loose root SQL) | Partial | Medium — maintainability | Single migration authority | — | M | Migration lint | AC-13 |

### P1 — Core expansion (product surface + intelligence)

| # | Feature | Status | User value | Tech / DB / backend / frontend reqs | Deps | Cx | Tests | Acceptance |
|---|---|---|---|---|---|---|---|---|
| F-14 | Calibration layer in prod path (isotonic/platt walk-forward; per-market/league) | Missing in prod (offline exists) | **High** — prerequisite for confidence claims | Calibrator tables + predict-path application | F-04 | M | Calibration eval harness | AC-14 |
| F-15 | Data-quality scoring + `NO_PREDICTION` abstention gate | Missing | High — honest confidence | Quality score per prediction; gate in predict | F-02, F-14 | M | Gate unit tests | AC-15 |
| F-16 | Match Intelligence full page (form, H2H, xG, injuries, lineups, referee, odds+movement, predictions, evidence, missing-info labels) | Partial — `/matches/[id]` exists (predictions+recs+odds); drawer exists | High | New page composition; provider data joins | F-07, injury/lineup wiring | L | Component + e2e | AC-16 |
| F-17 | Predictions centre upgrade (browse/filter/search/compare; prob vs model-confidence vs data-quality vs EV vs model-version vs timestamp; per-prediction evidence) | Partial — `/predictions` exists (tier/league/date filters) | High | API filters + UI columns | F-15, F-02 | M | API tests | AC-17 |
| F-18 | Dashboard rebuild (today's fixtures, featured qualified picks, rollover card, performance snapshot, settlements feed, alerts) | Partial — `/dashboard` exists (5-min poll) | High — landing experience | New sections; honest empty states | F-11, F-14 | L | e2e | AC-18 |
| F-19 | Analytics/performance centre (accuracy, Brier, log-loss, calibration, per-market/league/band, CLV, ROI only with verified records; separate simulated vs real) | Partial — `/performance` exists; no CLV/ROI honesty split | High | Aggregation queries + charts (no chart lib in deps — pick one) | F-04, F-05, F-07 | M | Metric tests | AC-19 |
| F-20 | Results & history consolidation (`/tracking` + settlements; immutable snapshots; corrections visible) | Partial — `/tracking` exists (user_bets admin-only settle fixed) | Medium | Merge/clarify routes; audit view | F-09 | M | e2e | AC-20 |
| F-21 | Notifications productization (match/prediction/lineup/odds/result/settlement/favourite/rollover/account; preferences) | Partial — inbox table-backed (fixed); **no email/push delivery** | Medium | Notification dispatcher; preference model exists | — | M | Delivery tests | AC-21 |
| F-22 | AI assistant grounding (explains predictions/matches from real data; verified-fact vs interpretation labels) | Partial — `/ai-chat` SSE via NVIDIA works; rate limits fixed | Medium | Prompt grounding in snapshots; guardrails | F-02 | M | Prompt eval | AC-22 |
| F-23 | Admin platform (see ODDLY-ADMIN-PLATFORM-PLAN.md): 11-section control centre + `admin_activity_log` audit coverage | Partial — 20 admin pages exist; major gaps | High — operations | Per admin plan | — | XL | Admin e2e | AC-23 |
| F-24 | Subscriptions/billing launch (tiers, entitlements enforcement, trials, Stripe live, support) | Backend coded, **dormant** — no checkout UI, no subscriptions tables, pricing CTAs disabled | Revenue | `subscriptions`/`subscription_events`/`invoices` tables; checkout UI; enforcement flag ON; webhook→entitlements | Decision (timing) | L | Webhook + entitlement tests | AC-24 |
| F-25 | UI/UX redesign (design tokens, IA, mobile strategy, states, a11y — see ODDLY-UI-UX-REDESIGN-PLAN.md) | Partial — DESIGN.md + ui/ components exist; drift | Medium | Per UI plan | — | L | Visual/a11y checks | AC-25 |
| F-26 | Injury/lineup pipeline completion (`feature-engineering.ts` → predict cron → `injury_features_used`; API-Football free-tier limits) | Partial — 64 rows scraped; impact ~0 (stale expected_return) | Medium | Wire into prod feature path; refresh logic | F-02 | M | Feature-presence test | AC-26 |
| F-27 | Dixon-Coles challenger + champion/challenger registry (model_versions/experiments; promote/rollback) | Missing in prod path (XGB candidates unpromoted) | High — model quality | New model + registry tables + eval harness | F-04, F-14 | L | Walk-forward gate | AC-27 |
| F-28 | Competition + team intelligence pages (standings, fixtures, results, stats, prediction performance, data coverage; entity-resolved profiles) | Partial — data exists (450 teams, 113 referee profiles, league params); no dedicated pages | Medium | New routes + aggregation APIs | F-08 | M | — | AC-28 |
| F-29 | Odds/market intelligence page (open/current/closing, movement, implied prob, margin, consensus, model-vs-market, CLV; source+timestamp) | Partial — odds shown on match/predictions; no dedicated page | Medium | Depends on F-07 depth | F-07 | M | — | AC-29 |
| F-30 | Live centre (live scores/events where licensed; honest pre-match vs live labelling) | Missing | Low–Med | Provider licence decision; never present pre-match as live | Provider | L | — | AC-30 |
| F-31 | Player intelligence (only where providers support; no invented stats) | Missing | Low | API-Football/Sportmonks data | Provider | L | — | AC-31 |
| F-32 | Security/ops hardening: secrets rotation (old service-role JWT, DB password, API-Football key **still in git history**), CI pipeline (no `.github/workflows`), E2E suite | Partial — tree scrubbed; history compromised; no CI/E2E | High — production safety | Rotate secrets; GH Actions; Playwright | — | M | CI green | AC-32 |

### P2 — Advanced

| # | Feature | Status | Notes | Cx | Deps |
|---|---|---|---|---|---|
| F-33 | Screenshot-to-analysis (OCR → fixture/odds match → central engine → immutable record) | Missing | Reuse `predictMatchEnsemble`; never parallel engine | XL | F-15 |
| F-34 | Additional markets (AH, corners, cards) | Missing | Only after data+model proof per market | XL | F-14, F-27 |
| F-35 | Betting agent productization (NG market; booking codes) | Partial — `/betting-agent` exists, History tab "Coming Soon", betslip console.log only | Research-grade; productize after core | L | Core stable |
| F-36 | HT/FT + first-half markets | Missing | HT scores already stored | L | F-14 |
| F-37 | Weather features (Open-Meteo collected, unused) | Backend-only | Backfill + forecast ingestion | M | F-02 |
| F-38 | Market-implied probability model (devigged baseline) | Missing | Needs odds history | M | F-07 |
| F-39 | External monitoring/alerting/backup automation | Missing | No alerting beyond admin dashboard | M | F-23 |
| F-40 | Retention/archival (hot/cold split, R2 parquet) | Partial — cleanup cron exists | Per G′9 | M | — |
| F-41 | Public model report card (`/performance` public with honest metrics + n) | Missing | Marketing trust | S | F-19 |
| F-42 | Email/push notification delivery | Missing | In-app only today | M | F-21 |
| F-43 | OAuth login | Missing | Email auth works | M | — |
| F-44 | Admin approvals workflow (sensitive actions require second-admin approval) | Missing | Per §19 security/audit | M | F-23 |

---

## Phased plan

### Phase 0 — Audit & decisions (NOW; no code)

- This audit + tracker + admin plan + UI plan + acceptance criteria → **user review**.
- Resolve open decisions (see IMPLEMENTATION-ROADMAP "Open decisions"): odds provider/budget (D1), Convex keep-or-fold (A6), subscription timing (G5), Trezo adopt-or-remove.
- **Exit condition:** user approves roadmap + decisions recorded.

### Phase 1 — Truth & foundation (recommend FIRST implementation phase)

**Concrete recommendation — start with:** F-01 (tests) → F-13 (migrations) → F-12 (types) → F-02 (snapshots) → F-05/F-04 (metrics fix + baseline refresh) → F-09 (settlement audit trail) → F-10 (cron consolidation).

Rationale: everything downstream (calibration, rollover, confidence UI, admin metrics) is unverifiable until predictions are traceable, metrics are correct, settlement is auditable, and the DB surface is type-safe. All are S/M, mostly backend, low user-visible risk.

- **Parallel:** F-01 ∥ F-12 ∥ F-13. **Sequential:** F-02 → F-05 → F-09.
- **Exit:** `npm test` green on core libs; `tsc` clean; 100% new predictions carry snapshots; settlement_feed append-only; cron count within plan limits; secrets rotation ticketed.

### Phase 2 — Data & prediction intelligence

F-07 (odds — gated on D1) → F-06 (recommendations wiring) → F-08 (entity resolution) → F-14 (calibration) → F-15 (quality gate/abstention) → F-26 (injuries) → F-27 (Dixon-Coles + registry).
- **Parallel:** F-08 ∥ F-26. **Sequential:** F-07 → F-06 → F-14 → F-15 → F-27.
- **Exit:** calibrated probabilities in prod; abstention gate live; recommendations populated by cron (value-bets/accumulator stop starving); champion/challenger registry operational.

### Phase 3 — Rollover engine to spec + core product UI

F-11 (rollover v2 per spec) → F-18 (dashboard rebuild) → F-16 (match intelligence) → F-17 (predictions centre) → F-19 (analytics) → F-20 (results/history) → F-29 (odds intel) → F-28 (competition/team pages).
- **Parallel:** F-16 ∥ F-17 ∥ F-19 after F-11 lands. UI work (F-25) runs continuously in parallel.
- **Exit:** daily rollover ticket QUALIFIED/WAIT/SKIP with explanations; all audited user routes meet acceptance criteria; no decorative metrics.

### Phase 4 — Admin platform + notifications + AI grounding

F-23 (admin control centre — see admin plan phases) → F-21/F-42 (notifications + delivery) → F-22 (AI grounding) → F-32 (CI/E2E/security).
- **Exit:** every §19 admin capability present or explicitly deferred; all admin actions audited in `admin_activity_log`; CI + e2e gates green.

### Phase 5 — Monetization & advanced

F-24 (subscriptions launch — gated on product decision + Phase 3 value proof) → F-30 (live centre, provider decision) → F-33–F-36, F-38, F-44 as data permits.
- **Exit:** paid tier live with enforcement; advanced features only where validated.

### Phase 6 — Production hardening

F-39 (monitoring/alerting/backup) → soak test (90-day autonomy per AUTONOMOUS-LEARNING-ARCHITECTURE.md) → cutover gates per TESTING-AND-QA-PLAN.md.

---

## Definition of done (per phase)

- All P0 items in phase at "Complete" per tracker; acceptance criteria in ODDLY-PRODUCT-ACCEPTANCE-CRITERIA.md pass.
- No new fake/decorative data; every user-facing number traceable.
- Tests: unit for math, integration for pipeline touched, e2e smoke for UI paths touched.
- Docs updated (tracker statuses, changelog in MASTER-PLAN).

## Parallel vs sequential summary

- **Sequential critical path:** F-01 → F-02 → F-07(decision) → F-06 → F-14 → F-15 → F-11 → F-18.
- **Parallelisable:** UI/UX (F-25) throughout; admin build (F-23) parallel to Phase 3; entity resolution/injuries (F-08/F-26) parallel in Phase 2; marketing copy (F-41-adjacent) anytime after F-19.
- **Hard blockers:** D1 odds decision blocks F-07→F-11 chain; subscription timing decision blocks F-24; secrets rotation blocks any public launch claim.
