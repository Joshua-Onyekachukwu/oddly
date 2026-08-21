#!/usr/bin/env node

/**
 * 3-Season Continuous-Learning Simulation
 * 
 * Simulates what would have happened if the prediction system had been
 * operating continuously through the last 3 seasons of football.
 * 
 * Three approaches compared:
 * A) Static Model — train once, test on all unseen matches
 * B) Periodic Retrain — retrain every 200 matches
 * C) Continuous Learning — update Elo/form after every match
 * 
 * Tests across multiple betting markets: 1X2, Over/Under, BTTS, DC
 */

const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");
const path = require("path");

// ─── Load Environment ───────────────────────────────────────────────────
function loadEnv() {
  const envPath = path.join(__dirname, "..", ".env.local");
  const envContent = fs.readFileSync(envPath, "utf8");
  const env = {};
  for (const line of envContent.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    let val = t.slice(i + 1).trim();
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    env[t.slice(0, i).trim()] = val;
  }
  return env;
}

const env = loadEnv();
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

// ─── Poisson Model ──────────────────────────────────────────────────────
function poissonProb(lambda, k) {
  let logP = -lambda;
  for (let i = 2; i <= k; i++) logP += Math.log(lambda) - Math.log(i);
  return Math.exp(logP);
}

function matchResultProbs(homeXG, awayXG) {
  const maxGoals = 7;
  const homeWin = { p: 0, goals: [] };
  const draw = { p: 0, goals: [] };
  const awayWin = { p: 0, goals: [] };

  for (let h = 0; h <= maxGoals; h++) {
    for (let a = 0; a <= maxGoals; a++) {
      const p = poissonProb(homeXG, h) * poissonProb(awayXG, a);
      if (h > a) { homeWin.p += p; homeWin.goals.push([h, a, p]); }
      else if (h === a) { draw.p += p; draw.goals.push([h, a, p]); }
      else { awayWin.p += p; awayWin.goals.push([h, a, p]); }
    }
  }
  return { homeWin: homeWin.p, draw: draw.p, awayWin: awayWin.p };
}

function overUnderProbs(homeXG, awayXG, line) {
  const maxGoals = 7;
  let over = 0, under = 0;
  for (let h = 0; h <= maxGoals; h++) {
    for (let a = 0; a <= maxGoals; a++) {
      const p = poissonProb(homeXG, h) * poissonProb(awayXG, a);
      if (h + a > line) over += p;
      else under += p;
    }
  }
  return { over, under };
}

function bttsProbs(homeXG, awayXG) {
  const maxGoals = 7;
  let yes = 0, no = 0;
  for (let h = 0; h <= maxGoals; h++) {
    for (let a = 0; a <= maxGoals; a++) {
      const p = poissonProb(homeXG, h) * poissonProb(awayXG, a);
      if (h >= 1 && a >= 1) yes += p;
      else no += p;
    }
  }
  return { yes, no };
}

function doubleChanceProbs(homeXG, awayXG) {
  const { homeWin, draw, awayWin } = matchResultProbs(homeXG, awayXG);
  return {
    homeOrDraw: homeWin + draw,
    drawOrAway: draw + awayWin,
    homeOrAway: homeWin + awayWin,
  };
}

