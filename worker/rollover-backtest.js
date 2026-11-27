#!/usr/bin/env node

/**
 * ODDLY Rollover Backtest — 2-odds daily ticket replay
 *
 * Replays history day-by-day: for each calendar date it rebuilds what the
 * rollover engine (src/lib/rollover/engine.ts) WOULD have recommended using
 * ONLY information that existed before each fixture's kickoff:
 *
 *   - predictions with created_at < fixture.kickoff_time  (no future preds)
 *   - odds_snapshots with snapshot_time <= fixture.kickoff_time (closing odds)
 *
 * The best-scoring ticket per day is settled flat-stake against actual
 * scores. Days with no qualifying ticket are skipped (honest — the engine
 * never forces a ~2.00 ticket).
 *
 * Metrics reported:
 *   - days evaluated / days with ticket / days skipped
 *   - ticket hit rate (wins / tickets)
 *   - flat-stake ROI, total P&L, max drawdown (cumulative P&L)
 *   - longest win / loss streaks
 *   - per-market leg breakdown (legs won / settled / win rate)
 *
 * Usage:
 *   node worker/rollover-backtest.js [--days=90] [--start=2025-01-01]
 *                                   [--stake=1] [--max-fixtures=2000]
 *                                   [--out=docs/rollover-backtest-report.json]
 *
 * Requires .env.local (or env vars) with NEXT_PUBLIC_SUPABASE_URL and
 * SUPABASE_SERVICE_ROLE_KEY. If the DB is unreachable the script exits
 * with a clear message — it does not fabricate results.
 */

const fs = require("fs");
const path = require("path");

// ─── Load the TypeScript engine (pure module, no @/ imports) ──────────
require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "commonjs", moduleResolution: "node" },
});
const engine = require(path.join(__dirname, "..", "src", "lib", "rollover", "engine.ts"));
const { buildRolloverTickets, DEFAULT_ROLLOVER_CONFIG, canonicalMarket } = engine;

// ─── Env (same convention as other worker scripts) ─────────────────────
function loadEnv() {
  const envPath = path.join(__dirname, "..", ".env.local");
  const env = {};
  try {
    for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("=");
      if (i === -1) continue;
      let val = t.slice(i + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      env[t.slice(0, i).trim()] = val;
    }
  } catch {}
  return { ...env, ...process.env };
}

// ─── Args ──────────────────────────────────────────────────────────────
function arg(name, dflt) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=").slice(1).join("=") : dflt;
}
const DAYS = parseInt(arg("days", "90"), 10);
const START = arg("start", null); // YYYY-MM-DD
const STAKE = parseFloat(arg("stake", "1"));
const MAX_FIXTURES = parseInt(arg("max-fixtures", "3000"), 10);
const OUT = arg("out", path.join(__dirname, "..", "docs", "rollover-backtest-report.json"));

// ─── Settlement (mirrors worker/settle-predictions.js conventions,
//     adapted to the engine's canonical market/selection keys) ──────────
function settleLeg(market, selection, hs, as) {
  const total = hs + as;
  const sel = (selection || "").toLowerCase();
  switch (market) {
    case "1x2":
      if (sel === "home" && hs > as) return "won";
      if (sel === "draw" && hs === as) return "won";
      if (sel === "away" && hs < as) return "won";
      return "lost";
    case "ou": {
      const line = parseFloat(sel.split("_").pop() || "2.5");
      if (sel.startsWith("over")) return total > line ? "won" : "lost";
      if (sel.startsWith("under")) return total < line ? "won" : "lost";
      return "unknown";
    }
    case "btts":
      if (sel === "yes") return hs > 0 && as > 0 ? "won" : "lost";
      if (sel === "no") return hs === 0 || as === 0 ? "won" : "lost";
      return "unknown";
    case "dc": {
      if (sel === "1x") return hs >= as ? "won" : "lost";
      if (sel === "x2") return hs <= as ? "won" : "lost";
      if (sel === "12") return hs !== as ? "won" : "lost";
      return "unknown";
    }
    case "dnb": {
      if (hs === as) return "void"; // stake refunded
      if (sel === "home") return hs > as ? "won" : "lost";
      if (sel === "away") return hs < as ? "won" : "lost";
      return "unknown";
    }
    case "homegoals": {
      const line = parseFloat(sel.split("_").pop() || "0.5");
      return sel.startsWith("over") ? hs > line ? "won" : "lost"
           : sel.startsWith("under") ? hs < line ? "won" : "lost" : "unknown";
    }
    case "awaygoals": {
      const line = parseFloat(sel.split("_").pop() || "0.5");
      return sel.startsWith("over") ? as > line ? "won" : "lost"
           : sel.startsWith("under") ? as < line ? "won" : "lost" : "unknown";
    }
    default:
      return "unknown";
  }
}

