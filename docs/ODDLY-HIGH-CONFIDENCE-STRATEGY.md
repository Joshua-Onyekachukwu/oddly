# ODDLY — High-Confidence Prediction Strategy

Audit date: 2026-10-02. Goal: genuinely calibrated high-probability predictions —
including honest "NO RELIABLE PREDICTION" — not forced confidence.

## 1. The four scores must be separate

| Score | Meaning | Never confused with |
|-------|---------|---------------------|
| **Predicted probability** `p` | Model's estimate P(outcome) | Accuracy |
| **Model confidence** | Reliability of `p` given validation history, uncertainty, evidence completeness | `p` itself |
| **Data quality** | Completeness/freshness/accuracy of inputs (lineups confirmed? injuries current? odds present?) | Model confidence |
| **Betting value** | EV vs available odds (edge, Kelly) | All of the above |

Today ODDLY conflates these: `confidence_tier` is (at best) a probability
threshold, `opportunity_score` mixes edge+probability, and `data_quality_score`
is sparsely populated. The strategy below separates them explicitly.

## 2. Calibration foundation (must come first)

Nothing else matters until probabilities are calibrated. Required:

1. **Fix the eval pipeline** — the last walk-forward produced 0 predictions
   (`walk-forward-report.json` empty). Restore it before any claim.
2. **Champion/challenger harness** — every candidate model/feature set runs
   walk-forward on identical folds; promotion only on out-of-sample lift.
3. **Per-market calibrators** — isotonic regression (already have
   `isotonic-calibrator.json` artifact) or Platt scaling, fit on a held-out
   calibration window *before* the test window, per market, per league-group.
4. **Reliability reporting** — Brier score, log loss, ECE, reliability diagrams
   per market per league, stored in `validation_results` (columns already exist
   for injury-vs-baseline deltas).
5. **Confidence intervals** — bootstrap or conformal intervals on `p`, so the
   UI can show "62% ± 4%" rather, than a false-precision point estimate.

## 3. The confidence tier system (evidence-based, not arbitrary)

Replace threshold-on-probability tiers with a **two-gate** system:

```
GATE 1 — Calibration gate: is p calibrated for this market+league?
         (ECE < threshold, sufficient calibration samples)
GATE 2 — Evidence gate: data_quality_score ≥ minimum AND
         minimum sample of supporting evidence
              │
              ▼
   Tier assignment by calibrated p AND historical tier accuracy:
     ELITE     : p ≥ T_elite  AND tier's historical accuracy ≥ A_elite
     HIGH      : p ≥ T_high   AND tier's historical accuracy ≥ A_high
     MEDIUM    : p ≥ T_med
     LOW       : below
     NO RELIABLE PREDICTION : fails Gate 1 or Gate 2
```

Thresholds `T_*` and accuracy floors `A_*` are **learned from
`validation_results`/calibration buckets**, not hardcoded. Example of the
discipline: if the ELITE bucket (p≥0.80) historically wins only 71%, the tier
must say so — or the threshold rises until the bucket's *actual* hit rate
matches its label.

## 4. What "90%+" can realistically mean

Honest assessment by market (football 1X2/GOALS context):

| Market | Realistic ceiling for p≥0.90 | Conditions |
|--------|------------------------------|------------|
| 1X2 single outcome | **Rare** — heavy home favorite vs bottom side, late-season mismatch, ~1–3% of matches | Market itself prices these ~1.05–1.15; model must *agree and add evidence* |
| Double chance (1X / 12 / X2) | **Achievable** — p≥0.90 reasonable for strong favorites' DC | Most common source of genuine high-confidence picks |
| Draw-no-bet favorite | Similar to 1X2 but slightly lower ceiling | |
| BTTS-No / BTTS-Yes (extreme mismatches) | Occasionally ≥0.85–0.90 | Needs xG/injury evidence, not just table position |
| Over/Under 0.5 or 5.5 goals | **Often ≥0.90** — but low value (odds ~1.05) | High probability ≠ high value; separate the scores |
| Exact score / HT-FT / correct score | **Never claim ≥0.90** — inherently diffuse | Cap displayed confidence honestly |
| Player props | Out of scope currently | |

**Key insight for ODDLY:** the 2.00-odds rollover strategy *needs* multi-leg
or moderate-probability tickets, not 90% singles. The high-confidence engine
should feed **selection quality** (which legs are safest) rather than chase
unattainable single-match certainty.

## 5. "NO RELIABLE PREDICTION" as a feature

The system must be allowed to abstain. Abstention triggers:

- Calibration gate fails for that market+league (insufficient recent
  calibration data).
- `data_quality_score` below minimum (no confirmed lineup AND no fresh injury
  data AND no odds → don't predict).
- Model disagreement beyond threshold (sub-models diverge → uncertainty too
  high).
- Out-of-distribution detection: matchup/team/league combo unseen in training
  (e.g., newly promoted side with <N matches).
- Market disagreement extreme (model says 70%, market says 45% → flag, don't
  silently average).

Abstentions should be **logged and reviewed** — a healthy abstention rate
(10–30% of fixtures) is a sign of honesty, not failure.

## 6. Uncertainty & disagreement signals (inputs to confidence, not outputs)

- Ensemble spread: std-dev across sub-model probabilities.
- Feature completeness per prediction (which inputs were missing).
- Injury/lineup certainty tier (confirmed XI > predicted XI > injury report >
  nothing).
- Odds freshness (closing-line proximity) — but only pre-match snapshots.
- League reliability score (historical calibration quality per league).

## 7. Rollout order

1. Restore walk-forward eval → produce first honest baseline metrics.
2. Wire isotonic calibration into the PROD path (currently offline-only).
3. Implement Gate 1 + per-market calibration reporting.
4. Implement data-quality scoring on every prediction (populate
   `data_quality_score`/`data_quality_breakdown` consistently).
5. Implement abstention + tier assignment from learned thresholds.
6. Only then surface confidence tiers in UI — with the historical accuracy of
   each tier shown alongside ("ELITE picks have hit 78% historically").
