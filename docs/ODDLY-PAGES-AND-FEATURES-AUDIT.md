# ODDLY — Pages & Features Audit (2026-11-27)

Page-by-page + feature audit against the 27-section requirements in
[ODDLY-PRODUCT-AUDIT-BRIEF.md](ODDLY-PRODUCT-AUDIT-BRIEF.md) §1–22.
Evidence base: [PRODUCT-AUDIT-FINDINGS.md](PRODUCT-AUDIT-FINDINGS.md)
(verified code/schema audit, post-fix state). Spot-checked against
`src/app/**` and `src/components/**` on 2026-11-27.

Statuses: Complete / Partial / Frontend-only / Backend-only / Broken /
Missing / Needs-improvement / Unverified.

Cross-references: [MASTER-PLAN.md](MASTER-PLAN.md),
[UI-UX-REDESIGN-PLAN.md](UI-UX-REDESIGN-PLAN.md),
[PRODUCT-ROADMAP.md](PRODUCT-ROADMAP.md),
[ODDLY-ROLLOVER-ENGINE-SPEC.md](ODDLY-ROLLOVER-ENGINE-SPEC.md),
[EVALUATION-BASELINE-2026-11.md](EVALUATION-BASELINE-2026-11.md).

> **Post-fix note.** Issues marked **[FIXED 2026-11-27]** were resolved
during the audit day: middleware legal/callback access, notifications API
(table-backed), user-bets settle (admin-only), API auth surface
(predictions POST, value-bets/odds rate limits, realtime Bearer bypass,
cron auth chain, pipeline fs-state → `app_state`), `/forgot-password`
routing. Secrets were scrubbed from the working tree (still in git
history — rotation required, see findings §4).

---

## 1. Marketing / public pages (brief §2)

Public shell = `Navbar` + `Footer` (`src/components/landing/`). Nav links
use home-page anchors (`/#features`, `/#pricing`, `/#faq`), not the
dedicated routes.

| Route / page | Status | Evidence | Dependencies / blockers | Recommended action |
|---|---|---|---|---|
| `/` home | Complete | Server-rendered real Supabase stats; `LiveMatches` wired | Minor hardcodes: `modelAgreement: 5`, `activeModels: 3` literals | Replace hardcodes with real counts; keep honest stats rule |
| `/features` | Complete (orphaned) | Static page exists; nav uses `/#features` anchor instead | Duplicate content risk vs home anchors | Decide canonical URL; either link it or remove |
| `/#pricing` anchor + `/pricing` | Partial | Page exists; tiers static; paid CTAs "Coming Soon" | Stripe backend coded but dormant; no subscriptions tables; entitlements flag OFF | P1: wire checkout once subscriptions schema lands; keep "Coming Soon" until then (honest) |
| `/faq` | Complete (orphaned) | Page exists; nav uses `/#faq` anchor | Same duplication concern as `/features` | Same as `/features` |
| `/about` | Complete (new) | Added 2026-11-27; honest content, no invented stats | — | — |
| `/contact` | Complete (new) | Added 2026-11-27 | No backend contact form verified — check whether it submits anywhere | Verify form action; add mailto/fallback if frontend-only |
| `/terms` `/privacy` `/cookies` `/responsible-gambling` | Complete **[FIXED]** | Content complete; were auth-gated via middleware, now public | Middleware fix verified | — |
| `/login` `/signup` | Complete | Client supabase-js auth; `(auth)` layout | No email-verify step observed; no onboarding redirect | Add post-signup onboarding hook (§3 below) |
| `/forgot-password` | Complete **[FIXED]** | Now routes to `/reset-password` | — | — |
| `/reset-password` | Complete (new) | `updateUser` form; middleware lets recovery session through | — | — |
| `/auth/callback` | Complete **[FIXED]** | Early-return in middleware; recovery → `/reset-password` | — | — |

**Brief §2 rule check:** no invented stats found on marketing pages;
planned-vs-available labelling is honest (paid CTAs disabled). Gap:
pricing page cannot sell until subscriptions exist (§18).

## 2. Auth / onboarding / accounts (brief §3)

