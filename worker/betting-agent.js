#!/usr/bin/env node

/**
 * ODDLY AI Betting Agent v1.0
 *
 * Intelligent betting assistant that:
 * 1. Finds upcoming games from our database
 * 2. Runs ensemble model to get probabilities
 * 3. Compares against bookmaker odds to find value
 * 4. Builds proposed betslips with risk assessment
 * 5. Generates explanations for each selection
 *
 * Does NOT place bets — always requires user approval.
 */

const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");
const path = require("path");

// ─── Env ─────────────────────────────────────────────────────────────────
function loadEnv() {
  const envPath = path.join(__dirname, "..", ".env.local");
  const env = {};
  try {
    const lines = fs.readFileSync(envPath, "utf8").split("\n");
    for (const line of lines) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("=");
      if (i === -1) continue;
      let val = t.slice(i + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
        val = val.slice(1, -1);
      env[t.slice(0, i).trim()] = val;
    }
  } catch {}
  return env;
}

const env = loadEnv();
const supabase = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL || "",
  env.SUPABASE_SERVICE_ROLE_KEY || ""
);

function clamp(v, lo = 0.01, hi = 0.99) {
  return Math.max(lo, Math.min(hi, v));
}

// ─── Game Finder ─────────────────────────────────────────────────────────
// Finds upcoming fixtures from our database
async function findUpcomingGames(options = {}) {
  const { league, days = 3, limit = 100 } = options;

  const now = new Date();
  const cutoff = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

  let query = supabase
    .from("fixtures")
    .select(`
      id, kickoff_time, league_id, status,
      home:teams!fixtures_home_team_id_fkey(id, canonical_name, logo),
      away:teams!fixtures_away_team_id_fkey(id, canonical_name, logo),
      league:leagues!fixtures_league_id_fkey(id, name, logo)
    `)
    .eq("status", "scheduled")
    .gte("kickoff_time", now.toISOString())
    .lte("kickoff_time", cutoff.toISOString())
    .order("kickoff_time", { ascending: true })
    .limit(limit);

  if (league) {
    query = query.eq("league_id", league);
  }

  const { data: fixtures, error } = await query;
  if (error) throw new Error(`Game finder failed: ${error.message}`);

  return (fixtures || []).map((f) => ({
    id: f.id,
    homeTeam: f.home?.canonical_name || "Unknown",
    awayTeam: f.away?.canonical_name || "Unknown",
    homeLogo: f.home?.logo,
    awayLogo: f.away?.logo,
    league: f.league?.name || "Unknown",
    leagueId: f.league_id,
    kickoff: f.kickoff_time,
    kickoffLocal: new Date(f.kickoff_time).toLocaleString("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }),
  }));
}

// ─── Value Engine ────────────────────────────────────────────────────────
// Compares model probabilities against bookmaker odds
async function analyzeValue(fixtures, options = {}) {
  const { minEdge = 0.03, includeOdds = true } = options;

  // Get predictions for these fixtures
  const fixtureIds = fixtures.map((f) => f.id);

  const { data: predictions } = await supabase
    .from("predictions")
    .select("fixture_id, market, selection, model_probability, confidence, model_version")
    .in("fixture_id", fixtureIds)
    .not("model_probability", "is", null);

  // Get odds for these fixtures
  let oddsMap = {};
  if (includeOdds && fixtureIds.length > 0) {
    const { data: odds } = await supabase
      .from("odds_snapshots")
      .select("fixture_id, market, selection, odds")
      .in("fixture_id", fixtureIds);

    for (const o of odds || []) {
      if (!oddsMap[o.fixture_id]) oddsMap[o.fixture_id] = {};
      const key = `${o.market}|${o.selection}`;
      if (!oddsMap[o.fixture_id][key]) oddsMap[o.fixture_id][key] = [];
      oddsMap[o.fixture_id][key].push(o.odds);
    }

    // Average odds
    for (const fid of Object.keys(oddsMap)) {
      for (const key of Object.keys(oddsMap[fid])) {
        const arr = oddsMap[fid][key];
        oddsMap[fid][key] = arr.reduce((s, v) => s + v, 0) / arr.length;
      }
    }
  }

  // Build value analysis for each fixture
  const analyses = [];

  for (const fixture of fixtures) {
    const preds = (predictions || []).filter((p) => p.fixture_id === fixture.id);
    const odds = oddsMap[fixture.id] || {};

    // Market mappings
    const MARKETS = {
      "1X2": { Home: "home", Draw: "draw", Away: "away" },
      "BTTS": { Yes: "btts_yes", No: "btts_no" },
      "OU": { "Over_2.5": "over_25", "Under_2.5": "under_25" },
      "DC": { "1X": "dc_1x", "X2": "dc_x2", "12": "dc_12" },
    };

    const valuePicks = [];

    for (const [marketType, selections] of Object.entries(MARKETS)) {
      for (const [label, oddsKey] of Object.entries(selections)) {
        const pred = preds.find(
          (p) => p.market === marketType && p.selection === label.split("_")[0]
        );
        if (!pred || !pred.model_probability) continue;

        const modelProb = pred.model_probability;
        const bookOdds = odds[`${marketType}|${label}`] || odds[oddsKey] || 0;

        if (bookOdds <= 0) continue;

        const impliedProb = 1 / bookOdds;
        const edge = modelProb - impliedProb;
        const ev = (modelProb * bookOdds - 1);
        const kellyFraction = edge > 0 ? edge / (bookOdds - 1) : 0;

        if (edge >= minEdge) {
          const tier =
            edge >= 0.10 ? "ELITE" :
            edge >= 0.07 ? "HIGH" :
            edge >= 0.05 ? "VALUE" :
            "WATCH";

          valuePicks.push({
            market: marketType,
            selection: label,
            modelProbability: Math.round(modelProb * 1000) / 10,
            bookmakerOdds: Math.round(bookOdds * 100) / 100,
            impliedProbability: Math.round(impliedProb * 1000) / 10,
            edge: Math.round(edge * 1000) / 10,
            expectedValue: Math.round(ev * 1000) / 10,
            kellyFraction: Math.round(kellyFraction * 1000) / 10,
            confidence: pred.confidence || "medium",
            tier,
            reasoning: generateReasoning(fixture, pred, modelProb, bookOdds, edge),
          });
        }
      }
    }

    if (valuePicks.length > 0) {
      analyses.push({
        fixture,
        valuePicks: valuePicks.sort((a, b) => b.edge - a.edge),
        bestPick: valuePicks.sort((a, b) => b.edge - a.edge)[0],
      });
    }
  }

  // Sort by best edge
  analyses.sort((a, b) => b.bestPick.edge - a.bestPick.edge);

  return analyses;
}

// ─── Reasoning Generator ─────────────────────────────────────────────────
function generateReasoning(fixture, pred, modelProb, bookOdds, edge) {
  const reasons = [];

  if (modelProb > 0.65) {
    reasons.push(`Strong model confidence (${(modelProb * 100).toFixed(1)}%)`);
  } else if (modelProb > 0.55) {
    reasons.push(`Moderate model confidence (${(modelProb * 100).toFixed(1)}%)`);
  }

  if (edge > 0.08) {
    reasons.push(`Significant edge of ${(edge * 100).toFixed(1)}% over market`);
  } else if (edge > 0.05) {
    reasons.push(`Good edge of ${(edge * 100).toFixed(1)}% over market`);
  }

  if (bookOdds > 2.5) {
    reasons.push(`Attractive odds at ${bookOdds.toFixed(2)}`);
  }

  const implied = 1 / bookOdds;
  if (modelProb - implied > 0.05) {
    reasons.push(
      `Model sees ${(modelProb * 100).toFixed(0)}% probability vs market's ${(implied * 100).toFixed(0)}%`
    );
  }

  return reasons.length > 0 ? reasons.join(". ") + "." : "Edge detected from model-market discrepancy.";
}

// ─── Betslip Builder ─────────────────────────────────────────────────────
// Builds a proposed betslip from selected value picks
function buildBetslip(selections, options = {}) {
  const {
    stake = 1000,
    maxLegs = 10,
    minTotalOdds = 1.5,
    maxTotalOdds = 50,
    bookmaker = "sportybet",
  } = options;

  if (!selections || selections.length === 0) {
    return { error: "No selections provided" };
  }

  if (selections.length > maxLegs) {
    return { error: `Maximum ${maxLegs} legs allowed. Got ${selections.length}.` };
  }

  // Validate each selection
  const validatedSelections = [];
  const warnings = [];

  for (const sel of selections) {
    if (!sel.fixture || !sel.market || !sel.selection || !sel.odds) {
      warnings.push(`Skipped invalid selection: ${JSON.stringify(sel)}`);
      continue;
    }

    validatedSelections.push({
      fixture: sel.fixture,
      market: sel.market,
      selection: sel.selection,
      odds: sel.odds,
      modelProbability: sel.modelProbability,
      edge: sel.edge,
      tier: sel.tier,
      reasoning: sel.reasoning,
    });
  }

  if (validatedSelections.length === 0) {
    return { error: "No valid selections", warnings };
  }

  // Calculate combined odds
  const combinedOdds = validatedSelections.reduce((acc, s) => acc * s.odds, 1);

  // Validate combined odds
  if (combinedOdds < minTotalOdds) {
    warnings.push(`Combined odds ${combinedOdds.toFixed(2)} below minimum ${minTotalOdds}`);
  }
  if (combinedOdds > maxTotalOdds) {
    warnings.push(`Combined odds ${combinedOdds.toFixed(2)} above maximum ${maxTotalOdds}`);
  }

  // Calculate risk metrics
  const combinedProb = validatedSelections.reduce((acc, s) => acc * s.modelProbability / 100, 1);
  const potentialReturn = stake * combinedOdds;
  const profit = potentialReturn - stake;
  const avgEdge = validatedSelections.reduce((s, v) => s + v.edge, 0) / validatedSelections.length;

  // Risk assessment
  const riskLevel =
    validatedSelections.length >= 8 ? "HIGH" :
    validatedSelections.length >= 5 ? "MEDIUM" :
    "LOW";

  // Kelly stake suggestion (fractional Kelly for safety)
  const kellyStake = validatedSelections.length === 1
    ? Math.round(stake * validatedSelections[0].edge / (validatedSelections[0].odds - 1) * 0.25)
    : Math.round(stake * avgEdge / (combinedOdds - 1) * 0.25);

  const betslip = {
    id: `slip_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    bookmaker,
    selections: validatedSelections,
    summary: {
      totalLegs: validatedSelections.length,
      combinedOdds: Math.round(combinedOdds * 100) / 100,
      stake,
      potentialReturn: Math.round(potentialReturn * 100) / 100,
      profit: Math.round(profit * 100) / 100,
      combinedProbability: Math.round(combinedProb * 1000) / 10,
      avgEdge: Math.round(avgEdge * 100) / 10,
      riskLevel,
      kellyStake: Math.max(100, Math.min(kellyStake, stake)),
    },
    warnings,
    status: "pending_review",
  };

  return betslip;
}

// ─── Booking Code Generator ──────────────────────────────────────────────
// Generates a booking code representation (actual integration requires API key)
function generateBookingCode(betslip, bookmaker = "sportybet") {
  // In production, this would call Convert Bet Codes API or Betloy
  // For MVP, we generate a structured representation

  const code = {
    bookmaker,
    betslipId: betslip.id,
    selections: betslip.selections.map((s) => ({
      match: s.fixture,
      market: s.market,
      selection: s.selection,
      odds: s.odds,
    })),
    combinedOdds: betslip.summary.combinedOdds,
    // Placeholder for actual booking code
    bookingCode: null,
    instructions: `Open ${bookmaker.charAt(0).toUpperCase() + bookmaker.slice(1)} app and add these selections manually.`,
    deepLink: null, // Would be generated by bookmaker API
  };

  return code;
}

// ─── Risk Assessment ─────────────────────────────────────────────────────
function assessRisk(betslip, userLimits = {}) {
  const {
    maxStake = 10000,
    maxDailyExposure = 50000,
    maxBetsPerDay = 5,
    minEdgeRequired = 0.03,
  } = userLimits;

  const risks = [];
  const { summary, selections } = betslip;

  if (summary.stake > maxStake) {
    risks.push({
      level: "BLOCK",
      message: `Stake ₦${summary.stake} exceeds maximum ₦${maxStake}`,
    });
  }

  if (summary.stake > maxStake * 0.5) {
    risks.push({
      level: "WARNING",
      message: `High stake: ₦${summary.stake} (${Math.round((summary.stake / maxStake) * 100)}% of max)`,
    });
  }

  if (summary.riskLevel === "HIGH") {
    risks.push({
      level: "WARNING",
      message: `${selections.length} legs — higher risk of one leg failing`,
    });
  }

  const lowEdgeSelections = selections.filter((s) => s.edge < minEdgeRequired * 100);
  if (lowEdgeSelections.length > 0) {
    risks.push({
      level: "INFO",
      message: `${lowEdgeSelections.length} selection(s) below minimum edge threshold`,
    });
  }

  if (summary.combinedProbability < 5) {
    risks.push({
      level: "WARNING",
      message: `Combined probability only ${summary.combinedProbability}% — very unlikely to win`,
    });
  }

  return {
    approved: risks.filter((r) => r.level === "BLOCK").length === 0,
    risks,
    riskScore: Math.min(100,
      (selections.length * 8) +
      (summary.riskLevel === "HIGH" ? 30 : summary.riskLevel === "MEDIUM" ? 15 : 0) +
      (summary.stake > maxStake * 0.7 ? 20 : 0) +
      (summary.combinedProbability < 10 ? 15 : 0)
    ),
  };
}

// ─── Audit Trail ─────────────────────────────────────────────────────────
async function logAgentAction(userId, action, data) {
  try {
    await supabase.from("agent_audit_log").insert({
      user_id: userId,
      action,
      selections: data.selections || null,
      odds_captured: data.oddsCaptured || null,
      booking_code: data.bookingCode || null,
      bookmaker: data.bookmaker || null,
      model_probability: data.modelProbability || null,
      edge: data.edge || null,
      stake: data.stake || null,
      potential_return: data.potentialReturn || null,
      status: data.status || "pending",
    });
  } catch (err) {
    console.error("Audit log error:", err.message);
  }
}

// ─── CLI Mode ────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || "find";

  console.log("🤖 ODDLY AI Betting Agent v1.0");
  console.log("━".repeat(55));

  switch (command) {
    case "find": {
      console.log("\n📋 Finding upcoming games with value...");
      const games = await findUpcomingGames({ days: 3, limit: 50 });
      console.log(`   Found ${games.length} upcoming fixtures\n`);

      for (const g of games.slice(0, 20)) {
        console.log(`   ${g.kickoffLocal} | ${g.league.padEnd(18)} | ${g.homeTeam} vs ${g.awayTeam}`);
      }
      break;
    }

    case "analyze": {
      console.log("\n🔍 Analyzing value across upcoming matches...");
      const games = await findUpcomingGames({ days: 3, limit: 100 });
      const analyses = await analyzeValue(games, { minEdge: 0.03 });

      console.log(`\n   Found value in ${analyses.length} matches:\n`);

      for (const a of analyses.slice(0, 15)) {
        const best = a.bestPick;
        console.log(`   🔥 ${a.fixture.homeTeam} vs ${a.fixture.awayTeam}`);
        console.log(`      Best: ${best.selection} @ ${best.bookmakerOdds} | Edge: ${best.edge}% | EV: ${best.expectedValue}%`);
        console.log(`      Model: ${best.modelProbability}% vs Market: ${best.impliedProbability}%`);
        console.log(`      ${best.reasoning}`);
        console.log("");
      }
      break;
    }

    case "betslip": {
      console.log("\n🎰 Building betslip from top value picks...");
      const games = await findUpcomingGames({ days: 3, limit: 100 });
      const analyses = await analyzeValue(games, { minEdge: 0.05 });

      if (analyses.length === 0) {
        console.log("   No value picks found. Try lowering minEdge.");
        break;
      }

      // Take top 3-5 picks for the betslip
      const topPicks = analyses.slice(0, Math.min(5, analyses.length)).map((a) => ({
        fixture: `${a.fixture.homeTeam} vs ${a.fixture.awayTeam}`,
        market: `${a.bestPick.market} - ${a.bestPick.selection}`,
        selection: a.bestPick.selection,
        odds: a.bestPick.bookmakerOdds,
        modelProbability: a.bestPick.modelProbability,
        edge: a.bestPick.edge,
        tier: a.bestPick.tier,
        reasoning: a.bestPick.reasoning,
      }));

      const slip = buildBetslip(topPicks, { stake: 2000 });

      if (slip.error) {
        console.log(`   ❌ ${slip.error}`);
        break;
      }

      console.log(`\n   📝 Betslip: ${slip.id}`);
      console.log(`   Bookmaker: ${slip.bookmaker}`);
      console.log(`   Legs: ${slip.summary.totalLegs}`);
      console.log(`   Combined Odds: ${slip.summary.combinedOdds}`);
      console.log(`   Stake: ₦${slip.summary.stake}`);
      console.log(`   Potential Return: ₦${slip.summary.potentialReturn}`);
      console.log(`   Profit: ₦${slip.summary.profit}`);
      console.log(`   Risk: ${slip.summary.riskLevel}`);
      console.log(`   Avg Edge: ${slip.summary.avgEdge}%`);
      console.log("");

      for (const sel of slip.selections) {
        console.log(`   ${sel.fixture}`);
        console.log(`     ${sel.market} @ ${sel.odds} | Edge: ${sel.edge}%`);
        console.log(`     ${sel.reasoning}`);
        console.log("");
      }

      const risk = assessRisk(slip);
      console.log(`   Risk Assessment: ${risk.approved ? "✅ APPROVED" : "❌ BLOCKED"}`);
      console.log(`   Risk Score: ${risk.riskScore}/100`);
      for (const r of risk.risks) {
        console.log(`   ${r.level}: ${r.message}`);
      }

      // Save slip
      const slipPath = path.join(__dirname, "..", "data", `betslip-${slip.id}.json`);
      fs.writeFileSync(slipPath, JSON.stringify(slip, null, 2));
      console.log(`\n   Saved to ${slipPath}`);
      break;
    }

    default:
      console.log("   Usage: node betting-agent.js [find|analyze|betslip]");
  }

  console.log(`\n${"━".repeat(55)}`);
  console.log("✅ Done!");
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { findUpcomingGames, analyzeValue, buildBetslip, assessRisk, generateBookingCode, logAgentAction };
