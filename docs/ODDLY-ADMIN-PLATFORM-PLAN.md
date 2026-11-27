# ODDLY — Admin Platform Plan (Operational Control Centre)

**Date:** 2026-11-27 · **Source:** ODDLY-PRODUCT-AUDIT-BRIEF.md §19
**Status:** Audit output — awaits approval. Cross-refs: [MASTER-PLAN.md](MASTER-PLAN.md) · [PRODUCT-ROADMAP.md](PRODUCT-ROADMAP.md) Module C · [ODDLY-COMPLETE-PRODUCT-ROADMAP.md](ODDLY-COMPLETE-PRODUCT-ROADMAP.md) F-23 · [PRODUCT-AUDIT-FINDINGS.md](PRODUCT-AUDIT-FINDINGS.md) §1

---

## 1. Current admin audit (verified 2026-11-27)

`src/app/admin/` — **20 page routes** (root dashboard + 19 sections); `src/app/api/v1/admin/` — **13 API routes**.

| Route | Size (lines) | Status | Real vs weak |
|---|---|---|---|
| `/admin` (dashboard) | 221 | Complete | Real — reads live tables incl. `admin_activity_log` (but that table is nearly empty, see §3) |
| `pipeline` | 883 | Complete | Real pipeline status; fs-state → `app_state` fixed |
| `picks` | 1191 | Complete | Largest page; prediction browsing |
| `walk-forward` | 812 | Complete | Validation results real |
| `ai-monitor` | 709 | Complete | NVIDIA usage monitoring |
| `system-health` | 802 | Complete | Overlaps db-health — merge candidate |
| `accuracy` | 598 | Complete | Settled-prediction metrics |
| `injuries` | 568 | Partial | Unverified view + RLS per findings |
| `users` | 490 | Complete | User mgmt exists (search, roles) — but no activity/subscription views |
| `crons` | 401 | Complete | Surfaces cron state; needs `cron_executions` depth |
| `draw-analysis` | 392 | Complete | Research-grade analytics |
| `security` | 354 | Partial | RLS/policy inspection; **no audit-log UI, no event feed** |
| `referees` | 310 | Complete | Referee profile management |
| `announcements` | 296 | Complete | CRUD works |
| `model-health` | 323 | Complete | Overlaps accuracy/walk-forward — reorganize under Model Intelligence |
| `db-health` | 211 | Complete | Merge into Overview/Operations |
| `rls` | 206 | Complete | Policy inspector |
| `scoring` | 147 | Partial | Model scoring config — fold into Model Intelligence |
| `settings` | 71 | Weak | Static only — no platform config/feature flags |
| `convex-health` | 622 | Orphaned | Convex provider never mounted — **delete or repurpose** |

**API routes:** announcements (+[id]), crons, db-health, leagues, model-performance, picks, rls, run-pipeline (auth fixed), run-validation, security, users (+[id]).

### What's missing entirely (per §19 vs current)

- Overview aggregating health+users+ingestion+predictions+settlements+jobs+providers+DB+alerts (dashboard exists but is not this).
- Football-data management: competitions/teams/players browser, entity-matching review queue, data-quality reports, ingestion-run browser, missing-data report, conflict queue.
- Provider management: health, quotas, costs, freshness, fallback status — **never expose credentials**.
- Prediction ops: settlement monitor, manual re-settle (audited), failure analysis.
- Model intelligence: registry/experiments, champion/challenger, drift, promote/rollback controls (model-health is read-only metrics today).
- Settlement ops + correction UI.
- Rollover admin: ticket generation audit, candidates, qualification audit, threshold config, performance.
- Subscriptions/billing admin.
- Platform config: feature flags, market enablement, thresholds.
- Security/audit: roles/permissions management, activity log UI, approvals.

### Critical gap: `admin_activity_log`

Table exists (`supabase/migrations/20260819000000_initial_schema.sql:453` — `id, admin_id, action, target_type, target_id, details jsonb, created_at`; RLS admin-only select/insert; cleanup cron prunes >90d at `api/v1/cron/cleanup/route.ts:111`). **Only the Stripe webhook writes it** (`api/v1/stripe/webhook/route.ts:139`). No admin page, no middleware/helper writes it for admin mutations (users, announcements, rls changes, run-pipeline, run-validation). Effectively an empty audit trail — must be fixed before admin platform ships (§19 security/audit requirement).

### Credential-protection rules (mandatory)

1. **Never render secrets** — provider keys, service-role JWT, DB passwords, webhook secrets must not appear in any admin page, API response, log line, or error message. Display only: provider name, key fingerprint (last 4), status, quota, cost.
2. All provider credentials stay in env vars / Supabase Vault — admin UI manages *references*, not values.
3. Admin APIs must not return rows containing credential columns; audit `database.types.ts` + API serializers.
4. `admin_activity_log.details` must redact any sensitive payload before insert.
5. No "test connection" feature that echoes provider responses containing keys.

---

## 2. Target control centre — 11 sections

