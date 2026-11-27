# ODDLY — Additional Data Sources

Audit date: 2026-10-02. Prices verified against provider docs/pricing pages at
audit time; re-verify before purchase. Guiding rule: **only buy what fixes a
measured gap** — the referee ablation (zero lift) shows more data ≠ better
predictions.

## 1. What we already have (don't re-buy)

| Need | Already covered by |
|------|--------------------|
| Fixtures, results, basic stats | API-Football + football-data.org (30K matches local) |
| Odds (pre-match) | The Odds API (key active) + SharpAPI (key saved, unused) |
| xG (historical, big-5 + UCL) | StatsBomb open data — free, just finish the scrape |
| xG (team-season aggregates) | Understat scrape — free, fix the broken exporters |
| Injuries (current) | API-Football injuries endpoint + premierinjuries (EPL) |
| Weather | Open-Meteo — free, but only forecast; historical needs archive API (also free) |
| Asian handicap | OddsPortal scrape — thin, low priority |

## 2. Recommended additions, ranked by value/cost

### Tier A — do first (high value, low cost)

| Source | What it adds | Cost | Why |
|--------|--------------|------|-----|
| **API-Football Pro/Ultra upgrade** | Injuries + suspensions + lineups endpoints at volume; odds endpoint | $19–29/mo | Unlocks the entire player-intelligence plan (P1–P3). Single biggest gap. |
| **Open-Meteo archive** | Historical weather per fixture city/date | Free | Converts dead `weather-features.json` into a real backtestable feature set |
| **StatsBomb open data (finish scrape)** | Remaining ~25 comp-seasons of xG/events | Free | Already half-done; resumable via `statsbomb-progress.json` |
| **Understat fix** | Per-match xG for 5 leagues × 5 seasons | Free | Match-level files are empty — fix exporters; biggest xG coverage win per dollar (zero) |

### Tier B — high impact, moderate cost

| Source | What it adds | Cost | Why |
|--------|--------------|------|-----|
| **Sportmonks** | Deep stats, lineups, formations/tactical data, referee data, injury history — 5 leagues from €29/mo, up to 120 leagues €249/mo | €29–249/mo | Only realistic source for **formation/tactical** features and structured lineup history. Start at €29 (5 comps) and only expand if P4 validation shows lift. |
| **football-data.org paid tier** | More competitions + stats/odds add-ons (€15 each) | €29–199 + add-ons | Extends the 30K-match backbone to more leagues; odds add-on could replace thin Odds API usage for covered leagues |
| **The Odds API paid tier** | Historical odds snapshots (plan-dependent), more bookmakers | $30–119/mo | Required for CLV, odds-movement, market-as-feature. **Also fix retention first** — paying for history we then delete is waste. |

### Tier C — evaluate, don't commit yet

| Source | What it adds | Cost | Caveat |
|--------|--------------|------|--------|
| **SharpAPI** (key already held) | Sharp-book closing odds — the best market signal | Free→$79–399/mo | Excellent for CLV/market-efficiency features; integrate as second odds source feeding `odds_snapshots` with `bookmaker='sharp'` |
| **FBref / Understat scraping** | Advanced team stats (xG trends, set pieces) | Free (ToS risk) | Scraping fragility; prefer API where possible |
| **API-Football Mega** ($39) | 150K req/day | $39/mo | Only if sync volume demands it |
| **StatsBomb paid (360)** | Full event data beyond open-data comps | Custom/expensive | Probably unnecessary — open data covers big-5+UCL |
| **Transfermarkt API (unofficial)** | Injuries, transfers, squad value | Free (ToS risk) | Current scrape quality is poor; only worth it with proper parsing |

## 3. Explicitly NOT recommended now

- **Another general odds API** — two sources (The Odds API + SharpAPI) suffice.
- **Paid referee data** — our own referee features showed zero lift; don't buy
  more until the base features earn their place.
- **Social/media sentiment** — no evidence of predictive value for 1X2/GOALS.
- **Player prop data providers** — no props markets in scope.

## 4. Coverage strategy

1. **Depth over breadth.** 5–8 well-covered leagues beat 17 thin ones. Prioritize
   EPL, La Liga, Bundesliga, Serie A, Ligue 1, Eredivisie, Primeira Liga, UCL.
2. **One-time purchases over subscriptions** where possible: historical
   football-data CSVs, StatsBomb open data, Understat archives are buy-once/keep
   forever. Store in Supabase, not local JSON.
3. **Verify before scaling:** every new feed must pass the walk-forward
   champion/challenger gate (see IMPROVEMENT-ROADMAP) before becoming a prod
   feature.

## 5. Estimated monthly cost scenarios

| Scenario | Stack | ~$/mo |
|----------|-------|-------|
| **Lean (recommended start)** | API-Football Pro $19 + The Odds API $30 + free tiers (StatsBomb, Understat, Open-Meteo) | **~$50** |
| **Growth** | API-Football Ultra $29 + Odds API $59 + Sportmonks €29 (5 leagues) | **~$125** |
| **Full** | API-Football Mega $39 + Odds API $119 + Sportmonks €99 (20 leagues) + SharpAPI Hobby $79 | **~$360** |

The lean stack fixes every critical gap found in the audit. Scale spend only
when validation proves lift.
