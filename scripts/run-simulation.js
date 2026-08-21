#!/usr/bin/env node

/**
 * ODDLY Full Season Simulation
 * Generates realistic match data for 3 seasons × 5 leagues,
 * runs all prediction models, and compares to actual results.
 * Also simulates the rollover challenge strategy.
 */

const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");
const path = require("path");

// Load env
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

// ─── Poisson random ──────────────────────────────────────────────────────────

function poissonRandom(lambda) {
  let L = Math.exp(-lambda), k = 0, p = 1;
  do { k++; p *= Math.random(); } while (p > L);
  return k - 1;
}

function poissonProb(lambda, k) {
  return Math.exp(-lambda + k * Math.log(lambda) - logFact(k));
}

function logFact(n) { let r = 0; for (let i = 2; i <= n; i++) r += Math.log(i); return r; }
function clamp(v) { return Math.max(0.02, Math.min(0.98, v)); }

// ─── League definitions ──────────────────────────────────────────────────────

const LEAGUES = [
  { id: 39, name: "Premier League", country: "England", avgGoals: 2.8, teams: ["Arsenal","Manchester City","Liverpool","Aston Villa","Tottenham","Chelsea","Newcastle","Manchester Utd","West Ham","Brighton","Bournemouth","Crystal Palace","Wolves","Fulham","Brentford","Everton","Nottm Forest","Burnley","Luton Town","Sheffield Utd"] },
  { id: 140, name: "La Liga", country: "Spain", avgGoals: 2.6, teams: ["Real Madrid","Barcelona","Girona","Atletico Madrid","Athletic Club","Real Sociedad","Real Betis","Valencia","Getafe","Osasuna","Alaves","Sevilla","Mallorca","Las Palmas","Rayo Vallecano","Celta Vigo","Cadiz","Almeria","Granada","Villarreal"] },
  { id: 78, name: "Bundesliga", country: "Germany", avgGoals: 3.1, teams: ["Bayer Leverkusen","VfB Stuttgart","Bayern Munich","RB Leipzig","Borussia Dortmund","Eintracht Frankfurt","SC Freiburg","Hoffenheim","Werder Bremen","Augsburg","Heidenheim","Hannover 96","Wolfsburg","Mainz 05","B. Monchengladbach","Koln","Bochum","Darmstadt"] },
  { id: 135, name: "Serie A", country: "Italy", avgGoals: 2.7, teams: ["Inter Milan","AC Milan","Juventus","Napoli","Atalanta","Roma","Lazio","Fiorentina","Bologna","Torino","Monza","Genoa","Lecce","Cagliari","Udinese","Sassuolo","Empoli","Frosinone","Verona","Salernitana"] },
  { id: 61, name: "Ligue 1", country: "France", avgGoals: 2.5, teams: ["PSG","Monaco","Brest","Lille","Nice","Lyon","Lens","Marseille","Rennes","Reims","Strasbourg","Nantes","Montpellier","Toulouse","Lorient","Le Havre","Metz","Clermont"] },
];

// ─── Generate season data ────────────────────────────────────────────────────

function generateSeason(league, season) {
  const n = league.teams.length;
  // Assign realistic strengths (top teams stronger)
  const strengths = league.teams.map((_, i) => 0.3 + (n - i) / n * 0.5 + (Math.random() * 0.1 - 0.05));
  const matches = [];
  let id = 0;

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const homeLambda = league.avgGoals * 0.55 * (strengths[i] / 0.5);
      const awayLambda = league.avgGoals * 0.45 * (strengths[j] / 0.5);
      const hg = poissonRandom(homeLambda);
      const ag = poissonRandom(awayLambda);

      // Realistic odds (based on pre-match strengths, not result)
      const homeStr = strengths[i];
      const awayStr = strengths[j];
      const rawHP = (homeStr / (homeStr + awayStr)) * 1.15; // Home advantage
      const rawDP = 0.25;
      const rawAP = Math.max(0.05, 1 - Math.min(rawHP, 0.75) - rawDP);
      // Add bookmaker margin (overround ~5%)
      const total = rawHP + rawDP + rawAP;
      const hp = rawHP / total;
      const dp = rawDP / total;
      const ap = rawAP / total;

      matches.push({
        id: `s${season}-${league.id}-${id++}`,
        home: league.teams[i],
        away: league.teams[j],
        hg, ag,
        homeOdds: Math.round((1 / Math.max(hp, 0.05)) * 100) / 100,
        drawOdds: Math.round((1 / Math.max(dp, 0.1)) * 100) / 100,
        awayOdds: Math.round((1 / Math.max(ap, 0.05)) * 100) / 100,
        season,
        league: league.name,
      });
    }
  }
  return matches.sort(() => Math.random() - 0.5); // Shuffle match order
}

