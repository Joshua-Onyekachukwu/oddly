# ODDLY — Decisions & Open Questions

**Date:** 2026-11-26

---

## Decisions needed before/during Phase A

### D1 — Odds data provider (BLOCKS Phase B/D — highest leverage)
The Odds API free quota was exhausted in Aug; value/rollover/CLV/market-implied features are all starved.
Options:
- **A:** Paid The Odds API (~$30–60/mo for usable quota)
- **B:** API-Football odds endpoint (check coverage/limits on your key)
- **C:** OddsPortal scraping (free, fragile, ToS risk)
- **D:** Combination: API-Football primary + Odds API secondary
**Recommendation:** D if budget allows; otherwise B. *Need: budget approval + key verification.*

### D2 — Convex: keep or fold?
Convex now holds only a slim realtime schema (livePick, valuePicks, settlementFeed, liveStats, leagues, teams). Options:
- Keep Convex for realtime subscriptions (works today)
- Fold into Supabase Realtime (one less vendor, simpler ops)
**Recommendation:** Keep for now (working), revisit post-migration; record ADR.

### D3 — New Supabase only, or dual-write transition?
User mandated new project. Confirm: hard cutover (env flip) vs parallel-run period. **Recommendation:** parallel-run 7 days during M3 verification, then cutover.

### D4 — Dixon-Coles priority
Not implemented anywhere. It's the most defensible upgrade for 1X2/DC draw bias. Approve as Phase C task? **Recommendation:** yes, after calibration layer (C1).

### D5 — Subscription/billing launch timing
Stripe routes exist but disabled in env example. Launch with core product or defer? **Recommendation:** defer gating until after Phase E core proven; keep code dormant.

### D6 — Trezo templates
`/Trezo` contains 3 unused Next.js template packs. Adopt components selectively during UI redesign, or delete folder? Affects repo cleanliness.

### D7 — Worker scripts sprawl
~90 scripts in `scripts/` + `worker/`, many one-off research/migration tools. Plan: archive to `scripts/archive/` or `research/` with README; keep only scheduled/active ones. Approve cleanup?

### D8 — Nigerian betting-agent scope
`docs/BETTING-AGENT-RESEARCH.md` explores booking codes for Bet9ja/SportyBet/BetKing. Is this a real product goal or research-only? Affects Phase G.

### D9 — User accounts & rollover chains
Current `/rollover` is user-managed chains. New engine produces daily tickets — do we keep user chains as a feature, replace with engine tickets, or both? **Recommendation:** engine tickets primary; user chains optional later.

### D10 — Data compliance
Scraping Transfermarkt/OddsPortal/Understat may violate ToS. Confirm risk appetite; prefer official APIs where feasible.

## Verified-correct decisions worth keeping (ADRs)

- Supabase as system of record + versioned migrations (reinforced by new-project mandate).
- Ensemble-of-specialists over single model (meta-ensemble architecture validated by design).
- Walk-forward/no-leakage validation as the only honest metric.
- Append-only settlement + cron locks + idempotent writes.
- Slim Convex for realtime only.

## Risks register (top)

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Odds data stays too sparse for backtest | High | High | Decide D1 early; define minimum-viable odds coverage |
| Snapshot persistence breaks predict cron perf | Med | Med | Batch insert; snapshot once per fixture-run not per market |
| Model accuracy claims remain unverifiable | Med | High | A4 re-baseline before any public claims |
| Migration loses historical predictions | Low | Critical | M0 backup + row-count reconciliation + spot checks |
| Scope creep (G-phase features) delays core | High | Med | Hard gate: G starts only after D6 honest backtest |
| Dual-engine confusion persists | Med | Med | A6/C6 formal retirement |
