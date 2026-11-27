# ODDLY — Prediction Intelligence Audit & Engine Master Plan

**Date:** 2026-11-26 · Companion to `SYSTEM-AUDIT.md`

---

## 1. What Exists Today (verified in code)

### Production path (active)

`src/lib/models/ensemble.ts` → `worker/models/meta-ensemble.js` ("Meta-Ensemble v2.0"):

| Sub-model | File | Approach |
|---|---|---|
| 1X2 | `market-1x2.js` (165 LOC) | Feature-weighted probability model |
| Goals/OU | `market-goals.js` (163 LOC) | Expected-goals → Poisson grid over/under lines |
| BTTS | `market-btts.js` (87 LOC) | Scoring-likelihood model using goals grid |
| Double Chance | `market-dc.js` (46 LOC) | Derived from 1X2 |
| Draw specialist | `market-draw.js` (286 LOC) | Dedicated draw-probability refinement; adjusts 1X2 outputs via `adjustProbs` |
| Cross-signals | `cross-model-signals.js` (162 LOC) | Inter-model information sharing (goals↔1X2↔BTTS↔DC) |
| Feature store | `feature-store-loader.js` (274 LOC) | Loads team profiles, referee, league params, weight config |

Feature inputs actually wired in production: Elo diff (+league home advantage), PPG/GF/GA splits, clean sheets, win rates, streak, fatigue (rest days), injury impact + ruled-out counts, league params (`league_model_params`), weight config (`model_weight_config`).

**Not wired into production features despite existing in research:** xG (StatsBomb profiles live in Convex/JSON, not in ensemble features), referee features, standings position, odds/implied probabilities, weather, H2H (hardcoded `h2h: 0.5` in `buildFeatures`!), match stats, half-time features.

### Legacy/research path

- `worker/ensemble-model.js` — Ensemble v5.0 (Poisson+Elo+Regression) + isotonic calibrator. Still runnable; **not** the cron path.
- Python: `train-xgboost.py`, `train-xgboost-v6.py` (47 features), `train-1x2-*.py` variants, `optuna-1x2.py`, `calibrate-isotonic.py`, `train-per-league.py`. Trained artifacts in `models/` (~15 files) and `data/xgboost-results/`.
- `worker/walk-forward.py`, `scripts/walk-forward-*.js` — validation harness.
- `worker/experiment-registry.js` — experiment tracking (3 registered experiments as of Aug).

### Claimed vs verified performance

| Claim | Source | Verification status |
|---|---|---|
| 65.6% walk-forward 1X2 accuracy | MASTER-DOCUMENTATION (Aug) | Reported by `walk-forward` research runs; methodology sound (no-leakage), but **which model version** produced it vs which serves production is unclear |
| 68.6% XGBoost v6 | model-comparison docs | Test-set number; Aug QA flagged potential leakage; never promoted |
| 88.8% at ≥80% confidence | confidence-accuracy table | Real but n=214; and Aug QA found production `v4.0-settle` predictions had ~57% overall — **production accuracy ≠ validated accuracy** was the P0 finding; needs re-measurement on current model_version rows |
| ELITE tier advantage | — | Aug QA: ELITE ≈ baseline (56.6% vs 56.8%) — confidence thresholds alone don't create edge |

**Honest baseline:** treat all historical accuracy claims as UNVERIFIED until re-measured against the current production `model_version` on settled predictions.

---

## 2. Market Coverage

Production emits ~24 market rows per fixture (1X2×3, OU lines, BTTS, DC, DNB, home/away goals variants). Supported settlement logic in `checkPrediction`: 1X2, over_under/OU, BTTS, DC, DNB, homegoals, awaygoals, smart_selection.

Not implemented: Asian Handicap, corners, cards, correct score, HT/FT, first-half markets, team goals beyond simple lines.

---

## 3. Gaps vs Requirements

| Requirement | Gap |
|---|---|
| Immutable input snapshots | Snapshots computed, then discarded at insert |
| Market-specific evaluation | Single `model_performance` table; no per-market calibration in prod path; 24h rolling window only |
| Champion/challenger | No promotion gate; challengers (XGBoost) sit in `models/` forever |
| Probability calibration | Isotonic calibrator exists only for legacy v5.0; meta-ensemble outputs uncalibrated in prod |
| "No reliable prediction" | Absent — unconditional predictions |
| Data-quality-aware confidence | `confidence_tier` = raw probability bands only |
| Dixon-Coles / bivariate Poisson | Not implemented |
| Market-implied probs as features | Not wired (odds starvation) |
| Leakage-safe H2H/xG/referee features | Exist in research data; not in prod feature path; `h2h` hardcoded 0.5 |