// ─── Elo System ─────────────────────────────────────────────────────────
function expectedScore(ratingA, ratingB) {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

function updateElo(rating, expected, actual, K = 32) {
  return rating + K * (actual - expected);
}

// ─── Form Tracker ───────────────────────────────────────────────────────
class FormTracker {
  constructor() {
    this.teams = {};
  }

  getForm(teamId, lastN = 5) {
    if (!this.teams[teamId]) return { ppg: 1.5, goalsScored: 1.3, goalsConceded: 1.1, wins: 2, draws: 1, losses: 2, homePPG: 1.7, awayPPG: 1.3 };
    const results = this.teams[teamId].slice(-lastN);
    if (results.length === 0) return { ppg: 1.5, goalsScored: 1.3, goalsConceded: 1.1, wins: 2, draws: 1, losses: 2, homePPG: 1.7, awayPPG: 1.3 };
    
    const pts = results.reduce((s, r) => s + r.points, 0);
    const gs = results.reduce((s, r) => s + r.goalsFor, 0);
    const gc = results.reduce((s, r) => s + r.goalsAgainst, 0);
    const wins = results.filter(r => r.points === 3).length;
    const draws = results.filter(r => r.points === 1).length;
    const losses = results.filter(r => r.points === 0).length;
    
    const homeResults = results.filter(r => r.isHome);
    const awayResults = results.filter(r => !r.isHome);
    const homePPG = homeResults.length > 0 ? homeResults.reduce((s, r) => s + r.points, 0) / homeResults.length : 1.5;
    const awayPPG = awayResults.length > 0 ? awayResults.reduce((s, r) => s + r.points, 0) / awayResults.length : 1.0;
    
    return {
      ppg: pts / results.length,
      goalsScored: gs / results.length,
      goalsConceded: gc / results.length,
      wins, draws, losses,
      homePPG, awayPPG,
    };
  }

  addResult(teamId, points, goalsFor, goalsAgainst, isHome) {
    if (!this.teams[teamId]) this.teams[teamId] = [];
    this.teams[teamId].push({ points, goalsFor, goalsAgainst, isHome, time: Date.now() });
    if (this.teams[teamId].length > 20) this.teams[teamId].shift();
  }
}

// ─── Head-to-Head Tracker ───────────────────────────────────────────────
class H2HTracker {
  constructor() {
    this.pairs = {};
  }

  getKey(teamA, teamB) {
    return [teamA, teamB].sort().join("_");
  }

  getStats(teamA, teamB) {
    const key = this.getKey(teamA, teamB);
    if (!this.pairs[key]) return null;
    return this.pairs[key];
  }

  addResult(teamA, teamB, homeGoals, awayGoals) {
    const key = this.getKey(teamA, teamB);
    if (!this.pairs[key]) this.pairs[key] = { matches: 0, homeWins: 0, draws: 0, awayWins: 0, totalGoals: 0 };
    const h = this.pairs[key];
    h.matches++;
    h.totalGoals += homeGoals + awayGoals;
    if (homeGoals > awayGoals) h.homeWins++;
    else if (homeGoals === awayGoals) h.draws++;
    else h.awayWins++;
    if (h.matches > 10) {
      // Decay old data
      h.matches = Math.max(5, h.matches - 1);
      h.homeWins = Math.max(0, h.homeWins - 0.5);
      h.draws = Math.max(0, h.draws - 0.3);
      h.awayWins = Math.max(0, h.awayWins - 0.5);
      h.totalGoals = h.totalGoals * 0.8;
    }
  }
}

// ─── Prediction Generator ───────────────────────────────────────────────
function generatePredictions(homeForm, awayForm, eloHome, eloAway, h2h, leagueAvgGoals) {
  // Estimate expected goals
  let homeXG = (homeForm.goalsScored + awayForm.goalsConceded) / 2;
  let awayXG = (awayForm.goalsScored + homeForm.goalsConceded) / 2;

  // Home advantage boost
  const homeAdvantage = 0.25;
  homeXG += homeAdvantage;

  // Elo adjustment
  const eloDiff = eloHome - eloAway;
  const eloBoost = eloDiff / 800;
  homeXG += eloBoost * 0.3;
  awayXG -= eloBoost * 0.3;

  // H2H adjustment
  if (h2h && h2h.matches >= 3) {
    const avgGoals = h2h.totalGoals / h2h.matches;
    const leagueAvg = leagueAvgGoals || 2.7;
    const h2hFactor = (avgGoals / leagueAvg - 1) * 0.1;
    homeXG += h2hFactor;
    awayXG += h2hFactor;
  }

  // Form-based adjustment
  const homePPGBoost = (homeForm.ppg - 1.5) * 0.15;
  const awayPPGBoost = (awayForm.ppg - 1.5) * 0.15;
  homeXG += homePPGBoost;
  awayXG += awayPPGBoost;

  // Clamp XG
  homeXG = Math.max(0.3, Math.min(4.0, homeXG));
  awayXG = Math.max(0.3, Math.min(4.0, awayXG));

  // Generate market predictions
  const { homeWin, draw, awayWin } = matchResultProbs(homeXG, awayXG);
  const ou25 = overUnderProbs(homeXG, awayXG, 2.5);
  const ou15 = overUnderProbs(homeXG, awayXG, 1.5);
  const ou35 = overUnderProbs(homeXG, awayXG, 3.5);
  const btts = bttsProbs(homeXG, awayXG);
  const dc = doubleChanceProbs(homeXG, awayXG);

  return {
    homeXG, awayXG,
    markets: {
      "1X2_Home": homeWin,
      "1X2_Draw": draw,
      "1X2_Away": awayWin,
      "OU25_Over": ou25.over,
      "OU25_Under": ou25.under,
      "OU15_Over": ou15.over,
      "OU15_Under": ou15.under,
      "OU35_Over": ou35.over,
      "OU35_Under": ou35.under,
      "BTTS_Yes": btts.yes,
      "BTTS_No": btts.no,
      "DC_HomeOrDraw": dc.homeOrDraw,
      "DC_DrawOrAway": dc.drawOrAway,
      "DC_HomeOrAway": dc.homeOrAway,
    },
  };
}

// ─── Actual Outcome Checker ──────────────────────────────────────────────
function checkOutcomes(homeGoals, awayGoals) {
  const totalGoals = homeGoals + awayGoals;
  return {
    "1X2_Home": homeGoals > awayGoals,
    "1X2_Draw": homeGoals === awayGoals,
    "1X2_Away": homeGoals < awayGoals,
    "OU25_Over": totalGoals > 2.5,
    "OU25_Under": totalGoals <= 2.5,
    "OU15_Over": totalGoals > 1.5,
    "OU15_Under": totalGoals <= 1.5,
    "OU35_Over": totalGoals > 3.5,
    "OU35_Under": totalGoals <= 3.5,
    "BTTS_Yes": homeGoals >= 1 && awayGoals >= 1,
    "BTTS_No": homeGoals === 0 || awayGoals === 0,
    "DC_HomeOrDraw": homeGoals >= awayGoals,
    "DC_DrawOrAway": homeGoals <= awayGoals,
    "DC_HomeOrAway": homeGoals !== awayGoals,
  };
}

// ─── Main Simulation ────────────────────────────────────────────────────
async function main() {
  console.log("🔬 3-Season Continuous-Learning Simulation");
  console.log("━".repeat(60));

  // Fetch all finished matches (paginate to get all)
  let allMatches = [];
  let offset = 0;
  const pageSize = 1000;
  while (true) {
    const { data: batch, error } = await supabase
      .from("fixtures")
      .select("id, home_team_id, away_team_id, home_score, away_score, kickoff_time, league_id")
      .eq("status", "finished")
      .not("home_score", "is", null)
      .order("kickoff_time", { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) { console.error("Error:", error.message); break; }
    if (!batch || batch.length === 0) break;
    allMatches = allMatches.concat(batch);
    if (batch.length < pageSize) break;
    offset += pageSize;
  }
  const matches = allMatches;
  const error = null;

  if (error) { console.error("Error:", error.message); return; }
  if (!matches || matches.length === 0) { console.error("No matches found"); return; }

  console.log(`📊 Loaded ${matches.length} matches`);
  console.log(`📅 Range: ${matches[0].kickoff_time} → ${matches[matches.length - 1].kickoff_time}`);

  const totalMatches = matches.length;
  const trainEnd = Math.floor(totalMatches * 0.4); // First 40% for training
  const evalMatches = matches.slice(trainEnd);

  console.log(`🎓 Training: ${trainEnd} matches | 🧪 Evaluation: ${evalMatches.length} matches`);
  console.log("");

  // ─── Initialize Systems ──────────────────────────────────────────────
  
  // A) Static model — Elo trained on first 40%, never updated
  const staticElo = {};
  const staticForm = new FormTracker();
  const staticH2H = new H2HTracker();

  // B) Periodic retrain — Elo retrained every 200 matches
  const periodicElo = {};
  const periodicForm = new FormTracker();
  const periodicH2H = new H2HTracker();

  // C) Continuous learning — Elo updated after every match
  const continuousElo = {};
  const continuousForm = new FormTracker();
  const continuousH2H = new H2HTracker();

  // ─── Phase 1: Train on historical data ──────────────────────────────
  console.log("Phase 1: Training on historical data...");
  
  for (let i = 0; i < trainEnd; i++) {
    const m = matches[i];
    const hs = m.home_score;
    const as = m.away_score;
    
    // Update all three systems during training
    for (const elo of [staticElo, periodicElo, continuousElo]) {
      if (!elo[m.home_team_id]) elo[m.home_team_id] = 1500;
      if (!elo[m.away_team_id]) elo[m.away_team_id] = 1500;
      
      const expH = expectedScore(elo[m.home_team_id], elo[m.away_team_id]);
      const expA = expectedScore(elo[m.away_team_id], elo[m.home_team_id]);
      
      const actualH = hs > as ? 1 : hs === as ? 0.5 : 0;
      const actualA = 1 - actualH;
      
      elo[m.home_team_id] = updateElo(elo[m.home_team_id], expH, actualH);
      elo[m.away_team_id] = updateElo(elo[m.away_team_id], expA, actualA);
    }
    
    // Update form trackers
    for (const form of [staticForm, periodicForm, continuousForm]) {
      const homePts = hs > as ? 3 : hs === as ? 1 : 0;
      const awayPts = as > hs ? 3 : as === hs ? 1 : 0;
      form.addResult(m.home_team_id, homePts, hs, as, true);
      form.addResult(m.away_team_id, awayPts, as, hs, false);
    }
    
    // Update H2H
    for (const h2h of [staticH2H, periodicH2H, continuousH2H]) {
      h2h.addResult(m.home_team_id, m.away_team_id, hs, as);
    }
  }

  // Deep copy static state
  const staticEloCopy = JSON.parse(JSON.stringify(staticElo));
  const staticFormCopy = JSON.parse(JSON.stringify(staticForm.teams));
  const staticH2HCopy = JSON.parse(JSON.stringify(staticH2H.pairs));

  // ─── Phase 2: Evaluate on unseen matches ─────────────────────────────
  console.log("Phase 2: Evaluating on unseen matches...\n");

  const results = {
    static: { total: 0, correct: 0, byMarket: {}, byConfidence: {}, bySeason: {} },
    periodic: { total: 0, correct: 0, byMarket: {}, byConfidence: {}, bySeason: {} },
    continuous: { total: 0, correct: 0, byMarket: {}, byConfidence: {}, bySeason: {} },
  };

  const learningCurve = { static: [], periodic: [], continuous: [] };
  let periodicCounter = 0;

  for (let i = 0; i < evalMatches.length; i++) {
    const m = evalMatches[i];
    const hs = m.home_score;
    const as = m.away_score;
    const season = new Date(m.kickoff_time).getFullYear();

    // Get form and H2H for each system
    for (const [name, elo, form, h2h] of [
      ["static", staticEloCopy, staticForm, staticH2H],
      ["periodic", periodicElo, periodicForm, periodicH2H],
      ["continuous", continuousElo, continuousForm, continuousH2H],
    ]) {
      if (!elo[m.home_team_id]) elo[m.home_team_id] = 1500;
      if (!elo[m.away_team_id]) elo[m.away_team_id] = 1500;

      const homeForm = form.getForm(m.home_team_id);
      const awayForm = form.getForm(m.away_team_id);
      const h2hStats = h2h.getStats(m.home_team_id, m.away_team_id);

      const predictions = generatePredictions(
        homeForm, awayForm,
        elo[m.home_team_id], elo[m.away_team_id],
        h2hStats, 2.7
      );

      const outcomes = checkOutcomes(hs, as);
      const r = results[name];
      r.total++;

      // Find best prediction for this match
      let bestProb = 0;
      let bestMarket = "";
      let bestSelection = "";
      let bestCorrect = false;

      for (const [market, prob] of Object.entries(predictions.markets)) {
        const correct = outcomes[market];
        if (prob > bestProb) {
          bestProb = prob;
          bestMarket = market;
          bestSelection = market;
          bestCorrect = correct;
        }

        // Track per-market accuracy
        if (!r.byMarket[market]) r.byMarket[market] = { total: 0, correct: 0 };
        r.byMarket[market].total++;
        if (correct) r.byMarket[market].correct++;
      }

      // Track best market prediction
      if (bestCorrect) r.correct++;

      // Track by confidence
      const confBucket = Math.floor(bestProb * 10) * 10;
      const confKey = `${confBucket}-${confBucket + 10}%`;
      if (!r.byConfidence[confKey]) r.byConfidence[confKey] = { total: 0, correct: 0 };
      r.byConfidence[confKey].total++;
      if (bestCorrect) r.byConfidence[confKey].correct++;

      // Track by season
      if (!r.bySeason[season]) r.bySeason[season] = { total: 0, correct: 0 };
      r.bySeason[season].total++;
      if (bestCorrect) r.bySeason[season].correct++;

      // Learning curve (every 50 matches)
      if ((i + 1) % 50 === 0 || i === evalMatches.length - 1) {
        const accuracy = r.total > 0 ? (r.correct / r.total * 100) : 0;
        learningCurve[name].push({
          match: i + 1,
          accuracy: Number(accuracy.toFixed(1)),
          total: r.total,
          correct: r.correct,
        });
      }
    }

    // Update continuous learning after each match
    for (const elo of [continuousElo]) {
      const expH = expectedScore(elo[m.home_team_id], elo[m.away_team_id]);
      const expA = expectedScore(elo[m.away_team_id], elo[m.home_team_id]);
      const actualH = hs > as ? 1 : hs === as ? 0.5 : 0;
      const actualA = 1 - actualH;
      elo[m.home_team_id] = updateElo(elo[m.home_team_id], expH, actualH, 16);
      elo[m.away_team_id] = updateElo(elo[m.away_team_id], expA, actualA, 16);
    }
    continuousForm.addResult(m.home_team_id, hs > as ? 3 : hs === as ? 1 : 0, hs, as, true);
    continuousForm.addResult(m.away_team_id, as > hs ? 3 : as === hs ? 1 : 0, as, hs, false);
    continuousH2H.addResult(m.home_team_id, m.away_team_id, hs, as);

    // Update periodic every 200 matches
    periodicCounter++;
    if (periodicCounter >= 200) {
      periodicCounter = 0;
      for (const elo of [periodicElo]) {
        const expH = expectedScore(elo[m.home_team_id], elo[m.away_team_id]);
        const expA = expectedScore(elo[m.away_team_id], elo[m.home_team_id]);
        const actualH = hs > as ? 1 : hs === as ? 0.5 : 0;
        const actualA = 1 - actualH;
        elo[m.home_team_id] = updateElo(elo[m.home_team_id], expH, actualH, 16);
        elo[m.away_team_id] = updateElo(elo[m.away_team_id], expA, actualA, 16);
      }
      periodicForm.addResult(m.home_team_id, hs > as ? 3 : hs === as ? 1 : 0, hs, as, true);
      periodicForm.addResult(m.away_team_id, as > hs ? 3 : as === hs ? 1 : 0, as, hs, false);
      periodicH2H.addResult(m.home_team_id, m.away_team_id, hs, as);
    }
  }

  // ─── Phase 3: Results ────────────────────────────────────────────────
  console.log("━".repeat(60));
  console.log("📊 SIMULATION RESULTS — Best Market Per Match");
  console.log("━".repeat(60));
  console.log("");

  for (const [name, label] of [
    ["static", "A) Static Model"],
    ["periodic", "B) Periodic Retrain (every 200)"],
    ["continuous", "C) Continuous Learning"],
  ]) {
    const r = results[name];
    const acc = r.total > 0 ? (r.correct / r.total * 100).toFixed(1) : "0.0";
    console.log(`${label}:`);
    console.log(`  Accuracy: ${acc}% (${r.correct}/${r.total})`);
    console.log("");
  }

  // Market breakdown for continuous learning
  console.log("━".repeat(60));
  console.log("📊 MARKET BREAKDOWN (Continuous Learning)");
  console.log("━".repeat(60));
  console.log("");

  const marketOrder = [
    "1X2_Home", "1X2_Draw", "1X2_Away",
    "OU25_Over", "OU25_Under", "OU15_Over", "OU15_Under",
    "OU35_Over", "OU35_Under", "BTTS_Yes", "BTTS_No",
    "DC_HomeOrDraw", "DC_DrawOrAway", "DC_HomeOrAway",
  ];

  for (const market of marketOrder) {
    const r = results.continuous.byMarket[market];
    if (r && r.total > 0) {
      const acc = (r.correct / r.total * 100).toFixed(1);
      console.log(`  ${market.padEnd(20)} ${acc.padStart(5)}%  (${r.correct}/${r.total})`);
    }
  }

  // Confidence calibration
  console.log("");
  console.log("━".repeat(60));
  console.log("📊 CONFIDENCE CALIBRATION (Continuous Learning)");
  console.log("━".repeat(60));
  console.log("");

  const confKeys = Object.keys(results.continuous.byConfidence).sort();
  for (const key of confKeys) {
    const r = results.continuous.byConfidence[key];
    if (r.total > 0) {
      const acc = (r.correct / r.total * 100).toFixed(1);
      console.log(`  ${key.padEnd(12)} ${acc.padStart(5)}%  (${r.correct}/${r.total})`);
    }
  }

  // Season performance
  console.log("");
  console.log("━".repeat(60));
  console.log("📊 SEASON PERFORMANCE (Continuous Learning)");
  console.log("━".repeat(60));
  console.log("");

  for (const [name, label] of [
    ["static", "Static"],
    ["periodic", "Periodic"],
    ["continuous", "Continuous"],
  ]) {
    console.log(`${label}:`);
    for (const season of Object.keys(results[name].bySeason).sort()) {
      const r = results[name].bySeason[season];
      const acc = r.total > 0 ? (r.correct / r.total * 100).toFixed(1) : "0.0";
      console.log(`  ${season}: ${acc}% (${r.correct}/${r.total})`);
    }
    console.log("");
  }

  // Learning curve
  console.log("━".repeat(60));
  console.log("📈 LEARNING CURVE (Accuracy over time)");
  console.log("━".repeat(60));
  console.log("");
  console.log("Matches | Static  | Periodic | Continuous");
  console.log("--------|---------|----------|----------");

  for (let i = 0; i < learningCurve.continuous.length; i++) {
    const s = learningCurve.static[i];
    const p = learningCurve.periodic[i];
    const c = learningCurve.continuous[i];
    if (s && p && c) {
      console.log(
        `${String(c.match).padStart(7)} | ${String(s.accuracy + "%").padStart(7)} | ${String(p.accuracy + "%").padStart(8)} | ${String(c.accuracy + "%").padStart(9)}`
      );
    }
  }

  // ─── Save Results ────────────────────────────────────────────────────
  const output = {
    timestamp: new Date().toISOString(),
    totalMatches: totalMatches,
    trainingMatches: trainEnd,
    evaluationMatches: evalMatches.length,
    results: {
      static: {
        accuracy: results.static.total > 0 ? results.static.correct / results.static.total : 0,
        total: results.static.total,
        correct: results.static.correct,
      },
      periodic: {
        accuracy: results.periodic.total > 0 ? results.periodic.correct / results.periodic.total : 0,
        total: results.periodic.total,
        correct: results.periodic.correct,
      },
      continuous: {
        accuracy: results.continuous.total > 0 ? results.continuous.correct / results.continuous.total : 0,
        total: results.continuous.total,
        correct: results.continuous.correct,
      },
    },
    markets: results.continuous.byMarket,
    confidence: results.continuous.byConfidence,
    learningCurve,
  };

  const outputPath = path.join(__dirname, "..", "research", "simulation-results.json");
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(`\n💾 Results saved to ${outputPath}`);

  // ─── Final Summary ──────────────────────────────────────────────────
  console.log("\n" + "━".repeat(60));
  console.log("🏆 FINAL SUMMARY");
  console.log("━".repeat(60));
  console.log("");
  
  const staticAcc = (results.static.correct / results.static.total * 100).toFixed(1);
  const periodicAcc = (results.periodic.correct / results.periodic.total * 100).toFixed(1);
  const continuousAcc = (results.continuous.correct / results.continuous.total * 100).toFixed(1);
  
  console.log(`A) Static Model:          ${staticAcc}%`);
  console.log(`B) Periodic Retrain:      ${periodicAcc}%`);
  console.log(`C) Continuous Learning:   ${continuousAcc}%`);
  console.log("");
  
  const best = Math.max(parseFloat(staticAcc), parseFloat(periodicAcc), parseFloat(continuousAcc));
  console.log(`Best approach: ${best}%`);
  console.log(`Target: 84.2%`);
  console.log(`Status: ${best >= 84.2 ? "✅ TARGET MET" : "⚠️ Below target — need more features"}`);
  console.log("━".repeat(60));
}

main().catch((e) => { console.error("❌", e.message); process.exit(1); });
