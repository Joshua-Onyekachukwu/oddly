#!/usr/bin/env node

/**
 * ODDLY Live xG Prediction Engine
 * 
 * Uses StatsBomb xG team profiles to generate expected goals estimates
 * for upcoming fixtures, then produces enhanced predictions.
 * 
 * For each upcoming match:
 *   1. Look up both teams' xG profiles (attack at home, defense away)
 *   2. Compute expected goals using xG-based attack/defense ratings
 *   3. Generate Poisson score-line grid from expected goals
 *   4. Compute all market probabilities
 *   5. Blend with form-based estimates (60% xG / 40% form when both available)
 *   6. Store predictions in Supabase
 * 
 * Run: node worker/live-xg-predictions.js
 */

const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");
const path = require("path");

// ─── Env ─────────────────────────────────────────────────────────────────
function loadEnv() {
  const envPath = path.join(__dirname, "..", ".env.local");
  const env = {};
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
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

function clamp(v, lo = 0.01, hi = 0.99) { return Math.max(lo, Math.min(hi, v)); }

// ─── StatsBomb xG Data ──────────────────────────────────────────────────
let xgData = {};
let xgLookup = {};

function loadXGData() {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "statsbomb-xg.json"), "utf8"));
    xgData = raw.features || {};
    // Build lowercase lookup for fuzzy matching
    for (const [name, features] of Object.entries(xgData)) {
      xgLookup[name.toLowerCase()] = features;
    }
    console.log(`   📊 Loaded xG profiles for ${Object.keys(xgData).length} teams`);
    return true;
  } catch (err) {
    console.log(`   ⚠️  No xG data: ${err.message}`);
    return false;
  }
}

function findXG(teamName) {
  if (!teamName) return null;
  const lower = teamName.toLowerCase();
  // Exact match
  if (xgLookup[lower]) return xgLookup[lower];
  // Partial match
  for (const [key, val] of Object.entries(xgLookup)) {
    if (lower.includes(key) || key.includes(lower)) return val;
  }
  // Word overlap match
  const words = lower.split(/\s+/);
  for (const [key, val] of Object.entries(xgLookup)) {
    const keyWords = key.split(/\s+/);
    const overlap = words.filter(w => keyWords.some(kw => kw.includes(w) || w.includes(kw)));
    if (overlap.length >= 2) return val;
  }
  return null;
}

// ─── Poisson Model ──────────────────────────────────────────────────────
function poissonProb(lambda, k) {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let logP = -lambda;
  for (let i = 1; i <= k; i++) logP += Math.log(lambda) - Math.log(i);
  return Math.exp(logP);
}

function poissonGoals(hLambda, aLambda, maxGoals = 8) {
  const grid = [];
  for (let i = 0; i <= maxGoals; i++) {
    grid[i] = [];
    for (let j = 0; j <= maxGoals; j++) {
      grid[i][j] = poissonProb(hLambda, i) * poissonProb(aLambda, j);
    }
  }
  return grid;
}

function computeMarkets(grid) {
  const m = {};
  let pH = 0, pD = 0, pA = 0;
  for (let i = 0; i < grid.length; i++)
    for (let j = 0; j < grid[i].length; j++) {
      if (i > j) pH += grid[i][j];
      else if (i === j) pD += grid[i][j];
      else pA += grid[i][j];
    }

  m["1X2_Home"] = clamp(pH); m["1X2_Draw"] = clamp(pD); m["1X2_Away"] = clamp(pA);
  m["DC_1X"] = clamp(pH + pD); m["DC_X2"] = clamp(pD + pA); m["DC_12"] = clamp(pH + pA);
  const dnb = pH + pA;
  m["DNB_Home"] = dnb > 0 ? clamp(pH / dnb) : 0.5;
  m["DNB_Away"] = dnb > 0 ? clamp(pA / dnb) : 0.5;

  const totals = {};
  let cumUnder = 0;
  for (let t = 0; t <= 9; t++) {
    for (let i = 0; i < grid.length; i++)
      for (let j = 0; j < grid[i].length; j++) if (i + j === t) cumUnder += grid[i][j];
    totals[t] = cumUnder;
  }
  for (const line of [0.5, 1.5, 2.5, 3.5, 4.5]) {
    m[`OU_Over_${line}`] = clamp(1 - (totals[Math.floor(line)] || 0));
    m[`OU_Under_${line}`] = clamp(totals[Math.floor(line)] || 0);
  }

  let btts = 0;
  for (let i = 1; i < grid.length; i++)
    for (let j = 1; j < grid[i].length; j++) btts += grid[i][j];
  m["BTTS_Yes"] = clamp(btts); m["BTTS_No"] = clamp(1 - btts);

  return m;
}

// ─── Team Stats (from history) ─────────────────────────────────────────
class Tracker {
  constructor() {
    this.history = {};
    this.elo = {};
  }

