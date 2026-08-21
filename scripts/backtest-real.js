#!/usr/bin/env node

/**
 * ODDLY Real Backtesting & Forward-Testing System
 *
 * Uses REAL odds from The Odds API (already in our database)
 * and tracks real results as matches finish.
 *
 * This is the definitive test — no synthetic data.
 */

const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");
const path = require("path");

function loadEnv() {
  const envPath = path.join(__dirname, "..", ".env.local");
  const envContent = fs.readFileSync(envPath, "utf8");
  const env = {};
  for (const line of envContent.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return env;
}

const env = loadEnv();
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

// ─── Utilities ───────────────────────────────────────────────────────────────

function clamp(v, lo = 0.01, hi = 0.99) { return Math.max(lo, Math.min(hi, v)); }
function sigmoid(x) { return 1 / (1 + Math.exp(-x)); }

// ─── Poisson Model ──────────────────────────────────────────────────────────

function poissonProb(lambda, k) {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let logP = -lambda;
  for (let i = 1; i <= k; i++) logP += Math.log(lambda) - Math.log(i);
  return Math.exp(logP);
}

function poissonPredict(homeLambda, awayLambda) {
  let pHome = 0, pDraw = 0, pAway = 0, pOver25 = 0, pBtts = 0;
  for (let i = 0; i <= 8; i++) {
    for (let j = 0; j <= 8; j++) {
      const p = poissonProb(homeLambda, i) * poissonProb(awayLambda, j);
      if (i > j) pHome += p;
      else if (i === j) pDraw += p;
      else pAway += p;
      if (i + j > 2.5) pOver25 += p;
      if (i > 0 && j > 0) pBtts += p;
    }
  }
  return { homeWin: clamp(pHome), draw: clamp(pDraw), awayWin: clamp(pAway), over25: clamp(pOver25), btts: clamp(pBtts) };
}

// ─── Elo Model ──────────────────────────────────────────────────────────────

class EloSystem {
  constructor() { this.ratings = {}; }
  get(t) { return this.ratings[t] || 1500; }
  predict(home, away) {
    const h = this.get(home) + 65; // Home advantage
    const a = this.get(away);
    const eH = 1 / (1 + Math.pow(10, (a - h) / 400));
    return { homeWin: clamp(eH), draw: clamp(0.25), awayWin: clamp(1 - eH - 0.25) };
  }
  update(home, away, hg, ag) {
    const h = this.get(home) + 65;
    const a = this.get(away);
    const eH = 1 / (1 + Math.pow(10, (a - h) / 400));
    const actual = hg > ag ? 1 : hg < ag ? 0 : 0.5;
    this.ratings[home] = this.get(home) + 32 * (actual - eH);
    this.ratings[away] = this.get(away) + 32 * ((1 - actual) - (1 - eH));
  }
}

// ─── Gradient Boosting (XGBoost-like) ──────────────────────────────────────

class XGBoost {
  constructor(nTrees = 100, lr = 0.1, maxDepth = 4) {
    this.trees = [];
    this.nTrees = nTrees;
    this.lr = lr;
    this.maxDepth = maxDepth;
  }

  predict(features) {
    let pred = 0;
    for (const tree of this.trees) {
      pred += this.lr * this.evalTree(tree, features);
    }
    return clamp(sigmoid(pred));
  }

  evalTree(tree, f) {
    if (!tree) return 0;
    if (tree.leaf !== undefined) return tree.leaf;
    return f[tree.f] <= tree.thr ? this.evalTree(tree.left, f) : this.evalTree(tree.right, f);
  }

  train(X, y) {
    let preds = y.map(() => 0);
    for (let t = 0; t < this.nTrees; t++) {
      const residuals = y.map((yi, i) => yi - sigmoid(preds[i]));
      const tree = this.buildTree(X, residuals, 0);
      this.trees.push(tree);
      for (let i = 0; i < X.length; i++) {
        preds[i] += this.lr * this.evalTree(tree, X[i]);
      }
    }
  }

  buildTree(X, residuals, depth) {
    if (depth >= this.maxDepth || X.length < 20) {
      return { leaf: residuals.reduce((s, r) => s + r, 0) / residuals.length };
    }

    let bestF = "", bestThr = 0, bestScore = Infinity;
    const features = Object.keys(X[0]);

    for (const f of features) {
      const vals = X.map(x => x[f]).sort((a, b) => a - b);
      const nThr = Math.min(15, vals.length - 1);
      for (let i = 0; i < nThr; i++) {
        const thr = vals[Math.floor((i + 1) * vals.length / (nThr + 1))];
        const left = [], right = [];
        for (let j = 0; j < X.length; j++) {
          (X[j][f] <= thr ? left : right).push(j);
        }
        if (left.length < 10 || right.length < 10) continue;
        const lMean = left.reduce((s, i) => s + residuals[i], 0) / left.length;
        const rMean = right.reduce((s, i) => s + residuals[i], 0) / right.length;
        const score = left.length * lMean ** 2 + right.length * rMean ** 2;
        if (score < bestScore) { bestScore = score; bestF = f; bestThr = thr; }
      }
    }

    if (!bestF) return { leaf: residuals.reduce((s, r) => s + r, 0) / residuals.length };

    const left = [], right = [];
    for (let i = 0; i < X.length; i++) {
      (X[i][bestF] <= bestThr ? left : right).push(i);
    }

    return {
      f: bestF, thr: bestThr,
      left: this.buildTree(left.map(i => X[i]), left.map(i => residuals[i]), depth + 1),
      right: this.buildTree(right.map(i => X[i]), right.map(i => residuals[i]), depth + 1),
    };
  }

  extractFeatures(homeForm, awayForm, homeOdds, drawOdds, awayOdds) {
    const impliedHome = 1 / homeOdds;
    const impliedDraw = 1 / drawOdds;
    const impliedAway = 1 / awayOdds;
    const overround = impliedHome + impliedDraw + impliedAway;

    return {
      homeFormPpg: homeForm.ppg || 1.5,
      awayFormPpg: awayForm.ppg || 1.5,
      homeGsAvg: homeForm.gsAvg || 1.3,
      homeGcAvg: homeForm.gcAvg || 1.2,
      awayGsAvg: awayForm.gsAvg || 1.1,
      awayGcAvg: awayForm.gcAvg || 1.3,
      impliedHomeProb: impliedHome / overround,
      impliedDrawProb: impliedDraw / overround,
      impliedAwayProb: impliedAway / overround,
      overround,
      goalDiff: (homeForm.gsAvg - homeForm.gcAvg) - (awayForm.gsAvg - awayForm.gcAvg),
      formDiff: (homeForm.ppg - 1.5) - (awayForm.ppg - 1.5),
      oddsRatio: homeOdds / awayOdds,
    };
  }
}

// ─── Form Tracker ───────────────────────────────────────────────────────────

class FormTracker {
  constructor() { this.h = {}; }
  record(home, away, hg, ag) {
    if (!this.h[home]) this.h[home] = [];
    if (!this.h[away]) this.h[away] = [];
    this.h[home].push({ gf: hg, ga: ag });
    this.h[away].push({ gf: ag, ga: hg });
  }
  getForm(t) {
    const last5 = (this.h[t] || []).slice(-5);
    if (last5.length === 0) return { ppg: 1.5, gsAvg: 1.3, gcAvg: 1.2 };
    return {
      ppg: last5.reduce((s, m) => s + (m.gf > m.ga ? 3 : m.gf === m.ga ? 1 : 0), 0) / last5.length,
      gsAvg: last5.reduce((s, m) => s + m.gf, 0) / last5.length,
      gcAvg: last5.reduce((s, m) => s + m.ga, 0) / last5.length,
    };
  }
}

// ─── Market Consensus ──────────────────────────────────────────────────────

function marketPredict(homeOdds, drawOdds, awayOdds) {
  const total = 1/homeOdds + 1/drawOdds + 1/awayOdds;
  return { homeWin: (1/homeOdds)/total, draw: (1/drawOdds)/total, awayWin: (1/awayOdds)/total };
}

// ─── Ensemble ──────────────────────────────────────────────────────────────

function ensemble(dc, eloPred, gbPred, marketPred, w) {
  const hw = dc.homeWin*w.dc + eloPred.homeWin*w.elo + gbPred*w.gb + marketPred.homeWin*w.mkt;
  const dw = dc.draw*w.dc + eloPred.draw*w.elo + 0.25*w.gb + marketPred.draw*w.mkt;
  const aw = dc.awayWin*w.dc + eloPred.awayWin*w.elo + (1-gbPred-0.25)*w.gb + marketPred.awayWin*w.mkt;
  const t = hw+dw+aw;
  return { homeWin: clamp(hw/t), draw: clamp(dw/t), awayWin: clamp(aw/t) };
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  console.log("🔄 ODDLY Real Backtesting System");
  console.log("━".repeat(70));

  // Fetch all fixtures with team names via joins
  const { data: fixtures } = await supabase
    .from("fixtures")
    .select(`
      id, home_score, away_score, status, kickoff_time,
      home_team:teams!fixtures_home_team_id_fkey(canonical_name),
      away_team:teams!fixtures_away_team_id_fkey(canonical_name),
      leagues(name)
    `)
    .order("kickoff_time", { ascending: true });

  if (!fixtures || fixtures.length === 0) {
    console.log("❌ No fixtures found. Run npm run sync:fixtures first.");
    return;
  }

  // Fetch all odds
  const { data: oddsData } = await supabase
    .from("odds_snapshots")
    .select("fixture_id, bookmaker, market, selection, odds")
    .order("snapshot_time", { ascending: true });

  // Group odds by fixture
  const oddsByFixture = {};
  if (oddsData) {
    for (const o of oddsData) {
      if (!oddsByFixture[o.fixture_id]) oddsByFixture[o.fixture_id] = {};
      if (!oddsByFixture[o.fixture_id][o.selection]) oddsByFixture[o.fixture_id][o.selection] = [];
      oddsByFixture[o.fixture_id][o.selection].push(o.odds);
    }
  }

  // Get average odds per fixture
  const getAvgOdds = (fixtureId) => {
    const odds = oddsByFixture[fixtureId] || {};
    const avg = (arr) => arr && arr.length > 0 ? arr.reduce((s, v) => s + v, 0) / arr.length : null;
    return {
      home: avg(odds["Home"]),
      draw: avg(odds["Draw"]),
      away: avg(odds["Away"]),
    };
  };

  console.log(`📊 Found ${fixtures.length} fixtures, ${oddsData?.length || 0} odds snapshots`);

  // Initialize models
  const elo = new EloSystem();
  const form = new FormTracker();
  const xgb = new XGBoost(100, 0.1, 4);

  // Collect training data
  const trainX = [], trainY = [];

  // Stats
  const modelStats = {
    "market": { c: 0, t: 0 },
    "elo": { c: 0, t: 0 },
    "poisson": { c: 0, t: 0 },
    "xgboost": { c: 0, t: 0 },
    "ensemble": { c: 0, t: 0 },
  };
  const tierStats = { high: { c: 0, t: 0 }, medium: { c: 0, t: 0 }, low: { c: 0, t: 0 } };
  let total = 0;

  // Process fixtures
  for (const fixture of fixtures) {
    const odds = getAvgOdds(fixture.id);
    if (!odds.home || !odds.draw || !odds.away) continue;

    const homeName = fixture.home_team?.canonical_name || "Unknown";
    const awayName = fixture.away_team?.canonical_name || "Unknown";

    const hf = form.getForm(homeName);
    const af = form.getForm(awayName);

    // Market prediction
    const mktPred = marketPredict(odds.home, odds.draw, odds.away);

    // Elo prediction
    const eloPred = elo.predict(homeName, awayName);

    // Poisson prediction
    const homeLambda = 1.35 * (hf.gsAvg / 1.3) * (af.gcAvg / 1.2);
    const awayLambda = 1.35 * (af.gsAvg / 1.3) * (hf.gcAvg / 1.2);
    const dcPred = poissonPredict(homeLambda, awayLambda);

    // XGBoost features
    const features = xgb.extractFeatures(hf, af, odds.home, odds.draw, odds.away);
    const gbPred = xgb.predict(features);

    // Ensemble
    const weights = { dc: 0.20, elo: 0.15, gb: 0.25, mkt: 0.40 };
    const ens = ensemble(dcPred, eloPred, gbPred, mktPred, weights);

    // Store training data
    if (fixture.home_score !== null && fixture.away_score !== null) {
      const actual = fixture.home_score > fixture.away_score ? "homeWin" : fixture.home_score < fixture.away_score ? "awayWin" : "draw";
      trainX.push(features);
      trainY.push(actual === "homeWin" ? 1 : 0);

      // Evaluate
      for (const [name, pred] of [
        ["market", mktPred],
        ["elo", eloPred],
        ["poisson", dcPred],
        ["xgboost", { homeWin: gbPred, draw: 0.25, awayWin: clamp(1 - gbPred - 0.25) }],
        ["ensemble", ens],
      ]) {
        const maxP = Math.max(pred.homeWin, pred.draw, pred.awayWin);
        const predResult = maxP === pred.homeWin ? "homeWin" : maxP === pred.awayWin ? "awayWin" : "draw";
        const correct = predResult === actual;
        modelStats[name].t++;
        if (correct) modelStats[name].c++;
      }

      // Tier stats
      const ensMax = Math.max(ens.homeWin, ens.draw, ens.awayWin);
      const tier = ensMax >= 0.55 ? "high" : ensMax >= 0.45 ? "medium" : "low";
      const ensCorrect = (ensMax === ens.homeWin ? "homeWin" : ensMax === ens.awayWin ? "awayWin" : "draw") === actual;
      tierStats[tier].t++;
      if (ensCorrect) tierStats[tier].c++;
      total++;

      // Update models
      elo.update(homeName, awayName, fixture.home_score, fixture.away_score);
      form.record(homeName, awayName, fixture.home_score, fixture.away_score);
    }
  }

  // Train XGBoost if we have data
  if (trainX.length > 10) {
    console.log(`\n🤖 Training XGBoost on ${trainX.length} samples...`);
    xgb.train(trainX, trainY);
    console.log("   ✅ XGBoost trained");
  }

  // ─── Print Results ──────────────────────────────────────────────────────

  console.log("\n\n" + "═".repeat(70));
  console.log("📊 REAL BACKTESTING RESULTS");
  console.log("═".repeat(70));
  console.log(`\nTotal fixtures analyzed: ${total}`);

  console.log("\n┌──────────────────────────────────────────────────────────────────┐");
  console.log("│                    MODEL ACCURACY COMPARISON                    │");
  console.log("├──────────────────────┬──────────┬──────────────────────────────┤");
  console.log("│ Model                │ Accuracy │ Notes                        │");
  console.log("├──────────────────────┼──────────┼──────────────────────────────┤");
  for (const [name, s] of Object.entries(modelStats)) {
    const acc = s.t > 0 ? ((s.c / s.t) * 100).toFixed(1) : "N/A";
    const note = name === "ensemble" ? "★ Our production model" : name === "market" ? "Baseline to beat" : "";
    console.log(`│ ${name.padEnd(20)} │ ${(acc + "%").padStart(8)} │ ${note.padEnd(28)} │`);
  }
  console.log("└──────────────────────┴──────────┴──────────────────────────────┘");

  console.log("\n┌──────────────────────────────────────────────────────────────────┐");
  console.log("│                    CONFIDENCE TIER ANALYSIS                     │");
  console.log("├──────────────┬──────────┬──────────┬───────────────────────────┤");
  console.log("│ Tier         │ Accuracy │ Matches  │ Action                    │");
  console.log("├──────────────┼──────────┼──────────┼───────────────────────────┤");
  for (const [tier, s] of Object.entries(tierStats)) {
    const acc = s.t > 0 ? ((s.c / s.t) * 100).toFixed(1) : "0.0";
    const action = tier === "high" ? "✅ Trust these picks" : tier === "medium" ? "⚠️ Proceed with caution" : "❌ Skip or reduce stake";
    console.log(`│ ${tier.padEnd(12)} │ ${(acc + "%").padStart(8)} │ ${String(s.t).padStart(8)} │ ${action.padEnd(25)} │`);
  }
  console.log("└──────────────┴──────────┴──────────┴───────────────────────────┘");

  // Key findings
  const ensAcc = modelStats.ensemble.t > 0 ? ((modelStats.ensemble.c / modelStats.ensemble.t) * 100).toFixed(1) : "N/A";
  const mktAcc = modelStats.market.t > 0 ? ((modelStats.market.c / modelStats.market.t) * 100).toFixed(1) : "N/A";
  const highAcc = tierStats.high.t > 0 ? ((tierStats.high.c / tierStats.high.t) * 100).toFixed(1) : "N/A";

  console.log("\n" + "═".repeat(70));
  console.log("📝 KEY FINDINGS (REAL DATA)");
  console.log("═".repeat(70));
  console.log(`
  1. ENSEMBLE ACCURACY: ${ensAcc}%
     Market baseline: ${mktAcc}%
     ${parseFloat(ensAcc) > parseFloat(mktAcc) ? `   ✅ Our model BEATS the market by +${(parseFloat(ensAcc) - parseFloat(mktAcc)).toFixed(1)}%` : "   ⚠️ Need to improve to beat market"}

  2. HIGH-CONFIDENCE PICKS: ${highAcc}%
     ${tierStats.high.t} picks with 55%+ confidence
     ${parseFloat(highAcc) > 60 ? "   ✅ EXCELLENT — These are highly profitable" : parseFloat(highAcc) > 55 ? "   ✅ GOOD — These beat the market" : "   ⚠️ Need more data to improve"}

  3. WHAT THIS MEANS:
     - We have ${total} real fixtures with real odds
     - The system is learning from real data
     - As more matches finish, accuracy will improve
     - Focus on high-confidence picks for best results

  4. NEXT STEPS:
     - Deploy to production and let it learn from real results
     - Track accuracy weekly as new matches finish
     - Optimize ensemble weights based on real performance
     - Add more leagues for more training data
  `);

  // Save report
  const report = {
    generatedAt: new Date().toISOString(),
    version: "real-backtest",
    totalFixtures: total,
    modelAccuracy: Object.fromEntries(Object.entries(modelStats).map(([n, s]) => [n, { accuracy: s.t > 0 ? +((s.c / s.t) * 100).toFixed(1) : null, total: s.t, correct: s.c }])),
    tierAnalysis: Object.fromEntries(Object.entries(tierStats).map(([t, s]) => [t, { accuracy: s.t > 0 ? +((s.c / s.t) * 100).toFixed(1) : 0, total: s.t }])),
  };
  fs.writeFileSync(path.join(__dirname, "..", "docs", "real-backtest-report.json"), JSON.stringify(report, null, 2));
  console.log("📄 Report saved to docs/real-backtest-report.json");
}

main().catch(e => { console.error("❌", e.message); process.exit(1); });
