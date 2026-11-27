#!/usr/bin/env node
/**
 * ODDLY — Honest Walk-Forward Evaluation of the PRODUCTION model
 *
 * Replays worker/models/meta-ensemble.js (the live v2.0-meta-ensemble used by
 * src/lib/models/ensemble.ts → cron/predict) over the 27,314-match research
 * dataset (data/research-dataset.json), computing features strictly
 * walk-forward — only matches before each fixture's date are visible.
 *
 * Feature construction mirrors src/lib/models/ensemble.ts +
 * src/app/api/v1/cron/predict/route.ts exactly:
 *   - Elo: K=32, +65 home advantage, rebuilt over rolling last-2000 finished
 *     matches (same as the predict cron's histFixtures window)
 *   - Form: last-15 matches per team via getTeamStats() logic
 *   - Rest days: days since team's previous match (30-day lookback, default 4)
 *   - h2h = 0.5 (hardcoded in prod), injuries = 0 (not in research features
 *     used by prod buildFeatures), leagueAvgGoals = 2.6, leagueHomeAdv = 65
 *   - storeData.weightConfig = production_v5 row from Supabase (≈ defaults)
 *
 * Also runs a COLD-START variant replicating what production currently does
 * on the new DB (0 finished fixtures → empty Elo/form → identical default
 * features for every match).
 *
 * Usage: node scripts/eval-walk-forward-replay.js [--cold-only] [--limit N]
 * Output: data/eval/replay-<timestamp>.json + data/eval/replay-latest.json
 */

const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const ROOT = path.join(__dirname, "..");
const DATASET = path.join(ROOT, "data", "research-dataset.json");
const OUT_DIR = path.join(ROOT, "data", "eval");

// ── Load team normalizer (transpile TS on the fly — same code prod uses) ──
function loadNormalizer() {
  const src = fs.readFileSync(path.join(ROOT, "src/lib/football/team-normalizer.ts"), "utf8");
  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const m = new module.constructor();
  m.paths = module.paths;
  m._compile(js, path.join(ROOT, "src/lib/football/team-normalizer.js"));
  return m.exports.normalizeTeamName;
}
const normalizeTeamName = loadNormalizer();

