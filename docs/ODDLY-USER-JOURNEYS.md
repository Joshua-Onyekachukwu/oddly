# ODDLY — User Journeys (2026-11-27)

Journeys mapped to actual routes. Evidence: [PRODUCT-AUDIT-FINDINGS.md](PRODUCT-AUDIT-FINDINGS.md)
and [ODDLY-PAGES-AND-FEATURES-AUDIT.md](ODDLY-PAGES-AND-FEATURES-AUDIT.md).
Route groups: `(marketing)` public shell, `(auth)`, `(dashboard)`
Sidebar+Header shell, `admin` role-gated.

Legend: ✅ exists · ⚠️ partial/friction · ❌ missing.

---

## J1. New visitor → signup → first value (brief §3)

| Step | Route(s) | Status | Friction / gap |
|---|---|---|---|
| Land | `/` | ✅ | Real stats; minor hardcodes (modelAgreement, activeModels) |
| Evaluate | `/#features`, `/#pricing`, `/#faq`, `/about`, `/contact` | ✅/⚠️ | `/features`, `/faq`, `/pricing` pages exist but nav uses anchors — orphaned duplicates; pricing can't convert (Stripe dormant) |
| Trust check | `/terms`, `/privacy`, `/cookies`, `/responsible-gambling` | ✅ **[FIXED]** | Were auth-gated; now public |
| Signup | `/signup` → `/auth/callback` | ✅ | Email verification step unverified at runtime |
| **Onboarding** | — | ❌ | **No onboarding flow exists.** User lands directly on `/dashboard` with no personalisation |
| First dashboard | `/dashboard` | ✅ | Content depends on `recommendations` table — starved unless admin ran NVIDIA generate manually (B1) |

**Current outcome:** a new user can register and see a dashboard, but gets
no personalisation, no favourites, and possibly thin content if
recommendations are stale.

### Proposed onboarding flow (brief §3: football interests → personalisation)

Single post-signup wizard at `/onboarding` (new route, `(dashboard)` or
standalone), skippable, ~3 steps:

1. **Interests** — favourite leagues (from `leagues` table), teams
   (search `teams.canonical_name`), maybe "I follow / I bet / both" intent.
2. **Personalisation** — derive dashboard defaults: favourite leagues
   pinned, default matches filter, notification categories pre-selected.
3. **Done** → `/dashboard` with populated favourites rail.

Requires (all missing today): `user_favourites` table
(user_id, entity_type, entity_id), `user_preferences` extension
(default league filter, notification categories), favourites API
(`/api/v1/user/favourites`), onboarding UI. See acceptance criteria doc
AC-AUTH-4/5.

---

## J2. Fan journey (follow teams, get notified)

| Step | Route(s) | Status | Friction / gap |
|---|---|---|---|
| Find team/match | `/matches` filters | ⚠️ | Team search unverified; no dedicated team page to land on |
| Follow | — | ❌ | **No favourites feature anywhere** (verified: no `fav*` in src or schema) |
| Get notified | `/notifications`, `/notifications/preferences` | ⚠️ | In-app only — no email/push; favourite/rollover/account alert categories unverified |
| Check result | `/matches/results`, `/tracking` | ✅ | Works |

**Gap summary:** the fan journey is broken at step 2 — there is nothing
to favourite and nothing that proactively notifies about a followed
team. This is the biggest product hole vs the brief (§3, §17).

---

## J3. Bettor journey (find value → build ticket → track → rollover)

| Step | Route(s) | Status | Friction / gap |
|---|---|---|---|
| Browse predictions | `/predictions` | ✅ | Filters partial vs brief (no competition/market/probability-range/data-quality filters confirmed) |
| Inspect a pick | `/matches/[id]` predictions tab; `/matches` drawer | ⚠️ | Shows prob/edge/EV/Kelly/risk — good; but **no dedicated prediction detail page** with evidence, model version, timestamp, uncertainty (brief §6–7) |
| Find value bets | betting-agent recommendations; `/api/v1/value-bets` | ⚠️ | Real data, but `recommendations` starved (B1) — pages can show empty states |
| Build accumulator | `/accumulator`, `/my-accumulators` | ✅ | Table-backed save/load |
| Bet slip | `/betting-agent` | ⚠️ | Betslip **not persisted** (console.log only); History tab "Coming Soon" |
| Track bets | `/tracking` | ✅ **[FIXED]** | user_bets manual settle now admin-only — users can't self-settle (correct) |
| Rollover | `/rollover` | ✅ v1 | Chains/picks/engine rec work; spec gaps: QUALIFIED/WAIT/SKIP states, combined prob/EV/correlation, monthly tracking, bankroll, simulated-vs-actual, manual approval, RG framing (ODDLY-ROLLOVER-ENGINE-SPEC.md) |
| Review performance | `/performance` | ✅ | Accuracy/Brier/log-loss/calibration; segment breakdowns + CLV partial |

