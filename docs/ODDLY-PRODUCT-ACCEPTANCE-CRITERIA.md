# ODDLY — Product Acceptance Criteria (2026-11-27)

Testable acceptance criteria per major feature area, derived from
[ODDLY-PRODUCT-AUDIT-BRIEF.md](ODDLY-PRODUCT-AUDIT-BRIEF.md) §1–27.
Evidence/status detail: [ODDLY-PAGES-AND-FEATURES-AUDIT.md](ODDLY-PAGES-AND-FEATURES-AUDIT.md);
user flows: [ODDLY-USER-JOURNEYS.md](ODDLY-USER-JOURNEYS.md).

Format: `AC-<AREA>-<n>` · Given/When/Then or checkbox · Priority
(P0 essential foundation / P1 core expansion / P2 advanced, brief §23)
· Phase (aligned to [IMPLEMENTATION-ROADMAP.md](IMPLEMENTATION-ROADMAP.md)
phases; P0→early phases, P1→mid, P2→late).

## Global rules (apply to every criterion)

- **R1 — No fake stats.** No page, API, email, or marketing claim may
  display invented numbers, counts, accuracy, or social proof. All stats
  trace to real tables/APIs. Planned features labelled as such.
- **R2 — Immutable prediction snapshots.** A prediction row, once
  generated, is never mutated; settlement attaches results, corrections
  are append-only events with reason + actor + timestamp.
- **R3 — Honest abstention.** The system may return "no pick" /
  insufficient-data states; abstention is a valid, visible outcome —
  never papered over with low-quality forced picks.
- **R4 — Rollover never forces tickets.** Rollover recommends; it never
  auto-creates bets, mutates central predictions, or overrides user
  bankroll limits. Responsible-gambling limits always win.
- **R5 — Admin audit trails.** Every admin mutation (user changes,
  settlement corrections, config/flag changes, pipeline triggers,
  model promotion/rollback) writes an `admin_activity_log`-style record:
  actor, action, target, before/after, timestamp, IP where available.
- **R6 — Credentials.** No secrets in client bundles, API responses,
  logs, or admin UI; provider keys env-only. (Rotation of history-
  exposed keys is a P0 prerequisite, not a criterion to defer.)

---

## AC-AUTH — Auth, onboarding, accounts (brief §3)

| ID | Pri | Phase | Criterion |
|---|---|---|---|
| AC-AUTH-1 | P0 | Early | Given a visitor on `/`, When they click signup and complete `/signup` + `/auth/callback`, Then they land authenticated on `/dashboard` (or `/onboarding` if AC-AUTH-4 shipped) — verified by runtime test. Email-verification behaviour documented either way. |
| AC-AUTH-2 | P0 | Early | Given `/terms`, `/privacy`, `/cookies`, `/responsible-gambling`, When accessed logged-out, Then all render 200 without redirect (regression guard for middleware fix). |
| AC-AUTH-3 | P0 | Early | Given an unauthenticated request to any `/api/v1/*` route except the explicit public allowlist, When called, Then it returns 401/403 — no Bearer-undefined bypass (regression guard). |
| AC-AUTH-4 | P1 | Mid | Given a new signup, When onboarding wizard completes, Then `user_favourites` + preference rows exist and `/dashboard` shows personalised content (favourite leagues/teams). Skippable in ≤3 steps. |
| AC-AUTH-5 | P1 | Mid | Given a user, When they favourite a team/league/match, Then it persists across sessions and appears in matches/predictions filters and notifications. |
| AC-AUTH-6 | P1 | Mid | Given a user, When they open `/settings`, Then they can update profile, notification preferences (incl. favourite/rollover/account categories), and request account deletion that completes within a defined SLA. |
| AC-AUTH-7 | P2 | Late | Given Stripe live, When a user checks out from `/pricing`, Then a `subscriptions` row + event + invoice are created, entitlements apply per `entitlements.ts`, and portal/cancel/refund flows work. Until then pricing CTAs remain honestly disabled. |

