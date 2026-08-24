#!/usr/bin/env node

/**
 * ODDLY Ensemble Prediction Engine v5.0
 *
 * Combines three independent models:
 * 1. Poisson Model — score-line probabilities from attack/defense ratings
 * 2. Elo Model — win/draw/away probabilities from strength ratings
 * 3. Regression Model — logistic regression on 30+ computed features
 *
 * Ensemble weighting is learned from historical calibration.
 * StatsBomb xG data adjusts Poisson lambdas when available.
 */

const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");
const path = require("path");

// ─── Isotonic Calibration ────────────────────────────────────────────────
let calibrator = null;
try {
  const calPath = path.join(__dirname, "..", "models", "isotonic-calibrator.json");
  calibrator = JSON.parse(fs.readFileSync(calPath, "utf8"));
  console.log(`[calibrator] Loaded isotonic calibrator (${calibrator.dataset_size} samples)`);
} catch {
  console.log("[calibrator] No isotonic calibrator found — using raw probabilities");
}

function applyCalibration(rawProb) {
  if (!calibrator || !calibrator.calibrator) return rawProb;
  const { x_thresholds, y_thresholds } = calibrator.calibrator;
  if (!x_thresholds || !y_thresholds || x_thresholds.length < 2) return rawProb;
  // Linear interpolation on isotonic thresholds
  for (let i = 0; i < x_thresholds.length - 1; i++) {
    if (rawProb >= x_thresholds[i] && rawProb <= x_thresholds[i + 1]) {
      const t = (rawProb - x_thresholds[i]) / (x_thresholds[i + 1] - x_thresholds[i]);
      return Math.max(0.01, Math.min(0.99, y_thresholds[i] + t * (y_thresholds[i + 1] - y_thresholds[i])));
    }
  }
  // Clip to range
  return rawProb < x_thresholds[0] ? y_thresholds[0] : y_thresholds[y_thresholds.length - 1];
}

// ─── Env ─────────────────────────────────────────────────────────────────
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
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
      val = val.slice(1, -1);
    env[t.slice(0, i).trim()] = val;
  }
  return env;
}

const env = loadEnv();
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

function clamp(v, lo = 0.01, hi = 0.99) {
  return Math.max(lo, Math.min(hi, v));
}
function sigmoid(x) {
  return 1 / (1 + Math.exp(-x));
}

// ─── xG Data (StatsBomb + Understat) ──────────────────────────────────────
let xgData = {};    // StatsBomb (narrow but deep)
let understatTeams = {};  // Understat (broad coverage: 484 teams)
let understatMatches = []; // Match-level xG from Understat

try {
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "statsbomb-xg.json"), "utf8"));
  xgData = raw.features || {};
  console.log(`   📊 Loaded StatsBomb xG for ${Object.keys(xgData).length} teams`);
} catch {
  console.log("   ⚠️  No StatsBomb xG data found — using goal-based estimates");
}

try {
  const uRaw = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "understat-xg.json"), "utf8"));
  understatTeams = uRaw.teams || {};
  understatMatches = uRaw.matches || [];
  console.log(`   ⚽ Loaded Understat xG for ${Object.keys(understatTeams).length} teams, ${understatMatches.length} matches`);
} catch {
  console.log("   ⚠️  No Understat xG data found — using StatsBomb/goal estimates only");
}

// ─── Injury Data ──────────────────────────────────────────────────────
let injuryData = {};
try {
  const injRaw = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "premier-injuries.json"), "utf8"));
  const injuries = injRaw.injuries || [];
  // Index by team name
  for (const inj of injuries) {
    const team = inj.team_name;
    if (!injuryData[team]) injuryData[team] = [];
    injuryData[team].push(inj);
  }
  console.log(`   🏥 Loaded injury data for ${Object.keys(injuryData).length} teams`);
} catch {
  console.log("   ⚠️  No injury data found");
}

function getInjuryImpact(teamName) {
  if (!teamName) return { ruled_out: 0, suspended: 0, doubtful: 0, impact: 0 };
  const injuries = injuryData[teamName] || [];
  const ruled_out = injuries.filter(i => i.status === "injured").length;
  const suspended = injuries.filter(i => i.status === "suspended").length;
  const doubtful = injuries.filter(i => i.status && i.status.startsWith("doubtful")).length;
  // Each ruled-out player reduces win probability by ~2-3%
  const impact = -(ruled_out * 0.025 + suspended * 0.02 + doubtful * 0.01);
  return { ruled_out, suspended, doubtful, impact };
}

// Common team name aliases for lookup
const TEAM_ALIASES = {
  'psg': 'Paris Saint Germain',
  'paris saint-germain': 'Paris Saint Germain',
  'paris saint germain': 'Paris Saint Germain',
  'man utd': 'Manchester United',
  'man united': 'Manchester United',
  'man u': 'Manchester United',
  'man city': 'Manchester City',
  'ac milan': 'AC Milan',
  'inter milan': 'Internazionale',
  'inter': 'Internazionale',
  'internazionale': 'Internazionale',
  'juve': 'Juventus',
  'barca': 'Barcelona',
  'real madrid': 'Real Madrid',
  'bayern munich': 'Bayern Munich',
  'bayern': 'Bayern Munich',
  'bayern munchen': 'Bayern Munich',
  'atletico madrid': 'Atletico Madrid',
  'atletico': 'Atletico Madrid',
  'sporting cp': 'Sporting CP',
  'sporting': 'Sporting CP',
  'lyon': 'Olympique Lyonnais',
  'marseille': 'Olympique de Marseille',
  'leverkusen': 'Bayer Leverkusen',
  'dortmund': 'Borussia Dortmund',
  'leipzig': 'RB Leipzig',
  'monaco': 'Monaco',
  'lille': 'Lille',
};