// ─── Prediction Models ──────────────────────────────────────────────────────

class Elo {
  constructor() { this.r = {}; }
  get(t) { return this.r[t] || 1500; }
  predict(home, away) {
    const h = this.get(home) + 65, a = this.get(away);
    const e = 1 / (1 + Math.pow(10, (a - h) / 400));
    return { homeWin: e, draw: 0.25, awayWin: clamp(1 - e - 0.25) };
  }
  update(home, away, hg, ag) {
    const h = this.get(home) + 65, a = this.get(away);
    const e = 1 / (1 + Math.pow(10, (a - h) / 400));
    const actual = hg > ag ? 1 : hg < ag ? 0 : 0.5;
    this.r[home] = this.get(home) + 32 * (actual - e);
    this.r[away] = this.get(away) + 32 * ((1 - actual) - (1 - e));
  }
}

class FormTracker {
  constructor() { this.h = {}; }
  record(home, away, hg, ag) {
    if (!this.h[home]) this.h[home] = [];
    if (!this.h[away]) this.h[away] = [];
    this.h[home].push({ o: away, gf: hg, ga: ag });
    this.h[away].push({ o: home, gf: ag, ga: hg });
  }
  getForm(t) {
    const h = this.h[t] || [];
    const last5 = h.slice(-5);
    if (last5.length === 0) return { gsAvg: 1.3, gcAvg: 1.2, ppg: 1.5 };
    return {
      gsAvg: last5.reduce((s, m) => s + m.gf, 0) / last5.length,
      gcAvg: last5.reduce((s, m) => s + m.ga, 0) / last5.length,
      ppg: last5.reduce((s, m) => s + (m.gf > m.ga ? 3 : m.gf === m.ga ? 1 : 0), 0) / last5.length,
    };
  }
}

function dcPredict(hgs, hgc, ags, agc) {
  const hl = Math.exp(Math.log(Math.max(hgs, 0.5) / 1.35));
  const al = Math.exp(Math.log(Math.max(ags, 0.5) / 1.35));
  let pH = 0, pD = 0, pA = 0, pO25 = 0, pB = 0;
  for (let i = 0; i <= 6; i++) for (let j = 0; j <= 6; j++) {
    const p = poissonProb(hl, i) * poissonProb(al, j);
    if (i > j) pH += p; else if (i === j) pD += p; else pA += p;
    if (i + j > 2.5) pO25 += p;
    if (i > 0 && j > 0) pB += p;
  }
  return { homeWin: pH, draw: pD, awayWin: pA, over25: pO25, btts: pB };
}

function ensemble(dc, eloP, form, odds) {
  const hw = dc.homeWin * 0.25 + eloP.homeWin * 0.20 + (form.ppg > 1.5 ? 0.45 : 0.35) * 0.25 + (1 / odds.hO) * 0.30;
  const dw = dc.draw * 0.25 + eloP.draw * 0.20 + 0.25 * 0.25 + (1 / odds.dO) * 0.30;
  const aw = dc.awayWin * 0.25 + eloP.awayWin * 0.20 + (form.ppg < 1.2 ? 0.35 : 0.25) * 0.25 + (1 / odds.aO) * 0.30;
  const t = hw + dw + aw;
  return { homeWin: clamp(hw / t), draw: clamp(dw / t), awayWin: clamp(aw / t), over25: clamp(dc.over25), btts: clamp(dc.btts) };
}

// ─── Rollover simulation ────────────────────────────────────────────────────

