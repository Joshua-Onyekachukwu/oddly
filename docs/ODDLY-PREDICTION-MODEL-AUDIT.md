# ODDLY — Prediction Model Audit

Audit date: 2026-10-02. Every claim below is traced to code, not docs.

## 1. The actual production path

```
vercel.json (9 crons)
  → src/app/api/v1/cron/{predict,settle,learn,...}/route.ts
  → src/app/api/v1/cron/predict/route.ts
  → src/lib/models/ensemble.ts  (predictMatchEnsemble)
  → worker/models/meta-ensemble.js   ← THE live model
       model_version written as "v2.0-meta-ensemble"
```

**Everything else is offline/manual:** all of `worker/` beyond the models dir,
`scripts/train-*.py`, `value-finder.py`, daily-loop, settle-predictions.js,
ensemble-model.js. The Python XGBoost/LightGBM artifacts in `models/` are
**not in the production path**.

## 2. What the live model actually is

`worker/models/meta-ensemble.js` — a JS ensemble of statistical/market models:
- **market-1x2.js** — 1X2 model with injury-impact term (**sign bug**:
  `z += homeInjuryImpact + awayInjuryImpact * -1`)
- Poisson-style goals/OU model, BTTS model, double-chance, draw model
- Inputs: Elo, form (last-N), H/A splits, `league_model_params`,
  `model_weight_config`, `player_injury_data`, feature-store profiles
- Outputs: per-market probabilities → `predictions` rows

## 3. Confirmed bugs (all verified in code)

| # | Bug | Impact |
|---|-----|--------|
| 1 | `model_weight_config` queried `config_name='default'`; only `'production_v5'` seeded; **new DB has 0 rows** | Learned weights never load — ensemble runs on hardcoded defaults |
| 2 | `market-1x2.js` away-injury sign inverted | Away injuries improve away team's predicted probability |
| 3 | `model_performance` hardcodes `"v2.0-meta-ensemble"` | Metrics attributed to wrong version when other models write |
| 4 | Pipeline route overwrites `model_version` to `"v5.1-phase2"` | Version sprawl; can't tell which model produced a prediction |
| 5 | `h2h` feature hardcoded `0.5` | H2H contributes nothing |
| 6 | `draw_odds` hook exists; `buildFeatures` never sets it | Draw model missing market input |
| 7 | `league_draw_calibration.shrunkDrawRate` write-only | Draw calibration computed, never applied |
| 8 | `confidence_tier` never written by predict cron | UI tier badges rely on stale/NULL data |
| 9 | `walk-forward-report.json` empty (0 predictions) | Last validation run broken — **no recent honest accuracy number exists** |
| 10 | Settle cron uses inline Poisson (different model than generator) | Settlement/eval model ≠ prediction model |
| 11 | Legacy workers write `v4.0-settle`, `v5.1-ensemble-calibrated` etc. | `model_version` space polluted; per-version metrics unreliable |
| 12 | `data_quality_score` type conflict int vs decimal(4,3) | Schema ambiguity |

## 4. The honest accuracy question

**The famous "65.6%" number is not what it appears:**
- It is **binary home-win** accuracy for an **XGBoost** model — NOT the
  production 3-way 1X2 meta-ensemble.
- It used **test-set early stopping** and had **feature leakage** — inflated.
- Source: `data/experiment-registry.json` EXP-001 (65.62% acc, ECE 0.039,
  high-conf 77.98%, elite 79.84% on 14,280 test matches) — binary classifier.

**No honest out-of-sample accuracy exists for the production
`v2.0-meta-ensemble`.** The last walk-forward run produced zero predictions.
Any accuracy claim currently shown to users would be unverifiable.

**Offline experiments that DID run** (`data/xgboost-results/`): per-market XGB
walk-forwards for 1X2, BTTS, O2.5 on up to 103,868 rows; isotonic calibration
artifacts (103,866 samples); feature ablations. These are research-grade but
use the research dataset whose xG/referee/injury blocks are zeroed — so they
validate ~60 effective features, not 95.

## 5. Model inventory (all artifacts found)

| Model | Where | In prod? | Notes |
|-------|-------|----------|-------|
| meta-ensemble.js v2.0 | `worker/models/` | ✅ YES | The live model |
| market-1x2.js | `worker/models/` | ✅ via ensemble | Sign bug |
| ensemble-model.js v5.1 | `worker/` | ❌ manual | Isotonic-calibrated variant |
| XGBoost per-market (1X2, BTTS, DC, OU15/25/35, enhanced/final/v5/standings) | `models/*.json` + `lgbm_*.txt` | ❌ offline only | Trained on research dataset |
| xgboost_v6_best | `models/` | ❌ never promoted | Leakage risk noted in SYSTEM-AUDIT |
| Poisson benchmark | `benchmark-results.json` | ❌ benchmark only | Compared vs XGB |
| Per-league logistic models | `per-league-models.json`, `data/` | ❌ offline | ~700 train/300 val each |
| Elo | inline in crons | ✅ | Rebuilt from fixtures |
| settle-cron inline Poisson | `cron/settle` | ⚠️ eval only | Different from generator |

## 6. Probability & confidence handling

- `model_probability` stored per selection; `confidence_lower/upper` columns
  exist but are NULL on legacy rows.
- `confidence_tier` (ELITE/HIGH/MEDIUM/LOW) exists via `add-confidence-tier.sql`
  with a backfill by probability thresholds — **but predict cron never writes
  it**, so tiers are threshold-on-read at best.
- Calibration artifacts exist (`isotonic-calibrator.json`, 103,866 samples) but
  are loaded only by the offline `ensemble-model.js`, not the prod meta-ensemble.
- **No reliability diagrams, ECE, or calibration gating in prod.**
- `data_quality_score` column exists; written by newer predictions only.

## 7. Verdict

The production system is a **hand-rolled JS statistical ensemble with known
bugs, no verified accuracy, no calibration in the live path, and several
half-wired "intelligence" features**. The strongest assets (XGBoost models,
isotonic calibration, 27K-match research set, walk-forward harness) are all
**offline and unused**. The gap is not model sophistication — it's that the
validated components never got promoted into production.