// Unified xG lookup: prefer StatsBomb, fall back to Understat
function findXGProfile(teamName) {
  if (!teamName) return null;
  // Try StatsBomb first (deeper per-match data)
  if (xgData[teamName]) return { ...xgData[teamName], source: 'statsbomb' };
  // Resolve aliases
  const tn = (TEAM_ALIASES[teamName.toLowerCase()] || teamName).toLowerCase();
  // Also try StatsBomb with resolved name
  if (xgData[tn.charAt(0).toUpperCase() + tn.slice(1)]) return { ...xgData[tn.charAt(0).toUpperCase() + tn.slice(1)], source: 'statsbomb' };
  // Try Understat (broader coverage, uses latest season)
  let bestMatch = null;
  for (const [key, feat] of Object.entries(understatTeams)) {
    const keyName = key.split(/_EPL_|_La_liga_|_Bundesliga_|_Serie_A_|_Ligue_1_|_Eredivisie_|_Primeira_Liga_|_Championship_/)[0];
    const kn = keyName.toLowerCase();
    if (kn === tn) {
      if (!bestMatch || feat.season > bestMatch.season) bestMatch = feat;
      continue;
    }
    const shortWords = tn.split(/\s+/);
    const longWords = kn.split(/\s+/);
    if (shortWords.length <= longWords.length && shortWords.every(w => longWords.some(lw => lw.includes(w) || w.includes(lw)))) {
      if (!bestMatch || feat.season > bestMatch.season) bestMatch = feat;
    }
  }
  if (bestMatch) return { ...bestMatch, source: 'understat' };
  return null;
}

// ─── Odds Features ─────────────────────────────────────────────────────
let oddsFeatures = {};
try {
  const oddsRaw = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "odds-features.json"), "utf8"));
  oddsFeatures = oddsRaw.features || {};
  console.log(`   📊 Loaded odds features for ${Object.keys(oddsFeatures).length} fixtures`);
} catch {
  console.log("   ⚠️  No odds features found — using model-only predictions");
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
  let pH = 0,
    pD = 0,
    pA = 0;
  for (let i = 0; i < grid.length; i++)
    for (let j = 0; j < grid[i].length; j++) {
      if (i > j) pH += grid[i][j];
      else if (i === j) pD += grid[i][j];
      else pA += grid[i][j];
    }

  m["1X2_Home"] = clamp(pH);
  m["1X2_Draw"] = clamp(pD);
  m["1X2_Away"] = clamp(pA);
  m["DC_1X"] = clamp(pH + pD);
  m["DC_X2"] = clamp(pD + pA);
  m["DC_12"] = clamp(pH + pA);
  const dnb = pH + pA;
  m["DNB_Home"] = dnb > 0 ? clamp(pH / dnb) : 0.5;
  m["DNB_Away"] = dnb > 0 ? clamp(pA / dnb) : 0.5;

  // Totals
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

  // BTTS
  let btts = 0;
  for (let i = 1; i < grid.length; i++)
    for (let j = 1; j < grid[i].length; j++) btts += grid[i][j];
  m["BTTS_Yes"] = clamp(btts);
  m["BTTS_No"] = clamp(1 - btts);

  // Team goals
  let hO05 = 0,
    hO15 = 0,
    aO05 = 0,
    aO15 = 0;
  for (let i = 0; i < grid.length; i++)
    for (let j = 0; j < grid[i].length; j++) {
      if (i >= 1) hO05 += grid[i][j];
      if (i >= 2) hO15 += grid[i][j];
      if (j >= 1) aO05 += grid[i][j];
      if (j >= 2) aO15 += grid[i][j];
    }
  m["HomeGoals_Over_0.5"] = clamp(hO05);
  m["HomeGoals_Over_1.5"] = clamp(hO15);
  m["AwayGoals_Over_0.5"] = clamp(aO05);
  m["AwayGoals_Over_1.5"] = clamp(aO15);

  return m;
}

// ─── Elo Model ──────────────────────────────────────────────────────────
function eloWinProb(eloH, eloA, homeAdvantage = 65) {
  const hAdj = eloH + homeAdvantage;
  const eH = 1 / (1 + Math.pow(10, (eloA - hAdj) / 400));
  return eH;
}

