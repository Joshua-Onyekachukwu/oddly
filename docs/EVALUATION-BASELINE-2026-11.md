# ODDLY — Evaluation Baseline (2026-11)

First honest, out-of-sample numbers for the **production** prediction model
(`worker/models/meta-ensemble.js`, `model_version = "v2.0-meta-ensemble"`,
reached via `src/lib/models/ensemble.ts` → `cron/predict`).

Supersedes nothing — this is the first verified baseline. The "65.6% accuracy"
figure in `experiment-registry.json` (EXP-001) belongs to a different binary
XGBoost model with test-set early stopping and feature leakage; it is **not**
this model and is not comparable.

---

## 1. Why the eval pipeline produces an empty report

`data/walk-forward-report.json` (`totalPredictions: 0`, dated 2026-09-02) is
written by `scripts/walk-forward-full.js`, which only scores predictions with
`result != 'pending'` joined to finished fixtures.

On the **new Supabase DB** (checked 2026-11-27):

| Table | State |
|---|---|
| `fixtures` | 159 rows, **all `status='scheduled'`**, kickoff 2026-11-27 → 2026-12-09, no scores |
| `predictions` | 1,056 rows, **all `result='pending'`**, all `model_version='v2.0-meta-ensemble'` |
| `model_weight_config` | 1 row (`production_v5`, weights ≈ hardcoded defaults) |
| `league_model_params` | 8 rows, all `home_advantage=65, goal_expectancy=2.6` (defaults) |

Causal chain:

1. `cron/settle` only settles fixtures with `status='finished'` **and** scores
   (`src/app/api/v1/cron/settle/route.ts:54-55`). There are zero finished
   fixtures → nothing can ever settle → every prediction stays `pending`.
2. `cron/predict` builds Elo/form from `status='finished'` fixtures
   (`predict/route.ts:82-85`). With an empty result, `eloMap`/`formMap` are
   empty → `getTeamStats([])` returns hardcoded defaults for **every** team.
3. `walk-forward-full.js` therefore finds 0 evaluable rows → empty report.

### Live predictions are currently degenerate (verified against DB)

Because history is empty, every fixture gets ~identical features. Confirmed by
grouping the 1,056 stored `model_probability` values:

- `1X2_draw = 0.3942` for **all** fixtures; `BTTS_yes = 0.377`,
  `OU_over_2.5 = 0.4002`, `DC_12 = 0.6058`, `DNB_home = 0.5611` — single values.
- `1X2_home/away`, `DC_1x/x2`, `DNB_*` take only ~4 distinct values (injury
  features are the only per-team input that varies).
- **The static 1X2 argmax is Draw (0.394 > 0.340 home > 0.266 away)** — the
  model currently predicts *Draw* for essentially every fixture.

My replay's cold-start probe reproduces these numbers to 4 decimals
(`1X2: 0.3399/0.3942/0.2659`, `BTTS_Yes: 0.3770`, `DC_12: 0.6058`,
`DNB_Home: 0.5611`, `OU_Over_2.5: 0.4002`), which validates the harness.

---

## 2. Method — honest walk-forward replay

New script: `scripts/eval-walk-forward-replay.js`
(~65 s for all 27,314 matches).

- **Model:** the actual production code — `require("worker/models/meta-ensemble.js")`,
  `predictMatch(features, storeData)` with `storeData.weightConfig =
  production_v5` (fetched from Supabase) and
  `storeData.leagueParams = {home_advantage:65, goal_expectancy:2.6}`
  (what prod effectively always passes today).
- **Data:** `data/research-dataset.json` — 27,314 finished matches,
  17 leagues (E0/D1/SP1/I1/F1/N1/B1/P1/T1/SC0 + 2nd tiers), 2021-07 → 2026-05.
  Outcome base rates: **H 43.5% / D 26.1% / A 30.3%**.
- **Walk-forward discipline:** for each match, features are built **only**
  from earlier matches, replicating `ensemble.ts` + the predict cron exactly:
  - Elo: K=32, +65 home advantage, rebuilt over a rolling last-2000-match
    window per fixture (same as the cron's `histFixtures` replay).
  - Form: `getTeamStats()` on each team's last-15 matches (last-10 PPG,
    last-8 home/away splits, streak, clean-sheet rate).
  - Rest days: days since team's previous match (30-day lookback, default 4)
    → fatigue term.
  - `h2h = 0.5` (hardcoded in prod), injuries = 0, `leagueAvgGoals = 2.6`,
    team names normalized via the real `team-normalizer.ts`.
