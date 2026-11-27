# ODDLY — Data Intelligence Master Plan

**Date:** 2026-11-26

---

## 1. Provider Audit (verified from code + docs)

| Provider | Used by | Data | Status | Cost | Verdict |
|---|---|---|---|---|---|
| football-data.org | `sync-football-data-org.js`, cron/sync | Fixtures, results, cards, corners, fouls, referee name | ✅ working | Free (10 req/min, ~12 competitions free) | KEEP — primary results source |
| StatsBomb Open Data | `collect-statsbomb*.js` | xG, shots, possession (2,183 matches claimed) | ✅ collected | Free | KEEP — expand competition coverage |
| The Odds API | `fetch-odds-*.js`, `fetch-live-odds.js` | 1X2/spreads/totals odds | 🟡 quota exhausted (Aug) | Free 500/mo | INSUFFICIENT — needs paid tier or supplement |
| API-Football | env key present | Fixtures/odds/injuries/lineups | ❓ usage unverified | Freemium | VERIFY — potentially the single best paid/free option for lineups+injuries+odds |
| Understat | `scrape-understat-xg.js`, `debug-understat.js` | xG team/match | 🔴 scraping failed | Free | REPLACE with StatsBomb/API-Football |
| Transfermarkt | `transfermarkt-scraper.js`, `scrape-injuries*.js` | Injuries/suspensions (149 teams claimed) | 🟡 partial, fragile scraping | Free | KEEP as supplement; fragile |
| OddsPortal (scrape) | `scrape-ah-odds.js` | Asian handicap | 🟡 exists | Free | VERIFY output quality; ToS risk |
| OpenWeatherMap | `collect-weather.js` | Weather | 🟡 script exists | Free tier | KEEP if features prove predictive |
| FBref | research docs only | Possession/PPDA | ⬜ not collected | Free (scrape) | Phase 2 |
| Convex | realtime schema | livePick/valuePicks/settlementFeed | ✅ slim | Free | KEEP for realtime or fold into Supabase Realtime |

## 2. Data-Provider Strategy (recommendation)

**Tier 1 (must fix):**
- **Results/fixtures:** football-data.org (have) + API-Football as cross-check for leagues football-data.org lacks.
- **Odds:** The Odds API paid tier (~$30/mo) OR API-Football odds endpoint — decision needed (see open questions). Odds are the single highest-leverage missing input for value + rollover.
- **xG:** StatsBomb open data (have) + Understat via API-Football or FBref scrape.
- **Injuries/lineups:** API-Football (has both, structured) as primary; Transfermarkt scraper as fallback.

**Tier 2:** referee stats (football-data.org provides referee per match — already collected), standings (football-data.org), weather (OpenWeatherMap, only if ablation shows value).

**Tier 3 (defer):** player props, corners/cards markets, manager data, travel distance.

**Cross-validation rule:** fixture identity (teams, kickoff, score) must be confirmed against ≥2 sources before settlement; conflicting sources → quarantine queue, never silent overwrite.

## 3. Required Data Inventory (per match, as-of prediction time)

Already covered in your spec §5.1 — mapping to what exists:

| Category | Have | Missing/weak |
|---|---|---|
| A. Match info | ✅ fixtures, kickoff, status | venue, external IDs inconsistent |
| B. Team performance | ✅ form/PPG/Elo computed | xG not in prod features; rest days partial; no fixture-congestion metric |
| C. Players/squad | 🟡 injuries (new system), 265 player stats | confirmed lineups, lineup predictions not fed to model |
| D. Environment | 🟡 referee data collected | referee NOT in prod features; weather collected but unused |
| E. Market intel | 🔴 odds snapshots sparse (quota) | opening/closing odds, movement, consensus — effectively absent |
| F. Outcomes | ✅ scores; partial stats | xG actuals, event-level data sparse |

## 4. Immutable Snapshot System (design)

```
prediction_runs (run_id)
  └─ prediction_inputs (run_id, fixture_id, snapshot JSONB, created_at)
        ├─ feature_vector: {elo_diff, ppg..., xg..., injury..., referee..., odds_implied...}
        ├─ team_state: {home: {elo, form[15], xg_avg}, away: {...}}
        ├─ context: {rest_days, venue, weather, referee_id, lineup_status}
        ├─ odds: [{bookmaker, market, selection, odds, captured_at}]
        ├─ data_quality: {completeness_score, freshness_score, sources[]}
        └─ versions: {feature_version, model_version, calibrator_version}
```

Rules:
- Written **once** per fixture per run; append-only.
- Predictions reference `input_id` — never duplicate the payload.
- Settlement reads actuals; never mutates the input snapshot.
- Retention: keep all snapshots (they're the audit trail); partition by month if size demands.
- Leakage test in CI: for each feature, assert `feature.as_of <= fixture.kickoff_utc`.

## 5. Ingestion Architecture

- **Collectors** stay as Node/Python scripts but write through a single `ingest()` service layer that: validates → dedupes (natural keys) → stamps `source` + `captured_at` → upserts → logs to `ingestion_runs`.
- **Schedules:** results every 30–60min on match days; odds every 15–60min pre-kickoff (3 timestamps: open/T-24h, T-2h, close/T-1h for CLV); injuries daily + pre-kickoff; xG weekly.
- **Idempotency:** natural-key upserts everywhere; `cron_locks` already exist — extend pattern.
- **Quality scores:** per-fixture completeness (which feature groups present), freshness (age of injury/odds data), source agreement. Persist on the snapshot.
- **Freshness SLOs:** injuries ≤24h, odds ≤2h pre-kickoff, results ≤30min post-full-time.

## 6. Data Quality & Validation

- `scripts/audit-*.js` → promote into scheduled `data_quality_checks` with alerting.
- Validation dimensions: identity (team/fixture mapping), temporal (timestamps sane, no future data), numerical (odds >1, probs in [0,1], scores consistent), completeness (required fields per league tier).
- Conflicting provider data → `data_conflicts` table + admin review; never last-write-wins silently.
- Duplicate prediction IDs already flagged in `data/duplicate-prediction-ids.json` — resolve during migration.

## 7. Build order

1. Odds ingestion fix (highest leverage — unblocks value, CLV, rollover, market-implied features).
2. Snapshot persistence (PE-1) — cheap, unblocks everything downstream.
3. Injury/lineup pipeline hardening (new system exists; verify collectors run on schedule).
4. xG coverage expansion (StatsBomb competitions + API-Football).
5. Cross-source fixture validation.
6. Feature store consolidation: move `/data/*.json` research artifacts into DB-backed feature store with versions.
