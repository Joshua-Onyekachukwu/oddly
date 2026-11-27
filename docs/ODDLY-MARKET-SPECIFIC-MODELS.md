# ODDLY — Market-Specific Models

Audit date: 2026-10-02. One model is not equally suited to every market. This
doc specifies per-market strategy: required data, model candidates, metrics,
calibration needs, minimum evidence, and high-confidence suitability.

Current prod markets (from meta-ensemble): `1X2`, goals `OU`, `BTTS`, `DC`
(double chance), draw. Markets below are the realistic expansion set.

## 1. Full-time 1X2 (Match Result)

| Aspect | Specification |
|--------|---------------|
| Required data | Elo, form, H/A splits, league params, injuries/availability, odds (market benchmark) |
| Model candidates | **Dixon-Coles** (industry standard for 1X2 — models low-scoring correlation), Poisson/bivariate-Poisson, current JS ensemble, XGBoost classifier (offline artifact exists) |
| Metrics | Accuracy, log loss, Brier (3-class), ECE per class |
| Calibration | Multiclass — per-class isotonic or Dirichlet calibration; draw is hardest class |
| Min evidence | Team strength sample ≥ N matches; league calibration data |
| High-confidence suitability | Low for single outcomes (see HIGH-CONFIDENCE-STRATEGY §4); best expressed via double-chance |
| Known issues | `h2h` hardcoded 0.5; draw calibration write-only; no Dixon-Coles yet |

## 2. Over/Under goals (0.5 / 1.5 / 2.5 / 3.5)

| Aspect | Specification |
|--------|---------------|
| Required data | Goal expectancy (attack/defense ratings), form, xG if available, injuries to attackers/keepers |
| Model candidates | **Poisson / negative-binomial** on expected total goals (NB handles overdispersion better than Poisson), current OU sub-model |
| Metrics | Log loss, Brier, calibration per line |
| Calibration | Per-line isotonic; O2.5 is the flagship market |
| Min evidence | Goal-expectancy estimates need ~10+ matches/team |
| High-confidence suitability | **High for extreme lines** (O0.5, O5.5) — but low betting value; honest labeling essential |
| Known issues | OU model exists in ensemble; verify it uses expectancy not just form |

## 3. Both Teams To Score (BTTS)

| Aspect | Specification |
|--------|---------------|
| Required data | Team scoring/conceding rates, clean-sheet tendencies, xG for/against, keeper injuries |
| Model candidates | Poisson-derived P(both score) = 1 − P(home 0) − P(away 0) + P(0-0); or direct classifier (XGB BTTS artifact exists) |
| Metrics | Log loss, Brier, ECE |
| Calibration | Binary isotonic |
| Min evidence | Same as OU |
| High-confidence suitability | Moderate — BTTS-No in mismatches can reach ~0.85; BTTS-Yes rarely ≥0.80 |
| Known issues | BTTS sub-model exists; xG would materially improve it |

## 4. Double Chance (1X / 12 / X2)

| Aspect | Specification |
|--------|---------------|
| Required data | Same as 1X2 — derived from calibrated 1X2 probs OR modeled directly |
| Model candidates | Derive from calibrated 1X2 (preferred — consistent) or dedicated model |
| Metrics | Log loss, Brier, calibration |
| Calibration | Binary per variant; **this is the best vehicle for genuine high-confidence picks** |
| Min evidence | Same as 1X2 |
| High-confidence suitability | **Highest of all markets** — p≥0.90 realistic for strong favorites' 1X/12 |

## 5. Draw No Bet (DNB)

| Aspect | Specification |
|--------|---------------|
| Required data | Same as 1X2 |
| Model candidates | Derived: P(win)/(P(win)+P(lose)) renormalized, or direct |
| Metrics | Log loss on the 2-way market |
| Calibration | Binary isotonic |
| High-confidence suitability | Moderate — close to 1X2 favorite probability |

## 6. First-half goals / HT-FT (expansion candidates)

| Aspect | Specification |
|--------|---------------|
| Required data | **HT scores (have in `historical_matches`), first-half goal rates — currently unused** |
| Model candidates | Separate first-half Poisson; HT-FT as 9-outcome model (harder) |
| Metrics | Per-market log loss/Brier |
| Calibration | Per-market |
| Min evidence | HT data coverage — good in football-data set |
| High-confidence suitability | Low-moderate; HT markets are efficient — expect thinner edges |
| Priority | **P3** — needs dedicated modeling, don't activate until 1X2/OU/BTTS/DC are calibrated |

## 7. Team totals / correct score / other

- **Team totals (over/under per team):** derivable from goals model; good P3 candidate.
- **Correct score:** cap confidence display; never market as high-confidence.
- **Asian handicap:** we have 59 scraped matches only — insufficient; revisit if
  Sportmonks/football-data odds add-on lands.

## 8. Cross-market rules

1. **Consistency constraint:** DC/DNB probabilities must be derivable from the
   same calibrated 1X2 distribution — never let separate models contradict.
2. **Correlation awareness:** OU-Over + BTTS-Yes + 1X2-home-win on the same
   fixture are correlated; accumulator/rollover engine must not treat them as
   independent (relevant to the 2.00 strategy — see ROADMAP).
3. **Per-market validation gates:** a market only ships to users after its own
   walk-forward calibration passes — no borrowing credibility across markets.
4. **Don't activate markets for availability's sake.** Each market needs a
   documented accuracy case first.
