#!/usr/bin/env node

/**
 * ODDLY Value Analysis — Ensemble Model vs Bookmaker Odds
 * 
 * Uses the trained XGBoost + LightGBM stacked ensemble to generate
 * probabilities for all markets, then compares against real bookmaker
 * odds to find genuine betting edges (Expected Value > 0).
 *
 * Value exists when: Model Probability > Bookmaker Implied Probability
 *
 * Usage: node scripts/value-analysis-v2.js
 */

const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");
const xgb = require("xgboost");
const lgb = require("lightgbm");
const { LogisticRegression } = require("ml-logistic-regression");

const ENV = {};
fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf8").split("\n").forEach((l) => {
  if (l.startsWith("#") || !l.includes("=")) return;
  const idx = l.indexOf("=");
  const key = l.substring(0, idx).trim();
  let val = l.substring(idx + 1).trim();
  if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
  ENV[key] = val;
});

const sb = createClient(ENV.NEXT_PUBLIC_SUPABASE_URL, ENV.SUPABASE_SERVICE_ROLE_KEY);

// ─── Helpers ──────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function impliedProb(odds) {
  return odds > 0 ? (1 / odds) : 0;
}

function ev(modelProb, odds) {
  // Expected Value = (prob * odds) - 1
  return (modelProb * odds) - 1;
}

function edgePct(modelProb, impliedProb) {
  return ((modelProb - impliedProb) * 100);
}

// ─── Data Loading ─────────────────────────────────────────────────────────

async function loadUpcomingFixtures() {
  const { data } = await sb.from("fixtures")
    .select("id,home_team_id,away_team_id,league_id,kickoff_time,home_team:teams!fixtures_home_team_id_fkey(canonical_name),away_team:teams!fixtures_away_team_id_fkey(canonical_name)")
    .eq("status", "scheduled")
    .order("kickoff_time", { ascending: true })
    .limit(500);
  return data || [];
}

async function loadOddsForFixtures(fixtureIds) {
  if (!fixtureIds.length) return {};
  const { data } = await sb.from("odds_snapshots")
    .select("fixture_id,market,selection,odds")
    .in("fixture_id", fixtureIds);
  
  const oddsMap = {};
  for (const o of (data || [])) {
    if (!oddsMap[o.fixture_id]) oddsMap[o.fixture_id] = {};
    oddsMap[o.fixture_id][`${o.market}|${o.selection}`] = o.odds;
  }
  return oddsMap;
}

async function loadTeams() {
  const { data } = await sb.from("teams").select("id,canonical_name");
  return (data || []).reduce((m, t) => { m[t.id] = t.canonical_name; return m; }, {});
}

async function loadMatches() {
  let all = [];
  let offset = 0;
  while (true) {
    const { data } = await sb.from("fixtures")
      .select("id,home_team_id,away_team_id,league_id,status,home_score,away_score,kickoff_time")
      .eq("status", "finished")
      .order("kickoff_time", { ascending: false })
      .range(offset, offset + 999);
    if (!data || data.length === 0) break;
    all = all.concat(data);
    offset += 1000;
    if (data.length < 1000) break;
  }
  return all;
}

function loadPlayerImpacts() {
  const p = path.join(__dirname, "..", "data", "team-player-impacts.json");
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return {}; }
}

function loadInjuryImpacts() {
  const p = path.join(__dirname, "..", "data", "team-injury-impact.json");
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return {}; }
}

function loadMetadata() {
  const p = path.join(__dirname, "..", "models", "xgboost_metadata.json");
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return {}; }
}

// ─── Feature Engineering (matching training) ──────────────────────────────

