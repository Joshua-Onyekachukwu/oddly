#!/usr/bin/env node
/**
 * ODDLY Value Edge Finder — Real Odds vs Model Predictions
 * Finds genuine betting edges with positive expected value.
 */
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

const env = {};
fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf8").split("\n").forEach((l) => {
  if (l.startsWith("#") || !l.includes("=")) return;
  const idx = l.indexOf("=");
  const key = l.substring(0, idx).trim();
  let val = l.substring(idx + 1).trim();
  if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
  env[key] = val;
});
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function main() {
  console.log("ODDLY Value Edge Finder - Real Odds vs Model");
  console.log("=".repeat(65));

  // 1. Get fixture IDs that have both predictions AND odds
  const { data: predSample } = await sb.from("predictions")
    .select("fixture_id").not("model_probability", "is", null).limit(500);
  const predFids = [...new Set((predSample || []).map(p => p.fixture_id))];

  const { data: oddsSample } = await sb.from("odds_snapshots")
    .select("fixture_id").limit(500);
  const oddsFids = [...new Set((oddsSample || []).map(o => o.fixture_id))];

  const overlap = predFids.filter(f => oddsFids.includes(f));
  console.log("  Fixtures with predictions: " + predFids.length);
  console.log("  Fixtures with odds: " + oddsFids.length);
  console.log("  Fixtures with BOTH: " + overlap.length);

  if (overlap.length === 0) {
    console.log("\n  No fixtures have both predictions and odds.");
    console.log("  Run the prediction pipeline first to generate predictions for scheduled fixtures.");
    return;
  }

  // 2. Load predictions for overlapping fixtures
  const edges = [];
  const BATCH = 20;
  for (let i = 0; i < overlap.length; i += BATCH) {
    const batch = overlap.slice(i, i + BATCH);
    const { data: preds } = await sb.from("predictions")
      .select("fixture_id,market,selection,model_probability,confidence_tier")
      .in("fixture_id", batch)
      .not("model_probability", "is", null);

    const { data: odds } = await sb.from("odds_snapshots")
      .select("fixture_id,market,selection,odds")
      .in("fixture_id", batch);

    const { data: fixs } = await sb.from("fixtures")
      .select("id,home_team:teams!fixtures_home_team_id_fkey(canonical_name),away_team:teams!fixtures_away_team_id_fkey(canonical_name),kickoff_time")
      .in("id", batch);

    // Build odds map: fixtureId -> best odds per market|selection
    const oddsMap = {};
    for (const o of (odds || [])) {
      const k = o.fixture_id + "|" + o.market + "|" + o.selection;
      if (!oddsMap[k] || o.odds > oddsMap[k]) oddsMap[k] = o.odds;
    }

    // Compare each prediction against bookmaker odds
    for (const p of (preds || [])) {
      const modelProb = p.model_probability;
      if (!modelProb || modelProb <= 0.01) continue;

      // Map prediction market to odds market
      let oddsKey = null;
      if (p.market === "1X2") {
        oddsKey = p.fixture_id + "|match_result|" + p.selection.toLowerCase();
      } else if (p.market === "over_under") {
        if (p.selection.startsWith("over_")) {
          oddsKey = p.fixture_id + "|over_under_2.5|over";
        } else {
          oddsKey = p.fixture_id + "|over_under_2.5|under";
        }
      } else if (p.market === "btts") {
        oddsKey = p.fixture_id + "|BTTS|" + (p.selection === "yes" ? "Yes" : "No");
      }

      if (!oddsKey) continue;
      const bookOdds = oddsMap[oddsKey];
      if (!bookOdds || bookOdds <= 1.01) continue;

      const bookImplied = 1 / bookOdds;
      const edge = modelProb - bookImplied;
      const expectedValue = (modelProb * bookOdds) - 1;

      if (edge > 0.005) {
        const fix = (fixs || []).find(f => f.id === p.fixture_id);
        edges.push({
          fixture: ((fix?.home_team?.canonical_name || "Home") + " vs " + (fix?.away_team?.canonical_name || "Away")),
          kickoff: fix?.kickoff_time ? new Date(fix.kickoff_time).toLocaleDateString() : "TBD",
          market: p.market, selection: p.selection,
          modelProb, bookOdds, bookImplied, edge, expectedValue,
          tier: edge > 0.05 ? "ELITE" : edge > 0.03 ? "HIGH" : edge > 0.01 ? "VALUE" : "MINOR",
        });
      }
    }
  }

  edges.sort((a, b) => b.edge - a.edge);

  // Report
  const elite = edges.filter(e => e.tier === "ELITE");
  const high = edges.filter(e => e.tier === "HIGH");
  const value = edges.filter(e => e.tier === "VALUE");

  console.log("\n" + "=".repeat(65));
  console.log("  RESULTS - " + edges.length + " edges found");
  console.log("=".repeat(65));

  console.log("\n  ELITE (>5%): " + elite.length);
  console.log("  HIGH (3-5%): " + high.length);
  console.log("  VALUE (1-3%): " + value.length);

  if (edges.length > 0) {
    console.log("\n  TOP 30 EDGES:");
    console.log("  " + "-".repeat(63));
    console.log("  " + "Fixture".padEnd(26) + "Market".padEnd(8) + "Sel".padEnd(6) + "Model".padStart(6) + "Book".padStart(6) + "Edge".padStart(7) + "Odds".padStart(5) + "EV".padStart(6));
    console.log("  " + "-".repeat(63));

    for (const e of edges.slice(0, 30)) {
      const icon = e.tier === "ELITE" ? "E" : e.tier === "HIGH" ? "H" : "V";
      console.log("  " + icon + " " +
        e.fixture.slice(0, 24).padEnd(24) +
        e.market.slice(0, 7).padEnd(8) +
        e.selection.slice(0, 5).padEnd(6) +
        (e.modelProb * 100).toFixed(0).padStart(4) + "% " +
        (e.bookImplied * 100).toFixed(0).padStart(4) + "% " +
        (e.edge * 100).toFixed(1).padStart(5) + "% " +
        e.bookOdds.toFixed(2).padStart(5) + " " +
        (e.expectedValue * 100).toFixed(1).padStart(5) + "%"
      );
    }

    // Edges by market
    console.log("\n  EDGES BY MARKET:");
    const byMkt = {};
    for (const e of edges) {
      if (!byMkt[e.market]) byMkt[e.market] = { count: 0, totalEdge: 0, elite: 0 };
      byMkt[e.market].count++;
      byMkt[e.market].totalEdge += e.edge;
      if (e.tier === "ELITE") byMkt[e.market].elite++;
    }
    for (const [m, v] of Object.entries(byMkt).sort((a, b) => b[1].totalEdge / b[1].count - a[1].totalEdge / a[1].count)) {
      console.log("    " + m.padEnd(14) + v.count + " edges | avg: " + (v.totalEdge / v.count * 100).toFixed(1) + "% | elite: " + v.elite);
    }

    // ROI
    const totalROI = edges.reduce((s, e) => s + e.modelProb * e.bookOdds, 0) / edges.length * 100 - 100;
    const eliteROI = elite.length ? elite.reduce((s, e) => s + e.modelProb * e.bookOdds, 0) / elite.length * 100 - 100 : 0;
    console.log("\n  PROFIT PROJECTION:");
    console.log("    All edges (" + edges.length + "): Expected ROI: " + (totalROI > 0 ? "+" : "") + totalROI.toFixed(1) + "%");
    if (elite.length) console.log("    ELITE only (" + elite.length + "): Expected ROI: " + (eliteROI > 0 ? "+" : "") + eliteROI.toFixed(1) + "%");
  } else {
    console.log("\n  No positive edges found with current data.");
  }

  // Save
  const outPath = path.join(__dirname, "..", "data", "value-edges.json");
  fs.writeFileSync(outPath, JSON.stringify({
    generated_at: new Date().toISOString(),
    fixtures_analyzed: overlap.length,
    total_edges: edges.length,
    elite: elite.length, high: high.length, value: value.length,
    top_edges: edges.slice(0, 50),
  }, null, 2));
  console.log("\n  Saved to data/value-edges.json");
}

main().catch(console.error);
