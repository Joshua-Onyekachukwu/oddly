# ODDLY — Master Plan

**Version:** 1.0 · **Date:** 2026-11-26 · **Status:** Phase One complete — awaiting roadmap approval

This is the index and executive summary for the full audit and rebuild plan. Detailed documents:

| Doc | Contents |
|---|---|
| [SYSTEM-AUDIT.md](SYSTEM-AUDIT.md) | Verified current state, architecture, feature inventory with statuses |
| [PREDICTION-ENGINE-PLAN.md](PREDICTION-ENGINE-PLAN.md) | Model audit, gaps, target engine architecture, modeling priorities |
| [DATABASE-AND-SUPABASE-PLAN.md](DATABASE-AND-SUPABASE-PLAN.md) | New Supabase schema, migration phases M0–M3, rollback |
| [DATA-INTELLIGENCE-PLAN.md](DATA-INTELLIGENCE-PLAN.md) | Provider audit, snapshot system, ingestion architecture |
| [ROLLOVER-STRATEGY-PLAN.md](ROLLOVER-STRATEGY-PLAN.md) | 2-odds engine design, qualification, backtest protocol |
| [PRODUCT-ROADMAP.md](PRODUCT-ROADMAP.md) | Full feature spec: user app, admin, internals |
| [UI-UX-REDESIGN-PLAN.md](UI-UX-REDESIGN-PLAN.md) | Page inventory, design system, content rules |
| [TESTING-AND-QA-PLAN.md](TESTING-AND-QA-PLAN.md) | Test layers, production gates |
| [IMPLEMENTATION-ROADMAP.md](IMPLEMENTATION-ROADMAP.md) | Phases A–H with task IDs, priorities, dependencies |
| [DECISIONS-AND-OPEN-QUESTIONS.md](DECISIONS-AND-OPEN-QUESTIONS.md) | 10 decisions needed + risk register |
| [AUTONOMOUS-LEARNING-ARCHITECTURE.md](AUTONOMOUS-LEARNING-ARCHITECTURE.md) | 90-day autonomous operation, learning subsystem, champion/challenger, infra evaluation, soak test |

> Note: `ARCHITECTURE.md`, `MASTER-DOCUMENTATION.md`, `FULL-SYSTEM-AUDIT.md`, `QA-STRESS-TEST-REPORT.md`, `SECURITY-AUDIT-REPORT.md` are August-2026 vintage. Many of their "critical" findings were fixed since (see git log Aug 26–Sep 2). They remain useful history but are superseded by SYSTEM-AUDIT.md.

---

## Executive Summary

ODDLY today is a **promising but unverified** football prediction platform: a Next.js app on Supabase+Convex, a market-specific meta-ensemble prediction engine, ~90 data/ML scripts, 9 registered cron jobs, and a broad (if uneven) product surface. Since the August audits, real remediation happened — RLS migrations, cron registration, auth hardening, rate limiting, a dedicated draw model, an injury-intelligence subsystem, and walk-forward validation infrastructure.

However, measured against your objectives, the honest state is:

- **The core strategic objective — a 2-odds daily rollover engine — does not exist.** The current `/rollover` page is a manual user tracker.
- **Predictions cannot be audited after the fact.** Feature snapshots are computed then discarded at insert.
- **There are zero automated tests**, so nothing can be safely changed at speed.
- **Odds data is effectively absent** (free quota exhausted), starving value analysis, CLV, market-implied features, and any rollover backtest.
- **Live database state could not be verified** from this environment, and the DB is being replaced anyway — so the migration must include a full inventory before cutover.
- **Multiple prediction engines coexist** (meta-ensemble v2.0 in prod path, legacy v5.0, Python XGBoost candidates) with no champion/challenger discipline.

## Answers to the 20 report questions (condensed)

