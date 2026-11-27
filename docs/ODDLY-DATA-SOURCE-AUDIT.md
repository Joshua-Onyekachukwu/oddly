# ODDLY — Data Source Audit

Audit date: 2026-10-02. Scope: every external provider, ingestion path, storage
table and consumption point in the codebase. Findings traced end-to-end
(provider → ingestion → storage → feature engineering → prediction), not just
from documentation.

## 1. Provider / integration inventory

| # | Provider | Method / endpoint | Data retrieved | Features that consume it | Status | Historical coverage | Freshness | Cost / limits | Stored locally? | Snapshots kept? | Available pre-match? |
|---|----------|-------------------|----------------|--------------------------|--------|--------------------|-----------|---------------|-----------------|-----------------|----------------------|
| 1 | **API-Football** (api-sports.io) | REST via `src/lib/sync/*`, `worker/sync-*`, `scripts/sync-*` | Fixtures, results, standings, injuries, player season stats, odds (fixture-level) | Elo/form rebuild, fixtures table, `player_injury_data`, `player-stats.json` | **Active** (sync workers; crons call it) | Current season + injuries back to ~2024 | Per sync run | Free 100 req/day; Pro $19/mo (7.5K/day); Ultra $29 (75K); Mega $39 (150K) | Yes — `fixtures`, `odds_snapshots`, injury tables | Partially — `odds_snapshots` pruned to ~1h (`src/lib/sync/odds.ts:290-295`) | Yes (pre-match odds/lineups endpoints exist) |
| 2 | **football-data.org** | CSV bulk download (`worker/fetch-*-football-data*`, `scripts/`) | 30,340 matches, 17 leagues, seasons 2122–2526: results, HT scores, shots, fouls, corners, cards, referee (67.9% null) | `historical_matches`, `team_match_stats`, `match_features`, research dataset | **Collected, stored in `data/` JSONs; DB tables on NEW project are EMPTY** | 5 seasons, 2021-07 → 2026-05 | One-off backfill | Free tier 12 comps; paid €29–199 + €15 stats/odds add-ons | Yes (local JSONs; Supabase tables exist but unpopulated on new project) | Static historical — inherently point-in-time | Yes (historical) |
| 3 | **The Odds API** (the-odds-api.com) | REST via `src/lib/sync/odds.ts`, `worker/fetch-odds*` | H2H odds per fixture/bookmaker/market | `odds_snapshots`, market-1x2 features, value/CLV | **Active but quota-constrained** — key present in `.env.local` | Whatever is fetched live; no deep history on free/cheap tiers | Per fetch | Free 500 credits/mo; $30/20K; $59/100K; $119/5M; $249/15M | Yes — `odds_snapshots` | **NO — pruned to ~1h, CLV history destroyed**; CLV written to ephemeral `data/*.json` | Yes |
| 4 | **SharpAPI** (sharpapi.io) | REST `https://api.sharpapi.io/api/v1` (`SHARPAPI_*` in `.env.local`) | Sharp bookmaker odds | **Nothing — key saved, zero code integration** | **Unused** | n/a | n/a | Free 12 req/min, 2 books, 60s delay; Hobby $79; Pro $229; Sharp $399 | No | n/a | n/a |
| 5 | **StatsBomb open data** | GitHub open-data repo scrape (`scripts/collect-statsbomb*`, `worker/`) | Event-level xG, shots, big chances, key passes per match | `xg_features`, `statsbomb-xg.json`, `statsbomb-progress.json` | **Partial — scrape incomplete** (15/~40 comp-seasons done) | La Liga 17 seasons, UCL 10, PL/Bundesliga 2, Serie A 1, Ligue 1 3, MLS 1 → 2,183 matches, 147 teams | One-off | Free (open data) | Yes — local JSONs; `xg_features`/`players`/`player_appearances` tables created but **empty on new DB** | Static | Yes |
| 6 | **Understat** | Scrape (`worker/collect-understat*` or similar) | Team-season xG aggregates | `understat-xg.json` | **Partially broken** — `understat-xg.json` has 484 team-seasons but `understat-match-xg.json`/`understat-team-xg.json` are EMPTY | 5 leagues × 5 seasons (2021–2025), 8,908 matches claimed | One-off | Free (unofficial scrape — ToS risk) | Local JSON only | Static | n/a (aggregates) |
| 7 | **OddsPortal** | Scrape (`worker/` AH scripts) | Asian handicap odds | `ah-odds.json`, `ah-features.json` | **Manual/one-off** | ~59 matches, 5 leagues, single scrape day | One-off | Free (scrape — ToS risk) | Local JSON only | No | n/a |
| 8 | **Open-Meteo** (weather) | API per fixture (`weather-features.json`) | Temp, precipitation, wind, humidity, city geo | Weather features — **never joined into research dataset or prod features** | **Collected once (2026-08-25), forward-only, unused by model** | None historical | One-off | Free tier | Local JSON only | No | Partially (forecast only near matchday) |
| 9 | **Transfermarkt** | Scrape (`transfermarkt-injuries.json`) | Injury lists (mostly EPL), many null fields, HTML entities | Nothing — not consumed | **Collected, unused, low quality** | Current only | One-off | Free (scrape — ToS risk) | Local JSON only | No | Yes |
| 10 | **premierinjuries.com** | Scrape (`premier-injuries.json`) | EPL injuries with expected_return | Nothing — not consumed | **Collected, unused** | Current EPL season | One-off | Free (scrape) | Local JSON only | No | Yes |
| 11 | **NVIDIA NIM / LLM** | `ai-chat` route + `ai_cache` table | Chat responses | AI chat feature only — **not a prediction input** | Active | n/a | On demand | API key in env | `ai_cache` | n/a | n/a |
| 12 | **Convex** | `convex/` realtime tables | Legacy realtime store (leagues, teams, livePick, valuePicks, settlementFeed, liveStats) | Realtime UI | **Legacy** — heavy data migrated to Supabase; Convex now realtime-only per `convex/schema.ts` | n/a | Live | Convex plan | Yes (Convex cloud) | n/a | n/a |