// ─── Regression Model (Logistic) ────────────────────────────────────────
// Learned weights from historical calibration
const REG_WEIGHTS = {
  // Optimized via coordinate descent on 10,722 historical matches
  // Val Brier: 0.204237 (was 0.210747) — 3.1% improvement
  // Val Accuracy: 48.8% (was 47.4%) — +1.4%
  intercept: -0.5887,
  eloDiff: 0.0037,         // ↑ Elo matters more than we thought (was 0.0018)
  homePPG: 0.0025,          // ↓ Redundant with Elo (was 0.15)
  awayPPG: -0.1225,
  homeGoalsFor: 0.0938,
  homeGoalsAgainst: -0.1713, // ↑ Defense matters more (was -0.1)
  awayGoalsFor: 0.0738,
  awayGoalsAgainst: -0.1738, // ↑ Away defense matters more (was -0.08)
  cleanSheetRate: 0.4813,    // ↑↑ Defensive strength is KEY (was 0.2)
  homeWinRate: 0.0225,       // ↓ Redundant with Elo+PPG (was 0.18)
  awayWinRate: -0.1225,
  streak: 0.1338,            // ↑↑ Momentum signal is strong (was 0.04)
  fatigue: 0.02,
  h2hHomeWins: 0.1738,       // ↑↑ H2H matters more (was 0.08)
  homeXG: 0.1338,            // StatsBomb xG adjustment
  awayXG: -0.1012,
  homeXGDiff: 0.06,          // xG - actual goals (finishing quality)
  awayXGDiff: -0.05,
  shotsDiff: 0.003,
  bigChancesDiff: 0.02,
};function regressionProb(features, refFeatures) {
  let z = REG_WEIGHTS.intercept;

  z += features.eloDiff * REG_WEIGHTS.eloDiff;
  z += features.homePPG * REG_WEIGHTS.homePPG;
  z += features.awayPPG * REG_WEIGHTS.awayPPG;
  z += features.homeGoalsFor * REG_WEIGHTS.homeGoalsFor;
  z += features.homeGoalsAgainst * REG_WEIGHTS.homeGoalsAgainst;
  z += features.awayGoalsFor * REG_WEIGHTS.awayGoalsFor;
  z += features.awayGoalsAgainst * REG_WEIGHTS.awayGoalsAgainst;
  z += features.cleanSheetRate * REG_WEIGHTS.cleanSheetRate;
  z += features.homeWinRate * REG_WEIGHTS.homeWinRate;
  z += features.awayWinRate * REG_WEIGHTS.awayWinRate;
  z += features.streak * REG_WEIGHTS.streak;
  z += features.fatigue * REG_WEIGHTS.fatigue;
  z += features.h2hHomeWins * REG_WEIGHTS.h2hHomeWins;
  z += (features.homeXG || 0) * REG_WEIGHTS.homeXG;
  z += (features.awayXG || 0) * REG_WEIGHTS.awayXG;
  z += (features.homeXGDiff || 0) * REG_WEIGHTS.homeXGDiff;
  z += (features.awayXGDiff || 0) * REG_WEIGHTS.awayXGDiff;
  z += (features.shotsDiff || 0) * REG_WEIGHTS.shotsDiff;
  z += (features.bigChancesDiff || 0) * REG_WEIGHTS.bigChancesDiff;

  // ─── Referee Features ────────────────────────────────────────────
  if (refFeatures) {
    // Home bias: positive = ref favors home team
    z += refFeatures.homeBias * 0.15;
    // Card strictness: strict refs → fewer goals → less likely home win
    const yellowEffect = (refFeatures.yellowPerMatch - 3.5) * -0.02;
    z += yellowEffect * 0.3;
    // Team-specific referee history
    if (refFeatures.homeTeamRef.matches >= 3) {
      z += (refFeatures.homeTeamRef.winRate - 0.46) * 0.08;
    }
    if (refFeatures.awayTeamRef.matches >= 3) {
      z += (0.30 - refFeatures.awayTeamRef.winRate) * 0.08;
    }
  }

  // ─── Injury Features ──────────────────────────────────────────────
  if (features.homeInjuries || features.awayInjuries) {
    const hInj = features.homeInjuries || { impact: 0 };
    const aInj = features.awayInjuries || { impact: 0 };
    // Injury disadvantage shifts z toward away team
    z += hInj.impact + aInj.impact * -1;
  }

  return sigmoid(z);
}

// ─── Ensemble Combiner ──────────────────────────────────────────────────
// Weights learned from calibration (Poisson best for totals, Elo best for 1X2)
const ENSEMBLE_WEIGHTS = {
  // Optimized: shifted toward regression + Elo (Poisson less important)
  // 1X2: Poisson 0.17 (was 0.25), Elo 0.40 (was 0.35), Regression 0.43 (was 0.40)
  x12: { poisson: 0.17, elo: 0.40, regression: 0.43 },
  // For totals (over/under) — Poisson still dominant for goal totals
  totals: { poisson: 0.55, elo: 0.15, regression: 0.30 },
  // For BTTS
  btts: { poisson: 0.50, elo: 0.10, regression: 0.40 },
  // For double chance / DNB
  dc: { poisson: 0.35, elo: 0.30, regression: 0.35 },
};

