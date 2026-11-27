# ODDLY — Strategic Assessment: Market Intelligence, Risk & Operations

Date: 2026-10-02. Extends the 10-document audit with nine strategic
requirements. Every assessment is grounded in verified code/data findings —
where evidence is missing, it says so.

## 1. Market Intelligence & Predictive Advantage

**Can ODDLY identify model-vs-market edges today? Partially — and it cannot yet
prove the edge is real.**

What exists:
- `recommendations` table with `edge`, `opportunity_score`, Kelly — the
  scoring pipeline runs.
- `odds_snapshots` now retains 30–90 days (fixed 2026-10-02); The Odds API sync
  is live (304 snapshots from first run).
- Market-1x2 sub-model + `market-consensus.json` (103 fixtures, vig-free
  consensus, ~6.5% overround) show the *method* works.

What prevents a real edge claim:
- **Odds history ≈ 0.** Until retention fix, ~16 fixtures ever had computed
  odds features. CLV cannot be measured retroactively.
- **No opening/closing tracking.** Snapshots are timestamped but nothing
  distinguishes opener vs closer; line-movement features don't exist.
- **Market is a benchmark, not an input.** Model probabilities never see odds;
  "edge" is computed post-hoc. A market-informed model (odds as feature with
  strict pre-match leakage guards) is P2.5 in the roadmap.
- **No proof of incremental value.** The decisive experiment — does the model
  beat the closing market? — requires retained closing odds + settled
  predictions over a meaningful sample. Neither exists yet.

