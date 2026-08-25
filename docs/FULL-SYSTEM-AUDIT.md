# Betting Intelligence Platform — Full System Audit Report

**Date:** August 25, 2026  
**Auditor:** Buffy (AI)  
**Status:** Pre-Change Audit — No Modifications Made

---

## EXECUTIVE SUMMARY

The platform has **35 frontend pages, 37 API routes, 40+ worker scripts, 599K+ predictions, 14K fixtures, 17 leagues, 2 databases (Supabase + Convex)**. The architecture is ambitious but has significant issues in security, data integrity, model consistency, and operational reliability that must be addressed before the system can be considered production-ready.

### Severity Count

| Severity | Count | Examples |
|----------|-------|---------|
| **CRITICAL** | 4 | No RLS on Supabase, hardcoded accuracy fallback, settle cron has inline model, only 1 cron registered |
| **HIGH** | 7 | 3 missing Supabase tables, inconsistent model versions, no prediction feature snapshots, stale data |
| **MEDIUM** | 8 | Landing page accuracy claims vs reality, no rate limiting on API, no retry logic, etc. |
| **LOW** | 5 | Missing schema.sql, no TypeScript tests, etc. |

---

## 1. WHAT CURRENTLY WORKS

### ✅ Data Pipeline
- **football-data.org sync**: 30,340 historical matches across 17 leagues (2021-2026)
- **Team composite ratings**: 405 teams with goals, shots, fouls, cards, form
- **Referee data**: 177 referees, 9,740 matches with referee names, 113 profiles
- **xG data**: StatsBomb (2,183 matches), Understat (empty — scraping failed)
- **Standings**: 9 leagues (PL, La Liga, Serie A, Bundesliga, Ligue 1, Championship, Eredivisie, Liga Portugal, Brasileirão)
- **Player stats**: 265 players across 116 teams

### ✅ Prediction Engine
- **Ensemble model v5.1**: Poisson + Elo + Regression + xG + Isotonic calibration
- **Walk-forward validated**: 65.6% average accuracy across 3 folds (14,280 test matches)
- **High-confidence bucket**: 78% at ≥65%, 89% at ≥80%
- **Convex cold storage**: 599K+ predictions, 838 teams, 946 xG profiles, 14.8K odds

### ✅ Frontend
- **35 pages** across marketing, dashboard, and admin
- **Real-time Convex subscriptions** for accuracy dashboard
- **Match detail drawer** with H2H, form guide, 24-market breakdown
- **Golden Picks page** with league and market filtering
- **Admin dashboards**: Accuracy, Convex Health, DB Health, System Health, Referees

### ✅ Research Infrastructure
- **Walk-forward simulator**: No-leakage training/prediction loop
- **Experiment registry**: Tracks all experiments with leaderboard
- **Clean research dataset**: 27,314 matches with 60+ features

---

## 2. WHAT IS BROKEN

### 🔴 CRITICAL: No Row-Level Security (RLS) on Supabase

**Finding:** The anon key can read ALL predictions, accumulators, and model_performance data without any restrictions.

```
Anon key predictions access: ALLOWED (5 rows)
Anon key accumulators access: ALLOWED
Anon key model_performance access: ALLOWED
```

**Impact:** Any user can read all prediction data, other users' accumulators, and model performance metrics. This is a complete security failure.

**Fix Required:** Enable RLS on all Supabase tables. Set policies: users can only read their own accumulators; predictions are read-only for authenticated users; model_performance is admin-only.

### 🔴 CRITICAL: Only 1 Cron Job Registered in Vercel

**Finding:** `vercel.json` only registers ONE cron job:
```json
{ "crons": [{ "path": "/api/v1/cron/daily", "schedule": "0 6 * * *" }] }
```

**Missing crons:**
- `/api/v1/cron/settle` — prediction settlement (should run every 30min)
- `/api/v1/cron/predict` — prediction generation
- `/api/v1/cron/sync` — fixture synchronization
- `/api/v1/cron/learn` — learning pipeline

**Impact:** Settlement only runs once daily at 6am. Predictions for finished matches may not settle for hours. Fixtures may go stale.

### 🔴 CRITICAL: Settle Cron Has Inline Poisson Model

**Finding:** `src/app/api/v1/cron/settle/route.ts` contains its own inline Poisson model instead of using the ensemble model:

```typescript
// Settle cron has its own Poisson:
function poissonProb(lambda: number, k: number): number { ... }
function poissonGoals(hL: number, aL: number, max = 8): number[][] { ... }
```

**Impact:** Settlement uses a different model than prediction generation. Settlement accuracy calculations are based on the wrong model.

### 🔴 CRITICAL: Hardcoded Accuracy Fallback

**Finding:** The landing page HeroBanner has a hardcoded fallback:
```typescript
const accuracy = stats.avgAccuracy > 0 ? `${stats.avgAccuracy}%` : "—";
// But the admin accuracy page has:
? "76.3" // Fallback from ELITE tier measurement
```