Maps to brief §19 verbatim. Existing pages are marked **reuse/merge/new**.

| # | Section | Current state | Gap | Required tables / endpoints / pages | Priority | Phase |
|---|---|---|---|---|---|---|
| A1 | **Overview** | `/admin` dashboard real but shallow | Needs unified health board: ingestion freshness, prediction counts, settlement backlog, cron failures, provider status, DB size, open alerts | Read aggregations over `cron_runs`/`app_state`/fixtures/predictions; new `/api/v1/admin/overview`; alert rules table `admin_alerts` | P0 | Ph4 |
| A2 | **User management** | `/admin/users` + API exist | Add: activity view (from `admin_activity_log` + auth events), subscription status, role changes audited, suspension | `profiles`, future `subscriptions`; extend users API; user detail page | P0 | Ph4 |
| A3 | **Football-data management** | Leagues API only; referees page | Competitions/teams/players browser; entity-match review queue; data-quality scores; ingestion runs; missing-data & conflict reports | `leagues, teams, players, fixtures, ingestion_runs?, entity_matches?, data_quality_scores?` — several tables may need creating; `/admin/data/*` pages + APIs | P0 | Ph4 |
| A4 | **Provider management** | None | Health/quota/cost/freshness/fallback per provider; credential-safe display | `data_providers` config table (no secrets — env refs only); `/api/v1/admin/providers`; status aggregation from cron logs | P1 | Ph4 |
| A5 | **Prediction ops** | `picks`, `accuracy`, `pipeline` exist | Settlement monitor, manual re-settle with mandatory audit entry, prediction failure analysis, regenerate controls | `predictions`, `settlement_feed`, `admin_activity_log`; new ops endpoints | P0 | Ph4 |
| A6 | **Model intelligence / registry** | `model-health`, `walk-forward`, `accuracy`, `scoring`, `draw-analysis` exist (read-only) | Registry: versions, experiments, champion/challenger, drift metrics, promote/rollback (approval-gated) | `model_versions`, `experiments`, `model_promotions?`; `/api/v1/admin/models/*`; merge existing 5 pages into one section | P1 | Ph4–5 |
| A7 | **Settlement ops** | None dedicated | Settlement queue, corrections with audit trail, void handling | `settlement_feed` (→ append-only per roadmap F-09), `settlement_corrections?` | P0 | Ph4 |
| A8 | **Rollover admin** | None | Daily ticket audit, candidate inspection, qualification-score breakdown, threshold config, monthly performance, manual approve/skip | `rollover_tickets`, `rollover_candidates?`, `rollover_config?`; depends on F-11 | P1 | Ph5 |
| A9 | **System ops** | `crons`, `system-health`, `db-health` exist | Unified jobs view: executions, locks, retries, failures, logs, cost/quota tracking; surface `cron_runs`/`cron_executions` | `cron_runs` exists; add failure alerting; merge 3 pages → Operations | P0 | Ph4 |
| A10 | **Platform config / feature flags** | `settings` static (71 lines) | Feature flags, market enablement, thresholds, rollout controls | `platform_config`/`feature_flags` table; `/admin/settings` rebuild + API | P1 | Ph4 |
| A11 | **Security / audit** | `security`, `rls` exist (inspectors) | Roles/permissions UI, **`admin_activity_log` viewer + writers everywhere**, approvals workflow, security events | `admin_activity_log` (exists — wire writes), `admin_roles?`, `admin_approvals?` | P0 | Ph4 |

**Non-section cleanups:** delete `convex-health` (orphaned); merge `db-health`+`system-health`→Operations; `scoring`→Model Intelligence; reorganize nav into the 11 sections (AdminLayoutClient.tsx).

---

## 3. Cross-cutting requirements

- **Audit-first:** every mutating admin action (role change, re-settle, promote model, config change, announcement publish) MUST insert `admin_activity_log` via a shared server-side helper — no client-side inserts. Include before/after in `details` (redacted).
- **Approvals:** destructive/sensitive actions (model promotion, settlement correction, user suspension, flag flips) require second-admin approval once user count justifies (§19 "approvals").
- **No decorative metrics:** every number links to its query; empty states explain why (PRODUCT-ROADMAP rule).
- **Vercel constraints:** admin dashboards must tolerate serverless (aggregate queries cheap; no fs; paginate large tables).
- **RLS:** admin APIs use service-role after `requireAdmin` check; pages server-render with admin session.

## 4. Phasing

- **Phase 4a (with roadmap Phase 4):** A1 Overview, A9 System ops consolidation, A11 audit-log wiring + viewer, A2 user mgmt depth, A5 prediction/settlement ops, nav reorganization, convex-health removal.
- **Phase 4b:** A3 data management, A10 config/flags.
- **Phase 5:** A4 provider mgmt (needs provider config table), A6 model registry (needs F-27), A8 rollover admin (needs F-11), A11 approvals workflow.

**Exit condition:** all §19 capabilities present or explicitly deferred with reason; 100% of admin mutations audited; zero credential exposure (verified by API audit test).