  recordMatch(home, away, hg, ag) {
    if (!this.history[home]) this.history[home] = [];
    if (!this.history[away]) this.history[away] = [];
    this.history[home].push({ gf: hg, ga: ag, isHome: true });
    this.history[away].push({ gf: ag, ga: hg, isHome: false });
    if (this.history[home].length > 30) this.history[home].shift();
    if (this.history[away].length > 30) this.history[away].shift();

    const h = (this.elo[home] || 1500) + 65;
    const a = this.elo[away] || 1500;
    const eH = 1 / (1 + Math.pow(10, (a - h) / 400));
    const actual = hg > ag ? 1 : hg < ag ? 0 : 0.5;
    this.elo[home] = (this.elo[home] || 1500) + 32 * (actual - eH);
    this.elo[away] = (this.elo[away] || 1500) * 1 + 32 * ((1 - actual) - (1 - eH));
  }

  getForm(team) {
    const hist = (this.history[team] || []).slice(-10);
    if (hist.length < 3) return { homeGF: 1.4, homeGA: 1.1, awayGF: 1.0, awayGA: 1.3, ppg: 1.5, cleanSheetRate: 0.25, bttsRate: 0.50, streak: 0 };
    const r5 = hist.slice(-5);
    const home = hist.filter(m => m.isHome).slice(-8);
    const away = hist.filter(m => !m.isHome).slice(-8);
    return {
      homeGF: home.length > 0 ? home.reduce((s, m) => s + m.gf, 0) / home.length : 1.4,
      homeGA: home.length > 0 ? home.reduce((s, m) => s + m.ga, 0) / home.length : 1.1,
      awayGF: away.length > 0 ? away.reduce((s, m) => s + m.gf, 0) / away.length : 1.0,
      awayGA: away.length > 0 ? away.reduce((s, m) => s + m.ga, 0) / away.length : 1.3,
      ppg: r5.reduce((s, m) => s + (m.gf > m.ga ? 3 : m.gf === m.ga ? 1 : 0), 0) / r5.length,
      cleanSheetRate: hist.filter(m => m.ga === 0).length / hist.length,
      bttsRate: hist.filter(m => m.gf > 0 && m.ga > 0).length / hist.length,
      streak: this.getStreak(hist),
    };
  }

  getStreak(hist) {
    let s = 0;
    for (let i = hist.length - 1; i >= 0; i--) {
      if (s >= 0 && hist[i].gf > hist[i].ga) s++;
      else if (s <= 0 && hist[i].gf < hist[i].ga) s--;
      else break;
    }
    return s;
  }
}