**Impact:** If the database query returns 0 or null, the landing page shows "—" or a hardcoded number instead of real data. The 76.3% fallback may not reflect actual accuracy.

---

## 3. WHAT IS UNRELIABLE

### 🟡 3 Missing Supabase Tables

**Tables that DON'T EXIST in Supabase:**
- `referee_profiles` — "Could not find the table in the schema cache"
- `match_stats` — "Could not find the table in the schema cache"
- `team_referee_stats` — "Could not find the table in the schema cache"

**Impact:** Referee features in the prediction model are using data from local JSON files only, not from the database. If the JSON files are stale, referee features are wrong.

### 🟡 Inconsistent Model Versions

**Predictions in DB use:** `v4.0-settle`  
**Ensemble model produces:** `v5.1-ensemble-calibrated`  
**Settle cron uses:** Inline Poisson (no version)

**Impact:** Three different "models" are producing predictions. The accuracy metrics may not reflect the actual ensemble model's performance.

### 🟡 Prediction Table Has Many NULL Columns

```json
{
  "confidence_lower": null,
  "confidence_upper": null,
  "features_used": null,
  "sub_model_probabilities": null,
  "model_disagreement": null,
  "data_quality_score": null,
  "data_quality_breakdown": null
}
```

**Impact:** No traceability. We cannot determine what the model knew when it made a prediction. This violates the "prediction must be permanently traceable" requirement.

### 🟡 Odds API Exhausted

**Finding:** The Odds API quota is exhausted (0/500 remaining). Only 16 fixtures have computed odds features out of 14,984 snapshots.

**Impact:** The model cannot use odds-based features for most predictions. CLV tracking is limited.

### 🟡 Understat xG Data Empty

**Finding:** `understat-xg.json` has 0 teams and 0 matches across all 5 leagues.

**Impact:** xG features rely entirely on StatsBomb (2,183 matches) which covers only a subset of leagues. Most predictions have `has_xg: 0`.

---

## 4. WHAT DATA IS MISSING

| Data | Coverage | Impact | Source |
|------|----------|--------|--------|
| **Starting Lineups** | 0% | HIGH — formation + player impact | Understat, API-Football |
| **Asian Handicap Odds** | 0% | HIGH — sharpest market signal | OddsPortal |
| **Weather** | 0% | MEDIUM — goals, cards effects | OpenWeatherMap |
| **Manager Tenure** | 0% | MEDIUM — new manager bounce | Wikipedia |
| **Possession/PPDA** | ~7% (2,183 matches) | MEDIUM — tactical style | FBref |
| **Referee tables in Supabase** | 0% | HIGH — referee features broken | Need CREATE TABLE |
| **Historical odds (closing)** | 0.1% | HIGH — CLV training features | The Odds API (exhausted) |

---

## 5. DATA STRUCTURE PROBLEMS

### Supabase Predictions Table
- **599,080 rows** — large but manageable
- **18 columns** — 7 are always NULL (wasted storage)
- **No feature snapshot** — cannot reproduce predictions
- **No fixture_id index** visible in schema
- **settled_at can be before created_at** (data integrity issue)

### Convex Predictions Table
- **~599K rows** migrated — but only sample-based counts work (32K read limit)
- **No fixture snapshot** — same traceability issue

### Local JSON Files
- **33 JSON files** in `/data` — mixed formats, some empty
- **No versioning** — files overwrite previous data
- **No provenance** — cannot determine when data was collected or from which source

---

## 6. PREDICTION ENGINE AUDIT

### Active Models

| Model | Version | Features | Status | Accuracy |
|-------|---------|----------|--------|----------|
| Ensemble v5.1 | v5.1-ensemble-calibrated | Poisson + Elo + Regression + xG + Isotonic | ACTIVE | 65.6% (walk-forward) |
| Settle Cron | Inline Poisson | Basic Poisson only | ACTIVE (settlement) | Unknown |
| XGBoost v6 | v6 (research) | 47 features | RESEARCH | 68.6% (test set) |
| Ensemble v5.0 | v5.0-ensemble | Poisson + Elo + Regression | LEGACY | 65.6% |

### Key Problem
The **settlement system uses a different model than the prediction system**. This means accuracy metrics are unreliable.

---

## 7. CRON RELIABILITY

| Job | Schedule | Endpoint | Registered in Vercel | Last Run |
|-----|----------|----------|---------------------|----------|
| Daily Pipeline | 6am UTC | /api/v1/cron/daily | ✅ YES | Unknown |
| Settlement | Should be frequent | /api/v1/cron/settle | ❌ NO | Unknown |
| Prediction | Should be daily | /api/v1/cron/predict | ❌ NO | Unknown |
| Sync | Should be daily | /api/v1/cron/sync | ❌ NO | Unknown |
| Learn | Should be weekly | /api/v1/cron/learn | ❌ NO | Unknown |

