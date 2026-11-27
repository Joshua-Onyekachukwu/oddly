# ODDLY — Complete Product Feature Specification

**Date:** 2026-11-26 · Organizes target product by module. "Have" = exists in code today.

---

## Module A — Public / Marketing

| Feature | Have | Plan |
|---|---|---|
| Landing page (hero, features, pricing, FAQ) | ✅ | Keep; rewrite copy to only claim verified capabilities; remove any accuracy figures not backed by measured data |
| Features / Pricing pages | ✅ | Keep; pricing gated on subscription decision |
| Public model report card | 🟡 (admin only) | Add public `/performance` page with honest metrics + sample sizes |

## Module B — User Application

| Feature | Have | Gap / Plan |
|---|---|---|
| Auth (email) | ✅ | Add OAuth optional; keep middleware protection |
| Dashboard | ✅ | Rebuild around: today's fixtures, featured qualified picks, rollover status, recent results, performance snapshot, notifications |
| Matches (upcoming/results/[id]) | ✅ | Keep; enrich detail page into full Match Intelligence (below) |
| Predictions list | ✅ | Add probability/confidence/EV/data-quality/qualification columns; link to match intelligence |
| Match Intelligence page | 🟡 (drawer) | Promote to full page: team comparison, form, H2H, xG, injuries, lineups, referee stats, odds comparison, market probs, model outputs, plain-language explanation, data-quality indicator |
| Odds Intelligence | 🟡 | Needs odds data first; show open/current/closing, movement, implied probs, overround, consensus, value flags |
| Daily Rollover | 🔴 | Replace user-chain UI with engine-driven daily ticket: candidate legs, combined odds ~2.00, qualification explanations, "no qualifying opportunity" state, ticket history |
| Results & History | ✅ | Add per-market accuracy, settled predictions archive, rollover records |
| Analytics | 🟡 | Brier, log-loss, calibration chart, ROI, CLV, per-league/per-market breakdowns — all with sample sizes |
| Accumulator builder | 🟡 | Keep manual builder; add optimizer ONLY after rollover engine proves combination logic |
| Screenshot-to-analysis | ⬜ | Phase G: upload → OCR/parse → fixture+odds matching → central prediction engine → verified analysis record. Reuse `predictMatchEnsemble`; never a parallel engine |
| Notifications | 🟡 | Verify delivery pipeline; add pick-settled, rollover-result, price-movement alerts |
| AI chat / "Why?" | 🟡 | Keep NVIDIA-backed explanations; ground prompts in snapshot data; add responsible-gambling guardrails |
| Betting agent | 🟡 | Nigerian-bookmaker booking codes — keep research; productize only after core proven |
| Settings/account | ✅ | Keep; add prediction preferences, notification prefs, subscription mgmt if billing enabled |
| Subscriptions (Stripe) | 🟡 | Routes exist; decide launch timing; tier-gate premium features only after core value proven |

## Module C — Administration (control center redesign)

Existing pages: overview, accuracy, convex-health, db-health, system-health, model-health, pipeline, referees, scoring, users, announcements, settings, ai-monitor, picks, injuries, walk-forward, rls, security, crons, draw-analysis, leagues.

Target organization:

| Section | Pages | Notes |
|---|---|---|
| Overview | System health, job status, today's pipeline, alerts | Real metrics only |
| Data Management | Providers, ingestion runs, fixture browser, missing-data report, quality scores, conflicts queue | New — highest operational value |
| Predictions | Generated predictions, settlement monitor, failure analysis, manual re-settle (audited) | Exists partially |
| Model Intelligence | Champion/challenger registry, training runs, walk-forward results, calibration plots, per-market/per-league performance, feature importance, promote/rollback controls | Formalize experiment registry |
| Rollover | Daily ticket generation, candidates, qualification audit, threshold config, performance | New |
| Competitions/Teams | Leagues, seasons, teams, coverage, data completeness | Exists partially |
| Operations | Cron executions, locks, failures, retries, API health, logs | `cron_executions` infra exists — surface it |
| Users | Accounts, roles, activity, subscriptions, audit log | Exists partially |
| Security/Config | RLS status, env config, security events, feature flags | Exists partially |

Rule: **no decorative metrics** — every number links to its query; empty states explain why.

## Module D — Internal / Engine Services

| Service | Have | Plan |
|---|---|---|
| Prediction engine | ✅ meta-ensemble | Harden + calibrate + snapshots (see PREDICTION-ENGINE-PLAN) |
| Settlement engine | ✅ | Extend window, unify Elo, per-market metrics |
| Rollover engine | 🔴 | Build per ROLLOVER-STRATEGY-PLAN |
| Data collectors | 🟡 | Consolidate behind ingest service; schedule + monitor |
| Feature store | 🟡 | DB-backed, versioned, snapshot-aligned |
| Experiment/challenger harness | 🟡 | Formalize promotion gates |
| Notification dispatcher | 🟡 | Verify + productize |

## Acceptance criteria (global)

- Every user-facing number is traceable to a DB query or labeled estimate.
- Every prediction links to its immutable input snapshot.
- Every scheduled job has lock + log + alert on failure.
- Every admin page has defined purpose and working data source.
- No feature ships without: unit tests for math, integration test for pipeline, e2e smoke for UI path.
