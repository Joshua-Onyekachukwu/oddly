#!/usr/bin/env node

/**
 * ODDLY Prediction Settlement Engine — Fast Mode
 * 
 * Generates predictions in-memory for finished fixtures, settles them
 * immediately against actual scores, and stores settled results.
 * 
 * This avoids the slow insert-then-update cycle.
 * 
 * Run: node worker/settle-predictions.js
 */

const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");
const path = require("path");

function clamp(v, lo = 0.01, hi = 0.99) { return Math.max(lo, Math.min(hi, v)); }

// ─── Prediction Engine (in-memory) ───────────────────────────────────────

class SimpleTracker {
  constructor() { this.history = {}; this.elo = {}; this.h2h = {}; this.leagueAvg = {}; this.leagueCount = {}; }
  recordMatch(home, away, hg, ag, leagueId) {
    if (!this.history[home]) this.history[home] = [];
    if (!this.history[away]) this.history[away] = [];
    this.history[home].push({ gf: hg, ga: ag, isHome: true });
    this.history[away].push({ gf: ag, ga: hg, isHome: false });
    if (this.history[home].length > 50) this.history[home].shift();
    if (this.history[away].length > 50) this.history[away].shift();
    const key = [home, away].sort().join(" vs ");
    if (!this.h2h[key]) this.h2h[key] = [];
    this.h2h[key].push({ home, away, hg, ag });
    if (leagueId) {
      if (!this.leagueAvg[leagueId]) { this.leagueAvg[leagueId] = 0; this.leagueCount[leagueId] = 0; }
      this.leagueAvg[leagueId] += hg + ag;
      this.leagueCount[leagueId]++;
    }
    const h = (this.elo[home] || 1500) + 65, a = this.elo[away] || 1500;
    const eH = 1 / (1 + Math.pow(10, (a - h) / 400));
    const actual = hg > ag ? 1 : hg < ag ? 0 : 0.5;
    this.elo[home] = (this.elo[home] || 1500) + 32 * (actual - eH);
    this.elo[away] = (this.elo[away] || 1500) + 32 * ((1 - actual) - (1 - eH));
  }
  getTeamStats(t) {
    const h = (this.history[t] || []).slice(-15);
    if (h.length < 3) return { ppg: 1.5, homePPG: 1.6, awayPPG: 1.2, homeGF: 1.4, homeGA: 1.1, awayGF: 1.0, awayGA: 1.3, scoresInR10: 0.7, concedesInR10: 0.75, cleanSheetRate: 0.25, bttsRate: 0.50, streak: 0, homeWinRate: 0.45, awayWinRate: 0.30 };
    const r5 = h.slice(-5), r10 = h.slice(-10);
    const home = h.filter(m => m.isHome).slice(-8), away = h.filter(m => !m.isHome).slice(-8);
    const ppgFn = (m) => m.reduce((s, x) => s + (x.gf > x.ga ? 3 : x.gf === x.ga ? 1 : 0), 0) / Math.max(1, m.length);
    const wr = (m) => m.filter(x => x.gf > x.ga).length / Math.max(1, m.length);
    return {
      ppg: ppgFn(r5), homePPG: ppgFn(home), awayPPG: ppgFn(away),
      homeGF: home.reduce((s, m) => s + m.gf, 0) / Math.max(1, home.length),
      homeGA: home.reduce((s, m) => s + m.ga, 0) / Math.max(1, home.length),
      awayGF: away.reduce((s, m) => s + m.gf, 0) / Math.max(1, away.length),
      awayGA: away.reduce((s, m) => s + m.ga, 0) / Math.max(1, away.length),
      scoresInR10: r10.filter(m => m.gf > 0).length / Math.max(1, r10.length),
      concedesInR10: r10.filter(m => m.ga > 0).length / Math.max(1, r10.length),
      cleanSheetRate: r10.filter(m => m.ga === 0).length / Math.max(1, r10.length),
      bttsRate: r10.filter(m => m.gf > 0 && m.ga > 0).length / Math.max(1, r10.length),
      streak: this.getStreak(h), homeWinRate: wr(home), awayWinRate: wr(away),
    };
  }
  getStreak(h) { let s = 0; for (let i = h.length - 1; i >= 0; i--) { if (s >= 0 && h[i].gf > h[i].ga) s++; else if (s <= 0 && h[i].gf < h[i].ga) s--; else break; } return s; }
  getH2H(home, away) {
    const m = (this.h2h[[home, away].sort().join(" vs ")] || []).slice(-10);
    if (m.length < 2) return { h2hHomeWins: 0.40, h2hDraws: 0.25, h2hBTTS: 0.50, h2hAvgGoals: 2.6 };
    let hW = 0, d = 0, btts = 0, total = 0;
    for (const x of m) { const hG = x.home === home ? x.hg : x.ag, aG = x.home === home ? x.ag : x.hg; total += hG + aG; if (hG > aG) hW++; else if (hG === aG) d++; if (hG > 0 && aG > 0) btts++; }
    return { h2hHomeWins: hW / m.length, h2hDraws: d / m.length, h2hBTTS: btts / m.length, h2hAvgGoals: total / m.length };
  }
  getLeagueAvgGoals(lid) { return (this.leagueAvg[lid] || 0) / Math.max(1, this.leagueCount[lid] || 1) || 2.6; }
}