**Honesty check:** model quality is the binding constraint — eval
baseline shows 1X2 argmax 41.7% vs always-home 43.5%. The bettor journey
is structurally complete but the underlying picks underperform a naive
baseline; marketing "golden picks" language should stay conservative
until calibration improves (B9).

---

## J4. Admin journey (ops control centre)

| Step | Route(s) | Status | Friction / gap |
|---|---|---|---|
| Login as admin | `/login` → role check | ✅ | Role-gated shell |
| Health overview | `/admin`, `/admin/system-health`, `/admin/db-health`, `/admin/crons` | ✅ | No unified provider-quota/cost/freshness view |
| Pipeline ops | `/admin/pipeline`, `/admin/run-pipeline`, `/admin/picks` | ✅ **[FIXED]** | run-pipeline auth forwarded; **triple prediction writers remain** — canonical = ensemble cron |
| Model oversight | `/admin/model-health`, `/admin/walk-forward`, `/admin/accuracy`, `/admin/draw-analysis`, `/admin/scoring` | ✅ | No registry/experiment/champion-challenger/promotion UI |
| User mgmt | `/admin/users`, `/admin/announcements` | ✅ | — |
| Data mgmt | — | ❌ | No fixture/team/player/entity-match admin; entity-resolution bugs have no remediation UI |
| Provider mgmt | — | ❌ | No provider health/quota/cost/fallback surface |
| Settlement ops | — | ❌ | No correction UI; settlement_feed is delete-all rebuild (not auditable) |
| Security/audit | `/admin/security`, `/admin/rls` | ⚠️ | `admin_activity_log` written only by Stripe webhook — admin actions unaudited |
| Config/flags | `/admin/settings` | ⚠️ | Static only; entitlements enforcement flag has no toggle |

---

## J5. Cross-cutting journey risks

1. **Empty-state risk (B1):** dashboard, value-bets, accumulator,
   notifications all depend on `recommendations`, populated only by
   manual admin NVIDIA runs. Until the ensemble cron writes
   recommendations, every consumer journey can hit empty states.
2. **No email/push:** every notification-dependent journey is
   in-app-only; users must visit to see alerts.
3. **Billing dead-end:** `/pricing` → "Coming Soon"; `/settings` Stripe
   portal link likely errors while dormant. Freemium direction is set;
   enforcement flag OFF.
4. **Cron plan mismatch (B4):** 9 Vercel crons on Hobby plan — scheduled
   pipelines (sync/predict/settle/learn/validate) may silently not all
   run in prod. All data-freshness journeys depend on this.
5. **Secrets rotation pending:** credentials in git history must be
   rotated before any public launch.

## J6. Priority journey fixes (maps to acceptance criteria)

| Priority | Journey fix | Unblocks |
|---|---|---|
| P0 | Populate `recommendations` from ensemble cron | J3 value-bets, accumulator, notifications, dashboard |
| P0 | Resolve cron plan mismatch + dedupe hourly/daily overlap | All freshness-dependent journeys |
| P0 | Append-only settlement events + admin correction UI | J3 tracking trust, J4 settlement ops |
| P1 | Onboarding + favourites (schema→API→UI) | J1, J2 entirely |
| P1 | Email notifications (settlement/lineup/favourite alerts) | J2, J3 tracking |
| P1 | Persist betslip + betting-agent History | J3 |
| P1 | Prediction detail page with evidence/version/timestamp | J3 trust |
| P1 | Subscriptions schema + checkout UI | Monetisation journey |
| P2 | Live centre (only with licensed provider), player/team/competition pages, rollover spec gaps | J2 depth, J3 advanced |