## AC-DASH — Dashboard (brief §4)

| ID | Pri | Phase | Criterion |
|---|---|---|---|
| AC-DASH-1 | P0 | Early | Given the ensemble predict cron has run, When `recommendations` is populated from ensemble output (not only manual NVIDIA runs), Then `/dashboard` shows today's picks without manual admin action. |
| AC-DASH-2 | P0 | Early | Given `/dashboard` renders, When any stat/count is displayed, Then it comes from a live query — no hardcoded `modelAgreement`/`activeModels` literals (currently hardcoded; must be replaced or removed). |
| AC-DASH-3 | P1 | Mid | Given a user with favourites, When `/dashboard` loads, Then favourite-team fixtures/predictions appear in a dedicated rail; empty favourites → onboarding prompt, not broken UI. |
| AC-DASH-4 | P1 | Mid | Given a settled prediction, When settlement feed updates, Then dashboard reflects won/lost/void/pending within one poll cycle (5 min) without stale "pending" on settled rows. |
| AC-DASH-5 | P2 | Late | Given rollover engine output, When user has rollover-eligible picks, Then dashboard shows rollover status card (count, next-eligible, link to `/rollover`). |

## AC-MATCH — Fixtures + match centre (brief §5)

| ID | Pri | Phase | Criterion |
|---|---|---|---|
| AC-MATCH-1 | P0 | Early | Given `/matches`, When filtering by date range and league, Then results match DB truth (spot-check vs `fixtures` table); pagination correct. |
| AC-MATCH-2 | P1 | Mid | Given `/matches`, When searching a team name and filtering by status (scheduled/live/finished), Then correct fixtures return; no duplicates from entity-resolution collisions. |
| AC-MATCH-3 | P1 | Mid | Given `/matches/[id]`, When opened, Then page shows: fixture info, predictions (prob + timestamp + model version), odds with source+timestamp, recommendations with edge/EV/Kelly, AND explicit "data unavailable" labels for missing sections (injuries/H2H/xG/lineups/referee/weather). No section silently absent or fabricated. |
| AC-MATCH-4 | P1 | Mid | Given injury data exists but `expected_return` is stale, When match page renders injuries, Then staleness is surfaced ("as of" date) rather than presented as current. |
| AC-MATCH-5 | P2 | Late | Given licensed live data, When a match is live, Then live scores/events appear with source attribution; pre-match predictions remain labelled pre-match (never presented as live). If no licence: no live page ships (no appearance-only). |

## AC-PRED — Predictions centre + detail (brief §6–7)

