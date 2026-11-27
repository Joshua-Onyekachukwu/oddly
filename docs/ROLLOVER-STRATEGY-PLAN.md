# ODDLY — 2-Odds Daily Rollover Master Plan

**Date:** 2026-11-26 · Status: PLAN — **no rollover engine exists today**

---

## 1. Current Reality

- `/rollover` page = user-managed compounding chains (`rollover_chains`, `rollover_picks`) + manual "Won/Lost" buttons + picks drawn from a `recommendations` table.
- `recommendations` rows are produced by value-bet logic (`/api/v1/value-bets`, `worker/betting-agent.js`) — **not** by a dedicated ~2.00-odds qualification engine.
- No combination search, no correlation analysis, no EV thresholding, no backtest, no daily auto-generated ticket, no rollover performance tracking.
- The user's stated #1 strategic objective is therefore **unimplemented**.

## 2. What the Engine Must Do (target design)

### Stage 1 — Candidate generation (daily, T-24h→T-2h window)

For every fixture in window × every supported market:
- model probability `p` (calibrated, per-market)
- best available decimal odds `o` (freshest snapshot, best bookmaker)
- implied prob `1/o`, overround-adjusted where multi-outcome
- `EV = p·o − 1`; `edge = p − 1/o`

### Stage 2 — Qualification (all must pass)

| Check | Threshold (initial, tune via backtest) |
|---|---|
| Calibrated probability | ≥ market-specific minimum (e.g. ≥0.55 for O/U, ≥0.50 for 1X2 longshots) |
| EV | > 0 with margin for error (e.g. EV ≥ +3%) |
| Data quality score | ≥ threshold (completeness + freshness) |
| Model agreement | sub-models don't disagree wildly (disagreement < cap) |
| Odds freshness | snapshot ≤ 2h old at selection |
| Market liquidity | odds from ≥1 liquid bookmaker; prefer consensus |
| League reliability | league's historical calibration acceptable |
| Correlation group | same fixture = same group; same league same-day = soft correlation |

Thresholds are **fitted on walk-forward history**, never guessed.

### Stage 3 — Combination construction

- Goal: combined decimal odds ≈ **2.00** (acceptable band e.g. 1.90–2.10, configurable).
- Search: rank qualified candidates by EV·confidence; greedy + local search over combinations; legs may span fixtures and markets.
- Combined probability: `Π pᵢ` adjusted by pairwise correlation factor (same-match legs are perfectly correlated on shared outcomes — e.g. "over 2.5" + "BTTS yes" on same match are NOT independent; handle via joint-outcome estimation from the goals grid, or forbid same-fixture legs initially).
- Combined EV and variance reported; reject if combined prob < required win-rate for sustainability.

### Stage 4 — Output

- `rollover_tickets` row: date, legs (fixture/market/selection/odds/prob each), combined_odds, combined_prob, EV, qualification rationale per leg, snapshot refs.
- User-facing card explains WHY each leg qualified. If nothing qualifies → explicit "NO QUALIFYING OPPORTUNITY TODAY" (never force a ticket).

## 3. Backtest Protocol (before any profitability claim)

- Data: historical fixtures + odds snapshots at T-24h/T-2h + settled results. **Requires odds history** — currently the weakest dataset; backtest may be limited until odds ingestion is fixed.
- Method: walk-forward, chronological; simulate daily ticket construction with point-in-time data only.
- Assumptions: take best available odds (optimistic) AND worst-case (pessimistic) bounds; account for overround, selection limits, odds movement between snapshot and bet placement.
- Metrics: daily completion rate, ticket win rate, cumulative ROI, max drawdown, losing-streak distribution, CLV of selections, comparison vs baselines (random ~2.0 picks, single-market picks, market-implied picks).
- Report with confidence intervals and honest verdict: a 2.00 ticket needs >50% true combined probability to profit; quantify whether the model's calibrated probabilities support that after margin.

## 4. Performance Tracking

- Per-leg and per-ticket settlement (extend `prediction_settlements`).
- Track: win rate vs predicted combined prob (calibration of the TICKET, not just legs), ROI, drawdown, streaks, CLV.
- Model accuracy, market ROI, and rollover success reported **independently**.

## 5. Build sequence

1. Odds ingestion fix (prerequisite — see DATA-INTELLIGENCE-PLAN).
2. Snapshot persistence (PE-1) — rollover must reference exact inputs.
3. Candidate generator + qualification service (`worker/rollover-engine.js` or API service).
4. Combination search + correlation handling.
5. Daily cron (`/api/v1/cron/rollover`) writing `rollover_tickets`.
6. User UI: today's ticket card + qualification explanations + history.
7. Backtest harness + first honest report.
8. Admin: rollover management, threshold tuning, performance dashboards.

## 6. Honest Risks

- **Odds data sparsity** may make backtest statistically weak — report n and uncertainty.
- Bookmaker margin means ~2.00 combined odds typically implies <50% true probability; the strategy only works if model `p` exceeds implied `1/o` consistently (positive CLV) — that is the actual hypothesis to validate.
- Correlation is the silent killer of accumulator strategies; same-fixture legs must use joint probabilities, not naive multiplication.
- Do NOT present simulated returns as real; label everything hypothetical until live forward-tracking accumulates ≥100 tickets.
