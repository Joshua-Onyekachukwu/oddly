# ODDLY — Rollover Intelligence Engine Spec

Date: 2026-10-02. Authoritative requirements for the 2.00-odds daily rollover
system. Scenario: ₦1,000 starting bankroll; monthly ambition ≥10 successful
rollovers, 21 as stretch — **targets, not quotas**. Central principle: maximize
quality/probability of opportunities, not ticket count.

## 1. Engine scope

Dedicated engine on top of the central prediction infrastructure:

- Scans ALL supported competitions and markets (not a hand-picked match list)
- Per-fixture: multiple markets, individual probabilities, model-vs-odds
  comparison, implied probabilities, bookmaker margins, EV
- Lineup/injury/availability/tactical/data-quality/market-movement inputs
- Correlation-aware combined-ticket probability (never blind multiplication)
- Searches broadly (thousands of combos where practical), ranks by
  statistical quality AND value
- Outputs WAIT when key info missing; SKIP when nothing qualifies
- Re-evaluates when new fixtures/odds/lineups arrive

Constraint: only markets with sufficient reliable data + model validation.

## 2. Combination search (~2.00 target)

- Single leg ≈2.00; 2+ legs mixed odds; 3+ when justified; same-match
  correlated markets (only with proper joint model); cross-competition and
  cross-kickoff combos
- Per combo evaluate: calibrated probs, combined prob (correlation-adjusted),
  actual odds, EV, comparable-selection history, model uncertainty,
  data quality, settlement/execution risk
- **Highest-probability ≠ best-value** — optimize the joint objective, don't
  force the price

## 3. Multi-dimensional qualification

Separate, non-interchangeable scores per selection:

| Score | Meaning |
|-------|---------|
| Predicted probability | calibrated P(outcome) |
| Model confidence | reliability of estimate (validation, uncertainty) |
| Data quality | freshness/completeness of inputs |
| Expected value | odds vs estimated probability |

Qualification inputs: calibrated prob, market history, competition reliability,
model agreement/uncertainty, data completeness, lineup certainty, odds
reliability, market-implied prob, EV, correlation, comparable-opportunity
history. No manufactured 90%+ claims; model agreement alone ≠ confidence.

## 4. Daily decision process

Every evaluation → **QUALIFIED / WAIT / SKIP**.

- QUALIFIED: meets probability + data-quality + validation + risk + execution
- WAIT: promising but missing confirmed lineups/injury updates/reliable odds
- SKIP: nothing meets minimums — never forced; skipped days are NOT failures
- Re-scan triggers: new fixtures, odds updates, lineup confirmations

## 5. Monthly performance tracker (dashboard)

Track: initial/current bankroll, growth, wins/losses/skips/qualified/placed,
ticket+leg odds, estimated combined prob, settlement, EV, P&L, competition/
market/model-version/data-quality breakdowns, qualification/rejection reasons.
Views: monthly, weekly, streaks, max losing streak, max drawdown, avg odds,
avg calibrated prob, progress to 10/21 targets.

**Rules:** targets shown as ambitions not guarantees; paper/simulated/unplaced
tickets NEVER count as real-money successes.

## 6. Opportunity discovery

- Systematic scan: all competitions → all fixtures → supported markets
- Prioritize leagues by demonstrated model performance (not popularity)
- Filter unreliable-data competitions via the §2 competition gate scorecard
- Detect correlated/redundant selections; compare alternative combos
- Rankings update as info changes
- **Record rejected opportunities** — audit whether filters are too strict
- Allocate analytical attention where models actually perform best

## 7. Realistic simulations

Using out-of-sample data + realistic odds:

- P(≥10 rollovers/month), P(≥21), expected qualified/skipped counts
- P(ticket loss), expected bankroll under staking variants
- Worst-case drawdowns, losing sequences, correlation impact
- Bookmaker limits, odds drift between analysis→execution, margins/settlement
- Skipped days modeled separately from placed bets
- Calibration uncertainty + model-performance variance included
- Threshold sweeps: win-prob vs opportunity count vs EV vs frequency vs risk
- Output: most defensible strategy per evidence — not the most aggressive

## 8. Bankroll protection & execution

- Configurable starting balance (default ₦1,000) and staking rules
- Track real available bankroll; NEVER auto-escalate stakes after losses;
  NEVER auto-replenish
- Max exposure limits; record actual stakes/returns; bookmaker limits +
  execution costs accounted
- **Manual approval required for real-money execution**
- Recommended ≠ placed — always distinguished
- Paper-trading mode mandatory before real deployment
- Evaluate full-bankroll vs partial staking on evidence — compounding is not
  assumed optimal
- User retains all real-money decisions

## 9. Continuous strategy evaluation

Track per-market/per-competition/per-model-version/per-combo performance;
whether high-prob picks actually hit; whether market disagreement helps;
whether lineup-waiting improves results; correlation hotspots; whether
filters reject too much or too little.

Changes only via controlled experiments + chronological validation +
champion/challenger — never after individual losses; distinguish variance
from deterioration.

## 10. Evidence-based release criteria (real money)

All required: substantial chronological backtest · out-of-sample validation ·
market-specific calibration · competition-specific reports · realistic odds/
settlement assumptions · correlation-aware combos · paper-trading period ·
independently verified settlement · documented bankroll risk assessment ·
non-overfit evidence.

Prediction quality and profitability reported SEPARATELY. 10 or 21 wins in a
small sample ≠ approval. Performance must hold across periods/market
conditions.

## 11. Status vs current implementation

| Requirement | Status |
|-------------|--------|
| Qualification gates + ~2.00 DFS builder + honest no-ticket | ✅ `src/lib/rollover/engine.ts` + 28 tests |
| Recommendation API + `/rollover` UI section | ✅ `/api/v1/rollover/recommendation`, page wired |
| Correlation-aware joint probability | ⚠️ partial — needs copula/empirical adjustment (spec §2) |
| Multi-score qualification (prob/confidence/quality/EV separate) | ⚠️ partial — scores exist, need formal separation |
| QUALIFIED/WAIT/SKIP daily decision + rescan triggers | ❌ needs decision-state model + scheduled re-eval |
| Monthly tracker dashboard | ⚠️ `/rollover` shows chains; needs full §5 metrics |
| Broad opportunity discovery across competitions | ⚠️ engine scans fixtures; needs market/league prioritization |
| Rejected-opportunity log | ❌ needs table + recording |
| Monte Carlo bankroll simulation (§7) | ⚠️ `worker/rollover-backtest.js` exists; needs realistic-odds runs + threshold sweeps |
| Bankroll controls + paper trading + manual approval | ⚠️ chains exist; staking/execution controls needed |
| Continuous strategy evaluation | ❌ needs experiment tracking per §9 |
| Release criteria pipeline | ❌ gates documented; needs enforcement |

**Next implementation steps (ordered):**
1. Correlation model for same-fixture legs (empirical joint frequencies from
   settled predictions once sample exists; conservative independence discount
   until then)
2. Rejected-opportunity logging table + QUALIFIED/WAIT/SKIP decision record
3. Monthly tracker metrics on `/rollover` (bankroll, streaks, drawdown,
   targets progress)
4. Realistic-odds backtest run once odds history accumulates (retention fix
   is live as of today)
5. Paper-trading mode + manual-approval flag on ticket placement