1. **Built:** Next.js app (35+ pages), Supabase+Convex backend, meta-ensemble engine, settlement+cron infra, injury system, walk-forward research harness, admin panel, NVIDIA AI chat.
2. **Working (code-verified):** fixture sync, prediction generation, settlement, cron locking/logging, auth/admin protection, rate limiting, injury tables/migrations.
3. **Partial:** odds ingestion, xG coverage, referee features (collected, not in prod model), notifications, Stripe, betting agent, admin depth.
4. **Broken/unverified:** Understat xG scrape, production accuracy claims (must re-baseline), live DB state, several admin metrics.
5. **Not built:** rollover engine, screenshot-to-analysis, Dixon-Coles, champion/challenger, immutable snapshots (computed but not stored), tests, CI.
6. **Data held:** ~30K historical matches (claimed), 838 teams, 17+ leagues, referee/xG/injury datasets, 599K predictions (claimed, Aug), odds snapshots (sparse).
7. **Data needed:** reliable odds feed, confirmed lineups, broader xG, market-implied prices, weather (if proven).
8. **Models:** meta-ensemble v2.0 (prod), legacy v5.0+isotonic, XGBoost v6/per-league candidates (unpromoted).
9. **Accuracy:** unverifiable claims; last honest walk-forward ≈65.6% 1X2 (Aug, pre-draw-model). Must re-baseline on current model_version.
10. **Limiters:** odds starvation, missing prod features (xG/referee/H2H hardcoded), no calibration in prod path, no snapshots, no tests.
11. **New Supabase:** clean normalized schema (see DATABASE plan), versioned migrations, RLS everywhere, service-role workers only.
12. **New DB contents:** reference data, fixtures+results, odds snapshots, prediction runs+inputs+predictions+settlements, models/experiments, injuries/lineups/weather, rollover tickets, product/ops tables.
13. **Rollover engine:** daily candidate generation → qualification (prob/EV/quality/freshness/correlation) → ~2.00 combination search → ticket + explanations → settlement + performance tracking → walk-forward backtest before any claims.
14. **Additional intelligence needed:** market-implied probs, Dixon-Coles, per-market calibration, data-quality scoring, CLV.
15. **User product:** dashboard, matches, match intelligence, predictions, odds intel, rollover, results, analytics, AI explain, screenshot-analysis (later), settings.
16. **Admin:** 9-section control center — Overview, Data, Predictions, Models, Rollover, Competitions, Operations, Users, Security.
17. **Features:** see PRODUCT-ROADMAP.md modules A–D.
18. **Implementation:** see IMPLEMENTATION-ROADMAP.md phases A–H.
19. **Sequence:** Foundation (tests, snapshots, new DB) → Data (odds, ingestion) → Models (calibration, Dixon-Coles, challengers) → Rollover engine+backtest → Product → Admin → Advanced → Production cutover.
20. **Production-ready requires:** green test gates, verified RLS, snapshot coverage, honest metrics, 7-day cron soak, tested rollback.

## Autonomous operation (added 2026-11-26)

The system must run ~90 days unattended: daily collection → prediction → monitoring → settlement → evaluation → error analysis → controlled experiments → validated promotion. Full design in `AUTONOMOUS-LEARNING-ARCHITECTURE.md`: batch-retrain + sufficient-statistic online updates (Elo/form), champion/challenger with a strict promotion gate, immutable prediction memory, leakage prevention via as-of-kickoff snapshots, durable job execution, daily/weekly/monthly reports, and a 90-day soak test as the acceptance harness. Reinforcement learning is explicitly rejected — this is probabilistic forecasting.

## Final Recommendations (honest assessment)

**Retain:** meta-ensemble architecture, walk-forward harness, cron/lock/log infra, injury system, historical datasets, UI component base, Convex-realtime (for now).

**Rebuild:** database (new project, clean schema), rollover (from scratch as engine), admin (reorganize), docs (this set supersedes August docs).

**Remove/archive:** legacy `ensemble-model.js`/`daily-loop.js` after C4, ~60 one-off research JSON artifacts from the data path (keep as research), Trezo folder (decision), stale August docs marked superseded.

**Biggest risks:** odds data starvation, unverifiable accuracy baseline, snapshot-perf cost, migration data loss (mitigated by M0 backups), scope creep into Phase G.

**Build first:** A1 tests → A2 snapshots → A8/A9/A10 new Supabase → B1 odds decision. Nothing else matters until predictions are traceable, the DB is clean, and odds flow.

**Realistic horizons:** 30 days = Phase A + B1–B3 + C1 (truth + data foundation). 60 days = + B-series + C2–C5 + D1–D3 (engine + rollover candidate). 90 days = + D4–D6 backtest + E2/E8 core UI. 180 days = Phase E/F complete + H gates → production candidate. (Estimates assume the open decisions in DECISIONS doc are resolved in week 1.)

---

## What I need from you to proceed

1. Approve or amend the roadmap (especially phase order and the 10 open decisions).
2. Answer D1 (odds provider/budget) — it gates the entire data phase.
3. Confirm new Supabase account/project details when ready (do NOT paste keys here — use env vars/secrets).
4. Confirm whether to begin Phase A implementation on your approval.

## Prediction-data audit (added 2026-10-02)

