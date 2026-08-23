#!/usr/bin/env node

/**
 * ODDLY Value Analysis — Model vs Bookmaker Odds
 * 
 * For every prediction, compare our model probability against the
 * bookmaker's implied probability to find genuine edge.
 * 
 * Value exists when: Model Probability > Bookmaker Implied Probability
 * 
 * Usage: node scripts/value-analysis.js
 */

const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");
const path = require("path");

function loadEnv() {
  const env = {};
  const envPath = path.join(__dirname, "..", ".env.local");
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    let val = t.slice(i + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
      val = val.slice(1, -1);
    env[t.slice(0, i).trim()] = val;
  }
  return env;
}

const env = loadEnv();
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

// Map prediction market+selection to odds market+selection
// Odds API uses: 1X2 (Home/Draw/Away), match_result (home/away/draw),
//   over_under_2.5 (over/under), Over/Under 2.5 (Over/Under), BTTS (Yes/No)
// Predictions use: 1X2 (Home/Draw/Away), OU (Over_X.X/Under_X.X), BTTS (Yes/No)
const ODDS_MATCH = {
  // odds_market + odds_selection → prediction_market + prediction_selection
  "1X2|Home": { pred: "1X2", sel: "Home" },
  "1X2|Draw": { pred: "1X2", sel: "Draw" },
  "1X2|Away": { pred: "1X2", sel: "Away" },
  "match_result|home": { pred: "1X2", sel: "Home" },
  "match_result|draw": { pred: "1X2", sel: "Draw" },
  "match_result|away": { pred: "1X2", sel: "Away" },
  "Over/Under 2.5|Over": { pred: "OU", sel: "Over_2.5" },
  "Over/Under 2.5|Under": { pred: "OU", sel: "Under_2.5" },
  "over_under_2.5|over": { pred: "OU", sel: "Over_2.5" },
  "over_under_2.5|under": { pred: "OU", sel: "Under_2.5" },
  "BTTS|Yes": { pred: "BTTS", sel: "Yes" },
  "BTTS|No": { pred: "BTTS", sel: "No" },
  "btts|yes": { pred: "BTTS", sel: "Yes" },
  "btts|no": { pred: "BTTS", sel: "No" },
};

function clamp(v, lo = 0.01, hi = 0.99) { return Math.max(lo, Math.min(hi, v)); }