| Feature | Status | Evidence | Blockers | Recommended action |
|---|---|---|---|---|
| Register / login / verify / reset / sessions | Complete | supabase-js client auth; all auth routes live; middleware protects `(dashboard)` + `/admin` | Email verification flow unverified at runtime | Runtime-test signup→verify→login once; mark Unverified until then |
| Onboarding (interests → personalisation) | **Missing** | No onboarding route/component found in `src/` | No favourites table; no market-preference schema for users | P1: build onboarding wizard (see ODDLY-USER-JOURNEYS.md §proposed flow) |
| Favourites (teams/leagues/matches) | **Missing** | No `fav*` matches in `src/` or `supabase/` schema | No tables, no API, no UI | P1: schema + API + UI together |
| Market preferences | Partial | Notification prefs exist (`/notifications/preferences`); no betting-market prefs found | — | Extend preferences model in P1 |
| Profile / security / billing / deletion | Partial | `/settings`: profile, notif prefs, Stripe portal link, sign-out. No password-change UI verified, no account-deletion flow | Stripe dormant; portal link may 404/error while dormant | P1: account deletion (GDPR-style) required before paid launch; verify portal behaviour |

## 3. Main dashboard (brief §4)

| Feature | Status | Evidence | Blockers | Recommended action |
|---|---|---|---|---|
| `/dashboard` | Complete | Today's picks/stats/settlement feed; 5-min poll; `src/app/(dashboard)/dashboard/page.tsx` (650 lines) | Depends on `recommendations` being populated — currently only by manual NVIDIA admin runs → sections can starve | P0: populate `recommendations` from ensemble cron output (findings §2) |
| Favourites rail | Missing | No favourites feature exists | See §2 | — |
| Rollover status widget | Partial | Rollover page exists; dashboard summary presence unverified | — | P2: surface rollover status card |
| Alerts on dashboard | Partial | Settlement feed + realtime APIs exist; no proactive alert surfacing verified | Notifications in-app only | P2 |

## 4. Fixtures + match centre (brief §5)

| Feature | Status | Evidence | Blockers | Recommended action |
|---|---|---|---|---|
| `/matches` browse + filters + pagination | Complete | `MatchesList`/`MatchCard`; date/league filters; detail drawer (`MatchDetailDrawer` 697 lines) | Search-by-team and country filter coverage unverified; status filter partial | P1: add team search + status filter; verify filter set against brief |
| `/matches/upcoming` `/matches/results` | Complete | Dedicated routes exist | — | — |
| `/matches/[id]` match page | **Partial** | 104-line server component → `MatchDetail` (509 lines): tabs = predictions / odds / analysis (edges + recommendations + Kelly). **No** injuries, H2H, xG, lineups, referee, weather, form, or missing-data labels | Data availability: injuries features exist (64 rows, impact ~0 — stale `expected_return`); referee profiles exist (113); xG only in research assets | P1: add form/H2H + referee + injuries sections with explicit "data unavailable" labels; P2: xG/lineups/weather where licensed |
| Realtime updates | Complete | Supabase realtime on matches pages | — | — |

## 5. Predictions centre (brief §6)

| Feature | Status | Evidence | Blockers | Recommended action |
|---|---|---|---|---|
| `/predictions` browse/filter | Complete | Tier/league/date filters ("golden picks") | Competition/market/probability-range/data-quality filters partial; search unverified | P1: extend filter set per brief; add data-quality column |
| Prediction fields (prob, model confidence, data quality, odds, implied prob, EV, version, timestamp, evidence, uncertainty, historical performance) | Partial | `predictions` + `model_performance` + `odds_snapshots` tables exist; display coverage of all brief fields unverified | `database.types.ts` stale (~24 vs 67 tables) | P1: audit field rendering; surface model version + timestamp + evidence on detail view |
| `/predictions/[id]` detail/intelligence report | **Missing as dedicated route** | No prediction-detail page in route inventory; match page shows predictions inline | — | P1: dedicated prediction detail page (evidence-based explanations only, brief §7) |
| Markets scope | Needs-improvement | Eval baseline: 1X2 argmax 41.7% (below always-home 43.5%), OU2.5 54.0%, BTTS 51.6% | Model under-predicts home wins; probs capped ~0.81 | P0: fix calibration before marketing "golden picks"; restrict surfaced markets to validated ones |

## 6. Live centre (brief §8)

