# ODDLY — Player Intelligence Plan

Audit date: 2026-10-02. This is the single highest-value gap in the platform:
player availability is where football predictions are actually won or lost, and
ODDLY currently runs on manual 1–10 importance guesses with no history.

## 1. Current state (verified)

**Live path (weak):**
- `player_injury_data` — rows with `player_importance` 1–10 entered manually,
  delete+reinsert on each collection run. No history, no expected return, no
  positional/role context. Read by `worker/models/feature-store-loader.js` →
  market-1x2 injury impact term.
- **Known bug:** `market-1x2.js` computes
  `z += homeInjuryImpact + awayInjuryImpact * -1` — the away-impact sign is
  inverted, so away injuries currently *help* the away team in the model.

**Dead path (better, unwired):**
- `player_availability` (status: injured/suspended/doubtful/out, UNIQUE
  player+team), `injury_snapshots` (historical, `source_confidence`,
  `is_historical`), `team_injury_features`, `fixture_injury_features`
  (home/away/diff aggregates), `injury_collection_log`, views
  `team_injury_summary_v2`, `injury_dashboard_summary`,
  `check_injury_data_freshness()`.
- Feature engineering exists: `src/lib/injury/feature-engineering.ts`.
- **No cron calls it.** `predictions.injury_features_used` /
  `injury_snapshot_date` columns exist but are never written.

**Local data assets:**
- `injuries-suspensions.json`: 20,257 API-Football injury records (fixture-dated
  ~2024 season) — usable for backfill/history.
- `premier-injuries.json`: 64 EPL injuries with expected_return.
- `transfermarkt-injuries.json`: low quality (null teams, HTML entities).
- `player-stats.json`: 265 players' season stats.
- `team-injury-impact.json`: 149 teams' aggregated impact scores.
- `player_impact` / `player_impact_scores` tables + `calculate-player-impact.js`:
  win-rate-without impact methodology exists.
- StatsBomb `players`/`player_appearances` schema ready (xG, xA, duels, minutes)
  but empty.

## 2. Target architecture

```
Collectors (API-Football injuries+lineups, premierinjuries cross-check)
      │  write point-in-time rows
      ▼
player_availability ──► injury_snapshots (append-only history)
      │                        │
      ▼                        ▼
team_injury_features    fixture_injury_features (per fixture, pre-match)
      │                        │
      └────────► predict cron ──┘  → predictions.injury_features_used
```

Key principles:

1. **Append-only history.** Every collection run inserts a snapshot; never
   delete+reinsert. This is what makes backtesting and "what did we know at
   time T" possible.
2. **Player importance from data, not guesses.** Compute importance from
   minutes share, xG+xA contribution, lineup status frequency, and
   win-rate-without impact (existing `player_impact` methodology). Role
   multipliers: GK > CB/DM > CM/winger > striker-depth.
3. **Replacement quality.** When a starter is out, compare the expected
   replacement's impact score to the absent player's — the *delta* is the
   feature, not the raw absence.
4. **Position-aware aggregates.** Defensive-line absences ≠ attacking absences.
   Keep per-unit (GK/def/mid/att) availability features.
5. **Suspensions as first-class.** API-Football exposes suspensions; ingest
   them into the same pipeline with reason codes.
6. **Lineups.** API-Football `/fixtures/lineups` gives confirmed XIs ~1h before
   kickoff. Ingest into a `fixture_lineups` table; confirmed lineups should
   override predicted availability for same-day predictions. This also unlocks
   formation/tactical features later.
7. **Cross-source verification.** premierinjuries (EPL) + Transfermarkt +
   API-Football — flag disagreements rather than silently picking one.

## 3. Implementation phases

**Phase P1 — unify & wire (no new data needed)**
- Fix `market-1x2.js` away-injury sign bug.
- Write a cron (`/api/v1/cron/injuries` or fold into existing collect job) that
  populates `player_availability` + `injury_snapshots` from API-Football.
- Call `feature-engineering.ts` in the predict path; write
  `predictions.injury_features_used` + `injury_snapshot_date`.
- Backfill `injury_snapshots` from `injuries-suspensions.json` (20K records).

**Phase P2 — importance engine**
- Populate `player_appearances`/`players` from StatsBomb (resume scrape) +
  API-Football player stats.
- Compute `player_impact_scores` per team; derive `player_importance` from it.
- Add replacement-delta feature.

**Phase P3 — lineups & suspensions**
- `fixture_lineups` table + ingestion cron (hourly on matchdays).
- Suspension ingestion; doubtful-status handling.
- Confirmed-lineup override in predict cron.

**Phase P4 — validation**
- Walk-forward backtest: injury features ON vs OFF (the
  `validation_results` table already has injury-vs-baseline delta columns).
- Only keep features that beat baseline out-of-sample.

## 4. Honest assessment

- This is the highest expected-value work remaining: injuries/lineups are the
  most common real-world cause of upset predictions, and we currently model
  them with guesses **and a sign bug**.
- Blocker: API-Football plan tier — injuries endpoint needs at least Pro
  ($19/mo); lineups too. Current key tier unknown — verify before Phase P3.
- Without Phase P4 validation we cannot claim the features help; the referee
  ablation (zero lift) is the cautionary precedent — measure before shipping.