async function main() {
  console.log("📊 ODDLY Value Analysis: Model vs Bookmaker");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  
  // First find fixtures that have odds (much smaller set)
  const { data: oddsFixtures } = await sb
    .from("odds_snapshots")
    .select("fixture_id")
    .limit(5000);
  const oddsFixtureIds = [...new Set((oddsFixtures || []).map(o => o.fixture_id))];
  console.log(`📋 ${oddsFixtureIds.length} fixtures with odds available`);
  
  // Load those fixtures
  const { data: fixtures } = await sb
    .from("fixtures")
    .select("id, home_team_id, away_team_id, kickoff_time, status, leagues(name)")
    .in("id", oddsFixtureIds)
    .order("kickoff_time", { ascending: true });
  
  console.log(`📋 ${fixtures?.length || 0} fixtures loaded`);
  
  const fixtureIds = (fixtures || []).map(f => f.id);
  
  // Load predictions for these fixtures
  const { data: predictions } = await sb
    .from("predictions")
    .select("fixture_id, market, selection, model_probability, confidence_lower, confidence_upper, confidence_tier")
    .in("fixture_id", fixtureIds);
  
  // Load odds
  const { data: oddsData } = await sb
    .from("odds_snapshots")
    .select("fixture_id, market, selection, odds")
    .in("fixture_id", fixtureIds);
  
  // Build odds lookup: fixture|pred_market|pred_selection → best odds
  const oddsMap = {};
  for (const o of oddsData || []) {
    const match = ODDS_MATCH[`${o.market}|${o.selection}`];
    if (match) {
      const key = `${o.fixture_id}|${match.pred}|${match.sel}`;
      if (!oddsMap[key]) oddsMap[key] = [];
      oddsMap[key].push(o.odds);
    }
    // Also store raw for fallback
    const rawKey = `${o.fixture_id}|${o.market}|${o.selection}`;
    if (!oddsMap[rawKey]) oddsMap[rawKey] = [];
    oddsMap[rawKey].push(o.odds);
  }
  
  // Build teams lookup
  const { data: teams } = await sb.from("teams").select("id, canonical_name, logo");
  const teamMap = {};
  for (const t of teams || []) teamMap[t.id] = t;
  
  // Build fixture lookup
  const fixtureMap = {};
  for (const f of fixtures || []) fixtureMap[f.id] = f;
  
  // Build predictions by fixture
  const predsByFixture = {};
  for (const p of predictions || []) {
    if (!predsByFixture[p.fixture_id]) predsByFixture[p.fixture_id] = [];
    predsByFixture[p.fixture_id].push(p);
  }
  
  // Analyze value
  const allValues = [];
  const seenPreds = new Set();
  let totalPredictions = 0;
  let valueCount = 0;
  
  for (const fixture of fixtures || []) {
    const preds = predsByFixture[fixture.id] || [];
    const home = teamMap[fixture.home_team_id]?.canonical_name || "Home";
    const away = teamMap[fixture.away_team_id]?.canonical_name || "Away";
    const league = fixture.leagues?.name || "Unknown";
    
    for (const pred of preds) {
      totalPredictions++;
      const dedupKey = `${fixture.id}|${pred.market}|${pred.selection}`;
      if (seenPreds.has(dedupKey)) continue;
      seenPreds.add(dedupKey);
      
      // Look up odds for this prediction
      const oddsKey = `${fixture.id}|${pred.market}|${pred.selection}`;
      const oddsValues = oddsMap[oddsKey] || [];
      
      if (oddsValues.length === 0) continue;
      
      if (oddsValues.length === 0) continue;
      
      // Get best (highest) odds
      const bestOdds = Math.max(...oddsValues);
      const impliedProb = (1 / bestOdds) * 100;
      const modelProb = pred.model_probability * 100;
      const edge = modelProb - impliedProb;
      
      // Expected value: (model_prob × odds) - 1
      const ev = (pred.model_probability * bestOdds) - 1;
      
      // Kelly criterion fraction
      const kelly = bestOdds > 0 ? ((pred.model_probability * bestOdds - 1) / (bestOdds - 1)) : 0;
      
      if (edge > 0) {
        valueCount++;
        allValues.push({
          fixture: `${home} vs ${away}`,
          league,
          market: pred.market,
          selection: pred.selection,
          modelProb: modelProb.toFixed(1),
          impliedProb: impliedProb.toFixed(1),
          edge: edge.toFixed(1),
          odds: bestOdds.toFixed(2),
          ev: ev.toFixed(3),
          kelly: Math.max(0, kelly).toFixed(3),
          tier: pred.confidence_tier,
          kickoff: fixture.kickoff_time,
        });
      }
    }
  }
  
  // Sort by edge (highest first)
  allValues.sort((a, b) => parseFloat(b.edge) - parseFloat(a.edge));
  
  // Display results
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`📊 Value Analysis Results`);
  console.log(`   Total predictions analyzed: ${totalPredictions}`);
  console.log(`   Predictions with positive edge: ${valueCount} (${(valueCount/totalPredictions*100).toFixed(1)}%)`);
  
  // Tier breakdown
  const tiers = {};
  for (const v of allValues) {
    if (!tiers[v.tier]) tiers[v.tier] = [];
    tiers[v.tier].push(v);
  }
  
  console.log(`\n   By Confidence Tier:`);
  for (const [tier, picks] of Object.entries(tiers).sort((a, b) => b[1].length - a[1].length)) {
    console.log(`     ${tier}: ${picks.length} picks`);
  }
  
  // Top 30 value picks
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`🏆 Top 30 Value Picks (by edge)\n`);
  console.log(['Match'.padEnd(40), 'Selection'.padEnd(20), 'Model%'.padEnd(8), 'Book%'.padEnd(8), 'Edge%'.padEnd(8), 'Odds'.padEnd(6), 'EV'.padEnd(6), 'Tier'.padEnd(10)].join(' '));
  console.log("-".repeat(110));
  for (const v of allValues.slice(0, 30)) {
    const match = v.fixture.length > 38 ? v.fixture.slice(0, 36) + ".." : v.fixture;
    console.log(
      `${match.padEnd(40)} ${v.selection.padEnd(20)} ${(v.modelProb+"%").padEnd(8)} ${(v.impliedProb+"%").padEnd(8)} ${(v.edge+"%").padEnd(8)} ${v.odds.padEnd(6)} ${v.ev.padEnd(6)} ${v.tier.padEnd(10)}`
    );
  }
  
  // Market breakdown
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`📈 Value by Market\n`);
  
  const byMarket = {};
  for (const v of allValues) {
    const key = v.selection;
    if (!byMarket[key]) byMarket[key] = { count: 0, avgEdge: 0, avgOdds: 0 };
    byMarket[key].count++;
    byMarket[key].avgEdge += parseFloat(v.edge);
    byMarket[key].avgOdds += parseFloat(v.odds);
  }
  
  const marketEntries = Object.entries(byMarket)
    .map(([k, v]) => ({ market: k, count: v.count, avgEdge: (v.avgEdge / v.count).toFixed(1), avgOdds: (v.avgOdds / v.count).toFixed(2) }))
    .sort((a, b) => b.count - a.count);
  
  console.log(['Market'.padEnd(25), 'Picks'.padEnd(8), 'Avg Edge'.padEnd(12), 'Avg Odds'.padEnd(10)].join(' '));
  console.log("-".repeat(60));
  for (const m of marketEntries) {
    console.log(`${m.market.padEnd(25)} ${String(m.count).padEnd(8)} ${(m.avgEdge+"%").padEnd(12)} ${m.avgOdds.padEnd(10)}`);
  }
  
  // Golden picks (ELITE + positive EV)
  const golden = allValues.filter(v => v.tier === "ELITE" && parseFloat(v.ev) > 0.05);
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`👑 Golden Picks (ELITE + EV > 5%): ${golden.length}\n`);
  
  for (const v of golden.slice(0, 15)) {
    console.log(`  ⭐ ${v.fixture} | ${v.selection} | Model: ${v.modelProb}% | Odds: ${v.odds} | Edge: ${v.edge}% | EV: ${v.ev}`);
  }
  
  // Save to JSON
  const output = {
    timestamp: new Date().toISOString(),
    totalPredictions,
    valueCount,
    goldenPicks: golden.length,
    topPicks: allValues.slice(0, 50),
    marketBreakdown: marketEntries,
    tierBreakdown: Object.fromEntries(Object.entries(tiers).map(([k, v]) => [k, v.length])),
  };
  
  const outPath = path.join(__dirname, "..", "data", "value-analysis.json");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`\n💾 Saved to ${outPath}`);
}

main().catch(console.error);