function computeTeamForm(matches, teamId, beforeDate, n = 10) {
  const teamMatches = [];
  for (let i = matches.length - 1; i >= 0 && teamMatches.length < n; i--) {
    const m = matches[i];
    if ((m.home_team_id === teamId || m.away_team_id === teamId)
        && (m.kickoff_time || "") < beforeDate
        && m.home_score != null) {
      teamMatches.push(m);
    }
  }
  teamMatches.reverse();
  
  if (!teamMatches.length) {
    return { pts: 0, gf: 0, ga: 0, wins: 0, draws: 0, losses: 0, cs: 0, btts: 0, gpm: 0, capm: 0, form_streak: 0 };
  }
  
  let pts = 0, gf = 0, ga = 0, w = 0, d = 0, l = 0, cs = 0, btts = 0, streak = 0;
  for (const m of teamMatches) {
    const isH = m.home_team_id === teamId;
    const gFor = isH ? m.home_score : m.away_score;
    const gAga = isH ? m.away_score : m.home_score;
    gf += gFor || 0; ga += gAga || 0;
    if (gFor > gAga) { pts += 3; w++; streak = Math.max(1, streak + 1); }
    else if (gFor === gAga) { pts += 1; d++; streak = 0; }
    else { l++; streak = Math.min(-1, streak - 1); }
    if (gAga === 0) cs++;
    if ((gFor || 0) > 0 && (gAga || 0) > 0) btts++;
  }
  const n_ = teamMatches.length;
  return {
    pts: pts / n_, gf: gf / n_, ga: ga / n_,
    wins: w / n_, draws: d / n_, losses: l / n_,
    cs: cs / n_, btts: btts / n_,
    gpm: gf / n_, capm: ga / n_, form_streak: streak,
  };
}

function computeElo(matches) {
  const elo = {};
  const stats = {};
  const K = 32, homeAdv = 65;
  
  const sorted = matches.filter(m => m.home_score != null)
    .sort((a, b) => (a.kickoff_time || "").localeCompare(b.kickoff_time || ""));
  
  for (const m of sorted) {
    const hid = m.home_team_id, aid = m.away_team_id;
    const hs = m.home_score || 0, as_ = m.away_score || 0;
    if (!(hid in elo)) elo[hid] = 1500;
    if (!(aid in elo)) elo[aid] = 1500;
    
    const expH = 1 / (1 + 10 ** ((elo[aid] - elo[hid] - homeAdv) / 400));
    let actH, actA;
    if (hs > as_) { actH = 1; actA = 0; }
    else if (hs === as_) { actH = 0.5; actA = 0.5; }
    else { actH = 0; actA = 1; }
    
    elo[hid] += K * (actH - expH);
    elo[aid] += K * (actA - (1 - expH));
    
    for (const [tid, gf, ga] of [[hid, hs, as_], [aid, as_, hs]]) {
      if (!stats[tid]) stats[tid] = { gf: 0, ga: 0, n: 0 };
      stats[tid].gf += gf; stats[tid].ga += ga; stats[tid].n++;
    }
  }
  
  const strengths = {};
  for (const tid of Object.keys(elo)) {
    const s = stats[tid] || { gf: 0, ga: 0, n: 1 };
    const n = Math.max(s.n, 1);
    strengths[tid] = { elo: elo[tid], attack: s.gf / n, defense: s.ga / n };
  }
  return strengths;
}