- **Scoring:** per market group, argmax-selection accuracy with Wilson 95% CIs,
  Brier score, per-selection binary log-loss; calibration buckets and
  per-league/recency breakdowns for 1X2.
- **Limitations (labeled, not hidden):**
  - Research-set team names are football-data.org names; prod uses DB
    `canonical_name`s. Normalization is applied, but cross-source alias
    coverage may differ slightly.
  - Prod's Elo window is "last 2000 finished fixtures across all leagues in
    the DB"; replay uses the 27K research set — same mechanics, different
    league mix.
  - No injuries, no xG, no referee, no odds features — consistent with what
    `buildFeatures` actually feeds the model today (those inputs exist in the
    dataset but prod never passes them).
  - `league_model_params`/`model_weight_config` are at default values, so
    learned-weight effects are nil — this measures the model **as deployed**.

Machine-readable output: `data/eval/replay-latest.json` (+ timestamped copy).

---

## 3. Results — walk-forward, n = 27,314

Argmax accuracy = the selection the model would surface as its pick.
Baselines: always-Home 1X2 = 43.5%; coin-flip binary markets = 50%;
1X2 random = 33.3%.

| Market | n | Argmax acc | 95% CI | Brier | LogLoss | Mean top prob |
|---|---|---|---|---|---|---|
| **1X2** | 27,314 | **41.7%** | 41.1–42.3 | 0.217 | 0.627 | 0.452 |
| DC (best of 1X/X2/12) | 27,314 | 70.3% | 69.7–70.8 | 0.328 | 0.858 | 0.778 |
| OU 0.5 | 27,314 | 92.8% | 92.4–93.1 | 0.078 | 0.306 | 0.900 |
| OU 1.5 | 27,314 | 67.3% | 66.7–67.8 | 0.223 | 0.679 | 0.781 |
| **OU 2.5** | 27,314 | **54.0%** | 53.4–54.6 | 0.265 | 0.735 | 0.636 |
| OU 3.5 | 27,314 | 60.2% | 59.6–60.8 | 0.261 | 0.767 | 0.763 |
| OU 4.5 | 27,314 | 73.7% | 73.1–74.2 | 0.170 | 0.539 | 0.801 |
| BTTS | 27,314 | 51.6% | 51.0–52.2 | 0.296 | 0.823 | 0.704 |
| DNB | 27,314 | 43.7% | 43.1–44.3 | 0.251 | 0.703 | 0.654 |
| HomeGoals O0.5 / O1.5 | 27,314 | 76.8% / 43.3% | — | — | — | — |
| AwayGoals O0.5 / O1.5 | 27,314 | 68.6% / 33.6% | — | — | — | — |

(CI columns for goal-line markets omitted for brevity — full data in JSON.)

### Headline findings

1. **1X2 is worse than "always predict Home" (41.7% vs 43.5%).** The model
   picks **Away 39% / Home 36% / Draw 25%** of the time while actual outcomes
   are Home 43.5% / Draw 26.1% / Away 30.3%. There is a systematic
   **home-win under-prediction**: mean predicted P(home) ≈ 0.33 vs 0.435
   actual. The draw model + `adjustProbs` redistribution flattens probabilities
   toward ~uniform and the argmax lands on away/draw too often.
2. **Recency helps but doesn't fix it:** last ~12 months of data (n=1,467):
   46.5% [43.9–49.1] vs 41.4% [40.8–42.0] earlier — better, still roughly at
   the always-home baseline, not above it.
3. **BTTS-Yes is under-predicted** (mean P(Yes)=0.437 vs 52.6% actual; model
   picks "No" 65% of the time). BTTS argmax accuracy 51.6% ≈ coin flip.
4. **OU 2.5 is the only market with clear signal:** 54.0% [53.4–54.6],
   Brier 0.265. Extreme lines (0.5/4.5) are high-accuracy but mostly reflect
   base rates (Over 0.5 hits 92.8% of the time regardless).