function ensembleCombine(poissonMarkets, eloProb, regressionProb, features) {
  const result = {};

  // 1X2 — blend all three models
  const pH_poisson = poissonMarkets["1X2_Home"];
  const pD_poisson = poissonMarkets["1X2_Draw"];
  const pA_poisson = poissonMarkets["1X2_Away"];

  // Elo-derived draw and away
  const pD_elo = 1 - eloProb - (1 / (1 + Math.pow(10, -(features.eloDiff + 100) / 400)));
  const pA_elo = 1 - eloProb - Math.max(0.05, clamp(pD_elo));

  // Regression-derived 1X2
  const pH_reg = regressionProb;
  // Estimate draw from regression (regression gives home win prob)
  const pD_reg = clamp(0.25 + (features.eloDiff > 0 ? -0.05 : 0.05));
  const pA_reg = clamp(1 - pH_reg - pD_reg);

  // Ensemble 1X2
  const w = ENSEMBLE_WEIGHTS.x12;
  let eH = pH_poisson * w.poisson + eloProb * w.elo + pH_reg * w.regression;
  let eD = pD_poisson * w.poisson + Math.max(0.05, pD_elo) * w.elo + pD_reg * w.regression;
  let eA = pA_poisson * w.poisson + Math.max(0.05, pA_elo) * w.elo + pA_reg * w.regression;

  // Normalize
  const total = eH + eD + eA;
  eH /= total;
  eD /= total;
  eA /= total;

  result["1X2_Home"] = clamp(eH);
  result["1X2_Draw"] = clamp(eD);
  result["1X2_Away"] = clamp(eA);

  // Double Chance
  result["DC_1X"] = clamp(eH + eD);
  result["DC_X2"] = clamp(eD + eA);
  result["DC_12"] = clamp(eH + eA);

  // DNB
  const dnb = eH + eA;
  result["DNB_Home"] = dnb > 0 ? clamp(eH / dnb) : 0.5;
  result["DNB_Away"] = dnb > 0 ? clamp(eA / dnb) : 0.5;

  // Totals — blend Poisson totals with regression
  const tw = ENSEMBLE_WEIGHTS.totals;
  for (const line of [0.5, 1.5, 2.5, 3.5, 4.5]) {
    const poissonOver = poissonMarkets[`OU_Over_${line}`];
    // Regression estimate for totals based on combined expected goals
    const expectedTotal = features.homeXG || features.homeGoalsFor || 1.4;
    const expectedTotalAway = features.awayXG || features.awayGoalsFor || 1.1;
    const combinedExpected = expectedTotal + expectedTotalAway;
    const regressionOver = clamp(1 - Math.exp(-combinedExpected * (line === 0.5 ? 1.8 : line === 1.5 ? 1.2 : line === 2.5 ? 0.85 : line === 3.5 ? 0.6 : 0.4)));

    result[`OU_Over_${line}`] = clamp(poissonOver * tw.poisson + regressionOver * tw.regression);
    result[`OU_Under_${line}`] = clamp(1 - result[`OU_Over_${line}`]);
  }

  // BTTS — blend Poisson BTTS with regression
  const bw = ENSEMBLE_WEIGHTS.btts;
  const poissonBTTS = poissonMarkets["BTTS_Yes"];
  const regressionBTTS = clamp(
    sigmoid(
      -0.3 +
        features.homeGoalsFor * 0.2 +
        features.awayGoalsFor * 0.15 +
        features.homeGoalsAgainst * 0.1 +
        features.awayGoalsAgainst * 0.1
    )
  );
  result["BTTS_Yes"] = clamp(poissonBTTS * bw.poisson + regressionBTTS * bw.regression);
  result["BTTS_No"] = clamp(1 - result["BTTS_Yes"]);

  // Team goals (use Poisson directly — most accurate for these)
  result["HomeGoals_Over_0.5"] = poissonMarkets["HomeGoals_Over_0.5"];
  result["HomeGoals_Over_1.5"] = poissonMarkets["HomeGoals_Over_1.5"];
  result["AwayGoals_Over_0.5"] = poissonMarkets["AwayGoals_Over_0.5"];
  result["AwayGoals_Over_1.5"] = poissonMarkets["AwayGoals_Over_1.5"];

  return result;
}

// ─── Enhanced Team Tracker ──────────────────────────────────────────────
class EnhancedTracker {
  constructor() {
    this.history = {};
    this.elo = {};
    this.h2h = {};
    this.leagueTable = {};
  }

  recordMatch(home, away, hg, ag, date, leagueId) {
    if (!this.history[home]) this.history[home] = [];
    if (!this.history[away]) this.history[away] = [];
    this.history[home].push({ opp: away, gf: hg, ga: ag, isHome: true, date });
    this.history[away].push({ opp: home, gf: ag, ga: hg, isHome: false, date });
    if (this.history[home].length > 50) this.history[home].shift();
    if (this.history[away].length > 50) this.history[away].shift();

    const h2hKey = [home, away].sort().join(" vs ");
    if (!this.h2h[h2hKey]) this.h2h[h2hKey] = [];
    this.h2h[h2hKey].push({ home, away, hg, ag });

    if (leagueId) {
      if (!this.leagueTable[leagueId]) this.leagueTable[leagueId] = {};
      const lt = this.leagueTable[leagueId];
      for (const [team, gf, ga] of [
        [home, hg, ag],
        [away, ag, hg],
      ]) {
        if (!lt[team])
          lt[team] = { played: 0, won: 0, drawn: 0, gf: 0, ga: 0, pts: 0 };
        lt[team].played++;
        lt[team].gf += gf;
        lt[team].ga += ga;
        if (gf > ga) {
          lt[team].won++;
          lt[team].pts += 3;
        } else if (gf === ga) {
          lt[team].drawn++;
          lt[team].pts += 1;
        }
      }
    }

    this.updateElo(home, away, hg, ag);
  }

  updateElo(home, away, hg, ag) {
    const h = (this.elo[home] || 1500) + 65;
    const a = this.elo[away] || 1500;
    const eH = 1 / (1 + Math.pow(10, (a - h) / 400));
    const actual = hg > ag ? 1 : hg < ag ? 0 : 0.5;
    this.elo[home] = (this.elo[home] || 1500) + 32 * (actual - eH);
    this.elo[away] =
      (this.elo[away] || 1500) + 32 * ((1 - actual) - (1 - eH));
  }

