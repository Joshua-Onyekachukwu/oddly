# Betting Intelligence Platform — Master Documentation

**Version:** 1.0  
**Last Updated:** August 25, 2026  
**Status:** Living Document — Updated with every significant change

---

## Table of Contents

1. [Executive Overview](#1-executive-overview)
2. [Product Vision & Principles](#2-product-vision--principles)
3. [System Architecture](#3-system-architecture)
4. [Data Architecture](#4-data-architecture)
5. [Database Architecture](#5-database-architecture)
6. [Prediction Engine](#6-prediction-engine)
7. [Model Registry](#7-model-registry)
8. [Feature Engineering](#8-feature-engineering)
9. [Odds Infrastructure](#9-odds-infrastructure)
10. [Market Architecture](#10-market-architecture)
11. [ELITE & Golden Picks](#11-elite--golden-picks)
12. [Settlement System](#12-settlement-system)
13. [Accuracy & Calibration](#13-accuracy--calibration)
14. [Cron & Scheduled Jobs](#14-cron--scheduled-jobs)
15. [Security](#15-security)
16. [Frontend Architecture](#16-frontend-architecture)
17. [Backend Architecture](#17-backend-architecture)
18. [Infrastructure & Deployment](#18-infrastructure--deployment)
19. [Environment Configuration](#19-environment-configuration)
20. [Research & Learning Loop](#20-research--learning-loop)
21. [Feature Status Matrix](#21-feature-status-matrix)
22. [Model & Dataset History](#22-model--dataset-history)
23. [Architecture Decision Records](#23-architecture-decision-records)
24. [Open Issues & Risks](#24-open-issues--risks)
25. [Development Roadmap](#25-development-roadmap)
26. [Change Log](#26-change-log)

---

## 1. Executive Overview

### What Is the Betting Intelligence Platform?

A sports prediction and intelligence platform that uses historical football data, statistical models, and machine learning to generate probability-based predictions across multiple betting markets.

### Problem Being Solved

Most bettors rely on intuition or incomplete information. The platform provides:

- Data-driven probability estimates for football match outcomes
- Value detection by comparing model probabilities against bookmaker odds
- ELITE and Golden Picks that filter for the highest-confidence predictions
- Historical accuracy tracking to validate predictions against real results

### Target Users

- Sports bettors who want data-backed predictions
- Analysts who want match intelligence and model transparency
- Researchers who want to understand prediction methodology

### Core Philosophy

> **DATA IS KING. ACTUAL RESULTS ARE THE JUDGE. OUT-OF-SAMPLE PERFORMANCE IS THE TRUTH.**

The platform must never confuse:

- Training accuracy with predictive accuracy
- Historical patterns with proven future performance
- Model confidence with certainty

### Key Numbers (August 2026)

| Metric | Value |
|--------|-------|
| Historical matches | 30,340 |
| Leagues tracked | 17 (football-data.org) + 79 (Supabase) |
| Teams | 838 |
| Predictions generated | 599,080 |
| Odds snapshots | 14,984 |
| xG profiles | 946 |
| Referee profiles | 147 |
| Walk-forward accuracy (1X2) | 65.6% |
| High-confidence accuracy (≥65%) | 78.0% |
| Elite accuracy (≥70%) | 79.8% |
| 80%+ confidence accuracy | 88.8% |

---

## 2. Product Vision & Principles

### Prediction Philosophy

Every prediction must be:

1. **Based on data** — not intuition or narrative
2. **Generated before the match** — not retrospectively
3. **Traceable** — we must know what the model knew when it predicted
4. **Evaluated honestly** — against genuinely unseen future matches
5. **Calibrated** — predicted probabilities should match actual frequencies

### Data Philosophy

- Collect as much legitimate, useful data as possible
- Clean it aggressively
- Transform it into predictive features
- Test it historically
- Measure whether it actually improves predictions
- Continuously feed findings back into the next iteration

### Risk Philosophy

- Never represent predictions as guarantees
- Always communicate uncertainty
- Show probability, not certainty
- The user makes the final decision

### Responsible Use Principles

- The platform is a decision-support tool, not a gambling service
- Users must understand that all predictions carry risk
- Compound returns (rollover) are hypothetical, not guaranteed
- No "guaranteed win" claims ever

---

## 3. System Architecture

### High-Level Architecture

```
                    SPORTS DATA SOURCES
                          ↓
              ┌─────────────────────────┐
              │   DATA INGESTION LAYER   │
              │  football-data.org       │
              │  The Odds API            │
              │  StatsBomb               │
              │  Transfermarkt           │
              └────────────┬────────────┘
                          ↓
              ┌─────────────────────────┐
              │   DATA STORAGE          │
              │  Supabase (hot/live)    │
              │  Convex (cold/realtime) │
              │  Local JSON (research)  │
              └────────────┬────────────┘
                          ↓
              ┌─────────────────────────┐
              │   FEATURE ENGINEERING   │
              │  Elo, Form, xG, Ref,    │
              │  Injury, Standings,      │
              │  Odds, Market Consensus  │
              └────────────┬────────────┘
                          ↓
              ┌─────────────────────────┐
              │   PREDICTION ENGINE     │
              │  Ensemble v5.1          │
              │  Poisson + Elo +        │
              │  Regression + xG +      │
              │  Isotonic Calibration   │
              └────────────┬────────────┘
                          ↓
              ┌─────────────────────────┐
              │   VALUE / EDGE ENGINE   │
              │  Model Prob vs Odds     │
              │  CLV Analysis           │
              │  Market Consensus       │
              └────────────┬────────────┘
                          ↓
              ┌─────────────────────────┐
              │   PICK CLASSIFICATION   │
              │  ELITE (≥70%)           │
              │  HIGH (≥60%)            │
              │  MEDIUM (≥50%)          │
              └────────────┬────────────┘
                          ↓
              ┌─────────────────────────┐
              │   PRESENTATION LAYER    │
              │  Golden Picks           │
              │  Match Intelligence     │
              │  Dashboard              │
              │  Admin Dashboards       │
              └─────────────────────────┘
```

### Actual Technology Stack

| Layer | Technology | Status |
|-------|-----------|--------|
| Frontend | Next.js 14 (App Router) | 🟢 Production |
| UI | Tailwind CSS + custom components | 🟢 Production |
| Hot Database | Supabase (PostgreSQL) | 🟢 Production |
| Cold Storage | Convex | 🟢 Production |
| Real-time | Convex React subscriptions | 🟢 Production |
| ML Training | Python (XGBoost, scikit-learn) | 🟢 Production |
| ML Serving | Node.js ensemble model | 🟢 Production |
| Deployment | Vercel | 🟢 Production |
| Version Control | GitHub | 🟢 Production |
| Auth | Supabase Auth | 🟢 Production |
| Payments | Stripe | 🟡 Partial |

---

## 4. Data Architecture

### Data Sources

| Source | Data | Coverage | Status | Cost |
|--------|------|----------|--------|------|
| **football-data.org** | Fixtures, results, scores, cards, fouls, corners, referee | 17 leagues, 2021-2026 | 🟢 Primary | Free (500 req/mo) |
| **The Odds API** | Bookmaker odds (1X2, spreads, totals) | Multiple bookmakers | 🟡 Exhausted | Free (500 req/mo) |
| **StatsBomb** | xG, xGA, shots, possession | 2,183 matches, top leagues | 🟢 Primary | Free (open data) |
| **Understat** | xG, xGA, team stats | 5 leagues | 🔴 Empty (scraping failed) | Free |
| **Transfermarkt** | Injuries, suspensions | 149 teams | 🟡 Partial | Free (scraping) |
| **Supabase** | Active predictions, fixtures, odds, users | All | 🟢 Primary | Free tier |
| **Convex** | Historical predictions, teams, xG, referees | All migrated | 🟢 Cold storage | Free tier |

### Data Ownership Matrix

| Data | Hot (Supabase) | Cold (Convex) | Local JSON |
|------|---------------|---------------|------------|
| Active predictions | ✅ | ✅ (archive) | ❌ |
| Historical predictions | ✅ (599K) | ✅ (599K) | ❌ |
| Fixtures | ✅ (14K) | ✅ (13K) | ❌ |
| Teams | ✅ (838) | ✅ (838) | ✅ (405 ratings) |
| Leagues | ✅ (79) | ✅ (85) | ❌ |
| Odds | ✅ (15K) | ✅ (14.8K) | ✅ (features) |
| xG | ❌ | ✅ (946) | ✅ (StatsBomb) |
| Referees | ❌ (tables missing!) | ✅ (113 profiles) | ✅ (177 refs) |
| Referee matches | ❌ | ✅ (9,740) | ✅ (30,340) |
| Injuries | ❌ | ✅ | ✅ (378) |
| Player stats | ❌ | ❌ | ✅ (265) |
| Standings | ❌ | ❌ | ✅ (9 leagues) |
| Weather | ❌ | ❌ | ❌ (not collected) |
| Lineups | ❌ | ❌ | ❌ (not collected) |

### Data Gaps (Highest Impact)

| Gap | Impact | Source | Cost | Coverage |
|-----|--------|--------|------|----------|
| Starting lineups | HIGH | Understat / API-Football | Free | Top 5 leagues |
| Asian Handicap odds | HIGH | OddsPortal | Free | Most bookmakers |
| Weather data | MEDIUM | OpenWeatherMap | Free | All matches |
| Manager tenure | MEDIUM | Wikipedia | Free | Top leagues |
| Possession/PPDA | MEDIUM | FBref | Free | Top 5 leagues |

---

## 5. Database Architecture

### Supabase (Hot/Live)

| Table | Rows | Columns | Purpose |
|-------|------|---------|---------|
| `leagues` | 79 | 9 | League reference data |
| `teams` | 838 | 6 | Team reference data |
| `fixtures` | 13,986 | 12 | Match fixtures and results |
| `predictions` | 599,080 | 18 | All predictions (active + historical) |
| `odds_snapshots` | 14,984 | 7 | Bookmaker odds |
| `accumulators` | 3 | 15 | User accumulator bets |
| `model_performance` | 6 | 12 | Model accuracy records |

**Missing tables (CRITICAL):** `referee_profiles`, `match_stats`, `team_referee_stats` — these were referenced in code but never created.

### Convex (Cold/Realtime)

| Table | Records | Purpose |
|-------|---------|---------|
| `predictions` | ~599K | Historical predictions (cold storage) |
| `teams` | 838 | Team reference |
| `leagues` | 85 | League reference |
| `fixtures` | ~13K | Fixture history |
| `odds` | ~14.8K | Odds snapshots |
| `xgFeatures` | 946 | xG team profiles |
| `refereeProfiles` | 113 | Referee statistics |
| `refereeMatches` | 9,740 | Referee match history |
| `refereeFeatureProfiles` | 147 | Computed referee features |
| `valuePicks` | — | Value betting opportunities |
| `injuries` | — | Injury/suspension data |
| `matchXg` | — | Match-level xG |
| `trainingData` | — | ML training datasets |
| `leagueModels` | — | Per-league model parameters |
| `auditLog` | — | System audit trail |

### Supabase Predictions Table Schema

```sql
predictions (
  id UUID PRIMARY KEY,
  fixture_id UUID,
  market TEXT,           -- '1X2', 'btts', 'ou', 'dc'
  selection TEXT,        -- 'home', 'draw', 'away', 'yes', 'no'
  model_probability FLOAT,
  confidence_lower FLOAT,  -- NULL (not populated)
  confidence_upper FLOAT,  -- NULL (not populated)
  model_version TEXT,      -- 'v4.0-settle' (current production)
  training_data_cutoff TEXT,  -- NULL
  features_used TEXT,        -- NULL
  sub_model_probabilities JSONB,  -- NULL
  model_disagreement FLOAT,       -- NULL
  data_quality_score FLOAT,       -- NULL
  data_quality_breakdown JSONB,   -- NULL
  result TEXT,             -- 'correct', 'wrong', NULL (pending)
  created_at TIMESTAMPTZ,
  settled_at TIMESTAMPTZ,
  confidence_tier TEXT     -- 'ELITE', 'HIGH', 'MEDIUM', 'LOW'
)
```

**Known issues:**
- 7 of 18 columns are always NULL (no feature snapshots, no traceability)
- `settled_at` can be before `created_at` (data integrity)
- No index on `fixture_id` (query performance)

---

## 6. Prediction Engine

### Ensemble Model v5.1 (Current Production)

**Algorithm:** Weighted ensemble of three sub-models + isotonic calibration

**Sub-models:**
1. **Poisson Model** — Score-line probabilities from attack/defense ratings
2. **Elo Model** — Win/draw/away probabilities from strength ratings  
3. **Regression Model** — Logistic regression on 30+ computed features

**Ensemble Weights (learned from calibration):**
```javascript
x12: { poisson: 0.17, elo: 0.40, regression: 0.43 }
totals: { poisson: 0.55, elo: 0.15, regression: 0.30 }
btts: { poisson: 0.50, elo: 0.10, regression: 0.40 }
dc: { poisson: 0.35, elo: 0.30, regression: 0.35 }
```

**Calibration:** Isotonic regression applied post-ensemble (ECE improved by 0.004)

**xG Integration:** StatsBomb xG adjusts Poisson lambdas when available

**Referee Integration:** Home bias and card tendencies adjust regression z-score

### Markets Supported

| Market | Model | Status |
|--------|-------|--------|
| 1X2 (Home/Draw/Away) | Ensemble v5.1 | 🟢 Production |
| Over/Under 0.5 | Ensemble (totals weights) | 🟢 Production |
| Over/Under 1.5 | Ensemble (totals weights) | 🟢 Production |
| Over/Under 2.5 | Ensemble (totals weights) | 🟢 Production |
| Over/Under 3.5 | Ensemble (totals weights) | 🟢 Production |
| BTTS Yes/No | Ensemble (btts weights) | 🟢 Production |
| Double Chance 1X/X2/12 | Ensemble (dc weights) | 🟢 Production |
| Draw No Bet | Derived from 1X2 | 🟢 Production |
| Asian Handicap | Not implemented | 🔴 Missing |
| Corners | Not implemented | 🔴 Missing |
| Cards | Not implemented | 🔴 Missing |

---

## 7. Model Registry

| ID | Model | Version | Algorithm | Accuracy | LogLoss | Brier | ECE | Status |
|----|-------|---------|-----------|----------|---------|-------|-----|--------|
| M-001 | Majority Class Baseline | — | Constant | 56.2% | 0.687 | 0.247 | — | 🔴 Rejected |
| M-002 | Poisson Only | v3.0 | Poisson | 60.1% | 0.665 | 0.235 | — | 🔴 Deprecated |
| M-003 | Ensemble v3.0 | v3.0 | Poisson+Elo+Reg | 62.8% | 0.640 | 0.225 | — | 🔴 Deprecated |
| M-004 | Ensemble v5.0 | v5.0 | Poisson+Elo+Reg+xG | 65.6% | 0.622 | 0.217 | 0.039 | 🔴 Superseded |
| **M-005** | **Ensemble v5.1** | **v5.1** | **Poisson+Elo+Reg+xG+Cal** | **65.6%** | **0.622** | **0.217** | **0.035** | **🟢 Production** |
| M-006 | XGBoost v6 | v6 | XGBoost (47 features) | 68.6% | 0.602 | 0.207 | — | 🔵 Candidate |
| M-007 | Per-League XGBoost | — | XGBoost per league | 63-72% | — | — | — | 🟡 Experimental |
| M-008 | Isotonic Calibrator | — | Isotonic Regression | — | — | — | 0.020 | 🟢 Applied to M-005 |

### Walk-Forward Validation Results (M-005)

| Fold | Train Seasons | Test Season | Accuracy | Baseline | Delta |
|------|---------------|-------------|----------|----------|-------|
| 1 | 2021-2022 | 2023 | 63.6% | 56.6% | +7.0% |
| 2 | 2021-2023 | 2024 | 63.7% | 56.2% | +7.5% |
| 3 | 2021-2024 | 2025 | 69.5% | 57.5% | +12.0% |
| **Average** | | | **65.6%** | **56.8%** | **+8.8%** |

### Confidence-Accuracy Relationship

| Confidence | Accuracy | Sample Size | trustworthy? |
|------------|----------|-------------|-------------|
| 50-55% | 55.5% | 1,411 | Marginal |
| 55-60% | 61.6% | 844 | Moderate |
| 60-65% | 64.7% | 459 | Good |
| 65-70% | 73.6% | 333 | Strong |
| 70-75% | 73.8% | 286 | Strong |
| 75-80% | **80.3%** | 259 | Very Strong |
| **80%+** | **88.8%** | **214** | **Excellent** |

---

## 8. Feature Engineering

### Feature Categories (60+ features)

#### Team Form (17 features)
- `elo_diff`, `home_elo`, `away_elo`
- `home_ppg_5`, `away_ppg_5`, `ppg_diff`
- `home_ppg_10`, `away_ppg_10`
- `home_gf_5`, `home_ga_5`, `away_gf_5`, `away_ga_5`
- `home_cs_5`, `away_cs_5`, `home_fts_5`, `away_fts_5`
- `home_streak`, `away_streak`, `streak_diff`
- `home_wr_5`, `away_wr_5`

#### Team Ratings (16 features)
- `home_goals_for/against`, `away_goals_for/against`
- `home_shots_for/against`, `away_shots_for/against`
- `home_corners_for`, `away_corners_for`
- `home/away_yellow_cards`, `home/away_red_cards`
- `home/away_fouls_for`

#### xG Features (7 features)
- `home_avg_xg`, `home_avg_xga`, `away_avg_xg`, `away_avg_xga`
- `xg_diff`, `xga_diff`, `has_xg`

#### Injury Features (7 features)
- `home_injured`, `home_doubtful`, `home_injury_impact`
- `away_injured`, `away_doubtful`, `away_injury_impact`
- `injury_diff`

#### Referee Features (5 features)
- `ref_home_bias`, `ref_avg_goals`, `ref_avg_yellow`
- `ref_matches`, `has_ref`

#### Standings Features (3 features)
- `home_position`, `away_position`, `position_diff`

#### Context Features (3 features)
- `is_home_advantage`, `season_phase`, `month`

#### Match Stats (12 features)
- `home/away_shots`, `home/away_shots_on_target`
- `home/away_fouls`, `home/away_corners`
- `home/away_yellow`, `home/away_red`
- `total_goals`, `goal_diff`

#### Half-Time Features (2 features)
- `ht_goal_diff`, `ht_total_goals`

### Feature Importance (from final walk-forward fold)

| Rank | Feature | Importance |
|------|---------|-----------|
| 1 | elo_diff | 0.174 |
| 2 | home_goals_for | 0.050 |
| 3 | away_shots_for | 0.040 |
| 4 | away_goals_for | 0.037 |
| 5 | home_shots_against | 0.032 |
| 6 | home_corners_for | 0.032 |
| 7 | away_position | 0.027 |
| 8 | away_fouls_for | 0.026 |
| 9 | away_corners_for | 0.025 |
| 10 | ppg_diff | 0.025 |

### Data Leakage Prevention

Every feature must satisfy: **Available before kickoff, computed from data before the match date.**

| Feature | Timestamp Available | Safe? |
|---------|-------------------|-------|
| elo_diff | Before match (computed from prior matches) | ✅ |
| home_ppg_5 | Before match (last 5 games) | ✅ |
| ref_home_bias | Before match (season-long stats) | ✅ |
| home_injury_impact | Before match (current injury list) | ✅ |
| home_avg_xg | Before match (season average) | ✅ |
| home_shots | After match (match stats) | ⚠️ Only for post-match analysis |
| ht_goal_diff | At half-time | ⚠️ Only for half-time predictions |

---

## 9. Odds Infrastructure

### Current State

| Source | Status | Coverage |
|--------|--------|----------|
| The Odds API | 🟡 Quota exhausted (0/500) | 14,984 snapshots |
| OddsPortal | 🔴 Not implemented | — |
| Direct bookmaker | 🔴 Not implemented | — |

### Odds Data Structure

```javascript
{
  fixture_id: "uuid",
  bookmaker: "bet365",     // or "pinnacle", "betfair", etc.
  market: "h2h",           // "h2h", "spreads", "totals"
  selection: "Home",       // "Home", "Draw", "Away"
  odds: 2.50,
  impliedProb: 0.40,       // 1/odds
  snapshot_time: "2026-08-25T10:00:00Z"
}
```

### CLV (Closing Line Value) Tracking

**Status:** 🟡 Implemented but limited data

The CLV tracker snapshots odds at three timepoints:
1. Opening (24h+ before kickoff)
2. Mid (6-24h before kickoff)  
3. Closing (1h before kickoff)

CLV = closing odds - opening odds. Negative CLV = sharp money moved in.

**Current limitation:** Only 16 fixtures have computed CLV features due to Odds API quota exhaustion.

---

## 10. Market Architecture

### Supported Markets

| Market | Selections | Model | Settlement |
|--------|-----------|-------|------------|
| **1X2** | Home, Draw, Away | Ensemble | Score comparison |
| **Over/Under 0.5** | Over, Under | Ensemble (totals) | Total goals |
| **Over/Under 1.5** | Over, Under | Ensemble (totals) | Total goals |
| **Over/Under 2.5** | Over, Under | Ensemble (totals) | Total goals |
| **Over/Under 3.5** | Over, Under | Ensemble (totals) | Total goals |
| **BTTS** | Yes, No | Ensemble (btts) | Both teams score? |
| **Double Chance 1X** | Yes, No | Derived | Not away win |
| **Double Chance X2** | Yes, No | Derived | Not home win |
| **Double Chance 12** | Yes, No | Derived | Not draw |
| **Draw No Bet** | Home, Away | Derived | Home/Away only |

### Planned Markets

| Market | Status | Requirements |
|--------|--------|-------------|
| Asian Handicap | 🔴 Planned | AH odds from OddsPortal |
| Corners | 🔴 Planned | Corner data + model |
| Cards | 🔴 Planned | Card data + referee model |
| Player markets | 🔴 Planned | Player-level data |

---

## 11. ELITE & Golden Picks

### ELITE Classification

```javascript
const tier =
  bestProb >= 0.70 ? "ELITE"
  : bestProb >= 0.60 ? "HIGH"
  : bestProb >= 0.50 ? "MEDIUM"
  : "LOW";
```

**ELITE criteria:**
- Model probability ≥ 70%
- From the calibrated ensemble model
- Across any supported market

**Historical ELITE performance:** 79.8% accuracy (walk-forward)

### Golden Picks Page

The Golden Picks page shows the highest-confidence predictions across all markets and leagues.

**Features:**
- League filtering (PL, La Liga, Championship, etc.)
- Market filtering (1X2, BTTS, O/U, etc.)
- Match cards with team names, league, kickoff time
- Match detail drawer with full prediction breakdown
- 24-market prediction view per match
- Real-time Convex subscriptions for live updates

### Match Detail Drawer

When a user clicks a match card:
- Match information (teams, league, kickoff, venue)
- Prediction breakdown for all markets
- Probabilities, odds, edge, confidence
- H2H history
- Form guide
- Referee information
- xG data (when available)

---

## 12. Settlement System

### Settlement Flow

```
Match Completes
     ↓
Settlement Cron Triggered
     ↓
Fetch Actual Result from football-data.org
     ↓
Compare Prediction vs Actual
     ↓
result = "correct" | "wrong"
     ↓
Update predictions table
     ↓
Archive to Convex
```

### Settlement Status Values

| Value | Meaning |
|-------|---------|
| `correct` | Prediction matched actual outcome |
| `wrong` | Prediction did not match actual outcome |
| `void` | Match cancelled/postponed |
| `pending` | Not yet settled (default) |

### Known Issues (CRITICAL)

1. **Settlement cron NOT registered in Vercel** — only runs when manually triggered
2. **Settlement uses inline Poisson model** instead of the ensemble model for accuracy calculations
3. **Settlement is not idempotent** — running twice may create duplicate records
4. **Only settles last 7 days** — older predictions may never settle

---

## 13. Accuracy & Calibration

### Where Accuracy Is Displayed

| Page | Source | Number |
|------|--------|--------|
| Landing page (HeroBanner) | Dynamic from DB | Varies |
| Admin Accuracy dashboard | Convex real-time | ~65% |
| Admin Convex Health | Convex queries | Varies |
| Walk-forward results | Python research | 65.6% |

### Calibration Results

The isotonic calibrator compresses extreme probabilities:
- Raw 0.90 → Calibrated 0.77
- Raw 0.70 → Calibrated 0.67
- Raw 0.50 → Calibrated 0.48
- Raw 0.30 → Calibrated 0.31

**Interpretation:** The model overestimates at extremes. Calibration makes probabilities more honest.

---

## 14. Cron & Scheduled Jobs

### Registered in Vercel

| Job | Schedule | Endpoint | Status |
|-----|----------|----------|--------|
| Daily Pipeline | 6am UTC | `/api/v1/cron/daily` | 🟢 Registered |

### NOT Registered (CRITICAL)

| Job | Should Run | Endpoint | Status |
|-----|-----------|----------|--------|
| Settlement | Every 30min | `/api/v1/cron/settle` | 🔴 NOT registered |
| Prediction | Daily | `/api/v1/cron/predict` | 🔴 NOT registered |
| Fixture Sync | Daily | `/api/v1/cron/sync` | 🔴 NOT registered |
| Learning | Weekly | `/api/v1/cron/learn` | 🔴 NOT registered |
| Archive | Weekly | `/api/v1/cron/archive` | 🔴 NOT registered |
| Cleanup | Weekly | `/api/v1/cron/cleanup` | 🔴 NOT registered |

### Daily Pipeline (what the 6am cron does)

The daily cron endpoint calls these internal APIs in sequence:
1. `/api/v1/cron/sync` — Sync fixtures from football-data.org
2. `/api/v1/cron/settle` — Settle finished matches
3. `/api/v1/cron/predict` — Generate predictions for upcoming
4. `/api/v1/cron/learn` — Run learning pipeline

---

## 15. Security

### 🔴 CRITICAL: No Row-Level Security

**Finding:** The Supabase anon key can read ALL data without restrictions.

```
Anon key predictions: ALLOWED
Anon key accumulators: ALLOWED  
Anon key model_performance: ALLOWED
```

**Impact:** Any visitor can read all 599K predictions, all user accumulators, and model performance data.

**Status:** 🔴 NOT FIXED

### API Keys

| Key | Location | Purpose | Client-safe? |
|-----|----------|---------|-------------|
| `SUPABASE_SERVICE_ROLE_KEY` | .env.local | Server-side DB access | ❌ Server only |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | .env.local | Client-side DB access | ✅ Public |
| `THE_ODDS_API_KEY` | .env.local | Odds data | ❌ Server only |
| `API_FOOTBALL_KEY` | .env.local | Football data | ❌ Server only |
| `CONVEX_DEPLOY_KEY` | .env.local | Convex deployment | ❌ Server only |
| `CONVEX_ACCESS_TOKEN` | .env.local | Convex API access | ❌ Server only |

### Missing Security Controls

- ❌ No rate limiting on API routes
- ❌ No admin auth middleware on `/admin/*` pages
- ❌ No RLS policies on Supabase tables
- ❌ No CORS configuration documented
- ❌ No input validation on some API routes

---

## 16. Frontend Architecture

### Pages (35 total)

#### Marketing (3 pages)
- `/` — Landing page with HeroBanner, FunFacts, Features, Pricing
- `/features` — Feature showcase
- `/pricing` — Pricing plans

#### Auth (3 pages)
- `/login` — Sign in
- `/signup` — Sign up
- `/forgot-password` — Password reset

#### Dashboard (13 pages)
- `/dashboard` — Main user dashboard
- `/matches` — All matches
- `/matches/upcoming` — Upcoming matches
- `/matches/results` — Past results
- `/matches/[id]` — Match detail
- `/predictions` — User predictions
- `/accumulator` — Build accumulator
- `/accumulator/my-accumulators` — Saved accumulators
- `/rollover` — Rollover challenge
- `/performance` — User performance
- `/tracking` — Prediction tracking
- `/notifications` — Notifications
- `/notifications/preferences` — Notification settings
- `/settings` — User settings
- `/ai-chat` — AI chat interface
- `/betting-agent` — Betting agent interface

#### Admin (12 pages)
- `/admin` — Admin dashboard
- `/admin/accuracy` — Accuracy dashboard (Convex real-time)
- `/admin/convex-health` — Convex vs Supabase comparison
- `/admin/db-health` — Database health monitoring
- `/admin/system-health` — System health overview
- `/admin/model-health` — Model performance
- `/admin/pipeline` — Pipeline status
- `/admin/referees` — Referee intelligence
- `/admin/scoring` — Scoring analysis
- `/admin/users` — User management
- `/admin/announcements` — System announcements
- `/admin/settings` — Admin settings
- `/admin/ai-monitor` — AI monitoring

### Key Components

| Component | Location | Purpose |
|-----------|----------|---------|
| `HeroBanner` | `src/components/landing/` | Landing page hero with live stats |
| `MatchCard` | `src/components/matches/` | Match display card |
| `MatchDetailDrawer` | `src/components/matches/` | Full match analysis drawer |
| `AdminSidebar` | `src/components/admin/` | Admin navigation |
| `NotificationBell` | `src/components/notifications/` | Notification indicator |
| `ConvexProvider` | `src/providers/` | Convex React provider |

### Real-time Hooks

| Hook | Source | Purpose |
|------|--------|---------|
| `useRealTimePredictions` | Convex | Live prediction updates |
| `useRealTimeOdds` | Convex | Live odds updates |
| `useLiveScores` | Supabase | Live match scores |

---

## 17. Backend Architecture

### API Routes (37 total)

#### Auth (4 routes)
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/signup`
- `POST /api/v1/auth/forgot-password`
- `GET /api/v1/auth/me`

#### Core Data (5 routes)
- `GET /api/v1/fixtures` — List fixtures
- `GET /api/v1/fixtures/[id]` — Fixture detail
- `GET /api/v1/predictions` — List predictions
- `POST /api/v1/predictions/generate` — Generate predictions
- `GET /api/v1/odds` — Get odds

#### Value (2 routes)
- `GET /api/v1/value-bets` — Value betting opportunities
- `POST /api/v1/betting-agent/recommendations` — AI recommendations

#### Betting Agent (3 routes)
- `POST /api/v1/betting-agent/recommendations`
- `POST /api/v1/betting-agent/betslip`
- `POST /api/v1/betting-agent/audit`

#### Cron (7 routes)
- `GET /api/v1/cron/daily` — Daily pipeline
- `GET /api/v1/cron/sync` — Fixture sync
- `GET /api/v1/cron/settle` — Settlement
- `GET /api/v1/cron/predict` — Prediction generation
- `GET /api/v1/cron/learn` — Learning pipeline
- `GET /api/v1/cron/archive` — Data archival
- `GET /api/v1/cron/cleanup` — Data cleanup

#### User (4 routes)
- `GET/POST /api/v1/accumulators` — User accumulators
- `GET/POST /api/v1/user/bets` — User bets
- `GET/POST /api/v1/notifications` — Notifications
- `GET/POST /api/v1/notifications/preferences`

#### Admin (4 routes)
- `GET /api/v1/admin/db-health` — Database health
- `GET /api/v1/admin/leagues` — League management
- `GET /api/v1/admin/model-performance` — Model performance
- `POST /api/v1/admin/run-pipeline` — Manual pipeline trigger

#### Payments (3 routes)
- `POST /api/v1/stripe/checkout` — Stripe checkout
- `POST /api/v1/stripe/portal` — Stripe portal
- `POST /api/v1/stripe/webhook` — Stripe webhook

#### AI (2 routes)
- `POST /api/v1/ai-chat` — AI chat
- `GET /api/v1/ai-monitor` — AI monitoring

### Worker Scripts (45 scripts)

**Core Pipeline:**
- `ensemble-model.js` — Main prediction engine (v5.1)
- `daily-loop.js` — Daily prediction/settle/learn loop
- `betting-pipeline.js` — Master pipeline orchestrator
- `pre-match-update.js` — Pre-match prediction updates
- `settle-predictions.js` — Prediction settlement

**Research:**
- `research-audit.js` — Data audit
- `research-dataset.js` — Clean dataset builder
- `walk-forward.py` — Walk-forward simulator
- `experiment-registry.js` — Experiment tracking

**Data Collection:**
- `fetch-odds-smart.js` — Odds fetching
- `clv-tracker.js` — CLV tracking
- `predicted-lineups.js` — Lineup prediction
- `collect-statsbomb.js` — StatsBomb xG collection
- `referee-features.js` — Referee feature building

**Migration:**
- `migrate-to-convex.js` — Convex migration
- `migrate-preds-*.js` — Prediction migration
- `migrate-referee-matches.js` — Referee data migration

**ML Training (Python):**
- `train-xgboost-v6.py` — XGBoost training
- `calibrate-isotonic.py` — Isotonic calibration
- `train-per-league.py` — Per-league models

---

## 18. Infrastructure & Deployment

### Vercel Configuration

```json
{
  "crons": [
    { "path": "/api/v1/cron/daily", "schedule": "0 6 * * *" }
  ]
}
```

**Issue:** Only 1 cron registered. 5 more need to be added.

### Supabase

- **Project:** ulelicrbgicgnhmuulup
- **Plan:** Free tier
- **Tables:** 7 active, 3 missing
- **Storage:** ~599K predictions + 14K fixtures + 15K odds

### Convex

- **Deployment:** limitless-mole-387
- **Functions:** 36 (queries + mutations)
- **Data:** 599K predictions, 838 teams, 946 xG profiles

### GitHub

- **Repo:** Joshua-Onyekachukwu/oddly
- **Branch:** main (auto-deploys to Vercel)
- **Last commit:** 30befbf (audit report)

---

## 19. Environment Configuration

### Required Environment Variables

| Variable | Purpose | Required | Server-only |
|----------|---------|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | ✅ | ❌ |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key | ✅ | ❌ |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase admin key | ✅ | ✅ |
| `NEXT_PUBLIC_CONVEX_URL` | Convex deployment URL | ✅ | ❌ |
| `CONVEX_DEPLOY_KEY` | Convex deploy key | ✅ | ✅ |
| `CONVEX_ACCESS_TOKEN` | Convex API token | ✅ | ✅ |
| `THE_ODDS_API_KEY` | Odds API key | 🟡 | ✅ |
| `API_FOOTBALL_KEY` | Football API key | 🟡 | ✅ |
| `NEXT_PUBLIC_APP_URL` | App URL | ✅ | ❌ |
| `VERCEL_CRON_SECRET` | Cron auth | 🟡 | ✅ |

---

## 20. Research & Learning Loop

### Walk-Forward Methodology

```
Train: 2021-2022 → Predict: 2023 → Evaluate
Train: 2021-2023 → Predict: 2024 → Evaluate
Train: 2021-2024 → Predict: 2025 → Evaluate
```

**Rule:** At prediction time, the model can ONLY use information available before the match.

### Experiment Registry

| ID | Market | Model | Accuracy | Status |
|----|--------|-------|----------|--------|
| EXP-001 | 1X2 | XGBoost | 65.6% | 📋 Candidate |
| EXP-002 | O2.5 | XGBoost | 56.5% | 📋 Candidate |
| EXP-003 | BTTS | XGBoost | 54.8% | 📋 Candidate |

### Biggest Error Sources

1. **Draws** — 61% of false home-win predictions are actually draws
2. **Lower leagues** — Championship (56%), Serie B (59%), Ligue 2 (60%)
3. **Away wins** — 39% of false home-win predictions are away wins

---

## 21. Feature Status Matrix

| Feature | Status | Area | Notes |
|---------|--------|------|-------|
| Fixture Sync | 🟢 | Data | Daily cron (1 registered) |
| Odds Integration | 🟡 | Data | API exhausted, 16 fixtures with features |
| StatsBomb xG | 🟢 | Data | 2,183 matches |
| Understat xG | 🔴 | Data | Scraping failed, 0 data |
| Referee Data | 🟡 | Data | 177 refs, 9,740 matches (Convex only) |
| Injury Data | 🟡 | Data | 149 teams (Transfermarkt) |
| Player Stats | 🟡 | Data | 265 players |
| Standings | 🟢 | Data | 9 leagues |
| Ensemble v5.1 | 🟢 | ML | Production model |
| XGBoost v6 | 🔵 | ML | Candidate (68.6% test) |
| Isotonic Calibration | 🟢 | ML | Applied to production |
| Walk-Forward | 🟢 | Research | 3-fold validated |
| Experiment Registry | 🟢 | Research | 3 experiments tracked |
| CLV Tracking | 🟡 | Odds | Implemented, limited data |
| Predicted Lineups | 🟡 | Feature | Implemented, no injury data |
| Golden Picks | 🟢 | Product | Live with filtering |
| ELITE Picks | 🟢 | Product | ≥70% confidence |
| Match Detail | 🟢 | Product | H2H, form, 24 markets |
| Rollover Challenge | 🟡 | Product | Basic implementation |
| AI Betting Agent | 🔵 | AI | API routes exist, not integrated |
| Convex Real-time | 🟢 | Infra | Subscriptions active |
| Database RLS | 🔴 | Security | NOT IMPLEMENTED |
| Rate Limiting | 🔴 | Security | NOT IMPLEMENTED |
| Admin Auth | 🔴 | Security | NOT IMPLEMENTED |
| Weather Data | 🔵 | Feature | Not collected |
| Asian Handicap | 🔵 | Market | Not implemented |
| Per-League Models | 🟡 | ML | Experimental |

---

## 22. Model & Dataset History

### Dataset Versions

| Version | Matches | Leagues | Seasons | Features | Date |
|---------|---------|---------|---------|----------|------|
| v1 | 10,403 | 6 | 2021-2024 | 30 | Jul 2026 |
| v2 | 13,986 | 6 | 2021-2025 | 34 | Aug 2026 |
| **v3 (current)** | **27,314** | **17** | **2021-2026** | **60+** | **Aug 2026** |

### Model Version History

| Version | Date | Change | Impact |
|---------|------|--------|--------|
| v1.0 | Jul 2026 | Initial Poisson model | Baseline |
| v2.0 | Jul 2026 | Added Elo | +3% accuracy |
| v3.0 | Jul 2026 | Added logistic regression | +2% accuracy |
| v4.0 | Aug 2026 | Added xG features | +1% accuracy |
| v5.0 | Aug 2026 | Optimized ensemble weights | +1% accuracy |
| **v5.1** | **Aug 2026** | **Added isotonic calibration** | **ECE improved** |

---

## 23. Architecture Decision Records

### ADR-001: Use Supabase as Hot Database
- **Date:** Jul 2026
- **Decision:** Use Supabase for active data (auth, predictions, fixtures)
- **Reason:** Free tier, PostgreSQL, built-in auth, real-time
- **Consequences:** 500MB storage limit, 500K row limit approaching

### ADR-002: Use Convex for Cold Storage
- **Date:** Aug 2026
- **Decision:** Add Convex for historical data and real-time subscriptions
- **Reason:** Supabase free tier limits, Convex has generous free tier
- **Consequences:** Dual-database architecture, migration complexity

### ADR-003: Ensemble Over Single Model
- **Date:** Aug 2026
- **Decision:** Use weighted ensemble (Poisson + Elo + Regression) instead of single model
- **Reason:** Model diversity improves generalization
- **Consequences:** More complex, harder to interpret

### ADR-004: Isotonic Calibration
- **Date:** Aug 2026
- **Decision:** Apply isotonic regression to calibrate probabilities
- **Reason:** ECE improved by 0.004, more honest probabilities
- **Consequences:** Slight accuracy drop but better calibration

### ADR-005: Walk-Forward Validation
- **Date:** Aug 2026
- **Decision:** Use walk-forward instead of random train/test split
- **Reason:** Prevents future information leakage
- **Consequences:** More honest but lower reported accuracy

---

## 24. Open Issues & Risks

### 🔴 Critical

| Issue | Impact | Status |
|-------|--------|--------|
| No RLS on Supabase | Security breach | NOT FIXED |
| Only 1 cron registered | Settlement/prediction not running | NOT FIXED |
| Settle cron uses wrong model | Accuracy metrics unreliable | NOT FIXED |
| 3 Supabase tables missing | Referee features broken | NOT FIXED |

### 🟡 High

| Issue | Impact | Status |
|-------|--------|--------|
| No feature snapshots in predictions | No traceability | NOT FIXED |
| No admin auth middleware | Unauthorized admin access | NOT FIXED |
| Hardcoded accuracy fallback | Misleading numbers | NOT FIXED |
| No rate limiting on API | Abuse vulnerability | NOT FIXED |
| Odds API exhausted | No odds features | NOT FIXED |
| Understat xG empty | Missing xG data | NOT FIXED |
| Inconsistent model versions | Confusing metrics | NOT FIXED |

### 🟢 Resolved

| Issue | Resolution | Date |
|-------|-----------|------|
| Convex migration | 599K predictions migrated | Aug 2026 |
| Referee data | 9,740 matches migrated to Convex | Aug 2026 |
| Isotonic calibration | Applied to ensemble model | Aug 2026 |
| Walk-forward validation | 3-fold validated | Aug 2026 |

---

## 25. Development Roadmap

### Phase 1: CRITICAL FIXES (Do Now)
- [ ] Enable RLS on all Supabase tables
- [ ] Register all 6 crons in vercel.json
- [ ] Fix settle cron to use ensemble model
- [ ] Create missing Supabase tables

### Phase 2: HIGH PRIORITY (This Week)
- [ ] Add feature snapshots to predictions table
- [ ] Add admin auth middleware
- [ ] Fix landing page accuracy fallback
- [ ] Add rate limiting to API routes
- [ ] Fix Understat xG scraping

### Phase 3: DATA EXPANSION (This Month)
- [ ] Collect weather data (OpenWeatherMap)
- [ ] Scrape Asian Handicap odds (OddsPortal)
- [ ] Add database schema.sql
- [ ] Add API pagination
- [ ] Add retry logic to external APIs

### Phase 4: MODEL IMPROVEMENT (Next Month)
- [ ] Train per-league models
- [ ] Add weather features
- [ ] Add AH odds features
- [ ] Build draw-prediction specialist
- [ ] Ablation study on features

### Phase 5: PRODUCT FEATURES (Future)
- [ ] Starting lineup integration
- [ ] Push notifications for ELITE picks
- [ ] AI betting agent integration
- [ ] Advanced bookmaker integrations
- [ ] Mobile app

---

## 26. Change Log

| Date | Change | Reason | Status |
|------|--------|--------|--------|
| Jul 2026 | Initial platform built | MVP launch | ✅ |
| Jul 2026 | Poisson model v1 | Baseline predictions | ✅ |
| Jul 2026 | Elo integration | Improved accuracy +3% | ✅ |
| Jul 2026 | XGBoost v5 | Advanced ML | ✅ |
| Aug 2026 | Ensemble v5.0 | Combined models | ✅ |
| Aug 2026 | Convex migration | Cold storage | ✅ |
| Aug 2026 | Referee features | 177 refs, 9,740 matches | ✅ |
| Aug 2026 | Isotonic calibration | Better probabilities | ✅ |
| Aug 2026 | Walk-forward validation | Honest evaluation | ✅ |
| Aug 2026 | Research loop infrastructure | Audit, dataset, experiments | ✅ |
| Aug 2026 | Full system audit | Identified 4 critical issues | ✅ |
| Aug 2026 | Master documentation | Single source of truth | ✅ |

---

*This document is the living specification for the Betting Intelligence Platform. Update it with every significant change. The actual system is the source of truth.*
