# ODDLY — Prediction Improvement Roadmap

Audit date: 2026-10-02. Prioritized by expected predictive improvement ÷ cost.
Every item must pass the validation protocol (§5) before becoming a prod feature.

## Priority 1 — Critical foundations (fix what's broken/missing)

| # | Item | Why | Effort | Cost |
|---|------|-----|--------|------|
| P1.1 | **Backfill new Supabase with historical data** (30K matches, feature tables, or re-point env to old project) | New DB is empty — predictions currently have no team history | M | $0 |
| P1.2 | **Fix `model_weight_config` lookup** (`default`→`production_v5`) + populate from `optimized-weights.json` via feature-store-sync | Learned weights never load — model runs on defaults | S | $0 |
| P1.3 | **Fix `market-1x2.js` away-injury sign bug** | Away injuries currently help the away team | XS | $0 |
| P1.4 | **Fix `odds_snapshots` retention** (stop ~1h pruning; store pre-match + closing) | CLV/movement/market-features impossible otherwise | S | $0 |
| P1.5 | **Restore walk-forward eval** (empty `walk-forward-report.json`) | No honest accuracy number exists — everything else is unverifiable | M | $0 |
| P1.6 | **Wire the dead injury pipeline** (`feature-engineering.ts` → predict cron → `injury_features_used`) + append-only `injury_snapshots` | Best available player-intelligence, currently unused | M | $0 |
| P1.7 | **Dedup + normalize old prediction data** (or accept fresh start on new DB) | 599K rows with known dupes/casing chaos | M | $0 |

## Priority 2 — High-impact improvements

| # | Item | Why | Effort | Cost |
|---|------|-----|--------|------|
| P2.1 | **API-Football Pro upgrade** → injuries/suspensions/lineups ingestion + `fixture_lineups` table | Unlocks real player availability + confirmed XIs | M | ~$19–29/mo |
| P2.2 | **Player importance engine** — derive `player_importance` from minutes/xG+xA/impact scores; replacement-delta feature | Replaces manual 1–10 guesses | M | $0 (uses existing data) |
| P2.3 | **Join xG into features** — finish StatsBomb scrape + fix Understat exporters; add xG/xGA to model + research set | xG is the strongest single match-level predictor we own but don't use | M | $0 |
| P2.4 | **Isotonic calibration into PROD path** (currently offline-only) + per-market/league calibrators | Probabilities must be calibrated before any confidence claim | M | $0 |
| P2.5 | **Market-as-feature** — consensus odds, odds movement, closing-line value into model (with strict pre-match-only leakage guards) | Market is the best single predictor; currently a benchmark only | L | odds API tier ~$30–59/mo |
| P2.6 | **Dixon-Coles 1X2 model** as challenger to JS ensemble | Industry-standard; handles low-score draw correlation the current model misses | M | $0 |
| P2.7 | **Data-quality scoring on every prediction** + abstention ("NO RELIABLE PREDICTION") | Honest confidence requires knowing when NOT to predict | M | $0 |

## Priority 3 — Advanced intelligence

| # | Item | Why | Effort | Cost |
|---|------|-----|--------|------|
| P3.1 | **Confirmed-lineup ingestion + predicted-lineup model** | XIs ~1h pre-match are the best available injury signal | M | included in P2.1 |
| P3.2 | **Negative-binomial goals model** (overdispersion vs Poisson) | Better OU/BTTS calibration | S | $0 |
| P3.3 | **HT/FT + first-half markets** (HT scores already stored) | New market expansion after gates pass | L | $0 |
| P3.4 | **Weather features** — Open-Meteo archive backfill + forecast ingestion | Cheap, defensible for outdoor leagues | M | $0 |
| P3.5 | **Rest/travel/congestion features** | Real predictive value, currently absent | M | $0 |
| P3.6 | **Sportmonks integration** (formations, tactical data, deeper stats) — 5 leagues €29 | Only source for tactical/style features | L | ~€29–99/mo |
| P3.7 | **Referee features re-evaluation** — only if base features prove out; prior ablation showed zero lift | Don't spend before validating | S | $0 |

## Priority 4 — Experimental research

| # | Item | Why | Gate |
|---|------|-----|------|
| P4.1 | Bayesian hierarchical team-strength model | Shrinkage for thin-data teams/leagues | Must beat Elo+form baseline walk-forward |
| P4.2 | Gradient-boosted per-market models promoted to prod | Offline XGB artifacts exist; never promoted | Champion/challenger vs meta-ensemble on identical folds |
| P4.3 | Odds-movement/closing-line features | Requires retained odds history (P1.4 first) | CLV-positive backtest |
| P4.4 | Tactical style-matchup features | Requires Sportmonks (P3.6) | Ablation must show lift — referee precedent says measure first |
| P4.5 | Manager-change impact features | No data source yet | Needs provider + validation |

## The five most important improvements (ranked)

1. **Backfill data + fix weight config + injury sign bug** (P1.1–P1.3) — the
   model is currently running on defaults with an inverted injury term.
2. **Restore honest evaluation** (P1.5) — no accuracy claim is possible until
   walk-forward works; this gates everything else.
3. **Wire real injury/lineup intelligence** (P1.6 + P2.1/P2.2) — biggest
   real-world predictive gap.
4. **Calibration into prod** (P2.4 + P2.7) — prerequisite for the
   high-confidence strategy and honest UI tiers.
5. **xG integration** (P2.3) — best data-per-dollar improvement available.

## 5. Validation protocol (applies to EVERYTHING above)

- **Chronological walk-forward** — train on past, test on future, rolling folds.
- **Strict leakage guards** — no closing odds, no post-match info, no
  full-sample statistics in features; `input_snapshot` per prediction.
- **Out-of-sample only** — test-set early stopping banned (the 65.6% lesson).
- **Per-market AND per-league breakdowns** — aggregate accuracy hides failure.
- **Metrics:** Brier, log loss, ECE, reliability diagrams, accuracy by
  confidence bucket.
- **Ablation studies** — each feature group ON/OFF; referee features already
  showed zero lift — don't repeat that mistake by shipping unmeasured features.
- **Champion/challenger** — new model must beat incumbent on identical folds
  before promotion; version every model in `model_versions`.
- **Point-in-time honesty** — if data wasn't recorded at prediction time,
  say the feature can't be backtested; don't fake it.

## 6. Cost summary

| Phase | One-time | Recurring |
|-------|----------|-----------|
| P1 foundations | Engineering time only | $0 |
| P2 improvements | Engineering time | ~$50–90/mo (API-Football Pro + Odds API tier) |
| P3 advanced | Engineering time | +~€29–99/mo if Sportmonks |
| P4 research | Engineering time | $0 (uses existing infra) |

**Lean path to a credible system: ~$50/mo + engineering.** Every dollar beyond
that must be justified by a measured lift in P4.2/P4.3-style experiments.
