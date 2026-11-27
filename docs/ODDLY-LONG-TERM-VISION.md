# ODDLY — Long-Term Product Vision, Revenue Strategy & Continuous Intelligence

Date: 2026-11-27. Authoritative vision document. The 2.00 rollover strategy is
ONE module of the platform — never the whole product, never allowed to distort
core probability estimates.

## 1. Complete prediction lifecycle (independent of rollover)

Collect → validate → predict (all supported competitions/markets) → persist
every prediction permanently → preserve original feature/data snapshots →
record model version + timestamp → monitor upcoming matches → retrieve and
INDEPENDENTLY verify results → settle accurately → evaluate outcomes →
identify recurring errors → run controlled experiments → promote only after
validation.

## 2. Every prediction feeds learning

Auditable record of: all predictions, per-market probabilities, original odds
+ timestamps, data/feature snapshots, model versions, actual outcomes,
settlement corrections, performance, calibration errors, historical eval.
**Never discard losing predictions; never keep only winners.**

## 3. Rollover = independent strategy module

Searches opportunities, evaluates combos, EV, risk, may recommend skip. Does
not control the prediction engine or bias probabilities. Alternative
strategies/markets continue to be evaluated.

## 4. Three-month programme

- **Month 1 — Operational foundation:** reliable system operation, complete
  data/prediction audit, automated predictions + settlements, preserved
  history, performance baselines, controlled evaluation begins.
- **Month 2 — Intelligence improvement:** wider reliable coverage, better
  player/match intelligence, new model tests, calibration, error analysis,
  validation vs production benchmark.
- **Month 3 — Evidence & expansion:** full-period assessment, best
  competitions/markets, profitability vs operating cost, autonomous-ops
  validation, next expansion roadmap.

3 months = observation milestone, NOT a profitability deadline.

## 5. Reinvestment & financial discipline

Start small; revenue may fund better data, datasets, infrastructure,
processing, research, evaluation, monitoring. Betting returns are NEVER
guaranteed funding. Strict separation: bankroll / realised profit / operating
expenses / reinvestment. Never auto-increase exposure to recover losses.

## 6. Long-term financial objective

₦20M/month is an ASPIRATION recorded here only — never hardcoded into
prediction logic, never presented as expected. Scalability of any proven edge
must be investigated: bookmaker limits, liquidity, odds availability,
execution, stake-size impact.

## 7. Beyond rollover

Continue as a broad football intelligence product: additional strategies,
market-specific intelligence, analytical tools, performance dashboards.
**The product must be useful on days with no rollover opportunity.**

## 8. Permanent separation principle

Prediction generation · prediction evaluation · model learning · opportunity
discovery · betting strategy · financial performance — six independently
measurable, auditable components. Capabilities and financial potential must
rest on accumulated data, rigorous validation, demonstrated performance —
never assumptions.

## Programme tracker (living)

| Area | Status | Owner |
|------|--------|-------|
| Lifecycle automation (predict+settle crons) | ✅ running on new DB | Devin |
| Prediction snapshots + immutable records | ✅ schema + writes live | Devin |
| Injury intelligence pipeline | ✅ wired into predict+sync crons | Devin |
| Feature store population (weights/params/profiles) | 🔄 in progress | Devin |
| Odds history retention | 🔄 in progress | Devin |
| Honest evaluation baseline (walk-forward) | 🔄 in progress | Devin |
| Rollover engine v1 (gates, ~2.00 builder, no-ticket) | ✅ code+tests | Devin |
| Rollover spec gaps (correlation, WAIT/SKIP states, tracker, sims) | 📋 spec written | Devin |
| Data backfill (fixtures/history/xG/odds) | ⏳ Month 1 | Devin |
| Calibration + market-as-feature | ⏳ Month 2 | Devin |
| Competition gating + drift detection | ⏳ Month 2 | Devin |
| Paper trading + release criteria | ⏳ Month 2/3 | Devin |
| Vercel env var update (new Supabase keys) | ⛔ blocked: needs token | User |
| API-Football plan tier (injuries/lineups) | ❓ confirm | User |