5. **Calibration is mediocre but not catastrophic:** 1X2 argmax-confidence
   buckets show predicted ≈ actual within ~4pp at the top end
   (0.6–0.7 bucket: pred 0.64 → acc 0.63; 0.7+: pred 0.74 → acc 0.77, n=630),
   but the model is **under-confident overall** (mean top prob 0.45) and never
   exceeds ~0.81 — it cannot express strong opinions.
6. **Per-league 1X2 spread is large:** Primeira Liga 48.7%, Eredivisie 47.9%,
   Scottish Premiership 47.8% vs Ligue 2 36.2%, League Two 37.3% — lower-tier
   leagues drag the average down.

### Cold-start baseline (what prod emits TODAY on the empty DB)

Single static prediction applied to all 27,314 matches — i.e., literally what
the current 1,056 pending predictions say:

| Market | Static pick accuracy |
|---|---|
| 1X2 | **26.1%** (= always-Draw base rate; argmax is Draw) |
| BTTS | 47.4% (static pick: No) |
| OU 2.5 | 49.3% (static pick: Under) |
| DC | 69.7% |
| DNB | 43.5% (static pick: Away) |

Until finished fixtures accumulate in the DB, **every live prediction is a
league-agnostic prior** — no team information is used at all.

---

## 4. What works / what's broken

**Works**
- The ensemble code runs end-to-end and is deterministic; the replay harness
  reproduces live DB probabilities to 4 decimals (validated cold-start).
- OU/goal markets carry real (if modest) signal; DC inherits 1X2 structure.
- Probabilities are roughly calibrated in the mid-range — not wildly
  overconfident.

**Broken / weak**
- **Eval pipeline:** `walk-forward-full.js` + settle cron produce nothing on
  the new DB (0 finished fixtures → 0 settlements → empty report). It will
  stay empty until fixtures are played and synced with scores.
- **Cold-start degeneracy:** predict cron emits identical priors for every
  fixture while `fixtures` has no finished rows. Predictions made now carry
  ~zero team signal (only injury features vary).
- **1X2 directional bias:** home wins are under-predicted by ~10pp; the
  ensemble's top pick underperforms the trivial always-Home baseline.
- **BTTS calibration:** systematically under-rates BTTS-Yes.
- **Draw model:** produces ~0.39 draw prob by default (vs 26% base rate) —
  over-draws in cold start, contributes to the flattened 1X2 distribution.
- Per `ODDLY-PREDICTION-MODEL-AUDIT.md` bugs still stand (h2h=0.5 hardcoded,
  `confidence_tier` never written, settle cron uses a *different* inline
  Poisson — so even once settlements flow, `result` labels come from a
  different model than the one being evaluated).

## 5. Recommended fixes (priority order)

1. **Backfill finished fixtures** into the new DB (scores + status) so the
   predict cron's Elo/form maps populate and settle can close the loop.
   Until then, treat all current predictions as priors, not forecasts.
2. **Fix the settle/eval model mismatch** — settle should score the stored
   `market_probability` against outcomes via `checkPrediction` (already in
   `ensemble.ts`), not re-derive outcomes with a separate Poisson.
3. **1X2 recalibration:** the home/away/draw weights produce an away-leaning
   argmax. Options: retrain `model_weight_config` on the research set
   walk-forward (the harness now exists), add a home-win prior correction,
   or gate the draw model's `adjustProbs` aggression (it currently flattens
   probabilities toward uniform).
4. **BTTS:** recalibrate `bttsYes` (isotonic on walk-forward residuals);
   current mean 0.437 vs 0.526 actual.
5. **Wire real features prod already collects but doesn't pass:** injuries
   (`player_injury_data` is queried but only feeds `market-1x2`'s tiny injury
   term), xG columns exist in the research set, `draw_odds` hook is dead.
6. **Re-run this script after any model change** — it is the honest baseline:
   `node scripts/eval-walk-forward-replay.js` → `data/eval/replay-latest.json`.

## 6. Reproduce

```bash
node scripts/eval-walk-forward-replay.js            # full 27,314-match replay
node scripts/eval-walk-forward-replay.js --limit 2000   # quick smoke test
```

Requires `.env.local` (Supabase) for `production_v5` weights; falls back to
hardcoded defaults (numerically ~identical) if unavailable.