// ── Env + Supabase helpers (weightConfig; optional) ──
function loadEnv() {
  const envFile = path.join(ROOT, ".env.local");
  if (!fs.existsSync(envFile)) return;
  for (const line of fs.readFileSync(envFile, "utf8").split("\n")) {
    const mm = line.match(/^([^#=]+)=(.*)$/);
    if (mm) process.env[mm[1].trim()] = mm[2].trim().replace(/^"|"$/g, "");
  }
}
async function fetchWeightConfig() {
  try {
    loadEnv();
    const { createClient } = require("@supabase/supabase-js");
    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const { data: wc } = await sb
      .from("model_weight_config")
      .select("*")
      .eq("config_name", "production_v5")
      .maybeSingle();
    console.log(`[eval] weightConfig: ${wc ? "production_v5 loaded from DB" : "none (defaults)"}`);
    return wc || null;
  } catch (e) {
    console.log(`[eval] Supabase weightConfig unavailable (${e.message}); using defaults`);
    return null;
  }
}

// ── Production model (the actual live code) ──
const ensemble = require(path.join(ROOT, "worker/models/meta-ensemble.js"));

// ── Replicated from src/lib/models/ensemble.ts (getTeamStats + buildFeatures) ──
function getTeamStats(history) {
  const h = history.slice(-15);
  if (h.length < 3) {
    return {
      ppg: 1.5, homeGF: 1.4, homeGA: 1.1, awayGF: 1.0, awayGA: 1.3,
      scoresRate: 0.7, concedesRate: 0.75, homeWinRate: 0.45, awayWinRate: 0.30,
      cleanSheetRate: 0.30, streak: 0, matches: h.length,
    };
  }
  const r10 = h.slice(-10);
  const home = h.filter((m) => m.isHome).slice(-8);
  const away = h.filter((m) => !m.isHome).slice(-8);
  let streak = 0;
  for (let i = r10.length - 1; i >= 0; i--) {
    const m = r10[i];
    if (streak === 0) streak = m.gf > m.ga ? 1 : m.gf < m.ga ? -1 : 0;
    else if (streak > 0 && m.gf > m.ga) streak++;
    else if (streak < 0 && m.gf < m.ga) streak--;
    else break;
  }
  return {
    ppg: r10.slice(-5).reduce((s, m) => s + (m.gf > m.ga ? 3 : m.gf === m.ga ? 1 : 0), 0) / Math.min(5, r10.length),
    homeGF: home.reduce((s, m) => s + m.gf, 0) / Math.max(1, home.length),
    homeGA: home.reduce((s, m) => s + m.ga, 0) / Math.max(1, home.length),
    awayGF: away.reduce((s, m) => s + m.gf, 0) / Math.max(1, away.length),
    awayGA: away.reduce((s, m) => s + m.ga, 0) / Math.max(1, away.length),
    scoresRate: r10.filter((m) => m.gf > 0).length / Math.max(1, r10.length),
    concedesRate: r10.filter((m) => m.ga > 0).length / Math.max(1, r10.length),
    homeWinRate: home.filter((m) => m.gf > m.ga).length / Math.max(1, home.length),
    awayWinRate: away.filter((m) => m.gf > m.ga).length / Math.max(1, away.length),
    cleanSheetRate: r10.filter((m) => m.ga === 0).length / Math.max(1, r10.length),
    streak,
    matches: h.length,
  };
}

function buildFeatures(homeStats, awayStats, elo, homeName, awayName, extras = {}) {
  const homeElo = elo[homeName] || 1500;
  const awayElo = elo[awayName] || 1500;
  const ha = extras.leagueHomeAdvantage ?? 65;
  const eloDiff = homeElo - awayElo + ha;
  const restHome = extras.restDaysHome ?? 4;
  const restAway = extras.restDaysAway ?? 4;
  const fatigueHome = restHome < 2 ? -0.15 : restHome < 3 ? -0.05 : restHome > 7 ? -0.03 : 0;
  const fatigueAway = restAway < 2 ? -0.15 : restAway < 3 ? -0.05 : restAway > 7 ? -0.03 : 0;
  const fatigue = fatigueHome - fatigueAway;
  return {
    eloDiff, eloHome: homeElo, eloAway: awayElo,
    homePPG: homeStats.ppg, awayPPG: awayStats.ppg,
    homeGF: homeStats.homeGF, homeGA: homeStats.homeGA,
    awayGF: awayStats.awayGF, awayGA: awayStats.awayGA,
    cleanSheet: homeStats.cleanSheetRate,
    homeWinRate: homeStats.homeWinRate, awayWinRate: awayStats.awayWinRate,
    streak: homeStats.streak - awayStats.streak,
    fatigue, h2h: 0.5,
    homeGFavg: homeStats.homeGF, homeGAavg: homeStats.homeGA,
    awayGFavg: awayStats.awayGF, awayGAavg: awayStats.awayGA,
    leagueAvgGoals: 2.6,
    homeScoresRate: homeStats.scoresRate, awayScoresRate: awayStats.scoresRate,
    homeConcedesRate: homeStats.concedesRate, awayConcedesRate: awayStats.concedesRate,
    homeInjuryImpact: 0, awayInjuryImpact: 0,
    homeInjuriesRuledOut: 0, awayInjuriesRuledOut: 0,
    restDaysHome: restHome, restDaysAway: restAway,
    leagueHomeAdvantage: ha,
    homeName, awayName,
  };
}

// ── Outcome helpers (mirror checkPrediction in ensemble.ts) ──
function selectionWon(marketKey, selection, hs, as) {
  const total = hs + as;
  const homeWin = hs > as, draw = hs === as, awayWin = hs < as;
  const both = hs > 0 && as > 0;
  const sel = selection.toLowerCase();
  const mkt = marketKey.toLowerCase();
  if (mkt === "1x2") return (sel === "home" && homeWin) || (sel === "draw" && draw) || (sel === "away" && awayWin);
  if (mkt === "ou") {
    const line = parseFloat(sel.split("_").pop() || "2.5");
    if (sel.startsWith("over")) return total > line;
    if (sel.startsWith("under")) return total < line;
    return false;
  }
  if (mkt === "btts") return sel === "yes" ? both : !both;
  if (mkt === "dc") {
    if (sel === "1x") return hs >= as;
    if (sel === "x2") return hs <= as;
    if (sel === "12") return hs !== as;
  }
  if (mkt === "dnb") return sel === "home" ? homeWin : awayWin;
  if (mkt === "homegoals") return hs > parseFloat(sel.split("_").pop() || "0.5");
  if (mkt === "awaygoals") return as > parseFloat(sel.split("_").pop() || "0.5");
  return false;
}

// ── Stats helpers ──
function wilsonCI(correct, n, z = 1.96) {
  if (!n) return [0, 0];
  const p = correct / n;
  const denom = 1 + z * z / n;
  const center = (p + z * z / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p) + z * z / (4 * n)) / n)) / denom;
  return [Math.max(0, center - half), Math.min(1, center + half)];
}
const pct = (x) => (x * 100).toFixed(1) + "%";