| Feature | Status | Evidence | Blockers | Recommended action |
|---|---|---|---|---|
| Live scores/events/stats | **Backend-only / Unverified** | Realtime APIs exist (`/api/v1/realtime/live-pick`, `live-stats`, `settlement-feed`, `value-picks`) — but these are pick/stats feeds, not a licensed live-score product; no `/live` route | No licensed live-data provider confirmed; live-match data availability unverified | P1: investigate provider licensing honestly; if unavailable, do not build appearance-only page |
| Live predictions | Unverified | No in-play model found; brief forbids presenting pre-match as live | — | Decide explicitly: either real in-play pipeline or no live predictions |

## 7. Results + prediction history (brief §9)

| Feature | Status | Evidence | Blockers | Recommended action |
|---|---|---|---|---|
| `/matches/results`, `/tracking` | Complete | Settled/won/lost/void/pending states; user_bets manual settle now **admin-only [FIXED]** | — | — |
| Immutable prediction snapshots | Complete (verified) | Prediction snapshots preserved through settlement; ensemble canonical writer | — | Keep; add regression test |
| Settlement corrections auditable | Partial | `settlement_feed` rebuilt **delete-all** (not append-only); cleanup deletes finished fixtures >30d with FK `NO ACTION` risk | Append-only settlement log missing | P0/P1: append-only settlement events table + audit trail; fix cleanup FK ordering |

## 8. Performance / analytics centre (brief §10)

| Feature | Status | Evidence | Blockers | Recommended action |
|---|---|---|---|---|
| `/performance` | Complete | Accuracy/Brier/log-loss/calibration from settled predictions | — | — |
| Per-market/competition/probability-range breakdown, CLV, ROI | Partial | `model_performance` rolling update is delete+recompute (expensive); admin has accuracy/draw-analysis/walk-forward pages; user-facing per-segment analytics limited | CLV needs closing-odds capture (odds_snapshots retain 30d — partial) | P1: segment breakdowns; P2: CLV once closing odds reliably captured |
| Accuracy vs simulated vs real-money separation | Partial | Simulated backtest reports exist in `docs/*.json`; user-facing labelling unverified | No real-money records exist yet | P1: label simulated vs verified explicitly wherever numbers shown |
| Admin analytics pages | Complete | `/admin/accuracy`, `/admin/draw-analysis`, `/admin/walk-forward`, `/admin/scoring` | — | — |

## 9. Rollover centre (brief §11)

| Feature | Status | Evidence | Blockers | Recommended action |
|---|---|---|---|---|
| `/rollover` module | Complete (v1) | `src/app/(dashboard)/rollover/page.tsx` (1,051 lines); chains + picks + engine rec; `src/lib/rollover/engine.ts` + tests; `/api/v1/rollover/recommendation` | Spec gaps tracked in ODDLY-ROLLOVER-ENGINE-SPEC.md: discovery breadth, combined-prob/EV/correlation display, QUALIFIED/WAIT/SKIP states, monthly tracking, bankroll, simulated-vs-actual, manual approval, RG framing | P1: close spec gaps in priority order; never mutate central predictions (verified — engine consumes only) |
| Rollover admin | **Missing** | No admin rollover section | — | P2 |

## 10. Competition intelligence (brief §12)

| Feature | Status | Evidence | Blockers | Recommended action |
|---|---|---|---|---|
| `/competitions/[slug]` pages | **Missing** | No competition routes in `src/app`; `leagues` table exists with name/country/logo | Standings data source unverified (football-data CSVs are results, not live standings) | P1: competition page = fixtures+results+prediction performance+data coverage first; standings only with verified source |

## 11. Team intelligence (brief §13)

| Feature | Status | Evidence | Blockers | Recommended action |
|---|---|---|---|---|
| `/teams/[id]` profiles | **Missing** | No team routes; `teams` table exists (450 rows, canonical_name + logo) | Entity resolution partial: `normalizeTeamName` canonicalizer exists + tested, but duplicated across sync paths; fuzzy `ilike` first-match without confidence; `external_id` has no provider namespace (collision risk) | P0/P1: namespace external_ids; P1: team profile page reusing resolved entities |

## 12. Player intelligence (brief §14)

