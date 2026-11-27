# ODDLY — Consolidated Product Audit Findings (2026-11-27)

Synthesis of three parallel codebase audits (pages/UI, API/auth/admin,
schema/jobs/providers). This is the evidence base for the product-audit
deliverable docs. Statuses use: Complete / Partial / Frontend-only /
Backend-only / Broken / Missing / Needs-improvement / Unverified.

## 1. Route/page inventory (user-facing)

### Marketing (public shell: Navbar+Footer)
| Route | Status | Notes |
|---|---|---|
| `/` home | Complete | server-rendered real Supabase stats; minor hardcodes (modelAgreement:5, activeModels:3); LiveMatches now wired |
| `/features` | Complete | static; not linked in nav (anchors used) |
| `/pricing` | Partial | tiers static; paid CTAs "Coming Soon"; Stripe backend exists but dormant |
| `/terms` `/privacy` `/cookies` `/responsible-gambling` | Complete content; access FIXED | were auth-gated, now public via middleware fix |
| `/about` `/contact` `/faq` | NEW (added today) | honest content, no invented stats |
| `/login` `/signup` | Complete | client supabase-js auth |
| `/forgot-password` | Complete (fixed) | now routes to /reset-password |
| `/reset-password` | NEW | updateUser form; middleware lets recovery session through |
| `/auth/callback` | FIXED | early-return in middleware; recovery → /reset-password |

### Dashboard (authenticated shell: Sidebar+Header)
| Route | Status | Notes |
|---|---|---|
| `/dashboard` | Complete | today's picks/stats/settlement feed, 5-min poll |
| `/matches` `/matches/upcoming` `/matches/results` | Complete | filters/pagination/detail drawer; realtime via Supabase |
| `/matches/[id]` | Complete | predictions+recommendations+odds; server component |
| `/predictions` | Complete | tier/league/date filters ("golden picks") |
| `/performance` | Complete | accuracy/Brier/log-loss/calibration from settled preds |
| `/accumulator` + `/my-accumulators` | Complete | build/save accumulators (table-backed) |
| `/betting-agent` | Partial | recommendations real; History tab "Coming Soon"; betslip not persisted (console.log only) |
| `/ai-chat` | Complete | SSE stream via NVIDIA; rate limits now incl. anonymous |
| `/rollover` | Complete (v1) | chains+picks+engine rec; spec gaps tracked separately |
| `/tracking` | Complete but FIXED-risk | user_bets manual settle now admin-only |
| `/notifications` + `/preferences` | Complete (fixed) | inbox reads real table now (was in-memory stub) |
| `/settings` | Complete | profile, notif prefs, Stripe portal, sign-out |

### Admin `/admin/*` (role-gated)
Complete: dashboard, pipeline, picks, ai-monitor, model-health,
walk-forward, accuracy, draw-analysis, referees, scoring, users,
announcements, crons, rls, security, system-health, db-health.
Partial/weak: injuries (unverified view+RLS), convex-health (orphaned
legacy), settings (static only), run-pipeline (FIXED auth forward).
Missing entirely: fixture/team/player data management, provider
management, model registry/experiments, settlement correction UI,
rollover admin, subscriptions/billing admin, platform config/feature
flags, security audit log UI.

## 2. API/backend findings (post-fix state)

FIXED today: user-bets settle admin-only; notifications GET table-backed;
ai-chat anon rate limit; predictions POST admin-only + placeholder
removed; odds/value-bets rate limits enforced; analytics/draw,
injuries/collect, predictions/generate GETs now authed; realtime/*
Bearer-undefined bypass closed; cron/daily + run-pipeline auth chain
fixed; pipeline fs-state → app_state table.

Remaining known issues:
- Triple prediction writers remain (ensemble cron canonical;
  NVIDIA generate is admin-only manual; predictions POST now 422s).
- recommendations table only populated by manual NVIDIA runs →
  value-bets/accumulator/notifications starve. NEEDS: populate
  recommendations from ensemble output in predict cron.
- settlement_feed rebuilt delete-all (not append-only); cleanup deletes
  finished fixtures >30d with FK NO ACTION risk.
- model_performance rolling update is delete+recompute (expensive).
- database.types.ts stale (~24 tables vs 67 actual).
- Migrations fragmented: supabase/migrations (15) + ~35 loose root SQL.
- Convex legacy: provider never mounted; convex/ dir + env warnings remain.
- /api/v1/auth/* routes unused (UI uses supabase-js directly) — dead code.
- admin_activity_log only written by Stripe webhook — admin actions
  not audited.
- No subscriptions/events/invoice tables — tier lives on profiles only.
- No email/push delivery — notifications in-app only.
- No external monitoring/alerting/backup automation.
- Vercel Hobby: 9 crons vs 1-cron plan limit (plan mismatch).
- pg_cron jobs (2 MV refreshes) coexist with Vercel crons.

## 3. Data/provider findings

Providers: The Odds API (odds+fixtures, active), API-Football
(fixtures/injuries, free-tier limited), football-data.co.uk CSVs
(backfilled 27,314 finished fixtures → Elo live), StatsBomb/Understat
(research only), Open-Meteo (collected, unused), Transfermarkt/Premier
Injuries scrapes (injury data, 64 rows), NVIDIA NIM (ai-chat + admin
prediction engine), Stripe (dormant billing).

Entity resolution: normalizeTeamName canonicalizer exists + tested;
duplicated logic across sync paths; fuzzy ilike first-match without
confidence; league resolution name-exact (fragile); external_id has no
provider namespace (collision risk); odds↔fixture matching weak on
kickoff-time constraint.

Fresh DB state: 27,473 fixtures (27,314 finished backfill + 159
scheduled), 450 teams, 67 tables, feature store populated
(production_v5 weights, 8 league params, 405 team profiles, 113
referee profiles), odds_snapshots retaining (dedupe+30d), injury
features computed (impact currently ~0 — stale expected_return dates).

Eval baseline (docs/EVALUATION-BASELINE-2026-11.md): honest
walk-forward replay of production ensemble over 27,314 matches —
1X2 argmax 41.7% (below always-home 43.5%), OU2.5 54.0%, BTTS 51.6%.
Model under-predicts home wins; probabilities capped ~0.81.
Backfill fixed the degenerate-prediction root cause.

## 4. Secrets/security

Scrubbed from working tree today: old-project service-role JWT
(2 scripts), new DB password fallback, API-Football key (6 scripts).
STILL IN GIT HISTORY — user must rotate: old Supabase service-role
key, new DB password, API-Football key.

## 5. Subscription/billing

Stripe fully coded (checkout/portal/webhook, ₦7,500 premium /
₦20,000 elite NGN) but dormant: no checkout UI, pricing CTAs disabled,
no subscriptions tables. Entitlements module added today
(src/lib/subscription/entitlements.ts): free/premium/elite feature
map, enforcement flag OFF — rollover=elite, ai.chat=elite,
accumulator/value_bets/betting_agent/analytics.advanced=premium.
User direction: freemium + paid planned; leave features open for now;
rollover intended for paid.

## 6. Testing/ops gaps

Jest: 28 tests (team-normalizer, rollover engine) — thin. No CI
(.github/workflows absent). No E2E. Cron overlap: pipeline hourly
duplicates settle/predict/archive work; daily orchestrator now fixed
but redundant with dedicated jobs.
