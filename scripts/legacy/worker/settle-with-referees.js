#!/usr/bin/env node

/**
 * ODDLY Settlement Engine — With Referee Features
 * 
 * Uses referee home bias, card tendencies, and goal tendencies
 * as additional prediction features. Referee data comes from
 * football-data.co.uk via local JSON files.
 * 
 * For matches without referee data, falls back to league averages.
 * 
 * Run: node worker/settle-with-referees.js
 */

const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");
const path = require("path");

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

function clamp(v, lo = 0.01, hi = 0.99) { return Math.max(lo, Math.min(hi, v)); }

// ─── Load Referee Profiles ──────────────────────────────────────────────
let refereeProfiles = {};
let leagueRefAvg = { homeBias: 0, avgGoals: 2.6, bttsPct: 0.50, over25Pct: 0.50, yellowPerMatch: 3.5 };

try {
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "referee-profiles.json"), "utf8"));
  for (const r of raw) {
    refereeProfiles[r.name.toLowerCase()] = r;
  }
  console.log(`   👨‍⚖️ Loaded ${Object.keys(refereeProfiles).length} referee profiles`);
} catch (e) {
  console.log(`   ⚠️  No referee profiles: ${e.message}`);
}

// ─── Load Match-Referee Mapping ─────────────────────────────────────────
let matchRefereeMap = {};

try {
  const matchData = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "football-data-referee-stats.json"), "utf8"));
  for (const m of matchData) {
    if (!m.referee || !m.home_team || !m.away_team) continue;
    const key = `${m.home_team.toLowerCase()}|${m.away_team.toLowerCase()}|${m.date}`;
    matchRefereeMap[key] = m.referee;
  }
  console.log(`   📋 Loaded ${Object.keys(matchRefereeMap).length} match-referee mappings`);
} catch (e) {
  console.log(`   ⚠️  No match-referee data: ${e.message}`);
}

function normalize(s) {
  return (s || "").toLowerCase().replace(/[^a-z0-9]/g, "")
    .replace(/(fc|sc|cf|ac|afc|ssc|us|uv|rc|rcd|ca|cd|vfb|tsg)$/g, "");
}

function getRefereeFeatures(homeTeam, awayTeam, matchDate) {
  // Try normalized name matching
  const hNorm = normalize(homeTeam);
  const aNorm = normalize(awayTeam);

  for (const [key, refName] of Object.entries(matchRefereeMap)) {
    const [kH, kA, kDate] = key.split("|");
    const kHNorm = normalize(kH);
    const kANorm = normalize(kA);
    if ((hNorm.includes(kHNorm) || kHNorm.includes(hNorm)) &&
        (aNorm.includes(kANorm) || kANorm.includes(aNorm))) {
      const profile = refereeProfiles[refName.toLowerCase()];
      if (profile) {
        return {
          referee: refName,
          homeBias: profile.homeBias,
          avgGoals: profile.avgGoals,
          bttsPct: profile.bttsPct,
          over25Pct: profile.over25Pct,
          yellowPerMatch: profile.avgYellow,
          redPerMatch: profile.avgRed,
          avgFouls: profile.avgFouls,
        };
      }
    }
  }

  // Fallback: league average
  return {
    referee: null,
    homeBias: 0,
    avgGoals: 2.6,
    bttsPct: 0.50,
    over25Pct: 0.50,
    yellowPerMatch: 3.5,
    redPerMatch: 0.1,
    avgFouls: 20,
  };
}

// ─── Tracker ────────────────────────────────────────────────────────────

class Tracker {
  constructor() { this.history = {}; this.elo = {}; this.h2h = {}; }

  recordMatch(home, away, hg, ag) {
    if (!this.history[home]) this.history[home] = [];
    if (!this.history[away]) this.history[away] = [];
    this.history[home].push({ gf: hg, ga: ag, isHome: true });
    this.history[away].push({ gf: ag, ga: hg, isHome: false });
    if (this.history[home].length > 60) this.history[home].shift();
    if (this.history[away].length > 60) this.history[away].shift();
    const key = [home, away].sort().join(" vs ");
    if (!this.h2h[key]) this.h2h[key] = [];
    this.h2h[key].push({ home, away, hg, ag });
    const h = (this.elo[home] || 1500) + 65;
    const a = this.elo[away] || 1500;
    const eH = 1 / (1 + Math.pow(10, (a - h) / 400));
    const actual = hg > ag ? 1 : hg < ag ? 0 : 0.5;
    this.elo[home] = (this.elo[home] || 1500) + 32 * (actual - eH);
    this.elo[away] = (this.elo[away] || 1500) + 32 * ((1 - actual) - (1 - eH));
  }