---

## 4. Recommended Engine Architecture (target)

```
                 ┌────────────────────────────────────────────┐
                 │         FEATURE STORE (versioned)           │
                 │  team_strength · form · xG · injuries ·     │
                 │  referee · standings · odds_implied ·       │
                 │  weather · h2h · rest/travel                │
                 │  every row: as_of_timestamp + source        │
                 └───────────────────┬────────────────────────┘
                                     │
        ┌────────────────────────────┼─────────────────────────────┐
        ▼                            ▼                             ▼
┌───────────────┐          ┌──────────────────┐           ┌────────────────┐
│ Statistical   │          │ ML Candidates    │           │ Market-        │
│ Core (champion│          │ (challengers)    │           │ Implied Model  │
│ today)        │          │ XGBoost v6,      │           │ devig odds →   │
│ meta-ensemble │          │ per-league,      │           │ true prob      │
│ + Dixon-Coles │          │ LightGBM, Elo-   │           │ baseline       │
│ upgrade path  │          │ dynamic          │           │                │
└───────┬───────┘          └────────┬─────────┘           └───────┬────────┘
        └───────────────────────────┼─────────────────────────────┘
                                    ▼
                    ┌───────────────────────────────┐
                    │  PER-MARKET CALIBRATOR        │
                    │  isotonic/platt per market ×  │
                    │  league, fit on walk-forward  │
                    │  out-of-fold predictions      │
                    └───────────────┬───────────────┘
                                    ▼
                    ┌───────────────────────────────┐
                    │  QUALITY & VALUE LAYER         │
                    │  data_quality · calibration · │
                    │  model_agreement · EV · CLV · │
                    │  → probability | NO_PREDICTION│
                    └───────────────────────────────┘
```

### Modeling priorities (evidence-ordered)

1. **Keep & harden meta-ensemble** as champion — it works, is interpretable, market-aware.
2. **Add Dixon-Coles** as a new sub-model for 1X2/DC — fixes the well-known Poisson draw/low-score bias; cheap to implement, directly targets the biggest error source (draws = 61% of false home-win picks per docs).
3. **Wire xG features into prod** — data already collected (StatsBomb 2,183 matches; needs expansion); currently unused in prod path.
4. **Per-market isotonic calibration** — reuse existing calibrator infrastructure, fit per market.
5. **Promote XGBoost v6 to challenger** — run through walk-forward + calibration harness; promote only if it beats champion out-of-sample per market.
6. **Market-implied baseline** — once odds ingestion is fixed, devigged odds are the strongest single predictor in football; use as feature AND as sanity bound.
7. **Defer:** neural nets, corners/cards/player props — insufficient data/odds coverage; revisit after core is proven.

### Validation protocol (non-negotiable)

- Chronological walk-forward, min 3 folds, per-market metrics: accuracy, Brier, log-loss, ECE.
- Report sample sizes + confidence intervals.
- Leakage checklist per feature (available-before-kickoff attestation).
- Promotion rule: challenger must beat champion on ≥2 of {Brier, log-loss, ECE} without accuracy regression, on out-of-fold data, across ≥2 seasons.
- Production accuracy re-baseline: recompute settled-prediction accuracy **by model_version** before any further model work.

---

## 5. Immediate Engine Fixes (pre-roadmap)

| ID | Task | Priority |
|---|---|---|
| PE-1 | Persist `featureSnapshot`, `ensembleOutputs`, odds snapshot, and `data_quality` on every prediction insert | P0 |
| PE-2 | Unify Elo/form computation into one shared, career-to-date builder used by BOTH predict and settle (fixes settle-window bias) | P0 |
| PE-3 | Retire or formally archive `worker/ensemble-model.js` + `daily-loop.js`; single authoritative engine | P1 |
| PE-4 | Add per-market calibration layer to meta-ensemble output | P1 |
| PE-5 | Implement `NO_PREDICTION` quality gate (min data completeness + min model agreement + calibration bounds) | P1 |
| PE-6 | Re-baseline production accuracy by model_version/market/league from settled rows | P1 |
| PE-7 | Wire xG + referee + standings features into `buildFeatures` where data exists | P2 |
| PE-8 | Implement Dixon-Coles sub-model | P2 |
