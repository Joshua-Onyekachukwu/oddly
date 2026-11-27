# ODDLY — Testing & Production Readiness Plan

**Date:** 2026-11-26 · Current state: **zero tests** (no `.test.`/`.spec.` files, no Jest config despite jest deps)

---

## 1. Test Infrastructure to Build

- Jest + ts-jest config (deps already in package.json) for unit/integration.
- Playwright (or Vitest+Testing Library) for e2e — add dependency.
- Python: pytest for training/validation scripts.
- CI: GitHub Actions — lint, type-check, unit tests, build on every PR.

## 2. Test Layers

### Unit (highest priority — pure math, fast)
- `checkPrediction` settlement logic for every market (1X2, OU lines, BTTS, DC, DNB, home/away goals) incl. edge cases (exactly on line → push handling).
- Poisson/goals-grid math in `market-goals.js`.
- `buildFeatures` / `getTeamStats` in ensemble.ts (Elo, form windows, rest-day fatigue, injury impact).
- Isotonic calibration interpolation.
- Odds math: implied prob, overround removal, EV, combined odds/probability, correlation adjustment.
- Rollover qualification rules + combination search.
- Team name normalization (`normalizeTeamName`) — historically buggy (case-sensitivity fixes in git log).

### Integration
- Predict cron: fixture window → predictions rows (idempotency: second run inserts 0).
- Settle cron: finished fixture → correct result + settlement row + feed archive.
- Snapshot write/read round-trip.
- Cron lock: concurrent runs → one executes, one skips.
- Supabase RLS: anon cannot read protected tables; user sees only own data.
- API auth: admin routes reject non-admin; cron routes reject missing secret.
- Injury feature pipeline end-to-end.

### Prediction-specific
- Leakage test: for N historical fixtures, recompute features as-of kickoff and assert no post-kickoff data (lineups confirmed after, closing odds, post-match stats).
- Walk-forward harness regression: champion model metrics within tolerance of baseline.
- Calibration: ECE/Brier per market on holdout.
- Rollover backtest determinism: same inputs → same ticket.

### E2E (critical user paths)
- Signup → login → dashboard loads.
- Matches list → match detail → prediction visible.
- Rollover page: ticket or honest empty state.
- Admin login → each admin section loads real data.
- Screenshot-to-analysis (when built): upload → result.

### Security
- RLS policy tests per table.
- Auth bypass attempts on admin/API.
- Rate-limit behavior.
- File upload validation (screenshot feature).
- Secret scan in client bundle (`NEXT_PUBLIC_` audit).

### Performance
- Predict cron for 500 fixtures < timeout; settle cron window.
- Dashboard query counts (no N+1); API p95 targets.
- DB: index coverage on fixtures(kickoff), predictions(fixture_id, result), odds(fixture_id, captured_at).

## 3. Production Readiness Gates

A release is "production-ready" only when:

| Gate | Criterion |
|---|---|
| Correctness | All unit+integration tests pass; settlement verified on 50 real fixtures |
| Traceability | 100% of new predictions have input snapshots |
| Security | RLS verified on new Supabase; admin auth tested; no secrets client-side |
| Reliability | 7 days of cron executions with zero unhandled failures; locks verified |
| Data quality | Snapshot completeness ≥ threshold on all predicted fixtures |
| Honesty | No unverified accuracy/ROI claims in UI or docs |
| Rollback | DB migration rollback tested; env flip-back documented |

## 4. Coverage & Gap Tracking

Maintain `docs/TESTING-AND-QA-PLAN.md` coverage table; target ≥80% on `src/lib` math + `worker/models` + settlement paths first (highest risk), then expand.

## 5. Known Test Debt (from audit)

- Model version sprawl → need golden-file tests per engine version.
- Settlement Elo windowing → add test asserting settle uses same team-strength builder as predict.
- `model_performance` Brier bug (O(n²) find + prob/result misalignment) → unit test will catch; fix in Phase A.
