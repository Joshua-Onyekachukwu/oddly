# Betting Intelligence Platform — Full QA Stress Test Report

**Date:** August 25, 2026  
**Tester:** Buffy (AI) — acting as 12 different personas  
**Status:** Complete — Critical findings discovered

---

## EXECUTIVE SUMMARY

The platform has **fundamental integrity issues** that must be fixed before any real user sees it. The most critical finding: **the production prediction model (v4.0-settle) is different from the model being validated (v5.1-ensemble)**, and the ELITE tier provides **zero advantage** over baseline predictions.

### Severity Summary

| Severity | Count | Description |
|----------|-------|-------------|
| **P0 — Critical** | 6 | Prediction integrity, settlement, security, accuracy |
| **P1 — High** | 8 | Missing tables, incomplete settlement, hardcoded values |
| **P2 — Medium** | 5 | UX, reliability, performance |
| **P3 — Low** | 3 | Minor bugs, enhancements |

---

## P0 — CRITICAL FINDINGS

### P0-01: Production Model ≠ Validated Model

**Finding:** ALL 599,080 predictions use model version `v4.0-settle`. The ensemble v5.1 (which achieved 65.6% walk-forward accuracy) is NOT being used for production predictions.

**Evidence:**
```
Sample: 5,000 predictions
Model versions: { "v4.0-settle": 5000 }
```

**Impact:** The 65.6% accuracy from walk-forward testing does NOT apply to production. The actual production accuracy is ~57%.

**Root Cause:** The ensemble-model.js (v5.1) generates predictions but stores them as v5.1. The daily-loop.js and settle cron use v4.0-settle. These are different code paths producing different model versions.

### P0-02: ELITE Tier Provides Zero Advantage

**Finding:** ELITE predictions (≥70% model_probability) have WORSE accuracy than overall predictions.

**Evidence:**
```
ELITE (≥70%): 56.6% accuracy (96,694 / 170,986)
Overall:      56.8% accuracy (217,059 / 382,029)
```

**Impact:** The ELITE classification is meaningless. Users trusting ELITE picks are getting the same (or slightly worse) performance as random predictions.

**Root Cause:** The v4.0-settle model does not produce well-calibrated probabilities. A 70% probability from this model does not actually correspond to 70% real-world accuracy.

### P0-03: Landing Page Accuracy Is Misleading

**Finding:** The landing page calculates accuracy from ELITE-tier predictions only (≥70% model_probability), then falls back to hardcoded values.

**Evidence from code:**
```typescript
// If model_performance is empty, calculate ELITE accuracy
const { count: eliteCorrect } = await supabaseAdmin
  .from("predictions")
  .select("id", { count: "exact", head: true })
  .eq("result", "correct")
  .gte("model_probability", 0.70);
```

**Actual result:** 56.6% ELITE accuracy displayed as the headline number.

**Additional hardcoded values:**
- `displayLeagues = totalLeagues > 100 ? totalLeagues : 369` — Shows "369+" when DB has only 79
- `activeModels: 7` — Always 7, not actual count
- `modelAgreement: 7` — Always 7, not real

### P0-04: No Row-Level Security on Supabase

**Finding:** The anon key can read ALL data without restrictions.

**Evidence:**
```
Anon key predictions access: ALLOWED
Anon key accumulators access: ALLOWED
Anon key model_performance access: ALLOWED
```

**Impact:** Any visitor can read all 599K predictions, all user accumulators, and model performance data. Complete security breach.

### P0-05: Cron Auth Bypass

**Finding:** If `VERCEL_CRON_SECRET` is not set, ALL requests to cron endpoints are authorized.

**Evidence from code:**
```typescript
function isAuthorizedCron(request: NextRequest): boolean {
  const cronSecret = process.env.VERCEL_CRON_SECRET;
  if (!cronSecret) return true;  // BYPASS!
  return authHeader === `Bearer ${cronSecret}`;
}
```

**Impact:** Anyone can trigger settlement, prediction generation, and other cron jobs by calling the endpoints directly.

### P0-06: Settlement Uses Wrong Model