  getTeamStats(team) {
    const hist = (this.history[team] || []).slice(-20);
    if (hist.length < 3) return { ppg: 1.5, homePPG: 1.6, awayPPG: 1.2, homeGF: 1.4, homeGA: 1.1, awayGF: 1.0, awayGA: 1.3, homeWinRate: 0.45, awayWinRate: 0.30, cleanSheetRate: 0.25, scoresInR10: 0.7, concedesInR10: 0.75, bttsRate: 0.50, streak: 0 };
    const r5 = hist.slice(-5), r10 = hist.slice(-10);
    const home = hist.filter(m => m.isHome).slice(-8), away = hist.filter(m => !m.isHome).slice(-8);
    return {
      ppg: r5.reduce((s, m) => s + (m.gf > m.ga ? 3 : m.gf === m.ga ? 1 : 0), 0) / r5.length,
      homePPG: home.length > 0 ? home.reduce((s, m) => s + (m.gf > m.ga ? 3 : m.gf === m.ga ? 1 : 0), 0) / home.length : 1.6,
      awayPPG: away.length > 0 ? away.reduce((s, m) => s + (m.gf > m.ga ? 3 : m.gf === m.ga ? 1 : 0), 0) / away.length : 1.2,
      homeGF: home.length > 0 ? home.reduce((s, m) => s + m.gf, 0) / home.length : 1.4,
      homeGA: home.length > 0 ? home.reduce((s, m) => s + m.ga, 0) / home.length : 1.1,
      awayGF: away.length > 0 ? away.reduce((s, m) => s + m.gf, 0) / away.length : 1.0,
      awayGA: away.length > 0 ? away.reduce((s, m) => s + m.ga, 0) / away.length : 1.3,
      homeWinRate: home.filter(m => m.gf > m.ga).length / Math.max(1, home.length),
      awayWinRate: away.filter(m => m.gf > m.ga).length / Math.max(1, away.length),
      cleanSheetRate: r10.filter(m => m.ga === 0).length / r10.length,
      scoresInR10: r10.filter(m => m.gf > 0).length / r10.length,
      concedesInR10: r10.filter(m => m.ga > 0).length / r10.length,
      bttsRate: r10.filter(m => m.gf > 0 && m.ga > 0).length / r10.length,
      streak: this.getStreak(hist),
    };
  }

  getStreak(hist) { let s = 0; for (let i = hist.length - 1; i >= 0; i--) { if (s >= 0 && hist[i].gf > hist[i].ga) s++; else if (s <= 0 && hist[i].gf < hist[i].ga) s--; else break; } return s; }

  getH2H(home, away) {
    const m = (this.h2h[[home, away].sort().join(" vs ")] || []).slice(-10);
    if (m.length < 2) return { h2hHomeWins: 0.40, h2hDraws: 0.25, h2hBTTS: 0.50, h2hAvgGoals: 2.6 };
    let hW = 0, d = 0, btts = 0, total = 0;
    for (const x of m) {
      const hG = x.home === home ? x.hg : x.ag, aG = x.home === home ? x.ag : x.hg;
      total += hG + aG;
      if (hG > aG) hW++; else if (hG === aG) d++;
      if (hG > 0 && aG > 0) btts++;
    }
    return { h2hHomeWins: hW / m.length, h2hDraws: d / m.length, h2hBTTS: btts / m.length, h2hAvgGoals: total / m.length };
  }
}

// ─── Prediction with Referee Features ──────────────────────────────────

