#!/usr/bin/env node
/**
 * ODDLY — Walk-forward feature/prediction dump for 1X2 (and BTTS/OU2.5) calibration work.
 *
 * Same strict walk-forward replay as scripts/eval-walk-forward-replay.js, but instead
 * of only scoring argmax accuracy it dumps ONE compact record per match containing:
 *   - the exact feature vector fed to the ensemble
 *   - the raw 1X2 linear predictor z and stage-wise probabilities:
 *       raw    = market-1x2.predict output BEFORE draw-model adjustProbs
 *       adjusted = after modelDraw.adjustProbs
 *       final  = after cross-model refine + league adjust (= pred.markets 1X2_*)
 *   - draw model drawProb, BTTS_Yes, OU_Over_2.5 final probs
 *   - actual score + result
 *
 * Output: data/eval/replay-1x2-records.json  (consumed by scripts/fit-1x2-recal.js)
 *
 * Usage: node scripts/eval-dump-1x2-records.js [--limit N]
 */

const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const ROOT = path.join(__dirname, "..");
const DATASET = path.join(ROOT, "data", "research-dataset.json");
const OUT = path.join(ROOT, "data", "eval", "replay-1x2-records.json");

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
    return wc || null;
  } catch (e) {
    console.log(`[dump] weightConfig unavailable (${e.message}); using defaults`);
    return null;
  }
}

const ensemble = require(path.join(ROOT, "worker/models/meta-ensemble.js"));
const model1x2 = require(path.join(ROOT, "worker/models/market-1x2.js"));
const modelDraw = require(path.join(ROOT, "worker/models/market-draw.js"));
const modelGoals = require(path.join(ROOT, "worker/models/market-goals.js"));
const modelBtts = require(path.join(ROOT, "worker/models/market-btts.js"));
const modelDc = require(path.join(ROOT, "worker/models/market-dc.js"));
const crossSignals = require(path.join(ROOT, "worker/models/cross-model-signals.js"));

// ── copied from eval-walk-forward-replay.js (kept in sync) ──
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

// Recompute the exact z linear predictor of market-1x2.predict (research features
// have no referee/injury/cross-signal terms, but we replicate them anyway).
function computeZ(features, weightConfig) {
  const w = model1x2.getWeights(weightConfig);
  let z = w.intercept;
  z += features.eloDiff * w.eloDiff;
  z += features.homePPG * w.homePPG;
  z += features.awayPPG * w.awayPPG;
  z += features.homeGF * w.homeGF;
  z += features.homeGA * w.homeGA;
  z += features.awayGF * w.awayGF;
  z += features.awayGA * w.awayGA;
  z += features.cleanSheet * w.cleanSheet;
  z += features.homeWinRate * w.homeWinRate;
  z += features.awayWinRate * w.awayWinRate;
  z += features.streak * w.streak;
  z += features.fatigue * w.fatigue;
  z += features.h2h * w.h2h;
  if (features.refereeHomeBias) z += features.refereeHomeBias * 0.15;
  if (features.refereeYellowPerMatch) z += (features.refereeYellowPerMatch - 3.5) * -0.02 * 0.3;
  if (features.homeTeamRefWinRate && features.homeTeamRefMatches >= 3) z += (features.homeTeamRefWinRate - 0.46) * 0.08;
  if (features.awayTeamRefWinRate && features.awayTeamRefMatches >= 3) z += (0.30 - features.awayTeamRefWinRate) * 0.08;
  if (features.homeInjuryImpact || features.awayInjuryImpact) {
    z += (features.homeInjuryImpact || 0) + (features.awayInjuryImpact || 0) * -1;
  }
  return z;
}