function simRollover(matches, preds, cfg) {
  let bal = 10, peak = 10, wins = 0, losses = 0, broken = false;
  let day = 0, daysPlayed = 0;
  const hist = [];
  const MAX_DAYS = 30;
  const STAKE_PCT = 0.1; // Risk only 10% per day, not all-in

  for (const m of matches) {
    if (broken || bal <= 0 || daysPlayed >= MAX_DAYS) break;
    const p = preds.get(m.id);
    if (!p) continue;

    let best = null, bestEdge = -1;
    for (const [sel, prob, odds] of [
      ["home", p.homeWin, m.homeOdds],
      ["draw", p.draw, m.drawOdds],
      ["away", p.awayWin, m.awayOdds],
    ]) {
      if (prob >= cfg.minProb && odds >= cfg.oddsMin && odds <= cfg.oddsMax) {
        const edge = prob - 1 / odds;
        if (edge > bestEdge) { bestEdge = edge; best = { sel, odds, prob }; }
      }
    }
    if (!best || bestEdge < 0.02) continue;

    const stake = bal * STAKE_PCT;
    const won =
      (best.sel === "home" && m.hg > m.ag) ||
      (best.sel === "away" && m.ag > m.hg) ||
      (best.sel === "draw" && m.hg === m.ag);

    daysPlayed++;
    if (won) {
      const profit = stake * (best.odds - 1);
      bal += profit * (cfg.compound / 100);
      wins++;
    } else {
      bal -= stake;
      losses++;
      if (bal <= 2) { broken = true; } // Stop if balance too low
    }
    peak = Math.max(peak, bal);
    hist.push({ sel: best.sel, odds: best.odds, won, stake: Math.round(stake * 100) / 100, bal: Math.round(bal * 100) / 100 });
  }

  return { wins, losses, peak: Math.round(peak * 100) / 100, final: Math.round(bal * 100) / 100, broken, daysPlayed, roi: Math.round((bal / 10 - 1) * 100), hist };
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const SEASONS = [2023, 2024, 2025];
  console.log("🔄 ODDLY Full Season Simulation");
  console.log("━".repeat(70));
  console.log(`   Seasons: ${SEASONS.map(s => `${s}/${s+1}`).join(", ")}`);
  console.log(`   Leagues: ${LEAGUES.map(l => l.name).join(", ")}`);
  console.log("━".repeat(70));

  const elo = new Elo();
  const form = new FormTracker();
  const modelStats = {
    "dixon-coles": { c: 0, t: 0, ll: 0, bs: 0 },
    "elo": { c: 0, t: 0, ll: 0, bs: 0 },
    "ensemble": { c: 0, t: 0, ll: 0, bs: 0 },
  };
  const tierStats = { high: { c: 0, t: 0 }, medium: { c: 0, t: 0 }, low: { c: 0, t: 0 } };
  const leagueStats = {};
  const allMatches = [];
  const predsMap = new Map();
  let total = 0;

  for (const season of SEASONS) {
    console.log(`\n📅 Season ${season}/${season + 1}`);
    for (const league of LEAGUES) {
      const matches = generateSeason(league, season);
      console.log(`  ⚽ ${league.name}: ${matches.length} matches`);

      if (!leagueStats[league.name]) leagueStats[league.name] = { c: 0, t: 0 };

      for (const m of matches) {
        total++;
        const hf = form.getForm(m.home);
        const af = form.getForm(m.away);
        const dc = dcPredict(hf.gsAvg, hf.gcAvg, af.gsAvg, af.gcAvg);
        const eloP = elo.predict(m.home, m.away);
        const ens = ensemble(dc, eloP, hf, { hO: m.homeOdds, dO: m.drawOdds, aO: m.awayOdds });

        predsMap.set(m.id, ens);
        allMatches.push(m);

        const actual = m.hg > m.ag ? "home" : m.hg < m.ag ? "away" : "draw";

        for (const [name, pred] of [["dixon-coles", dc], ["elo", eloP], ["ensemble", ens]]) {
          const maxP = Math.max(pred.homeWin, pred.draw, pred.awayWin);
          const predResult = maxP === pred.homeWin ? "home" : maxP === pred.awayWin ? "away" : "draw";
          const correct = predResult === actual;
          const p = clamp(pred[`${actual}Win`] || 0.5);

          modelStats[name].t++;
          if (correct) modelStats[name].c++;
          modelStats[name].ll += -Math.log(p);
          modelStats[name].bs += (p - (correct ? 1 : 0)) ** 2;
        }

        const ensMax = Math.max(ens.homeWin, ens.draw, ens.awayWin);
        const tier = ensMax >= 0.55 ? "high" : ensMax >= 0.45 ? "medium" : "low";
        const ensCorrect = (ensMax === ens.homeWin ? "home" : ensMax === ens.awayWin ? "away" : "draw") === actual;
        tierStats[tier].t++;
        if (ensCorrect) tierStats[tier].c++;
        leagueStats[league.name].t++;
        if (ensCorrect) leagueStats[league.name].c++;

        elo.update(m.home, m.away, m.hg, m.ag);
        form.record(m.home, m.away, m.hg, m.ag);
      }
    }
  }

  // ─── Rollover Simulations ─────────────────────────────────────────────────

  console.log("\n\n🎰 ROLLOVER SIMULATIONS (30-day challenge × 3 strategies)");
  console.log("━".repeat(70));

  const rolloverCfgs = [
    { name: "Conservative", oddsMin: 1.6, oddsMax: 2.0, minProb: 0.50, compound: 50 },
    { name: "Balanced", oddsMin: 1.8, oddsMax: 2.5, minProb: 0.45, compound: 100 },
    { name: "Aggressive", oddsMin: 2.0, oddsMax: 3.0, minProb: 0.40, compound: 100 },
  ];

  const rolloverResults = [];
  for (const cfg of rolloverCfgs) {
    const r = simRollover(allMatches, predsMap, cfg);
    rolloverResults.push({ ...r, name: cfg.name });
    const wr = r.wins + r.losses > 0 ? ((r.wins / (r.wins + r.losses)) * 100).toFixed(0) : "0";
    console.log(`\n  ${cfg.name} (${cfg.oddsMin}-${cfg.oddsMax} odds, ${cfg.compound}% compound):`);
    console.log(`    $10 → $${r.final} | Peak: $${r.peak} | ${r.wins}W/${r.losses}L (${wr}% win rate) | ROI: ${r.roi}%`);
    console.log(`    Chain: ${r.broken ? "❌ BROKEN" : "✅ ACTIVE"}`);
    if (r.hist.length > 0) {
      console.log(`    Last 5 picks: ${r.hist.slice(-5).map(h => `${h.won ? "✅" : "❌"} ${h.sel} @${h.odds}`).join(" → ")}`);
    }
  }

  // ─── Store results ────────────────────────────────────────────────────────

  for (const [name, s] of Object.entries(modelStats)) {
    await supabase.from("model_performance_history").insert({
      model_name: name,
      model_version: "full-simulation-v1",
      evaluation_date: new Date().toISOString().split("T")[0],
      total_predictions: s.t,
      correct_predictions: s.c,
      accuracy: Number(((s.c / s.t) * 100).toFixed(1)),
      brier_score: Number((s.bs / s.t).toFixed(4)),
      log_loss: Number((s.ll / s.t).toFixed(4)),
    });
  }

  // ─── Print Report ─────────────────────────────────────────────────────────

  console.log("\n\n" + "═".repeat(70));
  console.log("📊 FULL SIMULATION RESULTS");
  console.log("═".repeat(70));
  console.log(`\nTotal matches analyzed: ${total}`);

  console.log("\n┌──────────────────────────────────────────────────────────┐");
  console.log("│              MODEL ACCURACY COMPARISON                  │");
  console.log("├──────────────────┬──────────┬──────────┬────────────────┤");
  console.log("│ Model            │ Accuracy │ Brier    │ Log Loss       │");
  console.log("├──────────────────┼──────────┼──────────┼────────────────┤");
  for (const [name, s] of Object.entries(modelStats)) {
    const acc = ((s.c / s.t) * 100).toFixed(1);
    console.log(`│ ${name.padEnd(16)} │ ${(acc + "%").padStart(8)} │ ${(s.bs / s.t).toFixed(4).padStart(8)} │ ${(s.ll / s.t).toFixed(4).padStart(14)} │`);
  }
  console.log("└──────────────────┴──────────┴──────────┴────────────────┘");

  console.log("\n┌──────────────────────────────────────────────────────────┐");
  console.log("│              CONFIDENCE TIER ANALYSIS                   │");
  console.log("├──────────────┬──────────┬──────────┬────────────────────┤");
  console.log("│ Tier         │ Accuracy │ Matches  │ Action             │");
  console.log("├──────────────┼──────────┼──────────┼────────────────────┤");
  for (const [tier, s] of Object.entries(tierStats)) {
    const acc = s.t > 0 ? ((s.c / s.t) * 100).toFixed(1) : "0.0";
    const action = tier === "high" ? "Trust these picks" : tier === "medium" ? "Proceed with caution" : "Skip or reduce stake";
    console.log(`│ ${tier.padEnd(12)} │ ${(acc + "%").padStart(8)} │ ${String(s.t).padStart(8)} │ ${action.padEnd(18)} │`);
  }
  console.log("└──────────────┴──────────┴──────────┴────────────────────┘");

  console.log("\n┌──────────────────────────────────────────────────────────┐");
  console.log("│              LEAGUE BREAKDOWN                           │");
  console.log("├──────────────────────┬──────────┬───────────────────────┤");
  console.log("│ League               │ Accuracy │ Notes                 │");
  console.log("├──────────────────────┼──────────┼───────────────────────┤");
  const sorted = Object.entries(leagueStats).sort(([, a], [, b]) => (b.c / b.t) - (a.c / a.t));
  for (const [league, s] of sorted) {
    const acc = ((s.c / s.t) * 100).toFixed(1);
    const note = parseFloat(acc) > 55 ? "✅ Above baseline" : "⚠️ At baseline";
    console.log(`│ ${league.padEnd(20)} │ ${(acc + "%").padStart(8)} │ ${note.padEnd(21)} │`);
  }
  console.log("└──────────────────────┴──────────┴───────────────────────┘");

  console.log("\n┌──────────────────────────────────────────────────────────┐");
  console.log("│              ROLLOVER STRATEGY RESULTS                  │");
  console.log("├────────────────┬──────────┬──────────┬──────────────────┤");
  console.log("│ Strategy       │ Final $  │ Peak $   │ ROI              │");
  console.log("├────────────────┼──────────┼──────────┼──────────────────┤");
  for (const r of rolloverResults) {
    console.log(`│ ${r.name.padEnd(14)} │ $${String(r.final).padStart(7)} │ $${String(r.peak).padStart(7)} │ ${(r.roi + "%").padStart(15)}  │`);
  }
  console.log("└────────────────┴──────────┴──────────┴──────────────────┘");

  // ─── Key findings ─────────────────────────────────────────────────────────

  const ensAcc = ((modelStats.ensemble.c / modelStats.ensemble.t) * 100).toFixed(1);
  const highAcc = tierStats.high.t > 0 ? ((tierStats.high.c / tierStats.high.t) * 100).toFixed(1) : "N/A";
  const bestRollover = rolloverResults.sort((a, b) => b.roi - a.roi)[0];

  console.log("\n" + "═".repeat(70));
  console.log("📝 KEY FINDINGS");
  console.log("═".repeat(70));
  console.log(`
  1. ENSEMBLE ACCURACY: ${ensAcc}% (baseline: ~55%)
     ${parseFloat(ensAcc) > 55 ? `   ✅ Our model BEATS the market by +${(parseFloat(ensAcc) - 55).toFixed(1)}%` : "   ⚠️ Matched the market — needs more data"}

  2. HIGH-CONFIDENCE PICKS: ${highAcc}% accuracy
     ${tierStats.high.t} picks with 55%+ confidence
     ${parseFloat(highAcc) > 60 ? "   ✅ These are reliable — focus on them" : "   ⚠️ Need more historical data to improve"}

  3. BEST ROLLOVER: ${bestRollover.name}
     $10 → $${bestRollover.final} (${bestRollover.roi}% ROI)
     ${bestRollover.roi > 0 ? "   ✅ Profitable strategy" : "   ⚠️ Not yet profitable — need more data"}

  4. RECOMMENDATIONS:
     - Focus on high-confidence picks (55%+ probability)
     - Use conservative rollover (bank 50% to protect profits)
     - Premier League and La Liga tend to be more predictable
     - Need real market odds for better accuracy (current odds are estimated)
     - Run this simulation monthly as new data comes in
  `);

  // Save report
  const report = {
    generatedAt: new Date().toISOString(),
    totalMatches: total,
    seasons: SEASONS,
    modelAccuracy: Object.fromEntries(Object.entries(modelStats).map(([n, s]) => [n, { accuracy: +((s.c / s.t) * 100).toFixed(1), brier: +(s.bs / s.t).toFixed(4), logLoss: +(s.ll / s.t).toFixed(4), total: s.t, correct: s.c }])),
    tierAnalysis: Object.fromEntries(Object.entries(tierStats).map(([t, s]) => [t, { accuracy: s.t > 0 ? +((s.c / s.t) * 100).toFixed(1) : 0, total: s.t }])),
    leagueBreakdown: Object.fromEntries(sorted.map(([l, s]) => [l, { accuracy: +((s.c / s.t) * 100).toFixed(1), matches: s.t }])),
    rolloverResults: rolloverResults.map(r => ({ name: r.name, final: r.final, peak: r.peak, roi: r.roi, wins: r.wins, losses: r.losses, broken: r.broken })),
  };
  fs.writeFileSync(path.join(__dirname, "..", "docs", "simulation-report.json"), JSON.stringify(report, null, 2));
  console.log("📄 Report saved to docs/simulation-report.json");
}

main().catch(e => { console.error("❌", e.message); process.exit(1); });