function predictWithReferee(hs, as, h2h, eloDiff, refereeFeatures) {
  // Base regression (optimized weights)
  const rw = { intercept: -0.5887, eloDiff: 0.0037, homePPG: 0.0025, awayPPG: -0.1225, homeGoalsFor: 0.0938, homeGoalsAgainst: -0.1713, awayGoalsFor: 0.0738, awayGoalsAgainst: -0.1738, cleanSheetRate: 0.4813, homeWinRate: 0.0225, awayWinRate: -0.1225, streak: 0.1338, h2hHomeWins: 0.1738 };

  let z = rw.intercept;
  z += eloDiff * rw.eloDiff;
  z += hs.homePPG * rw.homePPG;
  z += as.awayPPG * rw.awayPPG;
  z += hs.homeGF * rw.homeGoalsFor;
  z += hs.homeGA * rw.homeGoalsAgainst;
  z += as.awayGF * rw.awayGoalsFor;
  z += as.awayGA * rw.awayGoalsAgainst;
  z += (hs.cleanSheetRate - as.cleanSheetRate) * rw.cleanSheetRate;
  z += hs.homeWinRate * rw.homeWinRate;
  z += as.awayWinRate * rw.awayWinRate;
  z += (hs.streak * 0.05 - as.streak * 0.03) * (rw.streak / 0.05);
  z += (h2h.h2hHomeWins - 0.4) * rw.h2hHomeWins;

  // ─── Referee Features ────────────────────────────────────────────
  // Home bias: positive = favors home team
  z += refereeFeatures.homeBias * 0.15;

  // Card strictness affects goals (strict refs = fewer goals, more fouls)
  const avgYellow = refereeFeatures.yellowPerMatch;
  const yellowEffect = (avgYellow - 3.5) * -0.02; // Strict refs → fewer goals
  z += yellowEffect * 0.3;

  // BTTS tendency of this referee
  const bttsEffect = (refereeFeatures.bttsPct - 0.50) * 0.10;
  // Over 2.5 tendency
  const over25Effect = (refereeFeatures.over25Pct - 0.50) * 0.08;

  // Goals tendency affects home advantage
  const goalsEffect = (refereeFeatures.avgGoals - 2.6) * 0.02;

  const regHomeProb = 1 / (1 + Math.exp(-z));

  // Poisson lambdas adjusted by referee tendencies
  const baseHL = hs.homeGF * (as.awayGA / 1.3);
  const baseAL = as.awayGF * (hs.homeGA / 1.3);
  const refGoalAdj = refereeFeatures.avgGoals / 2.6; // Normalize to average
  const hL = clamp(baseHL * refGoalAdj * (1 + eloDiff * 0.0003), 0.3, 4.5);
  const aL = clamp(baseAL * refGoalAdj * (1 - eloDiff * 0.0003), 0.3, 4.5);

  return { regHomeProb, hL, aL, refereeFeatures, bttsEffect, over25Effect };
}

// ─── Poisson ────────────────────────────────────────────────────────────

function poissonProb(l, k) { if (l <= 0) return k === 0 ? 1 : 0; let p = -l; for (let i = 1; i <= k; i++) p += Math.log(l) - Math.log(i); return Math.exp(p); }

function poissonGoals(hL, aL, max = 8) {
  const grid = [];
  for (let i = 0; i <= max; i++) { grid[i] = []; for (let j = 0; j <= max; j++) grid[i][j] = poissonProb(hL, i) * poissonProb(aL, j); }
  return grid;
}

function computeMarkets(grid) {
  const m = {};
  let pH = 0, pD = 0, pA = 0;
  for (let i = 0; i < grid.length; i++) for (let j = 0; j < grid[i].length; j++) {
    if (i > j) pH += grid[i][j]; else if (i === j) pD += grid[i][j]; else pA += grid[i][j];
  }
  m["1X2_Home"] = clamp(pH); m["1X2_Draw"] = clamp(pD); m["1X2_Away"] = clamp(pA);
  m["DC_1X"] = clamp(pH + pD); m["DC_X2"] = clamp(pD + pA);
  const totals = {}; let cum = 0;
  for (let t = 0; t <= 9; t++) { for (let i = 0; i < grid.length; i++) for (let j = 0; j < grid[i].length; j++) if (i + j === t) cum += grid[i][j]; totals[t] = cum; }
  for (const l of [0.5, 1.5, 2.5, 3.5, 4.5]) { m[`OU_Over_${l}`] = clamp(1 - (totals[Math.floor(l)] || 0)); m[`OU_Under_${l}`] = clamp(totals[Math.floor(l)] || 0); }
  let btts = 0; for (let i = 1; i < grid.length; i++) for (let j = 1; j < grid[i].length; j++) btts += grid[i][j];
  m["BTTS_Yes"] = clamp(btts); m["BTTS_No"] = clamp(1 - btts);
  return m;
}

// ─── Settlement ─────────────────────────────────────────────────────────

