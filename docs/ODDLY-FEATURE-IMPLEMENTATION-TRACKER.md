# ODDLY — Feature Implementation Tracker

**Date:** 2026-11-27 · **Status legend:** ✅ Complete · 🟡 Partial · 🔧 Backend-only · 🖥️ Frontend-only · ❌ Broken · ⬜ Missing · ❓ Unverified
**This is the single source of truth for "done vs planned".** Update status + evidence on every change. Cross-refs: [PRODUCT-AUDIT-FINDINGS.md](PRODUCT-AUDIT-FINDINGS.md) · [ODDLY-COMPLETE-PRODUCT-ROADMAP.md](ODDLY-COMPLETE-PRODUCT-ROADMAP.md) (F-## ids) · [ODDLY-ADMIN-PLATFORM-PLAN.md](ODDLY-ADMIN-PLATFORM-PLAN.md) (A# ids) · [MASTER-PLAN.md](MASTER-PLAN.md)

Test status: ✅ tested · 🟡 partial · ❌ none · ➖ n/a (static).

---

## Marketing / public

| Feature | Area | Status | Priority | Phase | Dependencies | Test status | Evidence/notes |
|---|---|---|---|---|---|---|---|
| `/` home | Marketing | ✅ | P1 | Ph3 | — | ➖ | Server-rendered real stats; hardcodes remain (modelAgreement:5, activeModels:3) — findings §1 |
| `/features` | Marketing | ✅ | P1 | Ph3 | — | ➖ | Static; unlinked in nav — add entry |
| `/pricing` | Marketing | 🟡 | P1 | Ph5 | F-24 | ➖ | Tiers static; paid CTAs disabled; Stripe backend dormant |
| `/about` `/contact` `/faq` | Marketing | ✅ | P1 | — | — | ➖ | Added 2026-11-27; honest content |
| `/terms` `/privacy` `/cookies` `/responsible-gambling` | Marketing | ✅ | P0 | — | — | ➖ | Public access fixed via middleware |
| Public model report card | Marketing | ⬜ | P2 | Ph5 | F-19 | ➖ | F-41 |
| Marketing copy rewrite (verified claims) | Marketing | ⬜ | P1 | Ph3 | F-19 | ➖ | E9 in old roadmap |

## Auth / account

| Feature | Area | Status | Priority | Phase | Dependencies | Test status | Evidence/notes |
|---|---|---|---|---|---|---|---|
| `/login` `/signup` | Auth | ✅ | P0 | — | — | 🟡 | supabase-js client auth |
| `/forgot-password` `/reset-password` `/auth/callback` | Auth | ✅ | P0 | — | — | 🟡 | Fixed 2026-11-27; recovery flow works |
| OAuth login | Auth | ⬜ | P2 | Ph5 | — | ❌ | F-43 |
| `/settings` (profile, notif prefs, Stripe portal, sign-out) | Account | ✅ | P1 | — | — | 🟡 | Stripe portal dormant until billing |

## Dashboard / matches

| Feature | Area | Status | Priority | Phase | Dependencies | Test status | Evidence/notes |
|---|---|---|---|---|---|---|---|
| `/dashboard` | App | 🟡 | P0 | Ph3 | F-11, F-14 | 🟡 | Works (5-min poll); rebuild per UI plan §4 — F-18 |
| `/matches` `/matches/upcoming` `/matches/results` | App | ✅ | P1 | — | — | 🟡 | Filters/pagination/drawer; realtime |
| `/matches/[id]` match centre | App | 🟡 | P1 | Ph3 | F-07, F-26 | 🟡 | Predictions+recs+odds exist; needs Match Intelligence depth — F-16 |
| Match Intelligence full page (form/H2H/xG/injuries/lineups/referee/odds/evidence/missing-info) | App | 🟡 | P1 | Ph3 | F-16 | ❌ | F-16 |

## Predictions / intelligence

| Feature | Area | Status | Priority | Phase | Dependencies | Test status | Evidence/notes |
|---|---|---|---|---|---|---|---|
| `/predictions` list | App | ✅ | P1 | — | — | 🟡 | Tier/league/date filters; upgrade columns — F-17 |
| Predictions centre (compare/browse/filter; prob vs model-confidence vs quality vs EV vs version) | App | 🟡 | P1 | Ph3 | F-15, F-02 | 🟡 | F-17 |
| Prediction evidence/explanation per pick | App | 🟡 | P1 | Ph3 | F-02 | ❌ | Snapshots exist; UI surfacing partial |
| Immutable prediction input snapshots | Backend | 🟡 | P0 | Ph1 | — | 🟡 | Tables exist; prod coverage unverified — F-02 |
| Calibration layer in prod path | Backend | ⬜ | P0 | Ph2 | F-04 | ❌ | Offline only today — F-14 |
| Data-quality score + NO_PREDICTION abstention | Backend | ⬜ | P0 | Ph2 | F-02, F-14 | ❌ | F-15 |
| Honest accuracy baseline | Backend | ✅ | P0 | — | — | ➖ | EVALUATION-BASELINE-2026-11.md: 41.7% 1X2 argmax, OU2.5 54.0%, BTTS 51.6% |
| `model_performance` Brier fix | Backend | 🟡 | P0 | Ph1 | — | ❌ | Known bug — F-05 |
| Dixon-Coles challenger + champion/challenger registry | Backend | ⬜ | P1 | Ph2–4 | F-04, F-14 | ❌ | F-27; model_versions/experiments tables |
| Injury/lineup pipeline → prod features | Backend | 🟡 | P1 | Ph2 | F-02 | ❌ | 64 rows scraped; impact ~0 — F-26 |
| Player intelligence | App | ⬜ | P2 | Ph5 | Provider | ❌ | F-31; no invented stats |
| Competition intelligence pages | App | ⬜ | P1 | Ph3 | F-08 | ❌ | F-28; data exists (450 teams, league params) |
| Team intelligence profiles (entity-resolved) | App | 🟡 | P1 | Ph3 | F-08 | 🟡 | normalizeTeamName exists+tested; dedup incomplete — F-08 |
| Odds/market intelligence page (open/current/close, movement, implied prob, margin, CLV) | App | 🟡 | P1 | Ph3 | F-07 | 🟡 | Odds shown on match/preds; no dedicated page — F-29 |
| Live centre | App | ⬜ | P2 | Ph5 | Provider licence | ❌ | F-30; never label pre-match as live |

## Odds / data

| Feature | Area | Status | Priority | Phase | Dependencies | Test status | Evidence/notes |
|---|---|---|---|---|---|---|---|
| Odds ingestion (The Odds API / API-Football) | Backend | 🟡 | P0 | Ph2 | D1 decision | 🟡 | Free quota exhausted; retention dedupe+30d works — F-07 |
| Odds snapshots T-24h/T-2h/T-1h + CLV | Backend | 🟡 | P0 | Ph2 | F-07 | ❌ | F-07 |
| Entity resolution hardening | Backend | 🟡 | P0 | Ph1–2 | — | 🟡 | Canonicalizer tested; ilike first-match, external_id collision risk — F-08 |
| Cross-source fixture validation + conflict queue | Backend | ⬜ | P1 | Ph2 | — | ❌ | B6 |
| `settlement_feed` append-only + auditable corrections | Backend | ❌ | P0 | Ph1 | — | ❌ | Currently delete-all rebuild; cleanup FK risk — F-09 |
| `database.types.ts` regeneration (24 vs 67 tables) | Backend | ❌ | P0 | Ph1 | — | ❌ | F-12 |
| Migrations consolidation (15 + ~35 loose SQL) | Backend | 🟡 | P0 | Ph1 | — | ❌ | F-13 |
| Weather features (Open-Meteo collected, unused) | Backend | 🔧 | P2 | Ph5 | F-02 | ❌ | F-37 |
| Market-implied probability model (devigged) | Backend | ⬜ | P2 | Ph5 | F-07 | ❌ | F-38 |

## Rollover

| Feature | Area | Status | Priority | Phase | Dependencies | Test status | Evidence/notes |
|---|---|---|---|---|---|---|---|
| Rollover engine v1 (`src/lib/rollover/engine.ts`) | Backend | 🟡 | P0 | Ph3 | F-02, F-06, F-07 | ✅ | 28 Jest tests exist incl. engine |
| `/rollover` page + recommendation API | App | ✅ | P0 | — | — | 🟡 | v1 complete; spec gaps tracked |
| Rollover engine v2 per spec (QUALIFIED/WAIT/SKIP, correlation combos ~2.00, monthly tracker) | Backend | 🟡 | P0 | Ph3 | F-11 | 🟡 | Spec: ODDLY-ROLLOVER-ENGINE-SPEC.md |
| Rollover admin (ticket audit, candidates, thresholds, monthly perf) | Admin | ⬜ | P1 | Ph5 | F-11 | ❌ | A8 |

## Play / tools

| Feature | Area | Status | Priority | Phase | Dependencies | Test status | Evidence/notes |
|---|---|---|---|---|---|---|---|
| `/accumulator` + `/my-accumulators` | App | ✅ | P1 | — | — | 🟡 | Table-backed; starved until F-06 |
| `/betting-agent` | App | 🟡 | P2 | Ph5 | Core stable | ❌ | Recommendations real; History "Coming Soon"; betslip console.log only |
| `/ai-chat` (NVIDIA SSE) | App | ✅ | P1 | — | — | 🟡 | Rate limits fixed; grounding upgrade — F-22 |
| AI assistant verified-vs-interpretation labelling | App | 🟡 | P1 | Ph4 | F-02 | ❌ | F-22 |
| `/notifications` + `/preferences` inbox | App | ✅ | P1 | — | — | 🟡 | Table-backed (fixed from in-memory stub) |
| Notification delivery (email/push) + alert types | Backend | ⬜ | P1 | Ph4 | F-21 | ❌ | In-app only; no email/push — F-21/F-42 |
| `/performance` analytics centre | App | 🟡 | P1 | Ph3 | F-04, F-05, F-07 | 🟡 | Accuracy/Brier/logloss/calibration exist; needs CLV/ROI honesty + chart lib — F-19 |
| `/tracking` results & history | App | ✅ | P1 | — | — | 🟡 | user_bets settle admin-only (fixed); consolidate w/ performance — F-20 |
| Screenshot-to-analysis | App | ⬜ | P2 | Ph5 | F-15 | ❌ | F-33; reuse central engine |

## Billing / subscriptions

| Feature | Area | Status | Priority | Phase | Dependencies | Test status | Evidence/notes |
|---|---|---|---|---|---|---|---|
| Stripe checkout/portal/webhook | Backend | 🔧 | P1 | Ph5 | F-24 | 🟡 | Fully coded, dormant |
| Entitlements module (`src/lib/subscription/entitlements.ts`) | Backend | 🔧 | P1 | Ph5 | F-24 | 🟡 | free/premium/elite map; enforcement OFF; rollover=elite direction |
| `subscriptions`/`subscription_events`/`invoices` tables | Backend | ⬜ | P1 | Ph5 | F-24 | ❌ | Tier lives on profiles only |
| Checkout UI + pricing activation | App | ⬜ | P1 | Ph5 | F-24 | ❌ | CTAs disabled today |

## Admin (20 routes today — see ODDLY-ADMIN-PLATFORM-PLAN.md)

| Feature | Area | Status | Priority | Phase | Dependencies | Test status | Evidence/notes |
|---|---|---|---|---|---|---|---|
| `/admin` dashboard | Admin | ✅ | P0 | — | — | 🟡 | Real tables; shallow — rebuild as Overview (A1) |
| `pipeline` `picks` `walk-forward` `ai-monitor` `accuracy` `crons` `announcements` `users` `referees` `draw-analysis` `rls` `security` `system-health` `db-health` | Admin | ✅ | P1 | Ph4 | — | 🟡 | Real data; reorganize into 11 sections |
| `injuries` | Admin | 🟡 | P1 | Ph4 | — | ❌ | Unverified view + RLS |
| `convex-health` | Admin | ❌ | — | Ph4 | — | ➖ | Orphaned (Convex never mounted) — delete |
| `settings` (admin) | Admin | 🟡 | P1 | Ph4 | — | ➖ | Static only → platform config/flags (A10) |
| Overview aggregation (health/users/ingestion/predictions/settlements/jobs/providers/DB/alerts) | Admin | ⬜ | P0 | Ph4 | A1 | ❌ | Needs `admin_alerts` |
| User mgmt depth (activity, subscription, audited role change, suspend) | Admin | 🟡 | P0 | Ph4 | A2 | ❌ | users page exists; no activity/sub views |
| Football-data mgmt (competitions/teams/players, entity-match queue, quality scores, conflicts) | Admin | ⬜ | P0 | Ph4 | A3 | ❌ | New pages+tables |
| Provider mgmt (health/quota/cost/freshness/fallback; no credentials) | Admin | ⬜ | P1 | Ph5 | A4 | ❌ | Credential-protection rules apply |
| Prediction ops (settlement monitor, audited re-settle, failure analysis) | Admin | 🟡 | P0 | Ph4 | A5 | ❌ | Partial via picks/pipeline |
| Model registry/intelligence (versions, experiments, champion/challenger, drift, promote/rollback) | Admin | 🟡 | P1 | Ph4–5 | A6, F-27 | ❌ | Read-only metrics today |
| Settlement ops + correction UI | Admin | ⬜ | P0 | Ph4 | A7, F-09 | ❌ | Depends on append-only feed |
| System ops unified (jobs/locks/retries/logs/costs) | Admin | 🟡 | P0 | Ph4 | A9 | ❌ | cron_runs exists; merge 3 pages |
| Platform config / feature flags / market thresholds | Admin | ⬜ | P1 | Ph4 | A10 | ❌ | `platform_config`/`feature_flags` table |
| Security/audit (roles UI, activity log, approvals) | Admin | 🟡 | P0 | Ph4 | A11 | ❌ | `admin_activity_log` nearly empty — see below |
| `admin_activity_log` coverage | Backend | ❌ | P0 | Ph1–4 | — | ❌ | Table exists; **only Stripe webhook writes it** — wire helper + all mutations |

## Platform / ops / quality

| Feature | Area | Status | Priority | Phase | Dependencies | Test status | Evidence/notes |
|---|---|---|---|---|---|---|---|
| Jest harness + core lib tests | Quality | 🟡 | P0 | Ph1 | — | 🟡 | 28 tests only — F-01 |
| E2E suite (Playwright or equiv) | Quality | ⬜ | P1 | Ph4 | F-32 | ❌ | None today |
| CI pipeline (`.github/workflows`) | Quality | ⬜ | P0 | Ph1–4 | F-32 | ❌ | Absent |
| Cron consolidation (9 Vercel crons vs plan limit; hourly pipeline dupes) | Ops | 🟡 | P0 | Ph1 | — | ❌ | F-10; plan mismatch |
| Secrets rotation (git history: old service-role JWT, DB password, API-Football key) | Security | ❌ | P0 | Ph1 | — | ➖ | Tree scrubbed; history compromised — user action |
| External monitoring/alerting/backup automation | Ops | ⬜ | P2 | Ph6 | A1 | ❌ | F-39 |
| `/api/v1/auth/*` dead routes | Backend | ❌ | P1 | Ph1 | — | ➖ | Unused (UI uses supabase-js) — remove |
| Convex legacy cleanup (`convex/` dir, env warnings) | Backend | 🟡 | P1 | Ph1 | A6 decision | ➖ | Provider never mounted |
| `/api/v1/recommendations` starvation fix (populate from ensemble in predict cron) | Backend | ❌ | P0 | Ph2 | F-06 | ❌ | Value-bets/accumulator/notifications starve today |
| Triple prediction writers cleanup (ensemble canonical; NVIDIA admin-only; POST 422s) | Backend | 🟡 | P1 | Ph2 | F-27 | ❌ | Documented in findings §2 |
| Retention/archival (hot/cold, R2 parquet) | Ops | 🟡 | P2 | Ph5 | — | ❌ | Cleanup cron exists; extend per G′9 |

---

## Phase rollup (mirrors ODDLY-COMPLETE-PRODUCT-ROADMAP.md)

| Phase | Theme | Exit condition |
|---|---|---|
| Ph0 | Audit & decisions | This doc set approved; D1/A6/G5/Trezo decided |
| Ph1 | Truth & foundation | Tests green, types clean, snapshots 100%, settlement append-only, crons within plan, secrets ticketed |
| Ph2 | Data & prediction intelligence | Calibrated prod probs, abstention gate, recommendations populated, registry live |
| Ph3 | Rollover v2 + core product UI | Daily QUALIFIED/WAIT/SKIP ticket; all audited routes meet AC |
| Ph4 | Admin platform + notifications + AI grounding + CI/E2E | All §19 capabilities; mutations audited; CI green |
| Ph5 | Monetization & advanced | Paid tier live w/ enforcement; advanced features where validated |
| Ph6 | Production hardening | Monitoring/backup; 90-day soak; cutover gates |
