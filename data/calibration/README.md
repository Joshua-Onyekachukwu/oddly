# Walk-forward recalibration artifacts (2026-11)

Fitted on `data/research-dataset.json` (27,314 matches) via the strict
walk-forward replay harness — no leakage: features for each match use only
prior matches; fitting used the first 80% of records for validation and all
records for the deployed parameters.

## Files

- `1x2-recal.json` — the artifact. Contains:
  - `theta = [alpha, biasHome, biasDraw]` (biasAway fixed 0): applied to the
    **final** 1X2 probabilities as `q_k ∝ p_k^alpha * exp(b_k)`, softmax over
    Home/Draw/Away. `alpha ≈ 0.60` (temperature), `biasHome ≈ +0.39`.
  - `btts = {a, b}` — Platt scaling `q = sigmoid(a·logit(p) + b)` on BTTS-Yes.
  - `honestValidation` — held-out tail (last 20%, n=5,463) metrics for params
    fit on the first 80% only, vs the uncalibrated baseline.

## How production applies it

Already wired in `worker/models/meta-ensemble.js` (`applyRecalibration`),
which runs **after** cross-model refinement and league adjustments, right
before market assembly — matching `stage: "fin"` in the artifact.

Parameter source order:
1. `storeData.weightConfig.recalibration` (JSONB column on
   `model_weight_config`, `config_name='production_v5'`) — written by
   `scripts/apply-1x2-recal.js`.
2. Fallback: this file (`data/calibration/1x2-recal.json`).

If neither exists the model behaves exactly as before (no-op).

Downstream effects (intended): `DNB_Home/Away` derive from the recalibrated
`refined.oneXtwo`; `DC_*` was computed earlier from pre-refine 1X2 probs and
is unaffected; `bestPick`/confidence use the recalibrated markets.

## Honest results (held-out tail, n=5,463)

| Metric | Baseline | Recalibrated |
|---|---|---|
| 1X2 argmax acc | 43.7% | **47.3%** (always-Home ≈ 43.5%) |
| 1X2 multiclass log-loss | 1.863 | **1.817** |
| BTTS log-loss / Brier | 0.807 / 0.291 | **0.687 / 0.247** |

Full-sample replay after deployment (`data/eval/replay-latest.json`):
1X2 46.5% [45.9–47.1], BTTS 52.8%, DNB 46.5%.

Caveat on BTTS: Platt slope a≈0.10 — the raw BTTS score carries weak
per-match discrimination on this feature set, so the recalibrator mostly
recentres P(Yes) to the base rate (~0.52). It improves proper scoring rules
honestly but BTTS picks are now close to a static Yes.

## Reproduce

```bash
node scripts/eval-dump-1x2-records.js     # ~35s, writes replay-1x2-records.json
node scripts/fit-1x2-recal.js --stage fin --kind tempBias   # refit artifact
node scripts/apply-1x2-recal.js           # backup row + write JSONB column
node scripts/eval-walk-forward-replay.js  # verify end-to-end (~65s)
```
