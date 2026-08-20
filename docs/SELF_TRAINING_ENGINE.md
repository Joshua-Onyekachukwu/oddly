# Self-Training Engine — Complete Engineering Specification

**Hand this to your engineering team. This is the implementation guide.**

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                    SELF-TRAINING ENGINE                              │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  DAILY LOOP (runs every day, automated)                      │  │
│  │                                                              │  │
│  │  1. SCAN      → Collect today's fixtures + odds              │  │
│  │  2. PREDICT   → Generate predictions for all markets         │  │
│  │  3. SELECT    → Pick the best 2-odds selection               │  │
│  │  4. SNAPSHOT  → Store exact features used for each prediction│  │
│  │  5. WAIT      → Match plays out                              │  │
│  │  6. SETTLE    → Record actual outcome (correct/wrong)        │  │
│  │  7. ANALYZE   → Compare prediction vs reality                │  │
│  │  8. LEARN     → Adjust weights, parameters, criteria         │  │
│  │  9. LOG       → Write to training_log                       │  │
│  │  10. REPEAT   → Tomorrow, slightly better                    │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  WEEKLY RETRAIN (runs every 7 days or every 50 predictions)  │  │
│  │                                                              │  │
│  │  1. Gather all prediction-outcome pairs since last retrain   │  │
│  │  2. Extract feature matrix                                    │  │
│  │  3. Refit Dixon-Coles parameters                             │  │
│  │  4. Retrain XGBoost on new data                              │  │
│  │  5. Recalculate feature importance                            │  │
│  │  6. Adjust ensemble weights                                   │  │
│  │  7. Run calibration check                                     │  │
│  │  8. Deploy new model version (alongside old)                  │  │
│  │  9. Write to training_log                                     │  │
│  │  10. Notify admin panel                                       │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  MONTHLY DEEP RETRAIN (runs every 30 days)                   │  │
│  │                                                              │  │
│  │  1. Full retrain on entire season data                       │  │
│  │  2. League-specific recalibration                             │  │
│  │  3. Market-specific recalibration                             │  │
│  │  4. Feature pruning (remove features that don't help)        │  │
│  │  5. Crown Jewel model retrain (focused on 2-odds picks)      │  │
│  │  6. Backtest on last 30 days                                 │  │
│  │  7. Generate learning report                                  │  │
│  │  8. Update model version                                      │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

## Part 1: The Daily Loop (Step by Step)

### Step 1: SCAN
The data collector pulls today's fixtures and odds.

### Step 2: PREDICT
Run Dixon-Coles, XGBoost, Elo, and market consensus models. Blend via ensemble. Generate predictions for all markets (over/under, BTTS, match result, double chance, etc.). Write to Supabase.

### Step 3: SELECT (Crown Jewel Pick)
From all predictions, select the single best 2-odds pick with 90%+ probability, 5%+ edge, low disagreement, and Opportunity Score >= 85.

### Step 4: SNAPSHOT
Store the exact feature snapshot used for every prediction. This is critical for self-training — the model needs to know what it saw when it made each prediction.

### Step 5–6: WAIT & SETTLE
When matches finish, evaluate predictions against actual outcomes. Store in model_learning_history with error analysis.

### Step 7–8: ANALYZE & LEARN
Analyze feature importance, calibration, market-specific and league-specific performance. Adjust weights and thresholds. Write lessons to training_log.

## Part 2: Weekly Retrain
Gather all prediction-outcome pairs, extract feature matrix, refit Dixon-Coles, retrain XGBoost, recalculate ensemble weights, run calibration check, deploy new version.

## Part 3: Autonomous Training Mode
Run the system for 90 days with no human intervention. Daily predictions, automatic settlement, learning, weekly retraining.

## Part 4: Crown Jewel Focused Model
Retrain a model specifically for the 2-odds daily pick using only crown jewel data.

## Part 5: Supabase Tables
- `training_log` — every learning cycle recorded
- `feature_importance` — which features matter most
- `model_learning_history` — every prediction-outcome pair with feature snapshots

## Part 6: GitHub Actions Workflows
- Daily predict at 6 AM
- Settle every 15 min
- Weekly retrain Monday 2 AM
- Monthly deep retrain 1st of month

## Part 7: File Structure
```
worker/
├── collect_odds.py
├── daily_loop.py
├── retrain.py
├── deep_retrain.py
├── autonomous_mode.py
├── crown_jewel_model.py
├── feature_extraction.py
├── model/
│   ├── dixon_coles.py
│   ├── xgboost_model.py
│   ├── elo.py
│   ├── ensemble.py
│   └── calibration.py
├── learning/
│   ├── feature_importance.py
│   ├── error_analysis.py
│   ├── league_analysis.py
│   └── market_analysis.py
└── utils/
    ├── supabase_client.py
    ├── logging.py
    └── config.py
```