| Feature | Status | Evidence | Blockers | Recommended action |
|---|---|---|---|---|
| `/players/*` + player stats | **Missing / Backend-only fragments** | `ODDLY-PLAYER-INTELLIGENCE-PLAN.md` exists; research assets (`player-data-research.md`, `player-impact-experiment.json`); injury features computed but impact ~0 (stale `expected_return` dates) | API-Football free tier limits player depth; no verified player-stat pipeline in prod path | P2: only where providers support it; fix injury `expected_return` staleness first (P1) |

## 13. Odds / market intelligence (brief §15)

| Feature | Status | Evidence | Blockers | Recommended action |
|---|---|---|---|---|
| Odds display on match page | Complete | `odds_snapshots` → odds tab grouped by market | — | — |
| Opening/current/closing, movement, implied prob, margin, consensus, model-vs-market, CLV | Partial | `odds_snapshots` retained (dedupe + 30d); edge/EV shown on recommendations; movement/closing/consensus/margin surfaces unverified | 30d retention limits closing-odds/CLV; odds↔fixture matching weak on kickoff-time constraint | P1: extend retention for closing odds; P2: movement/consensus/CLV panels; always show source+timestamp (partially done) |
| `/api/v1/odds`, `/api/v1/value-bets` | Complete **[FIXED]** | Rate limits now enforced; authed | Starved by empty `recommendations` (see §3) | — |

## 14. AI assistant (brief §16)

| Feature | Status | Evidence | Blockers | Recommended action |
|---|---|---|---|---|
| `/ai-chat` | Complete | SSE stream via NVIDIA NIM; rate limits incl. anonymous **[FIXED]** | Answers grounded in real ODDLY data? Prompt-level; no citation/verification UI | P1: require source citations in responses; distinguish verified facts vs interpretation visibly |
| Admin AI monitor | Complete | `/admin/ai-monitor` + `/api/v1/ai-monitor` | — | — |

## 15. Notifications / personalisation (brief §17)

| Feature | Status | Evidence | Blockers | Recommended action |
|---|---|---|---|---|
| `/notifications` inbox | Complete **[FIXED]** | Reads real table now (was in-memory stub) | — | — |
| `/notifications/preferences` | Complete | Preference API exists | Preference coverage vs brief list (match/prediction/lineup/odds/result/settlement/favourite/rollover/account) partial — favourites/rollover/account categories unverified | P1: extend categories with favourites + rollover + account |
| Delivery channels | Partial | **In-app only** — no email/push | No email provider; Vercel Hobby limits | P1: email at minimum for settlement/lineup alerts; push P2 |
| Proactive generation | Partial | Notifications depend on `recommendations` population | Same starvation issue as §3 | Fixed by recommendations cron fix |

## 16. Subscriptions / billing (brief §18)

| Feature | Status | Evidence | Blockers | Recommended action |
|---|---|---|---|---|
| Stripe integration | Backend-only (dormant) | Checkout/portal/webhook coded (`/api/v1/stripe/*`); webhook writes `admin_activity_log` | No checkout UI; pricing CTAs disabled; **no subscriptions/events/invoice tables** — tier lives on `profiles` only | P1: subscriptions schema (subscriptions, subscription_events, invoices) + entitlements enforcement flag |
| Entitlements | Backend-only | `src/lib/subscription/entitlements.ts` added 2026-11-27: free/premium/elite map; enforcement flag OFF; rollover=elite, ai.chat=elite, accumulator/value_bets/betting_agent/analytics.advanced=premium | Flag OFF by user direction (features open for now) | P1: enforcement UI (upgrade prompts) when billing live |
| Pricing page | Partial | See §1 | — | — |

## 17. Admin platform (brief §19)

Role-gated `/admin/*` shell exists. Complete: dashboard, pipeline,
picks, ai-monitor, model-health, walk-forward, accuracy, draw-analysis,
referees, scoring, users, announcements, crons, rls, security,
system-health, db-health. Partial/weak: injuries (unverified view+RLS),
convex-health (orphaned legacy), settings (static only), run-pipeline
(auth fixed).