  getTeamStats(team) {
    const hist = (this.history[team] || []).slice(-20);
    if (hist.length < 3)
      return {
        ppg: 1.5,
        goalsScored: 1.3,
        goalsConceded: 1.2,
        winRate: 0.4,
        homeWinRate: 0.45,
        awayWinRate: 0.3,
        cleanSheetRate: 0.25,
        bttsRate: 0.5,
        streak: 0,
        form5: "",
        homePPG: 1.6,
        awayPPG: 1.2,
        homeGoalsFor: 1.4,
        homeGoalsAgainst: 1.1,
        awayGoalsFor: 1.0,
        awayGoalsAgainst: 1.3,
        lastMatchDaysAgo: 7,
      };

    const recent5 = hist.slice(-5);
    const recent10 = hist.slice(-10);
    const homeMatches = hist.filter((m) => m.isHome).slice(-8);
    const awayMatches = hist.filter((m) => !m.isHome).slice(-8);
    const lastMatch = hist[hist.length - 1];
    const daysAgo = lastMatch?.date
      ? Math.floor(
          (Date.now() - new Date(lastMatch.date).getTime()) / 86400000
        )
      : 7;

    return {
      ppg:
        recent5.reduce(
          (s, m) => s + (m.gf > m.ga ? 3 : m.gf === m.ga ? 1 : 0),
          0
        ) / recent5.length,
      goalsScored: recent5.reduce((s, m) => s + m.gf, 0) / recent5.length,
      goalsConceded:
        recent5.reduce((s, m) => s + m.ga, 0) / recent5.length,
      winRate: recent5.filter((m) => m.gf > m.ga).length / recent5.length,
      homeWinRate:
        homeMatches.length > 0
          ? homeMatches.filter((m) => m.gf > m.ga).length /
            homeMatches.length
          : 0.45,
      awayWinRate:
        awayMatches.length > 0
          ? awayMatches.filter((m) => m.gf > m.ga).length /
            awayMatches.length
          : 0.3,
      cleanSheetRate:
        recent10.filter((m) => m.ga === 0).length / recent10.length,
      bttsRate:
        recent10.filter((m) => m.gf > 0 && m.ga > 0).length /
        recent10.length,
      streak: this.getStreak(hist),
      form5: recent5
        .map((m) => (m.gf > m.ga ? "W" : m.gf < m.ga ? "L" : "D"))
        .join(""),
      homePPG:
        homeMatches.length > 0
          ? homeMatches.reduce(
              (s, m) =>
                s + (m.gf > m.ga ? 3 : m.gf === m.ga ? 1 : 0),
              0
            ) / homeMatches.length
          : 1.6,
      awayPPG:
        awayMatches.length > 0
          ? awayMatches.reduce(
              (s, m) =>
                s + (m.gf > m.ga ? 3 : m.gf === m.ga ? 1 : 0),
              0
            ) / awayMatches.length
          : 1.2,
      homeGoalsFor:
        homeMatches.length > 0
          ? homeMatches.reduce((s, m) => s + m.gf, 0) /
            homeMatches.length
          : 1.4,
      homeGoalsAgainst:
        homeMatches.length > 0
          ? homeMatches.reduce((s, m) => s + m.ga, 0) /
            homeMatches.length
          : 1.1,
      awayGoalsFor:
        awayMatches.length > 0
          ? awayMatches.reduce((s, m) => s + m.gf, 0) /
            awayMatches.length
          : 1.0,
      awayGoalsAgainst:
        awayMatches.length > 0
          ? awayMatches.reduce((s, m) => s + m.ga, 0) /
            awayMatches.length
          : 1.3,
      lastMatchDaysAgo: daysAgo,
    };
  }

  getStreak(hist) {
    let streak = 0;
    for (let i = hist.length - 1; i >= 0; i--) {
      const won = hist[i].gf > hist[i].ga;
      const lost = hist[i].gf < hist[i].ga;
      if (streak >= 0 && won) streak++;
      else if (streak <= 0 && lost) streak--;
      else break;
    }
    return streak;
  }

  getH2H(home, away) {
    const key = [home, away].sort().join(" vs ");
    const matches = (this.h2h[key] || []).slice(-10);
    if (matches.length < 2)
      return { h2hHomeWins: 0.4, h2hDraws: 0.25, h2hAwayWins: 0.35 };
    let hW = 0;
    for (const m of matches) {
      const actualHome = m.home === home ? m.hg : m.ag;
      const actualAway = m.home === home ? m.ag : m.hg;
      if (actualHome > actualAway) hW++;
    }
    return { h2hHomeWins: hW / matches.length };
  }