| ID | Pri | Phase | Criterion |
|---|---|---|---|
| AC-PRED-1 | P0 | Early | Given `/predictions`, When filtering by tier/league/date, Then only real `predictions` rows render; every row shows outcome, probability, and distinguishes model confidence from outcome probability where both exist. |
| AC-PRED-2 | P0 | Early | Given the eval baseline (1X2 argmax 41.7% < always-home 43.5%), When predictions are surfaced to users, Then markets shown are limited to validated ones and marketing copy does not claim unverified accuracy (R1). |
| AC-PRED-3 | P1 | Mid | Given a prediction, When its detail view opens (dedicated route or expanded panel), Then it shows: outcome, prob, model confidence, data quality, odds, implied prob, EV, model version, generation timestamp, evidence factors, uncertainty, and link to historical performance for that market/competition. |
| AC-PRED-4 | P1 | Mid | Given insufficient data for a fixture, When prediction generation runs, Then the system abstains or emits explicit low-confidence/insufficient-data state (R3) — never a fabricated confident pick. |
| AC-PRED-5 | P1 | Mid | Given `/predictions` browse, When filtering by competition/market/probability-range/data-quality and searching, Then filters return correct subsets (extends today's tier/league/date set). |
| AC-PRED-6 | P2 | Late | Given model improvement work, When a new model version is promoted, Then historical predictions remain attributable to their original version (snapshots immutable, R2) and performance dashboards segment by version. |

## AC-RESULT — Results + history + settlement (brief §9)

| ID | Pri | Phase | Criterion |
|---|---|---|---|
| AC-RESULT-1 | P0 | Early | Given a finished fixture with settled predictions, When `/matches/results` and `/tracking` load, Then each shows correct settled/won/lost/void/pending state computed from immutable snapshots + settlement events. |
| AC-RESULT-2 | P0 | Early | Given settlement runs twice for the same fixture, When re-run, Then no duplicate settlement events and no silent overwrite — corrections append events with reason/actor/timestamp (R2). `settlement_feed` becomes append-only (currently delete-all rebuild — must change). |
| AC-RESULT-3 | P1 | Mid | Given an admin correcting a settlement, When they submit a correction with reason, Then the correction is recorded, the user-facing state updates, and the original record remains queryable. |
| AC-RESULT-4 | P1 | Mid | Given fixture cleanup job, When it deletes finished fixtures >30d, Then FK `NO ACTION` violations cannot occur (ordering/dependency fix) and settled-history retention policy is explicit and documented. |
| AC-RESULT-5 | P2 | Late | Given CLV-capable odds history, When settlement+closing odds exist, Then per-prediction CLV is computable and displayed labelled "closing-line value (simulated tracking)" until real-money records exist. |

## AC-ANALYTICS — Performance centre (brief §10)

| ID | Pri | Phase | Criterion |
|---|---|---|---|
| AC-ANALYTICS-1 | P0 | Early | Given settled predictions exist, When `/performance` loads, Then accuracy/Brier/log-loss/calibration are computed from real settled rows only; empty state is honest when <N samples. |
| AC-ANALYTICS-2 | P1 | Mid | Given performance data, When user selects market/competition/probability-range segments, Then metrics recompute per segment and sample sizes are shown (no metrics on n<threshold without warning). |
| AC-ANALYTICS-3 | P1 | Mid | Given simulated backtest numbers appear anywhere user-facing, Then they are explicitly labelled simulated/research and never mixed with verified settled performance (R1). Accuracy vs simulated vs real-money are visually separate. |
| AC-ANALYTICS-4 | P2 | Late | Given verified user bet records exist, When ROI is displayed, Then it uses only verified records with stake/currency/settlement provenance; otherwise ROI section shows "insufficient verified data". |
| AC-ANALYTICS-5 | P2 | Late | Given `model_performance` recompute runs, Then it is incremental or scheduled off-peak — delete+recompute cost is measured and within cron time budget. |

## AC-ROLLOVER — Rollover centre (brief §11, R4)

| ID | Pri | Phase | Criterion |
|---|---|---|---|
| AC-ROLLOVER-1 | P0 | Early | Given `/rollover`, When engine evaluates fixtures, Then it consumes central `predictions` read-only — test asserts predictions table unchanged after rollover runs (R4). |
| AC-ROLLOVER-2 | P1 | Mid | Given a candidate ticket, When displayed, Then it shows: legs (singles + combos targeting ~2.00 combined odds), combined probability, EV, correlation note, data quality, risk tier, and explicit QUALIFIED/WAIT/SKIP state with reject reasons when not qualified. |
| AC-ROLLOVER-3 | P1 | Mid | Given the user declines or lacks bankroll, When rollover recommends, Then nothing is auto-created — no bet rows, no forced tickets (R4). Manual-approval path exists before any "place" affordance. |
| AC-ROLLOVER-4 | P1 | Mid | Given rollover history, When viewed, Then simulated vs actual tracking is separated and labelled; monthly P&L tracking exists per spec. |
| AC-ROLLOVER-5 | P2 | Late | Given responsible-gambling limits configured, When a rollover ticket exceeds limits, Then it is blocked with clear messaging; limits override all recommendations (R4). |
| AC-ROLLOVER-6 | P2 | Late | Given admin, When viewing rollover ops, Then recommendation decisions (qualified/wait/skip + reasons) are auditable per R5. |

## AC-ODDS — Odds / market intelligence (brief §15)

| ID | Pri | Phase | Criterion |
|---|---|---|---|
| AC-ODDS-1 | P1 | Mid | Given a fixture with odds, When match page odds tab renders, Then each price shows source (bookmaker) + snapshot timestamp; implied prob and margin derivable. |
| AC-ODDS-2 | P1 | Mid | Given odds history, When opening/current prices exist, Then movement is shown; closing odds retained long enough to compute CLV (extend beyond 30d for closing capture). |
| AC-ODDS-3 | P2 | Late | Given multiple bookmakers, When odds panel renders, Then consensus + best-price comparison shown with source attribution always visible. |

## AC-COMP — Competition / team / player intelligence (brief §12–14)

| ID | Pri | Phase | Criterion |
|---|---|---|---|
| AC-COMP-1 | P1 | Mid | Given `/competitions/[slug]`, When opened, Then page shows real data only: upcoming fixtures, recent results, prediction performance for that league, and a data-coverage indicator; standings only if from a verified source. |
| AC-COMP-2 | P1 | Mid | Given `/teams/[id]`, When opened, Then profile shows canonical team identity with provider name variants resolved to ONE entity (no duplicates); form/results from real fixtures. |
| AC-COMP-3 | P0 | Early | Given entity resolution runs, When two provider names map to same team, Then `external_id` namespacing prevents cross-provider collisions (fix before team pages ship). |
| AC-COMP-4 | P2 | Late | Given player data, When player pages/sections render, Then every stat traces to a provider field with as-of timestamp; unsupported stats absent rather than invented (R1). |

## AC-LIVE — Live centre (brief §8)

| ID | Pri | Phase | Criterion |
|---|---|---|---|
| AC-LIVE-1 | P1 | Mid | Given live-data licensing is confirmed, When a match is in-play, Then `/live` (or matches live filter) shows scores/events/stats with provider attribution and timestamps. |
| AC-LIVE-2 | P1 | Mid | Given any live surface, When pre-match predictions display during live play, Then they remain labelled "pre-match" — never presented as live predictions. In-play predictions ship only with a validated in-play model + honest eval. |
| AC-LIVE-3 | P1 | Mid | Given no licensed live provider, When audit closes this area, Then decision is recorded as "not building" — no placeholder live page ships. |

## AC-AI — AI assistant (brief §16)

| ID | Pri | Phase | Criterion |
|---|---|---|---|
| AC-AI-1 | P0 | Early | Given `/ai-chat`, When asked about a match/prediction, Then the response is grounded in real ODDLY data (fixture/prediction IDs retrievable) and rate limits apply to anonymous + authed users (regression guard). |
| AC-AI-2 | P1 | Mid | Given any AI answer containing statistics, When rendered, Then verified facts vs interpretation are visually distinguished and stats cite their source table/API; the assistant never guarantees outcomes. |
| AC-AI-3 | P1 | Mid | Given prompt-injection or off-topic input, When submitted, Then response stays scoped to ODDLY data and refuses fabricated stats (R1) — covered by test cases. |

## AC-NOTIFY — Notifications / personalisation (brief §17)

| ID | Pri | Phase | Criterion |
|---|---|---|---|
| AC-NOTIFY-1 | P0 | Early | Given a notification-generating event (settlement, favourite match kickoff), When it occurs, Then a row lands in the real notifications table and `/notifications` renders it (regression guard for in-memory stub fix). |
| AC-NOTIFY-2 | P1 | Mid | Given `/notifications/preferences`, When toggling categories, Then preferences persist and cover: match, prediction, lineup, odds-movement, result, settlement, favourite, rollover, account. |
| AC-NOTIFY-3 | P1 | Mid | Given a user opt-in, When a settlement or lineup event fires, Then an email (or push) is delivered via a real provider — in-app only is not sufficient for P1 completion. |
| AC-NOTIFY-4 | P2 | Late | Given notification volume grows, When digests are enabled, Then users can receive a daily digest instead of per-event noise. |

## AC-BILL — Subscriptions / billing (brief §18)

| ID | Pri | Phase | Criterion |
|---|---|---|---|
| AC-BILL-1 | P1 | Mid | Given subscriptions schema exists (subscriptions, subscription_events, invoices — currently absent), When Stripe webhook fires, Then subscription state updates idempotently and `admin_activity_log` records it. |
| AC-BILL-2 | P1 | Mid | Given a premium/elite feature gate, When a free user hits it, Then an honest upgrade prompt shows (feature name, tier, price) — enforcement flag flip is a deliberate admin action with audit record (R5). |
| AC-BILL-3 | P1 | Mid | Given `/pricing`, When Stripe is live, Then checkout → webhook → entitlement works E2E in test mode; trial/cancel/refund paths documented. Until live, CTAs stay disabled (no fake checkout). |
| AC-BILL-4 | P2 | Late | Given billing live, When admin views subscriptions, Then MRR/active-count/churn visible in admin with per-user detail; support flow (refund/cancel) documented. |

## AC-ADMIN — Admin platform (brief §19, R5)

| ID | Pri | Phase | Criterion |
|---|---|---|---|
| AC-ADMIN-1 | P0 | Early | Given any admin mutation (user role change, announcement, pipeline trigger, config change), When executed, Then an audit record (actor/action/target/before-after/timestamp) is written — currently only Stripe webhook writes `admin_activity_log`; middleware or repository-level logging required. |
| AC-ADMIN-2 | P0 | Early | Given `/admin/*`, When accessed by non-admin role, Then 403 — and admin API routes enforce role server-side (not just UI hiding). |
| AC-ADMIN-3 | P1 | Mid | Given football-data management, When admin opens fixtures/teams/players/entity-match review, Then they can inspect sync state, resolve entity duplicates (with confidence shown), and see data-quality flags per competition. |
| AC-ADMIN-4 | P1 | Mid | Given provider management, When admin opens provider page, Then per-provider health/quota/cost/freshness/fallback status shows; **no credentials or key fragments ever render** (R6). |
| AC-ADMIN-5 | P1 | Mid | Given model registry, When admin views models, Then versions/experiments/champion-challenger status/drift metrics visible; promotion and rollback are audited actions (R5) that never rewrite historical prediction attribution (R2). |
| AC-ADMIN-6 | P1 | Mid | Given settlement ops, When admin views settlements, Then corrections use reason codes, are append-only, and appear in audit log; erroneous auto-settlements can be flagged without deleting history. |
| AC-ADMIN-7 | P1 | Mid | Given platform config, When admin toggles a feature flag or threshold, Then change is audited, takes effect without deploy where designed, and has a documented rollback. |
| AC-ADMIN-8 | P1 | Mid | Given cron/job ops, When admin views jobs, Then each job shows last-run status/duration/errors/retries; manual re-run is audited; the Vercel Hobby 1-cron plan limit vs 9 registered crons is resolved (upgrade or consolidate) before prod reliance. |
| AC-ADMIN-9 | P2 | Late | Given ops maturity, When monitoring exists, Then pipeline failure/odds staleness/settlement backlog trigger alerts to admin (external monitoring — currently absent). |
| AC-ADMIN-10 | P2 | Late | Given security review, When RLS policies are inspected via `/admin/rls`, Then findings link to remediation; penetration-test checklist from SECURITY-AUDIT-REPORT.md re-verified. |

## AC-UX — UI/UX + mobile + supporting systems (brief §20–22)

| ID | Pri | Phase | Criterion |
|---|---|---|---|
| AC-UX-1 | P1 | Mid | Given mobile viewport (375px), When using dashboard/matches/predictions/rollover/settings, Then layouts are intentionally designed for mobile (not shrunk desktop): nav reachable, tables→cards, tap targets ≥44px, no horizontal scroll on primary flows. |
| AC-UX-2 | P1 | Mid | Given any data view, When loading/empty/error states occur, Then each has a designed state (skeleton/spinner exists for matches; empty states honest; errors offer retry) — no blank screens or raw error dumps. |
| AC-UX-3 | P1 | Mid | Given keyboard/screen-reader use, When navigating primary flows, Then focus order, labels, and contrast meet WCAG 2.1 AA for interactive elements (spot-check: focus rings already present on several components). |
| AC-UX-4 | P1 | Mid | Given `database.types.ts` regeneration, When types are regenerated from live schema (67 tables vs ~24 typed), Then API/routes compile against real types; migrations consolidated into `supabase/migrations` with the ~35 loose root SQL files reconciled. |
| AC-UX-5 | P1 | Mid | Given backup/recovery, When documented and tested, Then Supabase backup/PITR posture is verified, a restore drill is recorded, and recovery runbook exists in docs/. |
| AC-UX-6 | P2 | Late | Given Convex legacy, When audited, Then unused `convex/` dir, provider stubs, and env warnings are removed or documented as deprecated — no dead parallel backend. |
| AC-UX-7 | P2 | Late | Given test suite, When CI exists (`.github/workflows`), Then `jest` (currently 28 tests) + lint + typecheck + a smoke E2E (signup→dashboard→prediction view) run on PR; coverage targets defined per TESTING-AND-QA-PLAN.md. |

---

## Phase summary

| Phase | Contains | Completion condition |
|---|---|---|
| **Phase 1 — P0 foundation** | AC-AUTH-1..3, AC-DASH-1..2, AC-PRED-1..2, AC-RESULT-1..2, AC-ANALYTICS-1, AC-ROLLOVER-1, AC-COMP-3, AC-AI-1, AC-NOTIFY-1, AC-ADMIN-1..2 + B1–B5 blockers | Recommendations populated by cron; settlement append-only; audit log on admin mutations; auth surface regression-clean; honest-stats rule enforced on all user surfaces |
| **Phase 2 — P1 core expansion** | AC-AUTH-4..6, AC-DASH-3..4, AC-MATCH-1..4, AC-PRED-3..5, AC-RESULT-3..4, AC-ANALYTICS-2..3, AC-ROLLOVER-2..4, AC-ODDS-1..2, AC-COMP-1..3, AC-LIVE-1..3, AC-AI-2..3, AC-NOTIFY-2..3, AC-BILL-1..3, AC-ADMIN-3..8, AC-UX-1..5 | Onboarding+favourites live; prediction detail w/ evidence; email notifications; subscriptions schema+checkout; admin data/provider/model/settlement/config sections; mobile pass; backups verified |
| **Phase 3 — P2 advanced** | AC-AUTH-7, AC-DASH-5, AC-MATCH-5, AC-PRED-6, AC-RESULT-5, AC-ANALYTICS-4..5, AC-ROLLOVER-5..6, AC-ODDS-3, AC-COMP-4, AC-NOTIFY-4, AC-BILL-4, AC-ADMIN-9..10, AC-UX-6..7 | Live centre (if licensed), player intel, CLV/ROI on verified records, rollover RG limits + admin, monitoring/alerting, Convex cleanup, CI/E2E |

## Sign-off checklist (before declaring a phase complete)

- [ ] Every criterion above has a test or documented manual verification.
- [ ] R1–R6 global rules verified by review, not assumed.
- [ ] No criterion marked done on appearance alone — backend wiring proven (brief §27).
- [ ] Docs updated: this file, PAGES-AND-FEATURES-AUDIT, USER-JOURNEYS,
      FEATURE-IMPLEMENTATION-TRACKER, and MASTER-PLAN index.