async function main() {
  const args = process.argv.slice(2);
  const limit = args.includes("--limit") ? parseInt(args[args.indexOf("--limit") + 1]) : Infinity;

  const weightConfig = await fetchWeightConfig();
  const dataset = JSON.parse(fs.readFileSync(DATASET, "utf8"));
  let matches = dataset.data;
  if (limit !== Infinity) matches = matches.slice(0, limit);
  console.log(`[dump] Replaying over ${matches.length} matches`);

  const storeData = {
    weightConfig: weightConfig || undefined,
    leagueParams: { home_advantage: 65, goal_expectancy: 2.6 },
  };

  const eloWindow = [];
  let eloMap = {};
  const formMap = {};
  const lastMatchTs = {};

  const records = [];
  let skipped = 0, errors = 0;
  const t0 = Date.now();

  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const home = normalizeTeamName(m.home_team);
    const away = normalizeTeamName(m.away_team);
    const hs = m.home_goals, as = m.away_goals;
    if (hs == null || as == null) { skipped++; continue; }
    const matchTs = new Date(m.date + "T12:00:00Z").getTime();

    // ── Stage-by-stage reproduction of meta-ensemble.predictMatch ──
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

    // Replicate meta-ensemble.predictMatch internals to capture stage probs
    let rec;
    try {
      const result1x2raw = model1x2.predict(features, weightConfig);
      const z = computeZ(features, weightConfig);
      const drawResult = modelDraw.predict(features);
      const adjusted = modelDraw.adjustProbs(
        result1x2raw.home, result1x2raw.draw, result1x2raw.away, drawResult.drawProb
      );
      const result1x2 = { home: adjusted.home, draw: adjusted.draw, away: adjusted.away };
      const resultGoals = modelGoals.predict(features);
      const resultBtts = modelBtts.predict(features, resultGoals);
      const resultDc = modelDc.predict(result1x2, features);

      const initialOutputs = {
        oneXtwo: result1x2,
        goals: resultGoals,
        btts: resultBtts,
        dc: resultDc,
      };
      const signals = crossSignals.computeSignals(initialOutputs);
      const refined = crossSignals.refinePredictions(initialOutputs, signals);

      // league adjust (leagueParams = defaults → haAdjust = 0, goalRatio ~1)
      const lw = storeData.leagueParams;
      if (lw.home_advantage && features.eloDiff !== undefined) {
        const haAdjust = (lw.home_advantage - 65) / 65 * 0.02;
        refined.oneXtwo.home = Math.min(0.95, refined.oneXtwo.home + haAdjust);
        refined.oneXtwo.away = Math.max(0.05, refined.oneXtwo.away - haAdjust);
      }
      if (lw.goal_expectancy) {
        const goalRatio = lw.goal_expectancy / (resultGoals.expectedGoals || 2.6);
        if (Math.abs(goalRatio - 1) > 0.05) {
          refined.goals.over25 = Math.min(0.95, refined.goals.over25 * Math.sqrt(goalRatio));
          refined.goals.under25 = 1 - refined.goals.over25;
        }
      }

      rec = {
        i,
        d: m.date,
        lg: m.league,
        hs, as,
        res: hs > as ? "H" : hs === as ? "D" : "A",
        _features: features, // temp for sanity check, stripped before write
        _storeData: storeData,
        z: +z.toFixed(6),
        raw: [+result1x2raw.home.toFixed(6), +result1x2raw.draw.toFixed(6), +result1x2raw.away.toFixed(6)],
        drawP: +drawResult.drawProb.toFixed(6),
        adj: [+adjusted.home.toFixed(6), +adjusted.draw.toFixed(6), +adjusted.away.toFixed(6)],
        fin: [+refined.oneXtwo.home.toFixed(6), +refined.oneXtwo.draw.toFixed(6), +refined.oneXtwo.away.toFixed(6)],
        bttsY: +refined.btts.bttsYes.toFixed(6),
        o25: +refined.goals.over25.toFixed(6),
        // feature vector (compact, rounded)
        f: [
          +features.eloDiff.toFixed(3), +features.homePPG.toFixed(4), +features.awayPPG.toFixed(4),
          +features.homeGF.toFixed(4), +features.homeGA.toFixed(4), +features.awayGF.toFixed(4), +features.awayGA.toFixed(4),
          +features.cleanSheet.toFixed(4), +features.homeWinRate.toFixed(4), +features.awayWinRate.toFixed(4),
          +features.streak.toFixed(1), +features.fatigue.toFixed(3), +features.h2h.toFixed(3),
          +features.eloHome.toFixed(1), +features.eloAway.toFixed(1),
        ],
      };
    } catch (e) {
      errors++;
      continue;
    }

    // Sanity: replicated stage probs must equal ensemble.predictMatch output
    if (records.length % 1000 === 0) {
      const chk = ensemble.predictMatch(rec._features, rec._storeData);
      const e1 = Math.abs((chk.markets["1X2_Home"] || 0) - rec.fin[0]);
      const e2 = Math.abs((chk.markets["BTTS_Yes"] || 0) - rec.bttsY);
      if (e1 > 1e-4 || e2 > 1e-4) {
        console.log(`  !! MISMATCH at i=${i}: dHome=${e1} dBtts=${e2}`);
        errors++;
      }
    }
    delete rec._features;
    delete rec._storeData;
    records.push(rec);

    // Update walk-forward state
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

  // ── Sanity check: replicated stage probs == ensemble.predictMatch ──
  // Re-run predictMatch on ~200 spread-out matches' stored features? We didn't keep
  // full feature objects; instead verify z/raw/adj/fin consistency on records by
  // calling ensemble once on synthetic default features (cold-start equivalence is
  // already covered by the baseline doc). Here we just verify fin sums ≈ 1.
  let badSum = 0;
  for (const r of records) {
    const s = r.fin[0] + r.fin[1] + r.fin[2];
    if (Math.abs(s - 1) > 0.02) badSum++;
  }
  console.log(`[dump] records=${records.length} skipped=${skipped} errors=${errors} badSum=${badSum} runtime=${((Date.now() - t0) / 1000).toFixed(0)}s`);

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), weightConfigName: "production_v5", records }));
  console.log(`[dump] wrote ${OUT}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