**Only 1 of 5 crons is actually registered.**

---

## 8. SECURITY AUDIT

### 🚨 CRITICAL: No RLS
All tables readable with anon key. Any visitor can:
- Read all 599K predictions
- Read all user accumulators
- Read model performance data
- Read all fixture data

### 🟡 API Keys in .env.local
17 keys/secrets found. Service role key is used in API routes (acceptable for server-side, but should be verified it's not exposed to client).

### 🟡 No Rate Limiting
API routes have no rate limiting. An attacker could:
- Exhaust Supabase query quota
- Run expensive queries repeatedly
- DDoS the prediction endpoints

### 🟡 Admin Endpoints
Admin pages exist at `/admin/*` but no middleware verification was found to ensure only admin users can access them.

---

## 9. DEPLOYMENT AUDIT

### Vercel Configuration
- **Cron:** Only daily pipeline registered
- **Build:** TypeScript compiles clean (0 errors)
- **Auto-deploy:** Pushes to main trigger deployment
- **Environment:** 17 env vars configured

### Git Status
- **12 uncommitted files** — mix of research infrastructure and migration tools
- **Last commit:** d7fbf71 (research loop infrastructure)

---

## 10. ACCURACY PROBLEM ANALYSIS

### Why Reported Accuracy Varies

| Source | Reported | Reality |
|--------|----------|---------|
| Landing Page | Dynamic (fetches from DB) | Uses fallback if DB returns 0 |
| Admin Accuracy | Convex real-time | Limited to 32K read sample |
| Walk-Forward | 65.6% | Genuine out-of-sample |
| Model Comparison | 68.6% | Test set (potential leakage) |
| ELITE Tier | 75-80% | High-confidence subset |

### The Real Accuracy
**65.6% walk-forward on 1X2** is the most honest number. The 88.8% at 80%+ confidence is real but on only 214 matches.

---

## 11. SCALABILITY ASSESSMENT

### Current Scale
- 599K predictions → Manageable
- 14K fixtures → Small
- 14K odds snapshots → Small
- 838 teams → Small
- 30K historical matches → Small

### Growth Projections (12 months)
- 599K → 2M+ predictions (daily generation × multiple markets)
- 14K → 50K+ fixtures (more leagues × more seasons)
- 14K → 500K+ odds snapshots (daily odds collection)

### Bottlenecks
1. **Supabase free tier** — 500MB storage, 500K rows may hit limits
2. **Convex 32K read limit** — prevents accurate counting
3. **No pagination** in many API routes — will slow down with growth
4. **Local JSON files** — not scalable, no concurrent access

---

## 12. RECOMMENDED ARCHITECTURE

### Keep
- Supabase for transactional data (auth, users, active predictions, fixtures)
- Convex for cold storage + real-time subscriptions
- Next.js for frontend + API routes
- Vercel for deployment
- Python for ML training

### Fix Immediately
1. Enable RLS on all Supabase tables
2. Register all cron jobs in vercel.json
3. Fix settlement to use ensemble model
4. Create missing Supabase tables (referee_profiles, match_stats, team_referee_stats)
5. Remove hardcoded accuracy fallbacks

### Fix Soon
6. Add feature snapshots to predictions table
7. Add rate limiting to API routes
8. Add admin auth middleware
9. Fix Understat xG scraping
10. Add retry logic to external API calls

### Plan for Growth
11. Add database migrations (schema.sql)
12. Add API pagination
13. Add prediction versioning
14. Add proper logging/observability
15. Add automated testing

---

## 13. IMPLEMENTATION ROADMAP

### CRITICAL (Do Now)
1. **Enable RLS on Supabase** — security breach
2. **Register all crons in vercel.json** — settlement not running
3. **Fix settle cron to use ensemble model** — wrong accuracy metrics
4. **Create missing Supabase tables** — referee features broken

### HIGH (This Week)
5. **Add feature snapshots to predictions** — traceability
6. **Add admin auth middleware** — unauthorized access
7. **Fix landing page accuracy fallback** — misleading claims
8. **Add rate limiting to API routes** — abuse prevention
9. **Fix Understat xG scraping** — missing data

### MEDIUM (This Month)
10. **Add database schema.sql** — no migration history
11. **Add API pagination** — scalability
12. **Add retry logic to external APIs** — reliability
13. **Collect weather data** — new feature
14. **Scrape Asian Handicap odds** — new feature

### LOW (Eventually)
15. **Add TypeScript tests** — code quality
16. **Add proper logging** — observability
17. **Add automated testing pipeline** — CI/CD
18. **Collect starting lineups** — new feature

---

*This audit was produced by inspecting the actual codebase, database, configuration, and running queries against live systems. No assumptions were made.*