function isCorrect(mk, actual, totalGoals, scores) {
  if (mk === "1X2_Home") return actual.home;
  if (mk === "1X2_Draw") return actual.draw;
  if (mk === "1X2_Away") return actual.away;
  if (mk === "OU_Over_0.5") return totalGoals > 0.5;
  if (mk === "OU_Under_0.5") return totalGoals <= 0.5;
  if (mk === "OU_Over_1.5") return totalGoals > 1.5;
  if (mk === "OU_Under_1.5") return totalGoals <= 1.5;
  if (mk === "OU_Over_2.5") return totalGoals > 2.5;
  if (mk === "OU_Under_2.5") return totalGoals <= 2.5;
  if (mk === "OU_Over_3.5") return totalGoals > 3.5;
  if (mk === "OU_Under_3.5") return totalGoals <= 3.5;
  if (mk === "OU_Over_4.5") return totalGoals > 4.5;
  if (mk === "OU_Under_4.5") return totalGoals <= 4.5;
  if (mk === "BTTS_Yes") return scores.home > 0 && scores.away > 0;
  if (mk === "BTTS_No") return scores.home === 0 || scores.away === 0;
  if (mk === "DC_1X") return actual.home || actual.draw;
  if (mk === "DC_X2") return actual.draw || actual.away;
  return false;
}

// ─── Main ───────────────────────────────────────────────────────────────