**Honest position:** ODDLY's realistic advantage is *not* beating sharp closing
lines market-wide (that's what Pinnacle is for). The plausible edges are:
(a) markets/books the consensus ignores (lower leagues, smaller books),
(b) timing edges (confirmed lineups ~1h pre-match vs earlier market moves),
(c) the rollover structure itself (combining moderate-probability legs).
Each needs its own CLV-measured validation before claiming.

## 2. Competition-Specific Intelligence

**Design: per-competition reliability scoring → prediction gating.**

Each league gets a rolling scorecard:

| Dimension | Source | Gate threshold (initial) |
|-----------|--------|--------------------------|
| Historical coverage | matches with features in `historical_matches`/fixtures | ≥500 matches or ≥2 seasons |
| Data quality | feature-completeness rate, lineup/injury availability | ≥80% core features |
| Market efficiency | model-vs-market divergence + CLV by league | measure, don't assume |
| Model performance | settled accuracy/Brier/log-loss per league | beats baseline |
| Calibration | per-league ECE on rolling window | ECE < ~0.05 |
| Sample size | settled predictions in window | ≥200 for claims |

Leagues failing gates get **"insufficient coverage — no predictions"** rather
than forced output. Initial expectation (from data audit): EPL, La Liga,
Bundesliga, Serie A, Ligue 1, Eredivisie, Primeira Liga, UCL have the data
depth; lower leagues and cups start gated until coverage accumulates.

## 3. Prediction Timing Intelligence

**Three immutable snapshot stages per fixture:**

| Stage | When | New information | Snapshot label |
|-------|------|-----------------|----------------|
| T1 Early | ~48–72h pre-match | Form, Elo, injuries report, opening odds | `early` |
| T2 Lineup | ~1h pre-match (confirmed XIs) | Confirmed lineups, late injury/suspension news, odds movement | `lineup` |
| T3 Near-kickoff | ~15min pre-match | Final odds (close proxy), weather, any late team news | `near_kickoff` |

Implementation:
- `predictions` rows already carry `input_snapshot` + `feature_version`;
  add `prediction_stage` column and keep **all three stages** (never overwrite
  — append-only, matching the injury-snapshot design).
- The predict cron currently runs every 4h in a 48h window — extend to emit
  stage-tagged predictions; lineup-stage requires the lineups ingestion (P3.1).
- **Value measurement:** compare T1 vs T2 vs T3 Brier/log-loss on the same
  fixtures. The delta *is* the measured value of lineup/weather/market-move
  information — this directly answers "how much does each factor add" with
  data instead of intuition.

## 4. Data Trust & Verification Engine

**Design (fits existing infra):**

- `data_sources` registry table: provider, endpoint, fields, reliability score,
  last-success, error rate.
- `data_quality_events` table: every conflict/stale/missing detection logged
  with severity.
- Verification rules per domain:
  - **Fixtures:** cross-check API-Football vs The Odds API vs football-data —
    conflicting kickoff/teams → flag, prefer source with better reliability
    score; postponed/abandoned detection via status transitions.
  - **Injuries:** API-Football vs premierinjuries vs Transfermarkt — disagreement
    on status → downgrade confidence, mark `conflicted`.
  - **Odds:** cross-bookmaker outlier detection (single book 20%+ off consensus
    → suspect feed, not signal).
  - **Staleness:** every feature carries `fetched_at`; freshness SLA per
    domain (odds <6h, injuries <24h, lineups <2h); stale → excluded or
    down-weighted, never silently used.
- **Source reliability score** = rolling accuracy of that source's fields vs
  eventual ground truth (did the "injured" player actually miss? did odds
  match closing?). Feeds `data_quality_score` on every prediction.
- Hard rule already aligned: low-quality inputs **reduce** `data_quality_score`
  → can trigger abstention; they never get hidden.

## 5. Model Drift & Stability

**Detection stack:**

- **Calibration drift:** rolling ECE/Brier per market+league on settled
  predictions (weekly windows, min 100 settlements).
- **Feature drift:** PSI (population stability index) on key features
  (eloDiff, form, odds-implied prob) vs training distribution.
- **Outcome drift:** rolling accuracy vs trailing baseline — flag only beyond
  confidence interval, not single losses.
- **Concept drift:** per-league model-vs-market gap widening → league-specific
  retrain trigger.

**Response protocol (anti-overreaction):**
- Individual losses NEVER trigger changes (football variance is huge).
- Drift alert → champion/challenger experiment → walk-forward validation →
  promotion only on statistically significant out-of-sample lift →
  `model_versions` records everything → rollback path documented.
- Autocorrelation guard: require ≥4 consecutive weekly windows of degradation
  before even *proposing* a challenger.

## 6. Rollover Portfolio Risk Engine

**Current state:** `src/lib/rollover/engine.ts` does qualification gates →
~2.00 combined-odds DFS search → honest "no ticket". Backtest harness exists
(`worker/rollover-backtest.js`) but has produced no real results (no odds
history until now).

**Required additions:**

| Component | Spec |
|-----------|------|
| Combined probability | Product of leg probabilities **adjusted for correlation** — same-match markets (1X2 + OU + BTTS on one fixture) are NOT independent; use copula or empirical joint-frequency adjustment |
| Selection correlation | Explicit correlation matrix per fixture/market family; cap effective-leg-count credit |
| EV per ticket | Σ leg EVs adjusted for correlation; compare vs ~2.00 target |
| Odds movement | Prefer legs whose odds are shortening (market agreeing) vs drifting (information against) — needs retained snapshots ✅ |
| Drawdown tracking | `rollover_chains` history → max drawdown, longest losing streak, bankroll survival curves |
| Historical ticket performance | Backtest on settled predictions once sample exists |
| No-ticket rule | Already implemented — keep it sacred: target price ≠ probability |

**Statistical supportability of 2.00 rollover:** with ~50% legs at ~1.9–2.1
decimal, a 2-leg ticket at ~2.00 combined implies ~50% true win rate needed
for breakeven. Realistically achievable only if leg selection has genuine
edge; otherwise it's a coin-flip structure with variance. The engine must
report the *estimated* win probability of every ticket and refuse sub-threshold
combinations — which it does; validation comes from the backtest.

## 7. Prediction Performance & Statistical Significance

**Claims policy (adopt now):**

- Minimum sample sizes: **≥200 settled predictions** per model+market+league
  cell before quoting accuracy; **≥100** before quoting calibration metrics.
- Always report **confidence intervals** (Wilson score interval for accuracy,
  bootstrap for Brier) alongside point estimates.
- Segment reporting mandatory: by competition, market, prediction stage
  (T1/T2/T3), probability bucket, model_version.
- "High confidence" labels require the tier's *historical* hit rate with CI —
  e.g. "ELITE: 78% ± 4% (n=340)" not "90% accurate".
- Small-sample rule: n<50 → display "insufficient data", never a percentage.
- Multiple-comparison guard: testing many leagues×markets inflates false
  discoveries — require Bonferroni-style adjustment or holdout confirmation
  before declaring any cell "beat the market".

## 8. Production Reliability & Operational Risk

**Failure-mode inventory (verified/assessed):**

| Failure | Current handling | Needed |
|---------|------------------|--------|
| Provider outage | Cron try/catch → cron_runs FAILED | Add stale-data fallback: predict with last-good features + lower data_quality_score |
| Expired credentials | API errors → cron fail | Credential-health check cron + alert (cron_alerts table exists) |
| API rate limits | 429 retries in FD sync; Odds API errors throw | Per-provider budget tracking (getOddsApiUsage exists) + backoff |
| Postponed/abandoned matches | Status field exists | Settlement rules: void/postpone handling in settle cron — verify |
| Settlement corrections | Score updates via sync | Re-settlement logic + audit trail on result changes |
| Odds changes post-prediction | Snapshots timestamped | CLV computation at close; never retro-edit input_snapshot |
| Duplicate predictions | Dedup SQL + idempotency check in predict cron | Unique constraint `uq_prediction_fixture_market_selection` (in DEDUP sql) — verify applied |
| Cron overlap | `withLock` + `cron_locks` | ✅ exists |
| Silent feature loss | None | Data-quality score + abstention (P2.7) |

**Auditability:** every prediction already gets `input_snapshot` +
`feature_version` + (now) `injury_features_used` + stage label → reproducible.
Settlement writes `result`/`settled_at` — add `settled_by`/`settlement_version`
for corrections audit.

## 9. Final Strategic Assessment

**What gives ODDLY a potential predictive advantage:**
1. **Timing edge** — confirmed lineups + late injury news processed faster
   than market repricing (T2/T3 stages).
2. **Coverage edge** — leagues/books where sharp money is thin; market
   consensus is weaker → model features matter more.
3. **Structured rollover** — combining independently-validated legs into
   ~2.00 tickets with honest probability reporting (variance-managed, not
   edge-claimed).
4. **Accumulated data moat** — point-in-time snapshots + settlement history
   compound; hard for a new entrant to replicate retroactively.

**What currently prevents that advantage:**
- Empty historical DB on new project (backfill in progress)
- No odds history until the retention fix (now live going forward)
- No lineups ingestion (API-Football tier needed)
- No calibration in prod path
- No honest accuracy baseline (walk-forward broken)
- Model bugs (weight config — fixed; version sprawl remains)

**Greatest incremental value, ranked:**
1. Confirmed lineups (T2 stage) — biggest single information upgrade
2. Retained odds history → CLV + market-as-feature + line movement
3. xG integration (data already owned, just not joined)
4. Real injury/availability pipeline (wired today; needs API tier for live data)
5. Per-league gating — knowing where NOT to predict is itself an advantage

**Markets to prioritize:** Double chance > Draw-no-bet > BTTS-No > O/U extreme
lines > 1X2. **Competitions:** Big-5 + Eredivisie/Primeira Liga/UCL first;
expand only through the §2 gate scorecard.

**Is 2.00 rollover statistically supportable?** Conditioned, not guaranteed:
supportable *if* leg selection demonstrates calibrated edge and the portfolio
engine enforces correlation + no-ticket rules. Currently it is a
**structure with honest math but unproven edge** — the backtest on real
settled predictions decides. Do not market it as profitable until CLV-positive
results exist.

**Required before claiming high-confidence predictions:**
- Restored walk-forward with honest metrics per market+league
- Prod-path calibration (isotonic) live
- ≥200 settled predictions per claimed tier with CIs
- Data-quality + abstention gates live
- Tier labels show historical hit rates, not aspirations

**Experiments required before implementation of advanced items:**
- Market-as-feature: does adding vig-free consensus odds improve Brier vs
  model-only? (P4.3 gate)
- Lineup delta: T1 vs T2 accuracy improvement measurement
- Dixon-Coles vs current 1X2 on identical folds
- xG ablation: with/without on the research set
- Referee features: already shown zero lift — do not revisit without new data