// Market groups: sub-market key → list of selection suffixes evaluated as one decision
const MARKET_GROUPS = {
  "1X2": ["Home", "Draw", "Away"],
  "OU_0.5": ["Over_0.5", "Under_0.5"],
  "OU_1.5": ["Over_1.5", "Under_1.5"],
  "OU_2.5": ["Over_2.5", "Under_2.5"],
  "OU_3.5": ["Over_3.5", "Under_3.5"],
  "OU_4.5": ["Over_4.5", "Under_4.5"],
  "BTTS": ["Yes", "No"],
  "DC": ["1X", "X2", "12"],
  "DNB": ["Home", "Away"],
  "HomeGoals_0.5": ["Over_0.5"],
  "HomeGoals_1.5": ["Over_1.5"],
  "AwayGoals_0.5": ["Over_0.5"],
  "AwayGoals_1.5": ["Over_1.5"],
};

// ── Main replay ──
async function main() {
  const args = process.argv.slice(2);
  const limit = args.includes("--limit") ? parseInt(args[args.indexOf("--limit") + 1]) : Infinity;
  const coldOnly = args.includes("--cold-only");

  const weightConfig = await fetchWeightConfig();
  const dataset = JSON.parse(fs.readFileSync(DATASET, "utf8"));
  let matches = dataset.data;
  if (limit !== Infinity) matches = matches.slice(0, limit);
  console.log(`[eval] Replaying meta-ensemble v2.0 over ${matches.length} matches (${dataset.date_range.from} → ${dataset.date_range.to})`);

  // Prod always ends up with leagueParams={home_advantage:65,goal_expectancy:2.6}
  // (league_model_params rows are all defaults; missing rows fall back to the same).
  const storeData = {
    weightConfig: weightConfig || undefined,
    leagueParams: { home_advantage: 65, goal_expectancy: 2.6 },
  };

  // State (walk-forward)
  const eloWindow = [];           // last 2000 finished matches {h,a,hs,as}
  let eloMap = {};                // normalized name → rating (rebuilt per match)
  const formMap = {};             // normalized name → last-15 {gf,ga,isHome}
  const lastMatchTs = {};         // normalized name → timestamp of last match

  // Aggregators
  const groupStats = {};          // groupKey → {n, correct, brier, logloss, baseCorrect, baseN, probSum...}
  const leagueStats = {};         // league → {n, correct1x2, n1x2}
  const calBuckets = {};          // for 1X2 argmax prob calibration
  const periodStats = {};         // 1X2 accuracy: early vs recent half
  const marketRowStats = {};      // per market-selection row: {n, events}
  const outcomes = { H: 0, D: 0, A: 0 };
  let skipped = 0, errors = 0;
  const perMatch = [];            // compact per-match record for JSON output (sampled)

  const t0 = Date.now();
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const home = normalizeTeamName(m.home_team);
    const away = normalizeTeamName(m.away_team);
    const hs = m.home_goals, as = m.away_goals;
    if (hs == null || as == null) { skipped++; continue; }
    const matchTs = new Date(m.date + "T12:00:00Z").getTime();
    outcomes[m.result] = (outcomes[m.result] || 0) + 1;

    // Rebuild Elo over rolling last-2000 window (mirrors predict cron)
    eloMap = {};
    const w = eloWindow;
    for (let j = 0; j < w.length; j++) {
      const f = w[j];
      const h = (eloMap[f.h] || 1500) + 65;
      const a = eloMap[f.a] || 1500;
      const eH = 1 / (1 + Math.pow(10, (a - h) / 400));
      const actual = f.hs > f.as ? 1 : f.hs < f.as ? 0 : 0.5;
      eloMap[f.h] = (eloMap[f.h] || 1500) + 32 * (actual - eH);
      eloMap[f.a] = (eloMap[f.a] || 1500) + 32 * (1 - actual - (1 - eH));
    }

    const homeStats = getTeamStats(formMap[home] || []);
    const awayStats = getTeamStats(formMap[away] || []);

    // Rest days (30-day lookback like prod batch cache)
    let restHome = 4, restAway = 4;
    const lh = lastMatchTs[home], la = lastMatchTs[away];
    if (lh && matchTs - lh <= 30 * 86400000) {
      restHome = Math.max(1, Math.min(14, Math.round((matchTs - lh) / 86400000)));
    }
    if (la && matchTs - la <= 30 * 86400000) {
      restAway = Math.max(1, Math.min(14, Math.round((matchTs - la) / 86400000)));
    }

    const features = buildFeatures(homeStats, awayStats, eloMap, home, away, {
      restDaysHome: restHome, restDaysAway: restAway,
    });

    let pred;
    try {
      pred = ensemble.predictMatch(features, storeData);
    } catch (e) {
      errors++;
      continue;
    }
    if (!pred || !pred.markets) { errors++; continue; }

    // ── Evaluate each market group ──
    // Index markets: "1X2_Home" → group "1X2", selection "Home"
    const byGroup = {};
    for (const [mk, prob] of Object.entries(pred.markets)) {
      const parts = mk.split("_");
      const mkt = parts[0];
      const sel = parts.slice(1).join("_");
      // normalize group keys
      let gkey = null;
      if (mkt === "1X2") gkey = "1X2";
      else if (mkt === "OU") {
        const line = sel.match(/(\d\.\d)$/)?.[1] || "2.5";
        gkey = `OU_${line}`;
      } else if (mkt === "BTTS") gkey = "BTTS";
      else if (mkt === "DC") gkey = "DC";
      else if (mkt === "DNB") gkey = "DNB";
      else if (mkt === "HomeGoals") gkey = `HomeGoals_${sel.split("_").pop()}`;
      else if (mkt === "AwayGoals") gkey = `AwayGoals_${sel.split("_").pop()}`;
      if (!gkey || !MARKET_GROUPS[gkey]) continue;
      if (!byGroup[gkey]) byGroup[gkey] = {};
      byGroup[gkey][sel] = prob;
      // row-level stats (prod settle semantics: each stored selection is a row)
      const rowKey = `${mkt}_${sel}`;
      if (!marketRowStats[rowKey]) marketRowStats[rowKey] = { n: 0, events: 0, probSum: 0 };
      marketRowStats[rowKey].n++;
      marketRowStats[rowKey].probSum += prob;
      if (selectionWon(mkt, sel, hs, as)) marketRowStats[rowKey].events++;
    }

    for (const [gkey, sels] of Object.entries(byGroup)) {
      const allowed = MARKET_GROUPS[gkey];
      const entries = allowed.filter((s) => sels[s] !== undefined).map((s) => [s, sels[s]]);
      if (!entries.length) continue;
      if (!groupStats[gkey]) groupStats[gkey] = { n: 0, correct: 0, brier: 0, logloss: 0, baseCorrect: 0, sumProb: 0 };
      const g = groupStats[gkey];
      g.n++;
      // argmax pick
      entries.sort((a, b) => b[1] - a[1]);
      const [bestSel, bestProb] = entries[0];
      const mktName = gkey === "1X2" ? "1X2" : gkey === "BTTS" ? "BTTS" : gkey === "DNB" ? "DNB" : gkey === "DC" ? "DC" : gkey.startsWith("OU") ? "OU" : gkey.startsWith("HomeGoals") ? "HomeGoals" : "AwayGoals";
      const bestWon = selectionWon(mktName, bestSel, hs, as);
      if (bestWon) g.correct++;
      g.sumProb += bestProb;
      if (!g.pickDist) g.pickDist = {};
      g.pickDist[bestSel] = (g.pickDist[bestSel] || 0) + 1;
      // Brier over the group's probability vector (normalized to sum 1)
      const tot = entries.reduce((s, [, p]) => s + p, 0) || 1;
      let brier = 0;
      for (const [s, p] of entries) {
        const pn = p / tot;
        const y = selectionWon(mktName, s, hs, as) ? 1 : 0;
        brier += (pn - y) * (pn - y);
      }
      g.brier += brier;
      // binary logloss per selection (matches prod row semantics)
      for (const [s, p] of entries) {
        const pn = Math.min(Math.max(p / tot, 1e-6), 1 - 1e-6);
        const y = selectionWon(mktName, s, hs, as) ? 1 : 0;
        g.logloss += -(y * Math.log(pn) + (1 - y) * Math.log(1 - pn));
      }

      // calibration on 1X2 argmax
      if (gkey === "1X2") {
        const b = Math.min(0.99, Math.floor(bestProb * 10) / 10);
        if (!calBuckets[b]) calBuckets[b] = { n: 0, correct: 0, probSum: 0 };
        calBuckets[b].n++;
        calBuckets[b].probSum += bestProb;
        if (bestWon) calBuckets[b].correct++;
      }

      // league breakdown for 1X2
      if (gkey === "1X2") {
        if (!leagueStats[m.league]) leagueStats[m.league] = { n: 0, correct: 0, homeWins: 0 };
        leagueStats[m.league].n++;
        if (bestWon) leagueStats[m.league].correct++;
        if (hs > as) leagueStats[m.league].homeWins++;
        // recency split: last ~12 months of dataset (>= 2025-06-01)
        const period = m.date >= "2025-06-01" ? "recent" : "early";
        if (!periodStats[period]) periodStats[period] = { n: 0, correct: 0 };
        periodStats[period].n++;
        if (bestWon) periodStats[period].correct++;
      }
    }

    // Update state AFTER prediction (walk-forward)
    eloWindow.push({ h: home, a: away, hs, as });
    if (eloWindow.length > 2000) eloWindow.shift();
    for (const [team, gf, ga, isHome] of [[home, hs, as, true], [away, as, hs, false]]) {
      if (!formMap[team]) formMap[team] = [];
      formMap[team].push({ gf, ga, isHome });
      if (formMap[team].length > 15) formMap[team].shift();
      lastMatchTs[team] = matchTs;
    }

    if (i % 5000 === 0) console.log(`  ... ${i}/${matches.length} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  }

  // ── Cold-start variant: prod on empty DB produces IDENTICAL features for
  // every match (empty elo/form → defaults; restDays 4; h2h 0.5; league 65/2.6).
  // Verify by running once and scoring the single prediction vector.
  let coldStart = null;
  if (!coldOnly) {
    const probe = buildFeatures(getTeamStats([]), getTeamStats([]), {}, "x", "y", {});
    const coldPred = ensemble.predictMatch(probe, storeData);
    // Score this single vector against every match
    const cs = {};
    for (const gkey of Object.keys(MARKET_GROUPS)) cs[gkey] = { n: 0, correct: 0 };
    for (const m of matches) {
      const hs = m.home_goals, as = m.away_goals;
      if (hs == null || as == null) continue;
      for (const [gkey, sels] of Object.entries(cs)) {
        const entries = MARKET_GROUPS[gkey]
          .map((s) => {
            // find prob in coldPred.markets
            let prob;
            for (const [mk, p] of Object.entries(coldPred.markets)) {
              const parts = mk.split("_");
              const mkt = parts[0];
              const sel = parts.slice(1).join("_");
              let g2 = null;
              if (mkt === "1X2") g2 = "1X2";
              else if (mkt === "OU") g2 = `OU_${sel.match(/(\d\.\d)$/)?.[1] || "2.5"}`;
              else if (mkt === "BTTS") g2 = "BTTS";
              else if (mkt === "DC") g2 = "DC";
              else if (mkt === "DNB") g2 = "DNB";
              else if (mkt === "HomeGoals") g2 = `HomeGoals_${sel.split("_").pop()}`;
              else if (mkt === "AwayGoals") g2 = `AwayGoals_${sel.split("_").pop()}`;
              if (g2 === gkey && sel === s) { prob = p; break; }
            }
            return prob !== undefined ? [s, prob] : null;
          })
          .filter(Boolean);
        if (!entries.length) continue;
        entries.sort((a, b) => b[1] - a[1]);
        const [bestSel] = entries[0];
        const mktName = gkey === "1X2" ? "1X2" : gkey === "BTTS" ? "BTTS" : gkey === "DNB" ? "DNB" : gkey === "DC" ? "DC" : gkey.startsWith("OU") ? "OU" : gkey.startsWith("HomeGoals") ? "HomeGoals" : "AwayGoals";
        sels.n++;
        if (selectionWon(mktName, bestSel, hs, as)) sels.correct++;
      }
    }
    coldStart = {
      note: "Single static prediction — what prod emits today with 0 finished fixtures (empty Elo/form). All 1,056 live predictions should have ~identical probabilities per market.",
      markets: coldPred.markets,
      accuracy: Object.fromEntries(Object.entries(cs).map(([k, v]) => [k, { n: v.n, acc: +(v.correct / v.n).toFixed(4) }])),
    };
  }

  // ── Report ──
  const report = {
    generatedAt: new Date().toISOString(),
    model: "worker/models/meta-ensemble.js v2.0-meta-ensemble (production path via src/lib/models/ensemble.ts)",
    dataset: { path: "data/research-dataset.json", matches: matches.length, range: dataset.date_range },
    method: "Strict walk-forward replay: features computed only from matches before each fixture (rolling 2000-match Elo window, last-15 form, rest days). No league params, no injuries, h2h=0.5 — identical to current prod defaults.",
    outcomeBaseRates: {
      home: +(outcomes.H / matches.length).toFixed(4),
      draw: +(outcomes.D / matches.length).toFixed(4),
      away: +(outcomes.A / matches.length).toFixed(4),
    },
    markets: {},
    marketRowStats,
    calibration1x2: Object.fromEntries(
      Object.entries(calBuckets)
        .sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]))
        .map(([b, v]) => [b, { n: v.n, meanPred: +(v.probSum / v.n).toFixed(4), acc: +(v.correct / v.n).toFixed(4), ci: wilsonCI(v.correct, v.n).map((x) => +x.toFixed(4)) }])
    ),
    leagues1x2: Object.fromEntries(
      Object.entries(leagueStats)
        .sort((a, b) => b[1].n - a[1].n)
        .map(([l, v]) => [l, { n: v.n, acc: +(v.correct / v.n).toFixed(4), ci: wilsonCI(v.correct, v.n).map((x) => +x.toFixed(4)), homeWinRate: +(v.homeWins / v.n).toFixed(4) }])
    ),
    periodStats1x2: Object.fromEntries(
      Object.entries(periodStats).map(([k, v]) => [k, { n: v.n, acc: +(v.correct / v.n).toFixed(4), ci: wilsonCI(v.correct, v.n).map((x) => +x.toFixed(4)) }])
    ),
    coldStart,
    skipped,
    errors,
    runtimeSec: +((Date.now() - t0) / 1000).toFixed(1),
  };

  for (const [g, v] of Object.entries(groupStats)) {
    report.markets[g] = {
      n: v.n,
      argmaxAccuracy: +(v.correct / v.n).toFixed(4),
      ci95: wilsonCI(v.correct, v.n).map((x) => +x.toFixed(4)),
      meanBrier: +(v.brier / (v.n * MARKET_GROUPS[g].length)).toFixed(4),
      meanBinaryLogLoss: +(v.logloss / (v.n * MARKET_GROUPS[g].length)).toFixed(4),
      meanTopProb: +(v.sumProb / v.n).toFixed(4),
      pickDistribution: v.pickDist || {},
    };
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const outPath = path.join(OUT_DIR, `replay-${stamp}.json`);
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "replay-latest.json"), JSON.stringify(report, null, 2));

  // ── Console summary ──
  console.log("\n═══ WALK-FORWARD REPLAY RESULTS ═══");
  console.log(`Matches: ${matches.length} | skipped: ${skipped} | errors: ${errors} | ${report.runtimeSec}s`);
  console.log(`Base rates — H:${pct(report.outcomeBaseRates.home)} D:${pct(report.outcomeBaseRates.draw)} A:${pct(report.outcomeBaseRates.away)}\n`);
  console.log("Market            n       Acc     95% CI              Brier   LogLoss  MeanTopP");
  for (const [g, v] of Object.entries(report.markets).sort((a, b) => b[1].n - a[1].n)) {
    console.log(
      `${g.padEnd(17)}${String(v.n).padStart(7)}  ${(v.argmaxAccuracy * 100).toFixed(1).padStart(5)}%  [${(v.ci95[0] * 100).toFixed(1)}–${(v.ci95[1] * 100).toFixed(1)}]  ${String(v.meanBrier).padStart(6)}  ${String(v.meanBinaryLogLoss).padStart(7)}  ${v.meanTopProb.toFixed(3)}`
    );
  }
  if (coldStart) {
    console.log("\n── Cold-start (current prod, empty history) ──");
    for (const [k, v] of Object.entries(coldStart.accuracy)) {
      console.log(`  ${k.padEnd(18)} acc=${(v.acc * 100).toFixed(1)}%  (static pick)`);
    }
  }
  console.log(`\nReport: ${outPath}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