// ─── Main ───────────────────────────────────────────────────────────────
async function main() {
  console.log("🎯 ODDLY Live xG Prediction Engine");
  console.log("━".repeat(60));

  const hasXG = loadXGData();
  if (!hasXG) {
    console.log("   ❌ Cannot run without xG data. Run: npm run collect:xg");
    process.exit(1);
  }

  const tracker = new Tracker();

  // Load historical matches for form tracking
  console.log("   Loading historical matches...");
  let offset = 0, loaded = 0;
  while (true) {
    const { data: batch } = await supabase
      .from("fixtures")
      .select("home_score, away_score, home:teams!fixtures_home_team_id_fkey(canonical_name), away:teams!fixtures_away_team_id_fkey(canonical_name)")
      .eq("status", "finished")
      .not("home_score", "is", null)
      .order("kickoff_time", { ascending: true })
      .range(offset, offset + 999);
    if (!batch || batch.length === 0) break;
    for (const m of batch) {
      const home = m.home?.canonical_name;
      const away = m.away?.canonical_name;
      if (home && away) tracker.recordMatch(home, away, m.home_score, m.away_score);
    }
    loaded += batch.length;
    offset += 999;
    if (batch.length < 1000) break;
  }
  console.log(`   Loaded ${loaded} historical matches\n`);

  // Get upcoming fixtures
  const now = new Date().toISOString();
  const { data: upcoming } = await supabase
    .from("fixtures")
    .select(`
      id, kickoff_time, league_id,
      home:teams!fixtures_home_team_id_fkey(canonical_name, logo),
      away:teams!fixtures_away_team_id_fkey(canonical_name, logo),
      league:leagues!fixtures_league_id_fkey(name, logo)
    `)
    .eq("status", "scheduled")
    .gte("kickoff_time", now)
    .order("kickoff_time", { ascending: true });

  if (!upcoming || upcoming.length === 0) {
    console.log("   No upcoming fixtures found.");
    return;
  }
  console.log(`   Found ${upcoming.length} upcoming fixtures\n`);

  // Match teams to xG profiles and generate predictions
  let xgMatched = 0;
  let noXG = 0;
  const predictions = [];
  const xgReport = [];

  for (const fixture of upcoming) {
    const home = fixture.home?.canonical_name;
    const away = fixture.away?.canonical_name;
    if (!home || !away) continue;

    const homeXG = findXG(home);
    const awayXG = findXG(away);
    const form = tracker.getForm(home);
    const awayForm = tracker.getForm(away);

    let homeLambda, awayLambda;
    let xgSource;

    if (homeXG && awayXG) {
      xgMatched++;
      // xG-based: home team's home attack vs away team's away defense
      // Use home_avg_xg for home attack, away team's conceded rate for away defense
      const homeAttackXG = homeXG.home_avg_xg || homeXG.avg_xg;
      const awayAttackXG = awayXG.away_avg_xg || awayXG.avg_xg;
      
      // Blend: 60% xG, 40% form
      homeLambda = clamp(homeAttackXG * 0.6 + form.homeGF * 0.4, 0.3, 4.5);
      awayLambda = clamp(awayAttackXG * 0.6 + awayForm.awayGF * 0.4, 0.3, 4.5);
      xgSource = `xG: ${homeAttackXG.toFixed(2)}-${awayAttackXG.toFixed(2)}`;
    } else if (homeXG) {
      xgMatched++;
      homeLambda = clamp((homeXG.home_avg_xg || homeXG.avg_xg) * 0.5 + form.homeGF * 0.5, 0.3, 4.5);
      awayLambda = clamp(awayForm.awayGF, 0.3, 4.5);
      xgSource = `xG(H): ${(homeXG.home_avg_xg || homeXG.avg_xg).toFixed(2)}-?`;
    } else if (awayXG) {
      xgMatched++;
      homeLambda = clamp(form.homeGF, 0.3, 4.5);
      awayLambda = clamp((awayXG.away_avg_xg || awayXG.avg_xg) * 0.5 + awayForm.awayGF * 0.5, 0.3, 4.5);
      xgSource = `xG(A): ?-${(awayXG.away_avg_xg || awayXG.avg_xg).toFixed(2)}`;
    } else {
      noXG++;
      homeLambda = clamp(form.homeGF, 0.3, 4.5);
      awayLambda = clamp(awayForm.awayGF, 0.3, 4.5);
      xgSource = "form-only";
    }

    // Generate Poisson grid and markets
    const grid = poissonGoals(homeLambda, awayLambda);
    const markets = computeMarkets(grid);

    // Find best market
    let bestMarket = null, bestProb = 0;
    for (const [mk, prob] of Object.entries(markets)) {
      if (prob > bestProb) { bestProb = prob; bestMarket = mk; }
    }
    const tier = bestProb >= 0.70 ? "ELITE" : bestProb >= 0.60 ? "HIGH" : bestProb >= 0.50 ? "MEDIUM" : "LOW";

    // Store predictions for all markets
    for (const [mk, prob] of Object.entries(markets)) {
      const selection = mk.includes("Home") ? "Home" : mk.includes("Away") ? "Away" : mk.includes("Draw") ? "Draw" : mk.split("_").slice(1).join("_");
      predictions.push({
        fixture_id: fixture.id,
        market: mk.split("_")[0],
        selection,
        model_probability: Math.round(prob * 10000) / 10000,
        model_version: hasXG && (homeXG || awayXG) ? "v5.1-xg" : "v5.1-form",
      });
    }

    const matchLabel = `${home} vs ${away}`;
    const leagueLabel = fixture.league?.name || "?";
    console.log(`  ${leagueLabel.padEnd(18)} ${matchLabel.padEnd(30)} λ: ${homeLambda.toFixed(2)}-${awayLambda.toFixed(2)} Best: ${bestMarket} ${Math.round(bestProb * 100)}% [${tier}] ${xgSource}`);

    xgReport.push({ home, away, homeLambda, awayLambda, homeXG: !!homeXG, awayXG: !!awayXG, bestMarket, bestProb, tier });
  }

  // Delete old predictions and insert new
  console.log(`\n   Clearing old predictions...`);
  await supabase.from("predictions").delete().gte("created_at", "2026-01-01T00:00:00Z");

  console.log(`   Inserting ${predictions.length} predictions...`);
  for (let i = 0; i < predictions.length; i += 50) {
    const batch = predictions.slice(i, i + 50);
    const { error } = await supabase.from("predictions").insert(batch);
    if (error) console.log(`   ⚠️  Batch error: ${error.message}`);
  }

  console.log(`\n${"━".repeat(60)}`);
  console.log(`✅ Generated ${upcoming.length} match predictions (${predictions.length} market predictions)`);
  console.log(`   xG matched: ${xgMatched}/${upcoming.length} (${Math.round(xgMatched / upcoming.length * 100)}%)`);
  console.log(`   Form-only: ${noXG}/${upcoming.length}`);
  console.log(`   ELITE picks: ${xgReport.filter(r => r.tier === "ELITE").length}`);
  console.log(`${"━".repeat(60)}`);

  // Top picks
  const elite = xgReport.filter(r => r.tier === "ELITE").sort((a, b) => b.bestProb - a.bestProb).slice(0, 10);
  if (elite.length > 0) {
    console.log("\n🏆 Top 10 ELITE Picks:");
    for (const r of elite) {
      console.log(`   ${r.home.padEnd(20)} vs ${r.away.padEnd(20)} ${r.bestMarket.padEnd(15)} ${Math.round(r.bestProb * 100)}%`);
    }
  }
}

main().catch(e => { console.error("❌", e.message); process.exit(1); });