## 2. End-to-end trace: collected → stored → consumed

### Actually consumed by the production predictor
(`vercel.json` crons → `src/app/api/v1/cron/predict/route.ts` →
`src/lib/models/ensemble.ts` → `worker/models/meta-ensemble.js`,
model_version `v2.0-meta-ensemble`)

| Input | Source | Path |
|-------|--------|------|
| Last ~2,000 finished fixtures (recomputed Elo + form) | `fixtures` table (API-Football sync) | predict cron queries finished matches, replays chronologically (window bug fixed 2026-10-02) |
| League params | `league_model_params` table | feature-store-loader |
| Model weights | `model_weight_config` | **BROKEN: queried as `config_name='default'`, only `'production_v5'` seeded — and new DB has 0 rows** |
| Injuries | `player_injury_data` | manual `player_importance` 1–10 guesses; delete+reinsert, no history |
| Team/referee feature profiles | `team_feature_profiles`, `referee_feature_profiles` | feature-store-loader — **tables empty on new DB** |

### Stored but NOT consumed by predictions
- `odds_snapshots` beyond the thin live window (pruned ~1h)
- `player_availability`, `injury_snapshots`, `team_injury_features`, `fixture_injury_features` — the richer injury system is **never read by any cron**
- `historical_matches`, `match_features`, `model_predictions`, `elo_ratings` — backtest store, **empty on new DB**
- `xg_features`, `players`, `player_appearances`, `team_strengths` — **empty on new DB**
- All `data/*.json` research artifacts (27K-match dataset, referee features, weather, AH odds, xG) — **not in production path**
- Python XGBoost/LightGBM models in `models/` — **not in production path** (offline scripts only)

### Consumed by nothing at all
- SharpAPI (key only), Understat match-level files (empty anyway), Transfermarkt/premierinjuries scrapes, weather features, OddsPortal AH features, `walk-forward-report.json` (empty)

## 3. Key findings

1. **Two disconnected injury systems.** The ensemble reads the simple
   `player_injury_data` (manual importance guesses, no history). The richer
   `player_availability`/`fixture_injury_features` pipeline
   (`src/lib/injury/feature-engineering.ts`) is never invoked by any cron and
   never reaches the model. `predictions.injury_features_used` is never written.
2. **Odds history is being destroyed.** `odds_snapshots` retention ~1 hour makes
   CLV, odds-movement and market-efficiency features impossible; CLV currently
   lands in ephemeral `data/*.json` files.
3. **Weight config lookup is broken.** `config_name='default'` vs seeded
   `'production_v5'` — and the new DB has zero rows either way until
   `worker/feature-store-sync.js` runs.
4. **xG exists but isn't joined.** StatsBomb/Understat xG data covers only
   ~2.1K matches and never made it into `research-dataset.json` (`has_xg`=0 for
   all 27,314 rows).
5. **New Supabase project has schema only.** All historical data (30K matches,
   599K predictions) lives in the OLD project (`ulelicr...`) and local `data/`
   JSONs. A data migration/backfill decision is required — see
   ODDLY-DATA-INVENTORY.md.
6. **Market odds are barely used as a feature.** Only ~16 fixtures ever had
   computed odds features; market-1x2 model exists but odds coverage is near
   zero historically. The market is currently a benchmark, not an input.