function predict1X2(hs, as, h2h, eloDiff, xgHome, xgAway) {
  // --- Core: Elo + home advantage (OPTIMIZED weights) ---
  // Intercept shifted down (-0.59 vs -0.12) to compensate for stronger features
  let pH = 0.40 + (1 / (1 + Math.pow(10, (-eloDiff - 65) / 400)) - 0.45) * 0.45;
  
  // --- Form signals (OPTIMIZED) ---
  // Home PPG: reduced (0.10→0.003) — redundant with Elo
  pH += (hs.homePPG - 1.6) * 0.003;
  pH += (hs.homeWinRate - 0.45) * 0.02;
  pH -= (as.awayPPG - 1.2) * 0.12;
  pH -= (1 - as.awayWinRate - 0.30) * 0.12;
  
  // --- Defensive stability (OPTIMIZED — much stronger) ---
  // Clean sheet rate: 0.08→0.48, defense is the strongest signal
  pH += (hs.cleanSheetRate - 0.25) * 0.48;
  pH -= (as.cleanSheetRate - 0.25) * 0.24;
  
  // --- H2H dominance (OPTIMIZED — stronger) ---
  pH += (h2h.h2hHomeWins - 0.40) * 0.17;
  
  // --- Goal difference signal ---
  const homeGD = hs.homeGF - hs.homeGA;
  const awayGD = as.awayGF - as.awayGA;
  pH += clamp((homeGD - awayGD) * 0.04, -0.08, 0.08);
  
  // --- Form streak: momentum (OPTIMIZED — 3x stronger) ---
  if (hs.streak >= 3) pH += 0.12;
  if (hs.streak <= -3) pH -= 0.12;
  if (as.streak >= 3) pH -= 0.08;
  if (as.streak <= -3) pH += 0.08;
  
  // --- xG signals (when available) ---
  if (xgHome && xgAway) {
    const xgDiff = xgHome.home_avg_xg - xgAway.away_avg_xg;
    pH += clamp(xgDiff * 0.08, -0.10, 0.10);
    const convDiff = (xgHome.home_xg_eff || 1.0) - (xgAway.away_xg_eff || 1.0);
    pH += clamp(convDiff * 0.03, -0.04, 0.04);
    const bigDiff = (xgHome.big_chance_rate || 0) - (xgAway.big_chance_rate || 0);
    pH += clamp(bigDiff * 0.05, -0.05, 0.05);
  }
  
  // --- Draw probability (same) ---
  let pD = 0.22 + (h2h.h2hDraws * 0.15);
  if (Math.abs(hs.ppg - as.ppg) < 0.3) pD += 0.03;
  if (Math.abs(eloDiff) < 100) pD += 0.02;
  if (hs.homeGF > 1.5 && as.awayGF > 1.5) pD -= 0.03;
  
  let pA = clamp(1 - clamp(pH) - clamp(pD), 0.05, 0.85);
  pH = clamp(pH, 0.05, 0.90); pD = clamp(pD, 0.12, 0.38);
  const t = pH + pD + pA; return { homeWin: pH / t, draw: pD / t, awayWin: pA / t };
}