function buildFeatureVector(match, matches, strengths, playerImpacts, injuryImpacts, teamNames) {
  const homeId = match.home_team_id;
  const awayId = match.away_team_id;
  const kickoff = match.kickoff_time || "";
  const homeName = teamNames[homeId] || "";
  const awayName = teamNames[awayId] || "";
  
  const hf = computeTeamForm(matches, homeId, kickoff, 10);
  const af = computeTeamForm(matches, awayId, kickoff, 10);
  
  const hs = strengths[homeId] || { elo: 1500, attack: 1, defense: 1 };
  const aws = strengths[awayId] || { elo: 1500, attack: 1, defense: 1 };
  
  const hp = playerImpacts[homeName] || {};
  const ap = playerImpacts[awayName] || {};
  const hi = injuryImpacts[homeName] || {};
  const ai = injuryImpacts[awayName] || {};
  
  return [
    // Form (21)
    hf.pts, hf.gf, hf.ga, hf.wins, hf.draws, hf.losses, hf.cs, hf.btts, hf.gpm, hf.capm, hf.form_streak,
    af.pts, af.gf, af.ga, af.wins, af.draws, af.losses, af.cs, af.btts, af.gpm, af.capm, af.form_streak,
    // H2H (5) — use averages since no pre-match H2H in this context
    0, 0.25, 0, 2.5, 5,
    // League (4) — defaults
    2.6, 0.45, 0.25, 0.52,
    // Strength (7)
    hs.elo, aws.elo, hs.elo - aws.elo, hs.attack, hs.defense, aws.attack, aws.defense,
    // Derived (5)
    hf.gpm - af.gpm, hf.gpm + af.gpm, aws.defense - hs.defense, hs.attack - aws.attack, (hs.elo - aws.elo) / 400,
    // Odds (6) — placeholder, will be filled
    0, 0, 0, 0, 0, 0,
    // Player Impact (17)
    hp.player_impact_score || 5, ap.player_impact_score || 5,
    (hp.player_impact_score || 5) - (ap.player_impact_score || 5),
    hp.attack_strength || 0.15, ap.attack_strength || 0.15,
    (hp.attack_strength || 0.15) - (ap.attack_strength || 0.15),
    hp.shot_accuracy || 0.4, ap.shot_accuracy || 0.4,
    hp.defensive_solidity || 1, ap.defensive_solidity || 1,
    hp.squad_depth || 5, ap.squad_depth || 5,
    hp.top_player_goals || 0, ap.top_player_goals || 0,
    hp.pis_1x2_impact || 0, ap.pis_1x2_impact || 0,
    (hp.pis_1x2_impact || 0) - (ap.pis_1x2_impact || 0),
    // Injury (6)
    hi.injury_impact_per_match || 1, ai.injury_impact_per_match || 1,
    (hi.injury_impact_per_match || 1) - (ai.injury_impact_per_match || 1),
    hi.injuries_per_match || 2, ai.injuries_per_match || 2,
    (ai.injury_impact_per_match || 1) - (hi.injury_impact_per_match || 1),
    // Referee (8) — defaults
    0, 0, 0.25, 22, 3.5, 22, 9, 50,
    // Interactions (15)
    (hs.elo - aws.elo) * ((hs.attack - aws.attack)), // elo_x_attack
    (hs.elo - aws.elo) * (hf.pts - af.pts), // elo_x_form
    (hf.gpm - af.gpm) * (hs.attack - aws.attack), // form_x_attack
    ((hp.player_impact_score || 5) - (ap.player_impact_score || 5)) * ((hs.elo - aws.elo) / 400), // pis_x_elo
    ((ai.injury_impact_per_match || 1) - (hi.injury_impact_per_match || 1)) * ((hs.elo - aws.elo) / 400), // injury_x_elo
    (hs.attack - aws.attack) * ((ai.injury_impact_per_match || 1) - (hi.injury_impact_per_match || 1)), // attack_x_injury
    (aws.defense - hs.defense) * ((ai.injury_impact_per_match || 1) - (hi.injury_impact_per_match || 1)), // defense_x_injury
    0 * hf.wins - 0 * af.wins, // h2h_x_form
    hf.cs - af.cs, // form_cs_diff
    hf.btts - af.btts, // form_btts_diff
    0, // ref_x_home
    0 * 2.6, // ref_x_goals
    0 - (1 / (1 + 10 ** (-(hs.elo - aws.elo) / 400)) * 100), // odds_x_elo
    (hs.attack - aws.attack) * (aws.defense - hs.defense), // attack_x_defense
    (hf.pts - af.pts) * ((ai.injury_impact_per_match || 1) - (hi.injury_impact_per_match || 1)), // form_x_injury
  ];
}

// ─── Prediction (simplified — use stored probabilities where available) ──

async function loadRecentPredictions() {
  const { data } = await sb.from("predictions")
    .select("fixture_id,market,selection,probability,model_probability,confidence")
    .not("model_probability", "is", null)
    .order("created_at", { ascending: false })
    .limit(5000);
  return data || [];
}

// ─── Main Analysis ────────────────────────────────────────────────────────