A full audit of every data source, stored-vs-consumed factor, model, and
confidence claim now lives in `docs/` as ten deliverables:

- `ODDLY-DATA-SOURCE-AUDIT.md` — every provider traced provider→feature→prediction
- `ODDLY-DATA-INVENTORY.md` — new Supabase schema (67 tables) + local datasets; flags that the new DB is empty and needs backfill
- `ODDLY-PREDICTION-FACTOR-AUDIT.md` — implemented / half-wired / dead / missing factors
- `ODDLY-PLAYER-INTELLIGENCE-PLAN.md` — unify the two injury systems, importance engine, lineups
- `ODDLY-ADDITIONAL-DATA-SOURCES.md` — provider pricing + lean ~$50/mo stack
- `ODDLY-PREDICTION-MODEL-AUDIT.md` — verified bugs (weight-config key, version sprawl; injury "sign bug" was verified a false positive) + honest accuracy status
- `ODDLY-HIGH-CONFIDENCE-STRATEGY.md` — calibration-first, two-gate confidence, honest abstention
- `ODDLY-MARKET-SPECIFIC-MODELS.md` — per-market model/metric/calibration specs
- `ODDLY-PREDICTION-INTELLIGENCE-ARCHITECTURE.md` — target layered architecture
- `ODDLY-PREDICTION-IMPROVEMENT-ROADMAP.md` — P1–P4 priorities; top-5 = backfill+bugfixes, restore eval, injury/lineup wiring, prod calibration, xG

These findings **amend** the roadmap above: Phase A/B priorities are confirmed
(backfill + eval + odds retention are now P1), and the high-confidence strategy
requires the calibration layer before any user-facing confidence tier ships.

## Strategic assessment (added 2026-10-02, second audit round)

`ODDLY-STRATEGIC-ASSESSMENT.md` covers nine additional requirements:
market-intelligence edge proof, per-competition gating, T1/T2/T3 prediction
timing snapshots, data trust/verification engine, model-drift protocol,
rollover portfolio risk engine, statistical-significance claims policy,
operational failure modes, and the final strategic verdict (advantage =
timing + coverage + rollover structure + data moat; 2.00 rollover is
conditioned, not guaranteed).

## Rollover engine spec + long-term vision (added 2026-11-27)

- `ODDLY-ROLLOVER-ENGINE-SPEC.md` — authoritative 11-section spec for the
  2.00-odds rollover engine: broad opportunity discovery, correlation-aware
  combos, 4-score qualification, QUALIFIED/WAIT/SKIP decisions, monthly
  tracker, simulations, bankroll controls, release criteria. Includes a
  status-vs-implementation table and ordered next steps.
- `ODDLY-LONG-TERM-VISION.md` — product vision: full prediction lifecycle
  independent of rollover, every prediction feeds learning, 3-month
  foundation→intelligence→evidence programme, reinvestment discipline,
  ₦20M/month aspiration (never in logic), permanent 6-component separation.

## Complete product audit (added 2026-11-27, awaiting user approval)

Evidence base: `PRODUCT-AUDIT-FINDINGS.md` (three parallel codebase audits).
Brief: `ODDLY-PRODUCT-AUDIT-BRIEF.md` (authoritative 27-section requirements).

Deliverables:
- `ODDLY-PAGES-AND-FEATURES-AUDIT.md` — all 46 routes + ~50 APIs classified
  with evidence; 11 cross-cutting blockers (B1–B11)
- `ODDLY-USER-JOURNEYS.md` — visitor/fan/bettor/admin journeys + proposed
  3-step onboarding
- `ODDLY-PRODUCT-ACCEPTANCE-CRITERIA.md` — ~60 testable criteria, P0–P2
- `ODDLY-COMPLETE-PRODUCT-ROADMAP.md` — 44 features (F-01–F-44), 7 phases
  with exit conditions; Phase-1 = tests → types/migrations → snapshots →
  metrics → settlement audit trail → cron consolidation
- `ODDLY-ADMIN-PLATFORM-PLAN.md` — full admin control-centre plan
- `ODDLY-FEATURE-IMPLEMENTATION-TRACKER.md` — ~90-row living tracker
- `UI-UX-REDESIGN-PLAN.md` — updated (design system, IA, mobile strategy)
- `EVALUATION-BASELINE-2026-11.md` — honest walk-forward baseline
  (1X2 argmax 41.7% < always-home; degenerate-prediction root cause fixed
  via 27,314-fixture backfill)

**Status: AUDIT COMPLETE — implementation awaits user approval.**