| Brief §19 area | Status | Evidence | Gap | Recommended action |
|---|---|---|---|---|
| Overview (health, users, ingestion, predictions, settlements, jobs, providers, DB, alerts) | Partial | `/admin` dashboard + system-health + db-health + crons pages exist | Unified health overview with provider quotas/costs/freshness unverified | P1: consolidate into ops overview |
| User management | Complete | `/admin/users` + API | — | Add audit-trail view (see security) |
| Football-data mgmt (competitions/teams/players/fixtures/entity matching/data quality) | **Missing** | No admin pages for fixtures/teams/players/entity-matching | Entity resolution issues (findings §3) have no admin surface | P1: data-quality + entity-match review UI |
| Provider mgmt (health, quotas, costs, freshness, fallbacks; never expose credentials) | **Missing** | Providers hardcoded in scripts; no admin surface | Credential exposure risk managed only by convention | P1: provider registry table + health page; secrets via env only |
| Prediction ops | Partial | `/admin/picks`, `/admin/pipeline`, `/admin/run-pipeline` (auth fixed), `/admin/run-validation` | Triple prediction writers remain (ensemble cron canonical; NVIDIA admin-only; predictions POST → 422) | P0: document canonical writer; retire dead paths |
| Model registry / experiments / champion-challenger / drift / promotion-rollback | Partial | `/admin/model-health`, `/admin/walk-forward`; AUTONOMOUS-LEARNING-ARCHITECTURE.md specifies champion/challenger | No registry/experiment/promotion UI; `production_v5` weights live but unmanaged | P1: model registry tables + admin pages |
| Settlement ops / correction UI | **Missing** | Settlement runs via cron; no correction UI; feed is delete-all rebuild | Corrections not auditable today | P0/P1: append-only settlement events + correction UI with reason codes |
| Rollover admin | **Missing** | — | — | P2 |
| System ops (jobs, queues, retries, logs, costs) | Partial | `/admin/crons`, `/admin/system-health`, `/admin/pipeline` | Retry/queue management unverified; Vercel Hobby: 9 crons vs 1-cron plan limit (plan mismatch — blocker) | P0: resolve cron plan mismatch; P1: job run history + retry controls |
| Platform config / feature flags / market thresholds | **Missing** | `/admin/settings` static only | Entitlements flag OFF has no admin toggle | P1: config table + flags UI |
| Security / audit (roles, permissions, activity logs, approvals) | Partial | `/admin/security`, `/admin/rls`; `admin_activity_log` written **only by Stripe webhook** — admin actions not audited | No admin-action audit trail; roles beyond admin/user unverified | P0/P1: audit log middleware on all admin mutations + UI |

## 18. Mobile / responsive (brief §20)

| Feature | Status | Evidence | Recommended action |
|---|---|---|---|
| Mobile UX | Needs-improvement / Unverified | Sidebar+Header dashboard shell; landing Navbar has mobile menu; no dedicated mobile patterns verified; no device testing evidence | P1: mobile pass on dashboard/matches/predictions/rollover; intentional layouts not shrunk desktop |

## 19. UI/UX consistency (brief §21)

| Feature | Status | Evidence | Recommended action |
|---|---|---|---|
| Design system | Partial | `src/components/ui/*` primitives exist (Accordion…Tooltips); consistent token usage seen (`#1B2A4A`, `#BFFF00`, `font-mono-data`) | P1: audit empty/loading/error states coverage; accessibility pass (focus rings present in spots) |
| Charts | Partial | Performance/admin pages chart; library unverified | P2 |

## 20. Supporting systems (brief §22)