  getFeatures(home, away, leagueId) {
    const hf = this.getTeamStats(home);
    const af = this.getTeamStats(away);
    const h2h = this.getH2H(home, away);
    const eloDiff =
      (this.elo[home] || 1500) - (this.elo[away] || 1500);

    const lt = this.leagueTable[leagueId] || {};
    const teams = Object.entries(lt).sort(
      (a, b) => b[1].pts - a[1].pts
    );
    const homePos =
      teams.findIndex(([t]) => t === home) + 1 || 10;
    const awayPos =
      teams.findIndex(([t]) => t === away) + 1 || 10;

    const homeGD = (lt[home]?.gf || 0) - (lt[home]?.ga || 0);
    const awayGD = (lt[away]?.gf || 0) - (lt[away]?.ga || 0);

    // ─── xG adjustments (Understat + StatsBomb) ──────────────────
    const homeXGData = findXGProfile(home);
    const awayXGData = findXGProfile(away);
    const homeXG = homeXGData?.avg_xg || null;
    const awayXG = awayXGData?.avg_xg || null;
    const homeXGDiff = homeXGData ? homeXG - (homeXGData.avg_goals || homeXGData.total_scored / Math.max(homeXGData.matches, 1)) : 0;
    const awayXGDiff = awayXGData ? awayXG - (awayXGData.avg_goals || awayXGData.total_scored / Math.max(awayXGData.matches, 1)) : 0;
    // Understat-specific features
    const homeXGA = homeXGData?.avg_xga || null;
    const awayXGA = awayXGData?.avg_xga || null;
    const homeXGLast5 = homeXGData?.xg_last5 || homeXG;
    const awayXGLast5 = awayXGData?.xg_last5 || awayXG;
    const homePPDA = homeXGData?.avg_ppda || null;
    const awayPPDA = awayXGData?.avg_ppda || null;

    // ─── Poisson lambdas with xG adjustment ───────────────────────
    const baseHomeLambda =
      hf.homeGoalsFor * (af.awayGoalsAgainst / 1.3);
    const baseAwayLambda =
      af.awayGoalsFor * (hf.homeGoalsAgainst / 1.3);

    // Blend xG with goal-based estimate, using Understat's home/away splits
    let homeLambda, awayLambda;
    if (homeXG && awayXG) {
      // Use Understat home/away splits when available (more accurate)
      const hXGHome = homeXGData?.home_xg || homeXG;
      const aXGAway = awayXGData?.away_xg || awayXG;
      const hXGDefHome = homeXGData?.home_xga || homeXGData?.avg_xga || baseHomeLambda;
      const aXGDefAway = awayXGData?.away_xga || awayXGData?.avg_xga || baseAwayLambda;
      
      // Home team: attack (home xG) vs defense (away xGA)
      homeLambda = clamp(
        (hXGHome * 0.55 + baseHomeLambda * 0.3 + (aXGDefAway > 0 ? aXGDefAway : baseHomeLambda) * 0.15) * 1.05,
        0.3, 4.5
      );
      // Away team: attack (away xG) vs defense (home xGA)
      awayLambda = clamp(
        (aXGAway * 0.55 + baseAwayLambda * 0.3 + (hXGDefHome > 0 ? hXGDefHome : baseAwayLambda) * 0.15) * 0.95,
        0.3, 4.5
      );
      
      // Apply recent form adjustment (last 5 matches xG trend)
      if (homeXGLast5 && homeXGLast5 > 0) {
        const homeFormRatio = homeXGLast5 / Math.max(homeXG, 0.1);
        homeLambda *= clamp(homeFormRatio, 0.85, 1.15);
      }
      if (awayXGLast5 && awayXGLast5 > 0) {
        const awayFormRatio = awayXGLast5 / Math.max(awayXG, 0.1);
        awayLambda *= clamp(awayFormRatio, 0.85, 1.15);
      }
      
      // PPDA pressing intensity adjustment
      if (homePPDA && awayPPDA && homePPDA > 0 && awayPPDA > 0) {
        const pressingEdge = (1 / homePPDA - 1 / awayPPDA) * 5;
        homeLambda *= clamp(1 + pressingEdge * 0.3, 0.9, 1.1);
        awayLambda *= clamp(1 - pressingEdge * 0.3, 0.9, 1.1);
      }
    } else {
      homeLambda = clamp(baseHomeLambda * (1 + eloDiff * 0.0003), 0.3, 4.5);
      awayLambda = clamp(baseAwayLambda * (1 - eloDiff * 0.0003), 0.3, 4.5);
    }

    // ─── Regression features ──────────────────────────────────────
    const regFeatures = {
      eloDiff,
      homePPG: hf.homePPG,
      awayPPG: af.awayPPG,
      homeGoalsFor: hf.homeGoalsFor,
      homeGoalsAgainst: hf.homeGoalsAgainst,
      awayGoalsFor: af.awayGoalsFor,
      awayGoalsAgainst: af.awayGoalsAgainst,
      cleanSheetRate: hf.cleanSheetRate - af.cleanSheetRate,
      homeWinRate: hf.homeWinRate,
      awayWinRate: af.awayWinRate,
      streak: hf.streak * 0.05 - af.streak * 0.03,
      fatigue:
        (hf.lastMatchDaysAgo - af.lastMatchDaysAgo) * 0.005,
      h2hHomeWins: h2h.h2hHomeWins - 0.4,
      homeXG: homeXG || hf.homeGoalsFor,
      awayXG: awayXG || af.awayGoalsFor,
      homeXGDiff,
      awayXGDiff,
      // Understat-specific features
      homeXGA: homeXGA || 0,
      awayXGA: awayXGA || 0,
      homeXGLast5: homeXGLast5 || 0,
      awayXGLast5: awayXGLast5 || 0,
      xgHomeAttackVsAwayDef: (homeXG || 0) - (awayXGA || 0),
      xgAwayAttackVsHomeDef: (awayXG || 0) - (homeXGA || 0),
      ppdaDiff: (homePPDA && awayPPDA) ? (awayPPDA - homePPDA) * 0.01 : 0,
      deepDiff: (homeXGData?.avg_deep || 0) - (awayXGData?.avg_deep || 0),
      shotsDiff: (homeXGData?.avg_shots || 10) - (awayXGData?.avg_shots || 10),
      bigChancesDiff:
        (homeXGData?.avg_big_chances || 1) -
        (awayXGData?.avg_big_chances || 1),
      xgNpxgRatio: (homeXGData?.npxg_ratio || 1) - (awayXGData?.npxg_ratio || 1),
      xgOverperformance: homeXGDiff - awayXGDiff,
    };

    // Look up odds features for this fixture pair
    // (will be set by main loop before calling getFeatures)
    const fixtureOdds = this._currentFixtureOdds || null;

    return {
      homeLambda,
      awayLambda,
      features: {
        ...regFeatures,
        homePos,
        awayPos,
        homeGD,
        awayGD,
        hf,
        af,
        oddsFeatures: fixtureOdds,
        homeInjuries: getInjuryImpact(home),
        awayInjuries: getInjuryImpact(away),
      },
    };
  }
}