async function main() {
  const MAX = parseInt(process.env.MAX_FIXTURES || "3000");
  console.log("🔄 ODDLY Settlement with Referee Features");
  console.log("━".repeat(60));

  const env = loadEnv();
  const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  const tracker = new Tracker();

  // Load finished fixtures
  console.log("   Loading finished fixtures...");
  const all = [];
  let offset = 0;
  while (true) {
    const { data: batch } = await sb.from("fixtures").select("id, home_score, away_score, kickoff_time, home_team_id, away_team_id").eq("status", "finished").not("home_score", "is", null).order("kickoff_time", { ascending: true }).range(offset, offset + 999);
    if (!batch || batch.length === 0) break;
    all.push(...batch);
    offset += batch.length;
    if (batch.length < 1000) break;
  }

  const { data: teams } = await sb.from("teams").select("id, canonical_name");
  const teamMap = {};
  for (const t of teams || []) teamMap[t.id] = t.canonical_name;
  console.log(`   Loaded ${all.length} fixtures, ${Object.keys(teamMap).length} teams\n`);

  const fixtures = all.slice(0, MAX);

  // Run settlement
  let correct = 0, wrong = 0, refereeMatched = 0;
  const marketStats = {};
  const tierStats = {};
  const calibBuckets = {};

  for (let i = 0; i < fixtures.length; i++) {
    const f = fixtures[i];
    const home = teamMap[f.home_team_id];
    const away = teamMap[f.away_team_id];
    if (!home || !away) { tracker.recordMatch(home || "?", away || "?", f.home_score, f.away_score); continue; }

    if (i >= 50) {
      const hs = tracker.getTeamStats(home);
      const as = tracker.getTeamStats(away);
      const h2h = tracker.getH2H(home, away);
      const eloDiff = (tracker.elo[home] || 1500) - (tracker.elo[away] || 1500);
      const matchDate = (f.kickoff_time || "").substring(0, 10);
      const ref = getRefereeFeatures(home, away, matchDate);
      if (ref.referee) refereeMatched++;

      const pred = predictWithReferee(hs, as, h2h, eloDiff, ref);
      const grid = poissonGoals(pred.hL, pred.aL);
      const markets = computeMarkets(grid);

      // Adjust 1X2 with regression + referee
      const eloProb = 1 / (1 + Math.pow(10, (-eloDiff - 65) / 400));
      let pD = 0.22 + h2h.h2hDraws * 0.15;
      if (Math.abs(hs.ppg - as.ppg) < 0.3) pD += 0.03;
      pD = clamp(pD, 0.12, 0.38);

      const eH = clamp(markets["1X2_Home"] * 0.17 + eloProb * 0.40 + pred.regHomeProb * 0.43);
      const eD = clamp(markets["1X2_Draw"] * 0.17 + 0.25 * 0.40 + pD * 0.43);
      let eA = clamp((1 - markets["1X2_Home"] - markets["1X2_Draw"]) * 0.17 + (1 - eloProb - 0.25) * 0.40 + (1 - pred.regHomeProb - pD) * 0.43);
      const total = eH + eD + eA;
      markets["1X2_Home"] = clamp(eH / total);
      markets["1X2_Draw"] = clamp(eD / total);
      markets["1X2_Away"] = clamp(eA / total);

      // Adjust BTTS with referee tendency
      const refBttsAdj = ref.bttsPct - 0.50;
      markets["BTTS_Yes"] = clamp(markets["BTTS_Yes"] + refBttsAdj * 0.05);
      markets["BTTS_No"] = clamp(1 - markets["BTTS_Yes"]);

      // Adjust O/U with referee goal tendency
      const refGoalsAdj = (ref.avgGoals - 2.6) * 0.02;
      for (const l of [2.5, 3.5]) {
        markets[`OU_Over_${l}`] = clamp(markets[`OU_Over_${l}`] + refGoalsAdj);
        markets[`OU_Under_${l}`] = clamp(1 - markets[`OU_Over_${l}`]);
      }

      // Evaluate
      const actual = { home: f.home_score > f.away_score ? 1 : 0, draw: f.home_score === f.away_score ? 1 : 0, away: f.home_score < f.away_score ? 1 : 0 };
      const totalGoals = f.home_score + f.away_score;
      const scores = { home: f.home_score, away: f.away_score };

      let bestMk = null, bestProb = 0;
      for (const [mk, pr] of Object.entries(markets)) { if (mk.startsWith("1X2") || mk.startsWith("OU") || mk.startsWith("BTTS") || mk.startsWith("DC")) { if (pr > bestProb) { bestProb = pr; bestMk = mk; } } }

      if (bestMk && isCorrect(bestMk, actual, totalGoals, scores)) correct++;
      else wrong++;

      // Market stats
      for (const [mk, pr] of Object.entries(markets)) {
        if (!mk.startsWith("1X2") && !mk.startsWith("OU") && !mk.startsWith("BTTS") && !mk.startsWith("DC")) continue;
        if (!marketStats[mk]) marketStats[mk] = { correct: 0, total: 0 };
        marketStats[mk].total++;
        if (isCorrect(mk, actual, totalGoals, scores)) marketStats[mk].correct++;
      }

      // Tier stats
      const tier = bestProb >= 0.70 ? "ELITE" : bestProb >= 0.60 ? "HIGH" : bestProb >= 0.50 ? "MEDIUM" : "LOW";
      if (!tierStats[tier]) tierStats[tier] = { correct: 0, total: 0 };
      tierStats[tier].total++;
      if (bestMk && isCorrect(bestMk, actual, totalGoals, scores)) tierStats[tier].correct++;
    }

    tracker.recordMatch(home, away, f.home_score, f.away_score);
    if ((i + 1) % 500 === 0) console.log(`   ${i + 1}/${fixtures.length} processed...`);
  }

  // Report
  const total = correct + wrong;
  console.log(`\n${"━".repeat(60)}`);
  console.log(`📊 SETTLEMENT RESULTS (with Referee Features)`);
  console.log(`${"━".repeat(60)}`);
  console.log(`   Fixtures: ${fixtures.length} | Referees matched: ${refereeMatched}`);
  console.log(`   ✅ Correct: ${correct} (${(correct / total * 100).toFixed(1)}%)`);
  console.log(`   ❌ Wrong: ${wrong} (${(wrong / total * 100).toFixed(1)}%)`);

  console.log(`\n📊 By Market:`);
  for (const [mk, s] of Object.entries(marketStats).sort((a, b) => b[1].correct / b[1].total - a[1].correct / a[1].total)) {
    const acc = (s.correct / s.total * 100).toFixed(1);
    const bar = "█".repeat(Math.round(s.correct / s.total * 20)) + "░".repeat(20 - Math.round(s.correct / s.total * 20));
    console.log(`   ${mk.padEnd(20)} ${bar} ${acc}% (${s.correct}/${s.total})`);
  }

  console.log(`\n📊 By Tier:`);
  for (const tier of ["ELITE", "HIGH", "MEDIUM", "LOW"]) {
    const t = tierStats[tier]; if (!t || t.total === 0) continue;
    const acc = (t.correct / t.total * 100).toFixed(1);
    console.log(`   ${tier.padEnd(10)} ${acc}% (${t.correct}/${t.total})`);
  }

  // Compare with non-referee version
  console.log(`\n📊 Referee Impact:`);
  console.log(`   Referee data available for ${refereeMatched}/${total} predictions`);
  console.log(`   ${(refereeMatched / total * 100).toFixed(1)}% of matches have referee features`);
}

main().catch(e => { console.error("❌", e.message); process.exit(1); });