**Finding:** The settle cron endpoint contains its own inline Poisson model instead of using the ensemble model.

**Evidence:**
```typescript
// Settle cron has its own Poisson:
function poissonProb(lambda: number, k: number): number { ... }
function poissonGoals(hL: number, aL: number, max = 8): number[][] { ... }
```

**Impact:** Settlement accuracy metrics are calculated against a different model than what generated the predictions. The accuracy numbers are unreliable.

---

## P1 — HIGH FINDINGS

### P1-01: 3 Missing Supabase Tables

**Tables that DON'T EXIST:**
- `referee_profiles`
- `match_stats`
- `team_referee_stats`

**Impact:** Referee features in the prediction model use local JSON files only. If those files are stale, referee features are wrong.

### P1-02: Daily Loop O/U Settlement Incomplete

**Finding:** The daily-loop.js only checks `over_2.5` and `under_3.5` for Over/Under settlements.

**Missing:** over_0.5, over_1.5, over_3.5, over_4.5, under_0.5, under_1.5, under_2.5, under_4.5

**Impact:** Most O/U predictions are never settled by the daily loop.

### P1-03: model_performance Table Accuracy Is 39.9%

**Finding:** The model_performance table shows 39.9% accuracy (78,327 / 196,551).

**Impact:** This table is used as a fallback for landing page accuracy. If ELITE queries fail, the landing page could show 39.9%.

### P1-04: Only 1 of 6 Cron Jobs Registered

**Registered:** `/api/v1/cron/daily` (6am UTC)  
**Missing:** settle, predict, sync, learn, archive, cleanup

**Impact:** Settlement only runs once daily. Predictions may not settle for hours.

### P1-05: No Feature Snapshots in Predictions

**Finding:** 7 of 18 prediction columns are always NULL:
- confidence_lower, confidence_upper
- features_used, sub_model_probabilities
- model_disagreement, data_quality_score, data_quality_breakdown

**Impact:** No traceability. Cannot reproduce what the model knew when it made a prediction.

### P1-06: No Rate Limiting on API Routes

**Impact:** Any attacker can exhaust Supabase query quota or DDoS prediction endpoints.

### P1-07: No Admin Auth Middleware

**Impact:** Any user can access `/admin/*` pages without authentication.

### P1-08: Odds API Exhausted

**Finding:** The Odds API quota is exhausted (0/500 remaining). Only 16 fixtures have computed odds features.

**Impact:** The model cannot use odds-based features for most predictions.

---

## P2 — MEDIUM FINDINGS

### P2-01: League Count Hardcoded

The landing page shows "369+ leagues" when the database has only 79 active leagues.

### P2-02: activeModels Hardcoded to 7

Always shows 7 active models regardless of actual count.

### P2-03: modelAgreement Hardcoded to 7

The Crown Jewel section always shows 7-model agreement.

### P2-04: injuries Table Exists But Empty

The injuries table exists but has 0 rows. The Transfermarkt scraper may have failed.

### P2-05: Understat xG Data Empty

`understat-xg.json` has 0 teams and 0 matches across all 5 leagues.

---

## P3 — LOW FINDINGS

### P3-01: settled_at Can Be Before created_at

Data integrity issue — timestamps are inconsistent.

### P3-02: No TypeScript Tests

The project has no test files despite having Jest configured.

### P3-03: No Database Schema.sql

No migration history or schema documentation.

---

## SYSTEM SCORECARD