// ─── Main ───────────────────────────────────────────────────────────────
async function main() {
  console.log("🎯 ODDLY Ensemble Prediction Engine v5.0");
  console.log("━".repeat(60));
  console.log("   Models: Poisson + Elo + Regression (Logistic)");
  console.log("   xG Source: StatsBomb Open Data");

  const tracker = new EnhancedTracker();

  // Load historical data
  console.log("\n   Loading historical matches...");
  let offset = 0;
  let loaded = 0;
  while (true) {
    const { data: batch } = await supabase
      .from("fixtures")
      .select(
        "home_score, away_score, kickoff_time, league_id, home:teams!fixtures_home_team_id_fkey(canonical_name), away:teams!fixtures_away_team_id_fkey(canonical_name)"
      )
      .eq("status", "finished")
      .not("home_score", "is", null)
      .order("kickoff_time", { ascending: true })
      .range(offset, offset + 999);
    if (!batch || batch.length === 0) break;
    for (const m of batch) {
      const home = m.home?.canonical_name;
      const away = m.away?.canonical_name;
      if (home && away)
        tracker.recordMatch(
          home,
          away,
          m.home_score,
          m.away_score,
          m.kickoff_time,
          m.league_id
        );
    }
    loaded += batch.length;
    offset += 999;
    if (batch.length < 1000) break;
  }
  console.log(`   Loaded ${loaded} historical matches`);

  // Get upcoming fixtures
  const now = new Date().toISOString();
  const { data: upcoming } = await supabase
    .from("fixtures")
    .select(
      `
      id, kickoff_time, league_id,
      home:teams!fixtures_home_team_id_fkey(canonical_name, logo),
      away:teams!fixtures_away_team_id_fkey(canonical_name, logo),
      league:leagues!fixtures_league_id_fkey(name, logo)
    `
    )
    .eq("status", "scheduled")
    .gte("kickoff_time", now)
    .order("kickoff_time", { ascending: true });

  if (!upcoming || upcoming.length === 0) {
    console.log("   No upcoming fixtures found.");
    return;
  }
  console.log(`   Found ${upcoming.length} upcoming fixtures\n`);

  // Get odds
  const fixtureIds = upcoming.map((f) => f.id);
  const { data: oddsData } = await supabase
    .from("odds_snapshots")
    .select("fixture_id, selection, odds")
    .in("fixture_id", fixtureIds);

  const oddsByFixture = {};
  if (oddsData) {
    for (const o of oddsData) {
      if (!oddsByFixture[o.fixture_id])
        oddsByFixture[o.fixture_id] = {};
      if (!oddsByFixture[o.fixture_id][o.selection])
        oddsByFixture[o.fixture_id][o.selection] = [];
      oddsByFixture[o.fixture_id][o.selection].push(o.odds);
    }
  }
  const avgOdds = (arr) =>
    arr && arr.length > 0
      ? arr.reduce((s, v) => s + v, 0) / arr.length
      : null;

  // Generate predictions
  let totalPredictions = 0;
  let eliteCount = 0;
  const predictions = [];

  for (const fixture of upcoming) {
    const home = fixture.home?.canonical_name;
    const away = fixture.away?.canonical_name;
    if (!home || !away) continue;

    // Set odds features for this fixture
    tracker._currentFixtureOdds = oddsFeatures[fixture.id] || null;

    const {
      homeLambda,
      awayLambda,
      features,
    } = tracker.getFeatures(home, away, fixture.league_id);

    // Get referee features for this match
    const refFeatures = getRefereeFeatures(home, away);

    // Referee-adjusted Poisson lambdas
    let adjHomeLambda = homeLambda;
    let adjAwayLambda = awayLambda;
    if (refFeatures.hasProfile && refFeatures.referee) {
      // 1) League-wide goal tendency
      const refGoalAdj = refFeatures.avgGoals / 2.6;
      adjHomeLambda = clamp(homeLambda * refGoalAdj, 0.3, 4.5);
      adjAwayLambda = clamp(awayLambda * refGoalAdj, 0.3, 4.5);
      // 2) Team-specific referee history (if 3+ matches each)
      const hMatches = refFeatures.homeTeamRef?.matches || 0;
      const aMatches = refFeatures.awayTeamRef?.matches || 0;
      if (hMatches >= 3 && aMatches >= 3) {
        const hRefStr = (refFeatures.homeTeamRef.winRate - 0.46);
        const aRefStr = (refFeatures.awayTeamRef.winRate - 0.30);
        const strDiff = hRefStr - aRefStr;
        adjHomeLambda = clamp(adjHomeLambda * (1 + strDiff * 0.25), 0.3, 4.5);
        adjAwayLambda = clamp(adjAwayLambda * (1 - strDiff * 0.25), 0.3, 4.5);
      }
      // 3) Referee home bias
      const homeBiasAdj = 1 + (refFeatures.homeBias - 0.46) * 0.15;
      adjHomeLambda = clamp(adjHomeLambda * homeBiasAdj, 0.3, 4.5);
      adjAwayLambda = clamp(adjAwayLambda / homeBiasAdj, 0.3, 4.5);
    }

    // Model 1: Poisson (referee-adjusted)
    const grid = poissonGoals(adjHomeLambda, adjAwayLambda);
    const poissonMarkets = computeMarkets(grid);

    // Model 2: Elo
    const eloProb = eloWinProb(
      tracker.elo[home] || 1500,
      tracker.elo[away] || 1500
    );

    // Model 3: Regression (with referee features)
    const regProb = regressionProb(features, refFeatures);

    // Ensemble: combine all three
    let ensembleMarkets = ensembleCombine(
      poissonMarkets,
      eloProb,
      regProb,
      features
    );

    // ─── Odds Blending ──────────────────────────────────────────────
    // When odds are available, blend model with market probabilities
    if (features.oddsFeatures) {
      const of = features.oddsFeatures;
      // Blend 1X2
      if (of.true_home && of.true_draw && of.true_away) {
        const bookmakerCount = of.bookmaker_count || 1;
        const consensus = (of.home_consensus + of.draw_consensus + of.away_consensus) / 3;
        const marketWeight = Math.min(0.35, 0.1 + (bookmakerCount * 0.05) + (consensus * 0.15));
        const modelWeight = 1 - marketWeight;
        ensembleMarkets["1X2_Home"] = clamp(ensembleMarkets["1X2_Home"] * modelWeight + of.true_home * marketWeight);
        ensembleMarkets["1X2_Draw"] = clamp(ensembleMarkets["1X2_Draw"] * modelWeight + of.true_draw * marketWeight);
        ensembleMarkets["1X2_Away"] = clamp(ensembleMarkets["1X2_Away"] * modelWeight + of.true_away * marketWeight);
        // Normalize to sum to 1
        const total = ensembleMarkets["1X2_Home"] + ensembleMarkets["1X2_Draw"] + ensembleMarkets["1X2_Away"];
        ensembleMarkets["1X2_Home"] /= total;
        ensembleMarkets["1X2_Draw"] /= total;
        ensembleMarkets["1X2_Away"] /= total;
      }
      // Blend BTTS (use market BTTS if available)
      if (of.true_btts_yes) {
        const bw = Math.min(0.3, 0.1 + (of.bookmaker_count || 1) * 0.05);
        ensembleMarkets["BTTS_Yes"] = clamp(ensembleMarkets["BTTS_Yes"] * (1 - bw) + of.true_btts_yes * bw);
        ensembleMarkets["BTTS_No"] = clamp(1 - ensembleMarkets["BTTS_Yes"]);
      }
    }

    // Find best market
    let bestMarket = null;
    let bestProb = 0;
    let bestRawProb = 0;
    for (const [mk, prob] of Object.entries(ensembleMarkets)) {
      const cal = applyCalibration(prob);
      if (cal > bestProb) {
        bestProb = cal;
        bestRawProb = prob;
        bestMarket = mk;
      }
    }

    // Confidence tier (based on calibrated probability)
    const tier =
      bestProb >= 0.70
        ? "ELITE"
        : bestProb >= 0.60
        ? "HIGH"
        : bestProb >= 0.50
        ? "MEDIUM"
        : "LOW";

    // Store predictions
    for (const [mk, prob] of Object.entries(ensembleMarkets)) {
      const selection = mk.includes("Home")
        ? "Home"
        : mk.includes("Away")
        ? "Away"
        : mk.includes("Draw")
        ? "Draw"
        : mk.split("_")
            .slice(1)
            .join("_");
      const calibratedProb = applyCalibration(prob);
      predictions.push({
        fixture_id: fixture.id,
        market: mk.split("_")[0],
        selection,
        model_probability: Math.round(calibratedProb * 10000) / 10000,
        raw_probability: Math.round(prob * 10000) / 10000,
        model_version: calibrator ? "v5.1-ensemble-calibrated" : "v5.0-ensemble",
      });
    }

    totalPredictions++;
    if (tier === "ELITE") eliteCount++;

    // ─── Push Notification for ELITE Picks ────────────────────────
    if (tier === "ELITE" && bestProb >= 0.75) {
      const notificationPayload = {
        type: "elite_pick",
        data: {
          fixture_id: fixture.id,
          match: `${home} vs ${away}`,
          market: bestMarket,
          selection: bestMarket.includes("Home") ? "Home" : bestMarket.includes("Away") ? "Away" : bestMarket.includes("Draw") ? "Draw" : bestMarket,
          probability: bestProb,
          tier,
          edge: features.oddsFeatures ? bestProb - (features.oddsFeatures.true_home || 0.33) : null,
          league: fixture.league?.name || "Unknown",
          kickoff: fixture.kickoff_time,
        },
      };
      // Store notification for API pickup
      try {
        const notifPath = path.join(__dirname, "..", "data", "pending-notifications.json");
        const existing = fs.existsSync(notifPath) ? JSON.parse(fs.readFileSync(notifPath, "utf8")) : [];
        existing.push({ ...notificationPayload.data, created_at: new Date().toISOString() });
        fs.writeFileSync(notifPath, JSON.stringify(existing.slice(-50), null, 2));
      } catch {}
    }

    const matchLabel = `${home} vs ${away}`;
    const leagueLabel = fixture.league?.name || "?";
    const xgLabel =
      features.homeXG && features.awayXG
        ? ` xG:${features.homeXG.toFixed(1)}-${features.awayXG.toFixed(1)}`
        : "";
    console.log(
      `  ${leagueLabel.padEnd(18)} ${matchLabel.padEnd(30)} Best: ${bestMarket} ${Math.round(
        bestProb * 100
      )}% [${tier}]${xgLabel}`
    );
  }

  // Batch insert predictions
  console.log(`\n   Inserting ${predictions.length} predictions...`);
  for (let i = 0; i < predictions.length; i += 50) {
    const batch = predictions.slice(i, i + 50);
    const { error } = await supabase.from("predictions").insert(batch);
    if (error) console.log(`   ⚠️  Batch error: ${error.message}`);
  }

  console.log(
    `\n${"━".repeat(60)}`
  );
  console.log(
    `✅ Generated ${totalPredictions} match predictions (${predictions.length} total market predictions)`
  );
  console.log(`   ELITE picks: ${eliteCount}`);
  console.log(`   Model: v5.0-ensemble (Poisson + Elo + Regression + xG)`);
  console.log(`${"━".repeat(60)}`);
}

main().catch((e) => {
  console.error("❌", e.message);
  process.exit(1);
});