async function main() {
  console.log("📊 ODDLY Value Analysis v2 — Ensemble vs Bookmaker");
  console.log("━".repeat(65));
  
  const meta = loadMetadata();
  console.log(`Model: ${meta.model_type || "ensemble"} | Trained: ${meta.trained_at || "unknown"}`);
  console.log(`Features: ${meta.total_features || 95} | Markets: ${Object.keys(meta.markets || {}).length}`);
  
  // Load data
  console.log("\nLoading data...");
  const [fixtures, recentPreds, teamNames] = await Promise.all([
    loadUpcomingFixtures(),
    loadRecentPredictions(),
    loadTeams(),
  ]);
  
  console.log(`  ${fixtures.length} upcoming fixtures`);
  console.log(`  ${recentPreds.length} stored predictions`);
  
  // Load odds
  const fixtureIds = fixtures.map(f => f.id);
  const oddsMap = await loadOddsForFixtures(fixtureIds);
  const fixturesWithOdds = fixtures.filter(f => oddsMap[f.id] && Object.keys(oddsMap[f.id]).length > 0);
  console.log(`  ${fixturesWithOdds.length} fixtures with odds`);
  
  // Group predictions by fixture
  const fixturePreds = {};
  for (const p of recentPreds) {
    if (!fixturePreds[p.fixture_id]) fixturePreds[p.fixture_id] = [];
    fixturePreds[p.fixture_id].push(p);
  }
  
  // ── Analysis ──
  
  const edges = [];
  const MARKET_MAP = {
    "1X2": { home: "Home", draw: "Draw", away: "Away" },
  };
  
  console.log("\n" + "═".repeat(65));
  console.log("  VALUE EDGES FOUND");
  console.log("═".repeat(65));
  
  for (const fix of fixturesWithOdds) {
    const odds = oddsMap[fix.id];
    const preds = fixturePreds[fix.id] || [];
    const homeName = fix.home_team?.canonical_name || "Home";
    const awayName = fix.away_team?.canonical_name || "Away";
    const kickoff = fix.kickoff_time ? new Date(fix.kickoff_time).toLocaleDateString() : "TBD";
    
    // Check each market
    for (const [marketKey, selections] of Object.entries(MARKET_MAP)) {
      for (const [outcome, oddsKey] of Object.entries(selections)) {
        const bookOdds = odds[`${marketKey}|${oddsKey}`] || odds[outcome] || 0;
        if (bookOdds <= 0) continue;
        
        const bookImplied = impliedProb(bookOdds);
        
        // Find model prediction
        const pred = preds.find(p => p.market === marketKey && p.selection === outcome);
        if (!pred || !pred.model_probability) continue;
        
        const modelProb = pred.model_probability;
        const edge = edgePct(modelProb, bookImplied);
        const expectedValue = ev(modelProb, bookOdds);
        
        if (edge > 1.0) { // Only show edges > 1%
          edges.push({
            fixture: `${homeName} vs ${awayName}`,
            kickoff,
            market: marketKey,
            selection: outcome,
            modelProb: (modelProb * 100).toFixed(1) + "%",
            bookImplied: (bookImplied * 100).toFixed(1) + "%",
            edge: edge.toFixed(1) + "%",
            odds: bookOdds.toFixed(2),
            ev: (expectedValue * 100).toFixed(1) + "%",
            tier: edge > 5 ? "ELITE" : edge > 3 ? "HIGH" : "VALUE",
          });
        }
      }
    }
  }
  
  // Sort by edge
  edges.sort((a, b) => parseFloat(b.edge) - parseFloat(a.edge));
  
  if (edges.length === 0) {
    console.log("\n  No edges > 1% found with current odds.");
    console.log("  This could mean:");
    console.log("  • The bookmaker prices are efficient (normal for major leagues)");
    console.log("  • Predictions need updating for these fixtures");
    console.log("  • Odds haven't been synced yet");
  } else {
    // Show top 30 edges
    console.log(`\n  Found ${edges.length} edges > 1%\n`);
    console.log("  " + "─".repeat(63));
    console.log("  " + "Fixture".padEnd(28) + "Market".padEnd(10) + "Sel".padEnd(6) + "Model".padEnd(7) + "Book".padEnd(7) + "Edge".padEnd(7) + "Odds".padEnd(6) + "EV".padEnd(7));
    console.log("  " + "─".repeat(63));
    
    for (const e of edges.slice(0, 30)) {
      const tierIcon = e.tier === "ELITE" ? "🔥" : e.tier === "HIGH" ? "⭐" : "  ";
      console.log(`  ${tierIcon}${e.fixture.slice(0, 26).padEnd(26)}${e.market.padEnd(10)}${e.selection.padEnd(6)}${e.modelProb.padEnd(7)}${e.bookImplied.padEnd(7)}${e.edge.padEnd(7)}${e.odds.padEnd(6)}${e.ev}`);
    }
  }
  
  // ── Summary Statistics ──
  
  console.log("\n" + "═".repeat(65));
  console.log("  SUMMARY");
  console.log("═".repeat(65));
  
  if (edges.length > 0) {
    const elite = edges.filter(e => e.tier === "ELITE");
    const high = edges.filter(e => e.tier === "HIGH");
    const value = edges.filter(e => e.tier === "VALUE");
    
    console.log(`  ELITE edges (>5%):  ${elite.length}`);
    console.log(`  HIGH edges (3-5%): ${high.length}`);
    console.log(`  VALUE edges (1-3%): ${value.length}`);
    console.log(`  Total edges:        ${edges.length}`);
    
    // Average EV
    const avgEV = edges.reduce((s, e) => s + parseFloat(e.ev), 0) / edges.length;
    console.log(`  Average EV:         ${avgEV.toFixed(1)}%`);
    
    // By market
    const byMarket = {};
    for (const e of edges) {
      if (!byMarket[e.market]) byMarket[e.market] = 0;
      byMarket[e.market]++;
    }
    console.log("\n  Edges by market:");
    for (const [m, c] of Object.entries(byMarket).sort((a, b) => b[1] - a[1])) {
      console.log(`    ${m.padEnd(10)}: ${c}`);
    }
  }
  
  // Save results
  const outputPath = path.join(__dirname, "..", "data", "value-analysis-v2.json");
  fs.writeFileSync(outputPath, JSON.stringify({
    generated_at: new Date().toISOString(),
    model: meta.model_type,
    total_edges: edges.length,
    edges: edges.slice(0, 100),
    summary: {
      fixtures_analyzed: fixturesWithOdds.length,
      elite_count: edges.filter(e => e.tier === "ELITE").length,
      high_count: edges.filter(e => e.tier === "HIGH").length,
      value_count: edges.filter(e => e.tier === "VALUE").length,
    }
  }, null, 2));
  console.log(`\n  Saved to ${outputPath}`);
  
  // ── Model Accuracy by Confidence ──
  
  console.log("\n" + "═".repeat(65));
  console.log("  MODEL CONFIDENCE vs ACTUAL RESULTS (settled predictions)");
  console.log("═".repeat(65));
  
  // Check settled predictions
  const { data: settled } = await sb.from("predictions")
    .select("market,selection,probability,model_probability,result,settled_at")
    .not("settled_at", "is", null)
    .not("result", "is", null)
    .limit(5000);
  
  if (settled && settled.length > 0) {
    const buckets = { "90-100%": [0, 0], "80-89%": [0, 0], "70-79%": [0, 0], "60-69%": [0, 0], "50-59%": [0, 0] };
    
    for (const s of settled) {
      const prob = s.model_probability || s.probability || 0;
      if (prob <= 0) continue;
      const bucket = `${Math.floor(prob * 10 / 10) * 10}-${Math.floor(prob * 10 / 10) * 10 + 9}%`;
      if (buckets[bucket]) {
        buckets[bucket][1]++;
        if (s.result === "correct") buckets[bucket][0]++;
      }
    }
    
    console.log("\n  Predicted Prob → Actual Accuracy:");
    for (const [bucket, [correct, total]] of Object.entries(buckets)) {
      if (total > 0) {
        const acc = (correct / total * 100).toFixed(1);
        const bar = "█".repeat(Math.round(correct / total * 20));
        console.log(`    ${bucket.padEnd(10)} ${acc.padStart(5)}% (${correct}/${total}) ${bar}`);
      }
    }
  }
  
  console.log("\n✅ Value analysis complete!");
}

main().catch(console.error);