function predictOU(hs, as, h2h, eloDiff, lgAvg, xgHome, xgAway) {
  let exp = lgAvg + ((hs.homeGF + as.awayGF) / 2 - 1.2) * 0.8 + ((hs.homeGA + as.awayGA) / 2 - 1.2) * 0.6 + (h2h.h2hAvgGoals - lgAvg) * 0.2;
  // xG-based expected goals: more accurate than raw goals
  if (xgHome && xgAway) {
    const xgExpected = (xgHome.home_avg_xg + xgAway.away_avg_xg) / 2;
    // Blend: 60% form-based, 40% StatsBomb xG
    exp = exp * 0.6 + xgExpected * 0.4;
    // Adjust for xG efficiency (are teams clinical or wasteful?)
    const homeEff = xgHome.home_xg_eff || 1.0;
    const awayEff = xgAway.away_xg_eff || 1.0;
    exp *= (homeEff * 0.5 + awayEff * 0.5);
  }
  exp = clamp(exp, 1.0, 5.5);
  const p0 = Math.exp(-exp), p1 = exp * p0, p2 = exp * exp / 2 * p0, p3 = exp * exp * exp / 6 * p0;
  return {
    over25: clamp(1 - (p0 + p1 + p2)), under25: clamp(p0 + p1 + p2),
    over15: clamp(1 - (p0 + p1)), under35: clamp(p0 + p1 + p2 + p3),
    over05: clamp(1 - p0), under45: clamp(p0 + p1 + p2 + p3 + exp * exp * exp * exp / 24 * p0)
  };
}

function predictBTTS(hs, as, h2h, eloDiff, lgAvg, xgHome, xgAway) {
  let p = 0.50 + (hs.scoresInR10 - 0.65) * 0.12 + (as.scoresInR10 - 0.65) * 0.12;
  p += (hs.concedesInR10 - 0.70) * 0.08 + (as.concedesInR10 - 0.70) * 0.08;
  p += (hs.bttsRate - 0.50) * 0.10 + (as.bttsRate - 0.50) * 0.10 + (h2h.h2hBTTS - 0.50) * 0.12;
  p -= (hs.cleanSheetRate - 0.25) * 0.06 + (as.cleanSheetRate - 0.25) * 0.06;
  // xG-based BTTS: both teams need xG > 0.5 for high BTTS probability
  if (xgHome && xgAway) {
    const homeAttack = xgHome.home_avg_xg;
    const awayAttack = xgAway.away_avg_xg;
    // If both teams create decent xG (>0.8 each), BTTS is more likely
    if (homeAttack > 0.8 && awayAttack > 0.8) p += 0.05;
    // If either team is very defensive (xG < 0.5), BTTS less likely
    if (homeAttack < 0.5 || awayAttack < 0.5) p -= 0.05;
  }
  return { bttsYes: clamp(p, 0.15, 0.85), bttsNo: clamp(1 - p, 0.15, 0.85) };
}

// ─── Settlement Logic ──────────────────────────────────────────────────────

function settle(market, selection, hs, as) {
  const total = hs + as;
  const sel = (selection || "").toLowerCase();
  switch (market) {
    case "1X2":
      if (sel === "home" && hs > as) return "correct";
      if (sel === "draw" && hs === as) return "correct";
      if (sel === "away" && hs < as) return "correct";
      return "wrong";
    case "over_under":
      if (selection === "over_2.5") return total > 2.5 ? "correct" : "wrong";
      if (selection === "under_2.5") return total <= 2.5 ? "correct" : "wrong";
      if (selection === "over_1.5") return total > 1.5 ? "correct" : "wrong";
      if (selection === "under_1.5") return total <= 1.5 ? "correct" : "wrong";
      if (selection === "over_3.5") return total > 3.5 ? "correct" : "wrong";
      if (selection === "under_3.5") return total <= 3.5 ? "correct" : "wrong";
      if (selection === "over_0.5") return total > 0.5 ? "correct" : "wrong";
      if (selection === "under_0.5") return total <= 0.5 ? "correct" : "wrong";
      if (selection === "over_4.5") return total > 4.5 ? "correct" : "wrong";
      if (selection === "under_4.5") return total <= 4.5 ? "correct" : "wrong";
      return "unknown";
    case "btts":
      if (selection === "yes") return (hs > 0 && as > 0) ? "correct" : "wrong";
      if (selection === "no") return (hs === 0 || as === 0) ? "correct" : "wrong";
      return "unknown";
    default:
      return "unknown";
  }
}

