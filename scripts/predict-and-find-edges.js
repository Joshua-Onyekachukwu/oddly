#!/usr/bin/env node
/**
 * ODDLY Predict & Find Edges
 * 
 * 1. Load trained XGBoost models (Node.js xgboost bindings)
 * 2. Build features for each scheduled fixture
 * 3. Generate probabilities
 * 4. Compare against real bookmaker odds
 * 5. Find genuine value edges
 *
 * Since we can't load XGBoost models in pure Node.js easily,
 * we'll use the existing predictions from Supabase and generate
 * new ones via the ensemble logic in Python.
 *
 * For now, use the stored predictions and match them against odds.
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
  console.log("ODDLY Predict & Find Edges");
  console.log("=".repeat(65));

  // 1. Get scheduled fixtures with odds
  const { data: scheduled } = await sb.from("fixtures")
    .select("id,home_team_id,away_team_id,league_id,kickoff_time")
    .eq("status", "scheduled").limit(300);
  console.log("  Scheduled fixtures: " + (scheduled || []).length);

  // 2. Get odds for scheduled fixtures
  const schedIds = (scheduled || []).map(f => f.id);
  const { data: odds } = await sb.from("odds_snapshots")
    .select("fixture_id,market,selection,odds")
    .in("fixture_id", schedIds);
  console.log("  Odds records: " + (odds || []).length);

  // Best odds per fixture/market/selection
  const bestOdds = {};
  for (const o of (odds || [])) {
    const k = o.fixture_id + "|" + o.market + "|" + o.selection;
    if (!bestOdds[k] || o.odds > bestOdds[k]) bestOdds[k] = o.odds;
  }
  const fixWithOdds = [...new Set((odds || []).map(o => o.fixture_id))];
  console.log("  Fixtures with odds: " + fixWithOdds.length);

  // 3. Get existing predictions for these fixtures
  const { data: preds } = await sb.from("predictions")
    .select("fixture_id,market,selection,model_probability")
    .in("fixture_id", fixWithOdds)
    .not("model_probability", "is", null);
  console.log("  Predictions with model_probability: " + (preds || []).length);

  // 4. Build prediction map
  const predMap = {};
  for (const p of (preds || [])) {
    const k = p.fixture_id + "|" + p.market + "|" + p.selection;
    if (!predMap[k] || (p.model_probability || 0) > (predMap[k].model_probability || 0)) {
      predMap[k] = p;
    }
  }

  // 5. Find edges
  const edges = [];
  for (const [key, pred] of Object.entries(predMap)) {
    const [fid, market, selection] = key.split("|");
    const modelProb = pred.model_probability;
    if (!modelProb || modelProb <= 0.01) continue;

    // Map to odds
    let oddsKey = null;
    if (market === "1X2") {
      oddsKey = fid + "|match_result|" + selection.toLowerCase();
    } else if (market === "over_under") {
      if (selection.startsWith("over_")) {
        oddsKey = fid + "|over_under_2.5|over";
      } else if (selection.startsWith("under_")) {
        oddsKey = fid + "|over_under_2.5|under";
      }
    } else if (market === "btts") {
      oddsKey = fid + "|BTTS|" + (selection === "yes" ? "Yes" : "No");
    }

    if (!oddsKey) continue;
    const bookOdds = bestOdds[oddsKey];
    if (!bookOdds || bookOdds <= 1.01) continue;

    const bookImplied = 1 / bookOdds;
    const edge = modelProb - bookImplied;
    const ev = (modelProb * bookOdds) - 1;

    if (edge > 0.005) {
      const fix = (scheduled || []).find(f => f.id === fid);
      edges.push({
        market, selection, modelProb, bookOdds, bookImplied, edge, ev,
        tier: edge > 0.05 ? "ELITE" : edge > 0.03 ? "HIGH" : edge > 0.01 ? "VALUE" : "MINOR",
        fixtureId: fid,
      });
    }
  }

  edges.sort((a, b) => b.edge - a.edge);

  const elite = edges.filter(e => e.tier === "ELITE");
  const high = edges.filter(e => e.tier === "HIGH");
  const value = edges.filter(e => e.tier === "VALUE");

  console.log("\n" + "=".repeat(65));
  console.log("  RESULTS - " + edges.length + " edges from " + fixWithOdds.length + " fixtures");
  console.log("=".repeat(65));

  console.log("\n  ELITE (>5%): " + elite.length);
  console.log("  HIGH (3-5%): " + high.length);
  console.log("  VALUE (1-3%): " + value.length);

  if (edges.length > 0) {
    console.log("\n  TOP 30 EDGES:");
    console.log("  " + "-".repeat(60));
    for (const e of edges.slice(0, 30)) {
      const icon = e.tier === "ELITE" ? "E" : e.tier === "HIGH" ? "H" : "V";
      console.log("  " + icon + " " +
        e.market.padEnd(12) + e.selection.padEnd(10) +
        (e.modelProb * 100).toFixed(0).padStart(4) + "% " +
        (e.bookImplied * 100).toFixed(0).padStart(4) + "% " +
        (e.edge * 100).toFixed(1).padStart(5) + "% " +
        e.bookOdds.toFixed(2).padStart(5) + " " +
        (e.ev * 100).toFixed(1).padStart(5) + "%"
      );
    }

    // Edges by market
    console.log("\n  EDGES BY MARKET:");
    const byMkt = {};
    for (const e of edges) {
      if (!byMkt[e.market]) byMkt[e.market] = { count: 0, totalEdge: 0 };
      byMkt[e.market].count++;
      byMkt[e.market].totalEdge += e.edge;
    }
    for (const [m, v] of Object.entries(byMkt).sort((a, b) => b[1].totalEdge / b[1].count - a[1].totalEdge / a[1].count)) {
      console.log("    " + m.padEnd(14) + v.count + " edges | avg: " + (v.totalEdge / v.count * 100).toFixed(1) + "%");
    }

    // ROI
    const totalROI = edges.reduce((s, e) => s + e.modelProb * e.bookOdds, 0) / edges.length * 100 - 100;
    const eliteROI = elite.length ? elite.reduce((s, e) => s + e.modelProb * e.bookOdds, 0) / elite.length * 100 - 100 : 0;
    console.log("\n  PROFIT PROJECTION:");
    console.log("    All edges (" + edges.length + "): Expected ROI: " + (totalROI > 0 ? "+" : "") + totalROI.toFixed(1) + "%");
    if (elite.length) console.log("    ELITE (" + elite.length + "): Expected ROI: " + (eliteROI > 0 ? "+" : "") + eliteROI.toFixed(1) + "%");
  } else {
    console.log("\n  No positive edges found.");
    console.log("  This means model probabilities closely match bookmaker prices.");
    console.log("  To find edges, we need to improve model accuracy beyond market efficiency.");
  }

  // Save
  const outPath = path.join(__dirname, "..", "data", "value-edges.json");
  fs.writeFileSync(outPath, JSON.stringify({
    generated_at: new Date().toISOString(),
    fixtures_with_odds: fixWithOdds.length,
    total_edges: edges.length,
    elite: elite.length, high: high.length, value: value.length,
    top_edges: edges.slice(0, 50),
  }, null, 2));
  console.log("\n  Saved to data/value-edges.json");
}

main().catch(console.error);
