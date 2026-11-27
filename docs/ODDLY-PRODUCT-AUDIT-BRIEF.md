# ODDLY — Complete Product Audit Brief (authoritative requirements)

Date: 2026-11-27. Full product experience + roadmap audit. **Audit first —
no broad implementation until the plan is reviewed and approved.**

## Scope (27 sections, condensed)

1. **Full app audit** — every route, page, component, API, schema, auth,
   cron, provider, admin feature, doc, mobile layout, test. Classify each:
   Complete / Partial / Frontend-only / Backend-only / Broken / Missing /
   Needs-improvement / Unverified — with evidence.
2. **Public/marketing pages** — home, how-it-works, features, predictions,
   competitions, pricing, about, FAQ, contact, terms, privacy,
   responsible-gambling. No invented stats; label planned vs available.
3. **Auth/onboarding/accounts** — register, login, verify, reset, sessions,
   onboarding (football interests → personalisation), favourites, market
   prefs, notifications, profile, security, billing, deletion.
4. **Main dashboard** — today's fixtures, predictions, confidence +
   data-quality indicators, live info, results, performance summary,
   favourites, rollover status, alerts. Real data only — no decorative or
   fabricated stats.
5. **Fixtures + match centre** — browse/filter/search fixtures by
   date/country/team/status; rich match page (form, H2H, xG, injuries,
   lineups, referee, weather, odds+movement, predictions, explanations,
   data-quality, missing-info labels).
6. **Predictions centre** — browse/filter/search/compare predictions by
   date/competition/market/probability/data-quality/status; per-prediction:
   outcome, prob, model confidence (≠ outcome prob), data quality, odds,
   implied prob, EV, model version, timestamp, evidence, uncertainty,
   historical performance. Markets only where models are validated.
7. **Prediction detail/intelligence reports** — evidence-based explanations
   only; no convincing-sounding fabrications.
8. **Live centre** — live scores/events/stats/lineups/odds where licensed;
   investigate live-prediction viability honestly; never present pre-match
   predictions as live.
9. **Results + prediction history** — settled/won/lost/void/pending,
   immutable snapshots, settlement corrections auditable, never silently
   overwrite.
10. **Performance/analytics centre** — accuracy, Brier, log-loss,
    calibration, per-market/competition/probability-range, CLV, ROI only
    with verified records; separate accuracy vs simulated vs real-money.
11. **Rollover centre** — dedicated module consuming central predictions
    (never mutating them): discovery, singles + combos ~2.00, combined prob,
    EV, correlation, data quality, risk, reject reasons, QUALIFIED/WAIT/
    SKIP, history, monthly tracking, bankroll, simulated vs actual,
    manual approval, responsible-gambling framing.
12. **Competition intelligence** — per-competition pages: standings,
    fixtures, results, stats, prediction performance, data coverage.
13. **Team intelligence** — team profiles + entity resolution across
    provider name variants (no duplicates).
14. **Player intelligence** — only where providers support it; no invented
    stats.
15. **Odds/market intelligence** — odds comparison, opening/current/closing,
    movement, implied prob, margin, consensus, model-vs-market, CLV;
    source + timestamp always shown.
16. **AI assistant** — explains predictions/matches using real ODDLY data;
    distinguishes verified facts from interpretation; no invented stats or
    guarantees.
17. **Notifications/personalisation** — match/prediction/lineup/odds/result/
    settlement/favourite/rollover/account alerts with preferences.
18. **Subscriptions/billing** — tiers, entitlements, payments, trials,
    restrictions, support; sensible monetisation tied to real value/cost.
19. **Admin platform** — operational control centre: overview (health,
    users, ingestion, predictions, settlements, jobs, providers, DB,
    alerts); user mgmt; football-data mgmt (competitions/teams/players/
    fixtures/entity matching/data quality); provider mgmt (health, quotas,
    costs, freshness, fallbacks — never expose credentials); prediction
    ops; model registry/intelligence (versions, experiments,
    champion/challenger, drift, promotion/rollback); settlement ops;
    rollover admin; system ops (jobs, queues, retries, logs, costs);
    platform config (feature flags, markets, thresholds); security/audit
    (roles, permissions, activity logs, approvals).
20. **Mobile/responsive** — intentional mobile UX, not shrunk desktop.
21. **UI/UX** — consistency, hierarchy, typography, colour, spacing, cards,
    charts, loading/empty/error states, search/filter, accessibility;
    serious-product feel, no decorative clutter.
22. **Supporting systems** — ingestion, normalisation, entity resolution,
    storage, fixtures, odds, player intel, prediction gen/storage/
    snapshots, monitoring, result verification, settlement, analytics,
    learning, notifications, personalisation, subscriptions, audit
    logging, job orchestration, monitoring/alerting, backup/recovery,
    security.
23. **Prioritisation** — P0 essential foundation / P1 core expansion /
    P2 advanced. Per feature: status, user value, tech/DB/backend/
    frontend requirements, dependencies, complexity, tests, acceptance
    criteria, phase.
24. **Implementation roadmap** — phased, with completion conditions,
    parallel vs sequential work, no duplication.
25. **Documentation** — produce/update:
    `ODDLY-COMPLETE-PRODUCT-ROADMAP.md`, `ODDLY-PAGES-AND-FEATURES-AUDIT.md`,
    `ODDLY-USER-JOURNEYS.md`, `ODDLY-ADMIN-PLATFORM-PLAN.md`,
    `ODDLY-UI-UX-REDESIGN-PLAN.md` (exists — update),
    `ODDLY-FEATURE-IMPLEMENTATION-TRACKER.md`,
    `ODDLY-PRODUCT-ACCEPTANCE-CRITERIA.md`. No duplicates; cross-reference.
26. **Final report** — every page status, missing pages/features,
    improvements, product structure (user + admin), backend
    requirements, journeys, design recs, dependencies, roadmap, testing
    criteria, complexity/blockers, first phase; plus summary answers
    (what users can do today / at essential-complete / at advanced-complete,
    current vs required admin capabilities, top unfinished tasks, what
    next).
27. **Execution rules** — audit before implementation; verify against
    code; no invented completeness; no duplicate systems; no security
    compromise; preserve prediction/learning architecture; rollover is
    not the whole product; no appearance-only pages; no fake stats;
    no credential exposure; preserve history; real backend wiring;
    testable features; maintained docs; coherent product > page count.

## Current audit context (from prior rounds)

- New Supabase: 67 tables live; predictions+settlement+odds+injury
  pipelines verified E2E on dev; feature store populated
  (production_v5 weights live).
- Rollover engine v1 exists (`src/lib/rollover/engine.ts` + tests +
  `/rollover` page + recommendation API) — spec gaps tracked in
  `ODDLY-ROLLOVER-ENGINE-SPEC.md`.
- Known broken/dead: several legacy worker scripts write to non-existent
  columns; `odds_feature_cache` dead schema; some injury scraper paths
  partial; old `data/` research assets not in prod path.
- Vercel prod still on OLD Supabase env vars (blocked on token).