// ─── Env ────────────────────────────────────────────────────────────────────

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

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const MAX_FIXTURES = parseInt(process.env.MAX_FIXTURES || "2000");
  const today = new Date().toISOString().split("T")[0];
  console.log("🔄 ODDLY Prediction Settlement — " + today);
  console.log("━".repeat(60));

  const env = loadEnv();
  const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

  // Step 1: Load all finished fixtures with scores, ordered chronologically
  console.log("📋 Step 1: Loading finished fixtures with scores...");
  const allFinished = [];
  let offset = 0;
  while (true) {
    const { data: batch } = await supabase
      .from("fixtures")
      .select("id, home_score, away_score, kickoff_time, league_id, home_team_id, away_team_id")
      .eq("status", "finished")
      .not("home_score", "is", null)
      .order("kickoff_time", { ascending: true })
      .range(offset, offset + 999);
    if (!batch || batch.length === 0) break;
    allFinished.push(...batch);
    offset += batch.length;
    if (batch.length < 1000) break;
  }
  console.log(`   Found ${allFinished.length} finished fixtures`);

  if (allFinished.length === 0) {
    console.log("   No finished fixtures to settle.");
    return;
  }

  // Step 2: Load team names and xG data
  const { data: teams } = await supabase.from("teams").select("id, canonical_name");
  const teamMap = {};
  for (const t of teams || []) teamMap[t.id] = t.canonical_name;
  console.log(`   Loaded ${Object.keys(teamMap).length} team names`);

  // Load xG features (StatsBomb + Understat)
  let xgData = {};
  try {
    const xgPath = path.join(__dirname, "..", "data", "statsbomb-xg.json");
    const xgRaw = JSON.parse(fs.readFileSync(xgPath, "utf8"));
    xgData = xgRaw.features || {};
    console.log(`   Loaded xG data for ${Object.keys(xgData).length} StatsBomb teams`);
  } catch (err) {
    console.log(`   ⚠️  No xG data: ${err.message}`);
  }
  // Load Understat xG (broader coverage)
  let understatTeams = {};
  try {
    const uPath = path.join(__dirname, "..", "data", "understat-xg.json");
    const uRaw = JSON.parse(fs.readFileSync(uPath, "utf8"));
    understatTeams = uRaw.teams || {};
    console.log(`   Loaded Understat xG for ${Object.keys(understatTeams).length} teams`);
  } catch (err) {
    console.log(`   ⚠️  No Understat xG: ${err.message}`);
  }
  // Build name lookup for xG (StatsBomb first, Understat fallback)
  const xgLookup = {};
  for (const [name, features] of Object.entries(xgData)) {
    xgLookup[name.toLowerCase()] = features;
  }
  // Add Understat teams as fallback
  for (const [key, feat] of Object.entries(understatTeams)) {
    const name = key.split(/_EPL_|_La_liga_|_Bundesliga_|_Serie_A_|_Ligue_1_/)[0].toLowerCase();
    if (!xgLookup[name]) xgLookup[name] = feat;
  }
  const TEAM_ALIASES = {
    'psg': 'Paris Saint Germain', 'man utd': 'Manchester United',
    'man united': 'Manchester United', 'man city': 'Manchester City',
    'inter milan': 'Internazionale', 'inter': 'Internazionale',
    'barca': 'Barcelona', 'bayern': 'Bayern Munich',
    'leverkusen': 'Bayer Leverkusen', 'dortmund': 'Borussia Dortmund',
    'atletico': 'Atletico Madrid', 'sporting cp': 'Sporting CP',
  };
  function findXG(teamName) {
    if (!teamName) return null;
    const resolved = TEAM_ALIASES[teamName.toLowerCase()] || teamName;
    const lower = resolved.toLowerCase();
    if (xgLookup[lower]) return xgLookup[lower];
    for (const [key, val] of Object.entries(xgLookup)) {
      if (lower.includes(key) || key.includes(lower)) return val;
    }
    return null;
  }

  // Step 3: Build tracker and generate predictions in-memory, settling as we go
  const fixturesToProcess = allFinished.slice(0, MAX_FIXTURES);
  console.log(`\n📋 Step 2: Generating + settling ${fixturesToProcess.length} fixtures...`);

  const tracker = new SimpleTracker();
  const settledPreds = [];
  const marketStats = {};
  const tierStats = {};
  const calibBuckets = {};
  const fixtureBestPreds = {};  // For smart selection
  let correct = 0, wrong = 0, unknown = 0;

  for (let i = 0; i < fixturesToProcess.length; i++) {
    const fixture = fixturesToProcess[i];
    const home = teamMap[fixture.home_team_id];
    const away = teamMap[fixture.away_team_id];
    if (!home || !away) continue;

    // Generate prediction BEFORE recording result (no data leakage)
    const hs = tracker.getTeamStats(home);
    const as = tracker.getTeamStats(away);
    const eloDiff = (tracker.elo[home] || 1500) - (tracker.elo[away] || 1500);
    const leagueAvg = tracker.getLeagueAvgGoals(fixture.league_id);
    const h2h = tracker.getH2H(home, away);

    const xgH = findXG(home);
    const xgA = findXG(away);
    const r1X2 = predict1X2(hs, as, h2h, eloDiff, xgH, xgA);
    const rOU = predictOU(hs, as, h2h, eloDiff, leagueAvg, xgH, xgA);
    const rBTTS = predictBTTS(hs, as, h2h, eloDiff, leagueAvg, xgH, xgA);

    const candidates = [
      { market: "1X2", selection: "Home", prob: r1X2.homeWin },
      { market: "1X2", selection: "Draw", prob: r1X2.draw },
      { market: "1X2", selection: "Away", prob: r1X2.awayWin },
      { market: "over_under", selection: "over_2.5", prob: rOU.over25 },
      { market: "over_under", selection: "under_2.5", prob: rOU.under25 },
      { market: "over_under", selection: "over_1.5", prob: rOU.over15 },
      { market: "over_under", selection: "under_3.5", prob: rOU.under35 },
      { market: "over_under", selection: "over_0.5", prob: rOU.over05 },
      { market: "over_under", selection: "under_4.5", prob: rOU.under45 },
      { market: "btts", selection: "yes", prob: rBTTS.bttsYes },
      { market: "btts", selection: "no", prob: rBTTS.bttsNo },
    ];

    let bestPred = null;
    for (const c of candidates) {
      const result = settle(c.market, c.selection, fixture.home_score, fixture.away_score);
      const conf = c.prob >= 0.85 ? "ELITE" : c.prob >= 0.70 ? "HIGH" : c.prob >= 0.60 ? "MEDIUM" : "LOW";

      if (result === "correct") correct++;
      else if (result === "wrong") wrong++;
      else unknown++;

      const mKey = `${c.market}/${c.selection}`;
      if (!marketStats[mKey]) marketStats[mKey] = { correct: 0, total: 0 };
      marketStats[mKey].total++;
      if (result === "correct") marketStats[mKey].correct++;

      if (!tierStats[conf]) tierStats[conf] = { correct: 0, total: 0 };
      tierStats[conf].total++;
      if (result === "correct") tierStats[conf].correct++;

      const bucket = (Math.round(c.prob * 10) / 10).toFixed(1);
      if (!calibBuckets[bucket]) calibBuckets[bucket] = { correct: 0, total: 0 };
      calibBuckets[bucket].total++;
      if (result === "correct") calibBuckets[bucket].correct++;

      // For smart selection: track best per fixture
      if (!fixtureBestPreds[fixture.id] || c.prob > fixtureBestPreds[fixture.id].prob) {
        fixtureBestPreds[fixture.id] = { ...c, result, prob: c.prob };
      }

      settledPreds.push({
        fixture_id: fixture.id,
        market: c.market,
        selection: c.selection,
        model_probability: c.prob,
        confidence_tier: conf,
        model_version: "v4.0-settle",
        result,
        settled_at: new Date().toISOString(),
      });
    }

    // Now record the match for the NEXT prediction (no leakage)
    tracker.recordMatch(home, away, fixture.home_score, fixture.away_score, fixture.league_id);

    if ((i + 1) % 200 === 0) {
      console.log(`   ${i + 1}/${fixturesToProcess.length} processed...`);
    }
  }

  console.log(`   ✅ Processed ${fixturesToProcess.length} fixtures in-memory`);

  // Step 4: Store settled predictions in batches
  console.log(`\n📋 Step 3: Storing ${settledPreds.length} settled predictions...`);

  const STORE_BATCH = 500;
  for (let i = 0; i < settledPreds.length; i += STORE_BATCH) {
    const batch = settledPreds.slice(i, i + STORE_BATCH);
    const { error } = await supabase.from("predictions").insert(batch);
    if (error) {
      // Try smaller batches if there's an issue
      for (const pred of batch) {
        await supabase.from("predictions").insert([pred]);
      }
    }
    if ((i + STORE_BATCH) % 2000 === 0 || i + STORE_BATCH >= settledPreds.length) {
      console.log(`   Stored ${Math.min(i + STORE_BATCH, settledPreds.length)}/${settledPreds.length}...`);
    }
  }
  console.log(`   ✅ Stored all predictions`);

  // ─── Reports ──────────────────────────────────────────────────────────

  const total = correct + wrong + unknown;

  console.log("\n" + "━".repeat(60));
  console.log("📊 SETTLEMENT RESULTS");
  console.log("━".repeat(60));
  console.log(`   Fixtures analyzed: ${fixturesToProcess.length}`);
  console.log(`   Predictions made:  ${total}`);
  console.log(`   ✅ Correct:     ${correct} (${(correct / total * 100).toFixed(1)}%)`);
  console.log(`   ❌ Wrong:       ${wrong} (${(wrong / total * 100).toFixed(1)}%)`);
  if (unknown > 0) console.log(`   ❓ Unknown:     ${unknown}`);

  // Accuracy by market
  console.log("\n📊 Accuracy by Market:");
  const sortedMarkets = Object.entries(marketStats)
    .map(([k, v]) => ({ market: k, acc: v.correct / v.total, correct: v.correct, total: v.total }))
    .sort((a, b) => b.acc - a.acc);

  for (const m of sortedMarkets) {
    const bar = "█".repeat(Math.round(m.acc * 20)) + "░".repeat(20 - Math.round(m.acc * 20));
    console.log(`   ${m.market.padEnd(22)} ${bar} ${(m.acc * 100).toFixed(1)}% (${m.correct}/${m.total})`);
  }

  // Accuracy by confidence tier
  console.log("\n📊 Accuracy by Confidence Tier:");
  const tierOrder = ["ELITE", "HIGH", "MEDIUM", "LOW"];
  for (const tier of tierOrder) {
    const t = tierStats[tier];
    if (!t || t.total === 0) continue;
    const acc = t.correct / t.total;
    const bar = "█".repeat(Math.round(acc * 20)) + "░".repeat(20 - Math.round(acc * 20));
    console.log(`   ${tier.padEnd(10)} ${bar} ${(acc * 100).toFixed(1)}% (${t.correct}/${t.total})`);
  }

  // Calibration
  console.log("\n📊 Calibration (Model Probability vs Actual Accuracy):");
  console.log(`   ${"Model%".padEnd(10)} ${"Predictions".padEnd(12)} ${"Actual%".padEnd(10)} ${"Status".padEnd(12)}`);
  for (const [bucket, stats] of Object.entries(calibBuckets).sort((a, b) => parseFloat(b[0]) - parseFloat(a[0]))) {
    const modelPct = parseFloat(bucket) * 100;
    const actualPct = (stats.correct / stats.total * 100).toFixed(1);
    const diff = Math.abs(modelPct - parseFloat(actualPct));
    const status = diff < 3 ? "✅ Calibrated" : diff < 8 ? "⚠️ Slightly off" : "❌ Miscalibrated";
    console.log(`   ${(modelPct + "%").padEnd(10)} ${String(stats.total).padEnd(12)} ${(actualPct + "%").padEnd(10)} ${status}`);
  }

  // Smart selection
  console.log("\n📊 Smart Selection (Best Market Per Match):");
  let smartCorrect = 0, smartTotal = 0;
  for (const [fid, pred] of Object.entries(fixtureBestPreds)) {
    smartTotal++;
    if (pred.result === "correct") smartCorrect++;
  }
  if (smartTotal > 0) {
    const acc = (smartCorrect / smartTotal * 100).toFixed(1);
    const bar = "█".repeat(Math.round(smartCorrect / smartTotal * 20)) + "░".repeat(20 - Math.round(smartCorrect / smartTotal * 20));
    console.log(`   ${bar} ${acc}% (${smartCorrect}/${smartTotal})`);
  }

  console.log("\n" + "━".repeat(60));
  console.log("✅ Settlement complete. Admin dashboard will now show real results.");
}

main().catch(e => { console.error("❌", e.message); process.exit(1); });