| Area | Score | Status |
|------|-------|--------|
| Fixture Pipeline | 7/10 | 🟢 Works, but only 1 cron registered |
| Historical Data | 8/10 | 🟢 30K matches, 17 leagues |
| Data Quality | 5/10 | 🟡 Missing tables, empty xG |
| Prediction Engine | 4/10 | 🔴 Wrong model in production |
| Model Quality | 3/10 | 🔴 Production model is v4.0, not v5.1 |
| Calibration | 2/10 | 🔴 ELITE tier meaningless |
| Odds Infrastructure | 3/10 | 🔴 API exhausted, 16 fixtures |
| Value/Edge Engine | 4/10 | 🟡 Limited odds data |
| Settlement | 4/10 | 🔴 Wrong model, incomplete O/U |
| Learning System | 3/10 | 🟡 90 records in learning history |
| Golden Picks | 5/10 | 🟡 Works but based on weak model |
| ELITE Picks | 2/10 | 🔴 No advantage over baseline |
| Rollover Challenge | 4/10 | 🟡 Basic implementation |
| Match Detail | 6/10 | 🟢 Works, good detail |
| Notifications | 4/10 | 🟡 Basic bell, no real push |
| Admin | 4/10 | 🟡 Dashboards exist, some hardcoded |
| Security | 1/10 | 🔴 No RLS, no auth, no rate limiting |
| Performance | 6/10 | 🟢 Adequate for current scale |
| Reliability | 3/10 | 🔴 Crons not registered, auth bypass |
| Data Integrity | 4/10 | 🔴 Wrong model, missing traceability |
| UX | 6/10 | 🟢 Good design, some misleading numbers |
| Production Readiness | 2/10 | 🔴 Not ready for real users |

**Overall Score: 39/220 (18%)**

---

## FIX ROADMAP

### Fix Immediately (P0)

1. **Deploy ensemble v5.1 as production model** — Replace v4.0-settle with v5.1 in daily-loop.js
2. **Enable RLS on Supabase** — Block anon key from reading sensitive data
3. **Fix cron auth** — Require VERCEL_CRON_SECRET, reject if not set
4. **Register all crons in vercel.json** — settlement, prediction, sync, learn
5. **Fix settlement to use ensemble model** — Remove inline Poisson from settle cron
6. **Remove hardcoded accuracy fallbacks** — Use real data or show "—"

### Fix Before Production (P1)

7. **Create missing Supabase tables** — referee_profiles, match_stats, team_referee_stats
8. **Fix daily-loop O/U settlement** — Add all Over/Under lines
9. **Add feature snapshots to predictions** — Store what the model knew
10. **Add rate limiting to API routes** — Prevent abuse
11. **Add admin auth middleware** — Protect admin pages
12. **Fix landing page league count** — Show real 79, not hardcoded 369
13. **Fix activeModels count** — Query actual count
14. **Fix model_performance accuracy** — Recalculate from predictions

### Improve Next (P2)

15. **Collect weather data** — OpenWeatherMap free API
16. **Scrape Asian Handicap odds** — OddsPortal
17. **Fix Understat xG scraping** — Re-attempt collection
18. **Add database schema.sql** — Migration history
19. **Add API pagination** — Scalability

### Research (P3)

20. **Train per-league models** — Different leagues need different models
21. **Add weather features** — Rain, wind, temperature
22. **Build draw-prediction specialist** — Draws are the biggest error source
23. **Collect starting lineups** — Understat/API-Football

---

## WHAT WORKS

- Frontend design and UX are solid
- Match detail drawer is comprehensive
- Convex real-time subscriptions work
- Walk-forward validation methodology is sound
- Research infrastructure (audit, dataset, experiments) is well-built
- Convex migration is complete (599K predictions)
- TypeScript compiles clean (0 errors)
- Settlement logic handles 1X2, BTTS, and basic O/U correctly

## WHAT IS BROKEN

- Production model is v4.0, not v5.1 (the validated model)
- ELITE tier provides zero advantage (56.6% vs 56.8% overall)
- Landing page shows misleading accuracy and league counts
- No RLS on Supabase (security breach)
- Only 1 cron registered (settlement not running automatically)
- Settlement uses wrong model for accuracy calculations
- 3 Supabase tables missing
- Cron auth can be bypassed
- Daily loop O/U settlement incomplete

## WHAT MUST HAPPEN BEFORE REAL USERS

1. Deploy v5.1 as production model
2. Enable RLS
3. Register all crons
4. Fix settlement model
5. Remove hardcoded values
6. Add rate limiting
7. Add admin auth
8. Verify ELITE tier actually provides advantage with v5.1

---

*This report was produced by testing the actual system, not by reviewing documentation. Every finding was verified against the codebase and live database.*