| System | Status | Evidence | Blockers | Recommended action |
|---|---|---|---|---|
| Ingestion / normalisation | Complete | Odds API (odds+fixtures), API-Football (fixtures/injuries, free-tier limited), football-data.co.uk CSVs (27,314 finished fixtures backfilled → Elo live) | Provider depth limits | — |
| Entity resolution | Partial | `normalizeTeamName` canonicalizer + tests; duplicates across sync paths; fuzzy first-match; no external_id namespace; weak odds↔fixture kickoff matching | See §11 | P1 hardening |
| Storage / schema | Complete | New Supabase: 67 tables live; feature store populated (production_v5 weights, 8 league params, 405 team profiles, 113 referee profiles) | `database.types.ts` stale (~24 vs 67); migrations fragmented (15 in `supabase/migrations` + ~35 loose root SQL) | P1: regenerate types; consolidate migrations |
| Fixtures pipeline | Complete | 27,473 fixtures (27,314 finished + 159 scheduled) | Scheduled-fixture freshness depends on cron health | — |
| Odds pipeline | Complete | `odds_snapshots` dedupe + 30d retention | Retention vs CLV (see §13) | P1 |
| Player/injury intel | Partial | Injury features computed; impact ~0 (stale `expected_return`); Transfermarkt/Premier Injuries scrapes (64 rows) | Staleness bug | P1 fix |
| Prediction generation / snapshots | Complete | Ensemble cron canonical; predictions+settlement+odds+injury pipelines verified E2E on dev | Triple writers (§17) | P0 doc + retire |
| Monitoring / result verification | Partial | Settlement cron + walk-forward infra; no external monitoring/alerting | No alerting on pipeline failure | P1 |
| Settlement | Partial | Works E2E; feed delete-all rebuild; cleanup FK risk | See §7 | P0/P1 |
| Analytics / learning | Partial | `cron/learn`, feature store, champion weights live; model_performance delete+recompute expensive | Cost/perf | P2 optimize |
| Notifications | Partial | In-app only (§15) | Email/push missing | P1 |
| Personalisation | Missing | No favourites/onboarding (§2) | — | P1 |
| Subscriptions | Backend-only | Stripe dormant (§16) | Schema missing | P1 |
| Audit logging | Partial | `admin_activity_log` Stripe-webhook only (§17) | Admin actions unaudited | P0/P1 |
| Job orchestration | Partial | 9 Vercel crons + 2 pg_cron MV jobs; hourly pipeline duplicates settle/predict/archive work | **Vercel Hobby 1-cron plan limit vs 9 crons — plan mismatch**; cron overlap redundancy | P0 plan decision; P1 dedupe jobs |
| Backup / recovery | **Missing / Unverified** | No backup automation found | — | P1: verify Supabase PITR/backups; document recovery |
| Security | Partial | Secrets scrubbed from tree; middleware + rate limits hardened **[FIXED]**; RLS admin page exists | **Secrets still in git history — rotation required** (old Supabase service-role key, new DB password, API-Football key); Convex legacy env warnings remain | P0: rotate credentials; P2: remove Convex remnants |

## 21. Cross-cutting blockers (feed into roadmap)

| # | Blocker | Severity | Affects |
|---|---|---|---|
| B1 | `recommendations` only populated by manual NVIDIA admin runs → value-bets/accumulator/notifications/dashboard starve | P0 | §3, §5, §13, §15 |
| B2 | Settlement feed delete-all rebuild + cleanup FK `NO ACTION` risk; no append-only audit | P0/P1 | §7, §17 |
| B3 | No subscriptions schema; Stripe dormant | P1 | §16, §1 pricing |
| B4 | Vercel Hobby cron plan limit (9 crons vs 1) | P0 | All scheduled pipelines |
| B5 | Secrets in git history — rotation pending | P0 | Security |
| B6 | No favourites/onboarding/personalisation | P1 | §2, §15, §20 |
| B7 | Admin gaps: football-data mgmt, provider mgmt, model registry, settlement correction UI, config/flags, audit log | P1 | §17 |
| B8 | Missing user pages: competitions, teams, players, live centre, prediction detail | P1/P2 | §5, §6, §10–12 |
| B9 | Model quality: 1X2 below always-home baseline; calibration caps ~0.81 | P0 (honesty) | §5, marketing claims |
| B10 | `database.types.ts` stale; migrations fragmented; Convex legacy remnants | P2 | DX/ops |
| B11 | Eval honesty: backtest numbers are simulated, not real-money — must stay labelled | Rule | §8, §10 |

## 22. Summary counts

- Routes audited: 46 page routes (10 marketing/auth public + 14 dashboard
  + 21 admin + misc), ~50 API routes.
- Complete: majority of existing routes.
- Partial: pricing, match detail, predictions fields, live/odds depth,
  notifications delivery, admin coverage, analytics segments.
- Missing: onboarding, favourites, competitions/teams/players pages,
  dedicated prediction detail, live centre page, subscriptions schema,
  large admin sections, backup/monitoring automation.
- Broken (pre-fix, now fixed): legal pages auth-gated, notifications stub,
  user-bets settle, several API auth gaps.
- Unverified at runtime: email verification flow, contact form action,
  Stripe portal behaviour while dormant, mobile UX, live-data licensing.
