# ODDLY — Prediction Factor Audit

Audit date: 2026-10-02. "Implemented" = code path reachable from the production
predict cron. "Planned" = schema/code exists but is not invoked. "Missing" =
no implementation found.

## A. Team performance & historical statistics

| Factor | Status | Evidence / notes |
|--------|--------|------------------|
| Recent form (multiple windows) | ✅ Implemented | Recomputed from last ~2,000 finished fixtures; predict + settle crons consistent (window bug fixed) |
| Home/away splits | ✅ Implemented | In ensemble features |
| Goals scored/conceded | ✅ Implemented | Via form/Elo features |
| Elo rating | ✅ Implemented | Rebuilt per cron run from fixture history |
| Head-to-head | ⚠️ Partial | `h2h` feature **hardcoded to 0.5** in meta-ensemble — hook exists, value never computed |
| xG / xGA | ❌ Missing in prod | Data exists (StatsBomb 2,183 matches, Understat aggregates) but `has_xg`=0 across the 27K research set; never joined |
| xPts | ❌ Missing | No provider integration |
| Shots / SoT / conversion | 🗄️ Stored only | In football-data matches + `team_match_stats`; not a prod feature |
| Big chances created/conceded | 🗄️ Stored only | StatsBomb event data has it; not joined |
| Possession / attacking efficiency | 🗄️ Stored only | Same |
| Clean sheets / failed-to-score | ❌ Missing | Derivable but not implemented |
| First-half / second-half splits | 🗄️ Stored only | HT scores stored in `historical_matches`; unused |
| Performance vs similar opponents | ❌ Missing | No opponent-strength-conditioned form |
| Tactical style matchups | ❌ Missing | No formation/style data at all |
| League-specific patterns | ⚠️ Partial | `league_model_params` + `league_draw_calibration` tables exist; `shrunkDrawRate` is **write-only, never read back** |

## B. Player intelligence & availability

| Factor | Status | Evidence / notes |
|--------|--------|------------------|
| Injured players | ⚠️ Partial | Ensemble reads `player_injury_data` — manual `player_importance` 1–10 **guesses**, delete+reinsert (no history), no expected-return |
| Suspended players | ⚠️ Partial | Same table; suspensions rarely populated (`derived_suspensions=0` in local data) |
| Doubtful/unavailable | ❌ Missing | `player_availability` has status field but is **never read by any cron** |
| Expected return dates | 🗄️ Stored only | In `premier-injuries.json` scrape; not in DB pipeline |
| Confirmed lineups | ❌ Missing | **0% coverage — never collected** (API-Football lineups endpoint unused) |
| Predicted lineups | ❌ Missing | `predicted-lineups.js` exists, no data |
| Key player absences | ⚠️ Partial | Only via crude injury counts/importance guesses |
| Goalkeeper availability | ❌ Missing | No position-aware impact |
| Defensive partnership stability | ❌ Missing | Requires lineup data |
| Minutes / workload / fatigue | ❌ Missing | No player minutes data in prod path |
| Player xG / xA | 🗄️ Stored only | `player_appearances` table exists, empty on new DB |
| Replacement quality vs absent player | ❌ Missing | `player_impact`/PIS tables exist but unwired |
| Tactical change from absence | ❌ Missing | No tactical model |
| **Point-in-time injury reconstruction** | ❌ Missing | `injury_snapshots` table designed for it; never populated; cannot rebuild what was known at historical prediction time |

**Two parallel injury systems exist and only the weaker one is live:**
- LIVE: `player_injury_data` (manual importance guesses)
- DEAD: `player_availability` → `team_injury_features` → `fixture_injury_features`
  (`src/lib/injury/feature-engineering.ts`) — richer, but no cron calls it and
  nothing writes `predictions.injury_features_used`.

## C. Tactical & matchup intelligence

| Factor | Status |
|--------|--------|
| Formation / tactical approach | ❌ Missing — no data source integrated |
| Pressing / defensive block / counters | ❌ Missing |
| Vulnerability to formations | ❌ Missing |
| Set-piece strength/weakness | ❌ Missing |
| Manager changes & impact | ❌ Missing — no manager data collected |
| Style compatibility | ❌ Missing |

## D. Match conditions & external factors

| Factor | Status | Notes |
|--------|--------|-------|
| Home advantage | ✅ Implemented | Core feature + `league_model_params.home_advantage` |
| Stadium / surface | ❌ Missing | |
| Travel distance | ❌ Missing | No geo data in prod path |
| Rest days / fixture congestion | ⚠️ Partial | Fatigue signals exist in `match_features` design; not confirmed live in prod features |
| European/domestic scheduling | ❌ Missing | |
| Extra-time fatigue | ❌ Missing | |
| Weather | 🗄️ Collected, unused | 9,729 records, forward-only, never a feature |
| Referee identity/tendencies | 🗄️ Stored, unused | 9,740 matches tagged locally; **ablation showed ZERO accuracy lift** (`referee-model-results.json`); DB tables empty on new project |
| Derby / rivalry | ❌ Missing | |
| Motivation / table context | ⚠️ Partial | `season_phase`, standings position in research features; not confirmed in prod path |
| Neutral venue | ❌ Missing | |

## E. Betting market intelligence

| Factor | Status | Notes |
|--------|--------|-------|
| Opening odds | ❌ Missing | No opening-vs-current tracking |
| Current odds | ⚠️ Partial | `odds_snapshots` live but pruned to ~1h |
| Odds movement / line movement | ❌ Missing | History destroyed by retention policy |
| Closing odds | ❌ Missing | ~0.1% coverage historically |
| Market-implied probabilities | ⚠️ Partial | Computed for ~16 fixtures only |
| Bookmaker margin / overround | ⚠️ Partial | In `market-consensus.json` (103 fixtures) |
| Book disagreement / consensus | ⚠️ Partial | Same — tiny coverage |
| Odds volatility / liquidity | ❌ Missing | |
| Model-vs-market value | ✅ Implemented | `recommendations` edge/opportunity_score/Kelly; market-1x2 sub-model exists |
| **Market as model INPUT** | ❌ Missing | Market is a benchmark, not a feature — and historically there's almost no odds data to use |
| **Leakage guard** | ❌ Missing | No mechanism preventing closing/future odds entering earlier predictions — must be enforced before market features are added |

## Summary verdict

- **Genuinely live:** Elo, form, H/A splits, goals, home advantage, basic
  market-value scoring, crude injury counts.
- **Half-wired (the dangerous middle):** H2H (hardcoded 0.5), injury system #2,
  draw calibration (write-only), `confidence_tier` (never written),
  `draw_odds` hook (never set), `model_weight_config` (wrong key + empty table).
- **Collected but dead:** referee data, xG, weather, AH odds, player stats,
  all Python models, 27K-match research dataset.
- **Absent entirely:** lineups, suspensions-at-scale, travel, rest modeling,
  tactical/style, manager, motivation, market-history features.