function normSel(s) {
  return (s || "").toLowerCase().trim().replace(/[\s\-]+/g, "_");
}

// ─── Main ──────────────────────────────────────────────────────────────
async function main() {
  const env = loadEnv();
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("❌ Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (.env.local). Cannot run backtest.");
    process.exit(1);
  }
  const { createClient } = require("@supabase/supabase-js");
  const supabase = createClient(url, key);

  const now = new Date();
  const endDate = new Date(now.getTime() - 24 * 60 * 60 * 1000); // yesterday — fully settled
  const startDate = START
    ? new Date(`${START}T00:00:00.000Z`)
    : new Date(endDate.getTime() - DAYS * 24 * 60 * 60 * 1000);

  console.log(`🔁 Rollover backtest ${startDate.toISOString().slice(0, 10)} → ${endDate.toISOString().slice(0, 10)}`);
  console.log(`   stake=${STAKE} maxFixtures=${MAX_FIXTURES} engine=src/lib/rollover/engine.ts`);

  // ── 1. Load finished fixtures (paginated) ──────────────────────────
  const fixtures = [];
  let offset = 0;
  while (fixtures.length < MAX_FIXTURES) {
    const { data, error } = await supabase
      .from("fixtures")
      .select("id, kickoff_time, league_id, home_score, away_score")
      .eq("status", "finished")
      .not("home_score", "is", null)
      .gte("kickoff_time", startDate.toISOString())
      .lte("kickoff_time", endDate.toISOString())
      .order("kickoff_time", { ascending: true })
      .range(offset, offset + 999);
    if (error) { console.error("fixtures query failed:", error.message); process.exit(1); }
    if (!data || data.length === 0) break;
    fixtures.push(...data);
    offset += data.length;
    if (data.length < 1000) break;
  }
  const sliced = fixtures.slice(0, MAX_FIXTURES);
  console.log(`   ${sliced.length} finished fixtures`);
  if (sliced.length === 0) { console.log("Nothing to backtest."); return; }

  const fixtureIds = sliced.map((f) => f.id);
  const fixtureById = new Map(sliced.map((f) => [f.id, f]));

  // ── 2. Load predictions (batched by fixture chunks) ────────────────
  const predsByFixture = new Map();
  const CHUNK = 200;
  for (let i = 0; i < fixtureIds.length; i += CHUNK) {
    const chunk = fixtureIds.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from("predictions")
      .select("id, fixture_id, market, selection, model_probability, model_disagreement, data_quality_score, created_at")
      .in("fixture_id", chunk);
    if (error) { console.error("predictions query failed:", error.message); process.exit(1); }
    for (const p of data || []) {
      if (!predsByFixture.has(p.fixture_id)) predsByFixture.set(p.fixture_id, []);
      predsByFixture.get(p.fixture_id).push(p);
    }
    if ((i / CHUNK) % 5 === 0) console.log(`   predictions: ${Math.min(i + CHUNK, fixtureIds.length)}/${fixtureIds.length} fixtures`);
  }

  // ── 3. Load odds snapshots (batched) ───────────────────────────────
  const oddsByFixture = new Map(); // fixtureId -> [{market,selection,odds,snapshot_time}]
  for (let i = 0; i < fixtureIds.length; i += CHUNK) {
    const chunk = fixtureIds.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from("odds_snapshots")
      .select("fixture_id, market, selection, odds, snapshot_time, bookmaker")
      .in("fixture_id", chunk)
      .order("snapshot_time", { ascending: true });
    if (error) { console.error("odds query failed:", error.message); process.exit(1); }
    for (const o of data || []) {
      if (!oddsByFixture.has(o.fixture_id)) oddsByFixture.set(o.fixture_id, []);
      oddsByFixture.get(o.fixture_id).push(o);
    }
    if ((i / CHUNK) % 5 === 0) console.log(`   odds: ${Math.min(i + CHUNK, fixtureIds.length)}/${fixtureIds.length} fixtures`);
  }

  // ── 4. Group fixtures by UTC kickoff date ──────────────────────────
  const byDate = new Map();
  for (const f of sliced) {
    const d = f.kickoff_time.slice(0, 10);
    if (!byDate.has(d)) byDate.set(d, []);
    byDate.get(d).push(f);
  }
  const dates = [...byDate.keys()].sort();
  console.log(`   ${dates.length} distinct match days`);

  // ── 5. Day-by-day replay ───────────────────────────────────────────
  const daily = [];
  const marketLegStats = new Map(); // market -> {won, lost, void, unknown}
  let combosEvaluatedTotal = 0;

  for (const date of dates) {
    const dayFixtures = byDate.get(date);
    const candidates = [];
    let predConsidered = 0;
    let oddsAvailable = 0;

    for (const f of dayFixtures) {
      const kickoff = new Date(f.kickoff_time).getTime();

      // Latest prediction per (market,selection) created BEFORE kickoff
      const preds = (predsByFixture.get(f.id) || [])
        .filter((p) => new Date(p.created_at).getTime() < kickoff)
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      const seen = new Set();
      const latest = [];
      for (const p of preds) {
        const k = `${canonicalMarket(p.market)}|${normSel(p.selection)}`;
        if (seen.has(k)) continue;
        seen.add(k);
        latest.push(p);
      }

      // Odds: best (max) decimal odds among snapshots <= kickoff.
      // Point-in-time: only snapshots at or before kickoff are eligible.
      const oddsRows = (oddsByFixture.get(f.id) || []).filter(
        (o) => new Date(o.snapshot_time).getTime() <= kickoff
      );
      const oddsBest = new Map(); // market|sel -> {odds, bookmaker}
      for (const o of oddsRows) {
        const k = `${canonicalMarket(o.market)}|${normSel(o.selection)}`;
        const cur = oddsBest.get(k);
        if (!cur || Number(o.odds) > cur.odds) {
          oddsBest.set(k, { odds: Number(o.odds), bookmaker: o.bookmaker || null });
        }
      }

      for (const p of latest) {
        predConsidered++;
        const prob = Number(p.model_probability);
        if (!Number.isFinite(prob) || prob <= 0 || prob >= 1) continue;

        // Try direct key, then a few alias spellings
        const keys = [
          `${canonicalMarket(p.market)}|${normSel(p.selection)}`,
          `${canonicalMarket(p.market)}|${(p.selection || "").toLowerCase()}`,
        ];
        let hit = null;
        for (const k of keys) { if (oddsBest.has(k)) { hit = oddsBest.get(k); break; } }
        // alias: h2h ↔ 1x2
        if (!hit && canonicalMarket(p.market) === "1x2") {
          for (const k of [`h2h|${normSel(p.selection)}`, `1x2|${normSel(p.selection)}`]) {
            if (oddsBest.has(k)) { hit = oddsBest.get(k); break; }
          }
        }
        if (!hit || !(hit.odds > 1)) continue;
        oddsAvailable++;

        candidates.push({
          fixtureId: f.id,
          fixtureLabel: `fixture:${f.id.slice(0, 8)}`,
          kickoffTime: f.kickoff_time,
          market: p.market,
          selection: p.selection,
          modelProbability: prob,
          odds: hit.odds,
          bookmaker: hit.bookmaker,
          modelDisagreement: p.model_disagreement != null ? Number(p.model_disagreement) : null,
          dataQualityScore: p.data_quality_score != null ? Number(p.data_quality_score) : null,
          leagueId: f.league_id,
          sourceId: p.id,
        });
      }
    }

    const result = buildRolloverTickets(candidates, DEFAULT_ROLLOVER_CONFIG);
    combosEvaluatedTotal += result.combinationsEvaluated;

    const day = {
      date,
      fixtures: dayFixtures.length,
      predictionsConsidered: predConsidered,
      candidatesWithOdds: oddsAvailable,
      qualifiedCount: result.qualifiedCount,
      combinationsEvaluated: result.combinationsEvaluated,
      reason: result.reason,
      ticket: null,
      pnl: 0,
      staked: 0,
    };

    if (result.tickets.length > 0) {
      const ticket = result.tickets[0]; // best score
      // Settle every leg against actual scores
      let allWon = true;
      let anyVoid = false;
      let anyUnknown = false;
      const legResults = [];
      for (const leg of ticket.legs) {
        const fx = fixtureById.get(leg.fixtureId);
        const res = fx
          ? settleLeg(leg.market, leg.selection, fx.home_score, fx.away_score)
          : "unknown";
        legResults.push({ ...leg, result: res });
        if (res === "void") anyVoid = true;
        else if (res !== "won") { allWon = false; if (res === "unknown") anyUnknown = true; }
        // per-market stats
        const mk = leg.market;
        if (!marketLegStats.has(mk)) marketLegStats.set(mk, { won: 0, lost: 0, void: 0, unknown: 0 });
        const st = marketLegStats.get(mk);
        if (res === "won") st.won++; else if (res === "lost") st.lost++;
        else if (res === "void") st.void++; else st.unknown++;
      }

      if (anyVoid) {
        day.result = "void"; // stake refunded (conservative simplification)
      } else if (anyUnknown) {
        day.result = "unknown";
      } else if (allWon) {
        day.result = "won";
        day.staked = STAKE;
        day.pnl = STAKE * (ticket.combinedOdds - 1);
      } else {
        day.result = "lost";
        day.staked = STAKE;
        day.pnl = -STAKE;
      }

      day.ticket = {
        id: ticket.id,
        combinedOdds: ticket.combinedOdds,
        combinedProbability: ticket.combinedProbability,
        combinedEv: ticket.combinedEv,
        score: ticket.score,
        legCount: ticket.legCount,
        legs: legResults.map((l) => ({
          fixtureId: l.fixtureId,
          market: l.market,
          selection: l.selection,
          modelProbability: l.modelProbability,
          odds: l.odds,
          result: l.result,
        })),
      };
    } else {
      day.result = "no_ticket";
    }

    daily.push(day);
    if (dates.indexOf(date) % 10 === 0) {
      console.log(`   … ${date}: ${day.result} (tickets so far evaluated)`);
    }
  }

  // ── 6. Metrics ─────────────────────────────────────────────────────
  const tickets = daily.filter((d) => d.ticket);
  const settled = tickets.filter((d) => d.result === "won" || d.result === "lost");
  const wins = settled.filter((d) => d.result === "won");
  const losses = settled.filter((d) => d.result === "lost");
  const totalStaked = settled.reduce((s, d) => s + d.staked, 0);
  const totalPnl = daily.reduce((s, d) => s + d.pnl, 0);
  const totalReturn = totalStaked + totalPnl;

  // Drawdown on cumulative P&L (flat stake, chronological)
  let cum = 0, peak = 0, maxDD = 0;
  const curve = [];
  for (const d of daily) {
    cum += d.pnl;
    curve.push({ date: d.date, cumPnl: cum });
    if (cum > peak) peak = cum;
    if (peak - cum > maxDD) maxDD = peak - cum;
  }

  // Streaks (won/lost only; void/unknown/no_ticket break the run? —
  // conservative: only consecutive settled tickets count)
  let winStreak = 0, lossStreak = 0, maxWin = 0, maxLoss = 0;
  for (const d of daily) {
    if (d.result === "won") { winStreak++; lossStreak = 0; maxWin = Math.max(maxWin, winStreak); }
    else if (d.result === "lost") { lossStreak++; winStreak = 0; maxLoss = Math.max(maxLoss, lossStreak); }
    else { winStreak = 0; lossStreak = 0; }
  }

  const marketBreakdown = {};
  for (const [m, s] of marketLegStats) {
    const settledLegs = s.won + s.lost;
    marketBreakdown[m] = {
      legsWon: s.won, legsLost: s.lost, legsVoid: s.void, legsUnknown: s.unknown,
      settled: settledLegs,
      legWinRate: settledLegs > 0 ? +(s.won / settledLegs).toFixed(4) : null,
    };
  }

  const report = {
    generatedAt: new Date().toISOString(),
    window: { from: startDate.toISOString(), to: endDate.toISOString() },
    config: {
      ...DEFAULT_ROLLOVER_CONFIG,
      note: "Same thresholds as production API route. Tune via this script's outputs before changing defaults.",
    },
    assumptions: [
      "Flat stake per ticket day (default 1.0 unit).",
      "Best available decimal odds (max across bookmakers) at/before kickoff — optimistic bound.",
      "Predictions used only if created_at < kickoff_time; odds only if snapshot_time <= kickoff_time.",
      "Cross-fixture legs treated as independent (standard accumulator assumption).",
      "Same-fixture legs forbidden by engine (correlation).",
      "DNB draw = void (stake refunded); any void leg voids the ticket.",
      "Days with no qualifying ticket are skipped — no forced bets.",
    ],
    summary: {
      daysEvaluated: daily.length,
      daysWithTicket: tickets.length,
      daysSkippedNoTicket: daily.length - tickets.length,
      ticketsSettled: settled.length,
      ticketsWon: wins.length,
      ticketsLost: losses.length,
      ticketHitRate: settled.length > 0 ? +(wins.length / settled.length).toFixed(4) : null,
      totalStaked: +totalStaked.toFixed(2),
      totalPnl: +totalPnl.toFixed(2),
      totalReturn: +totalReturn.toFixed(2),
      roi: totalStaked > 0 ? +((totalReturn - totalStaked) / totalStaked).toFixed(4) : null,
      maxDrawdown: +maxDD.toFixed(2),
      longestWinStreak: maxWin,
      longestLossStreak: maxLoss,
      avgCombinedOdds: tickets.length
        ? +(tickets.reduce((s, d) => s + d.ticket.combinedOdds, 0) / tickets.length).toFixed(3)
        : null,
      avgPredictedProb: tickets.length
        ? +(tickets.reduce((s, d) => s + d.ticket.combinedProbability, 0) / tickets.length).toFixed(4)
        : null,
      combinationsEvaluatedTotal,
    },
    marketBreakdown,
    equityCurve: curve,
    daily,
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));

  // ── Console summary ────────────────────────────────────────────────
  const s = report.summary;
  console.log("\n📊 Rollover backtest complete");
  console.log("━".repeat(60));
  console.log(`   Days evaluated:        ${s.daysEvaluated}`);
  console.log(`   Days with ticket:      ${s.daysWithTicket}  (skipped ${s.daysSkippedNoTicket})`);
  console.log(`   Tickets settled:       ${s.ticketsSettled}  (W ${s.ticketsWon} / L ${s.ticketsLost})`);
  console.log(`   Hit rate:              ${s.ticketHitRate != null ? (s.ticketHitRate * 100).toFixed(1) + "%" : "n/a"}`);
  console.log(`   Avg combined odds:     ${s.avgCombinedOdds ?? "n/a"}`);
  console.log(`   Avg predicted prob:    ${s.avgPredictedProb != null ? (s.avgPredictedProb * 100).toFixed(1) + "%" : "n/a"}`);
  console.log(`   Total staked:          ${s.totalStaked}`);
  console.log(`   Total P&L:             ${s.totalPnl >= 0 ? "+" : ""}${s.totalPnl}`);
  console.log(`   ROI:                   ${s.roi != null ? (s.roi * 100).toFixed(2) + "%" : "n/a"}`);
  console.log(`   Max drawdown:          ${s.maxDrawdown}`);
  console.log(`   Streaks W/L:           ${s.longestWinStreak} / ${s.longestLossStreak}`);
  console.log(`\n   Per-market leg win rates:`);
  for (const [m, b] of Object.entries(marketBreakdown)) {
    console.log(`     ${m.padEnd(12)} ${(b.legWinRate != null ? (b.legWinRate * 100).toFixed(1) + "%" : "n/a").padStart(7)}  (${b.legsWon}W/${b.legsLost}L of ${b.settled})`);
  }
  console.log(`\n   Full report → ${OUT}`);
  console.log("   ⚠️  Simulated/hypothetical — not a profitability guarantee.");
}

main().catch((e) => {
  console.error("Backtest failed:", e);
  process.exit(1);
});
