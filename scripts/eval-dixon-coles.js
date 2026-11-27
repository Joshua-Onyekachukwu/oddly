#!/usr/bin/env node
/**
 * ODDLY — Walk-Forward Evaluation of the Dixon-Coles CHALLENGER
 *
 * Replays worker/models/market-dixon-coles.js (DixonColesTracker: EWMA
 * attack/defence ratings + bivariate-Poisson grid with DC tau correction)
 * over the 27,314-match research dataset, strictly walk-forward: each
 * match is predicted BEFORE its result is observed, then observe() updates
 * ratings. No future information is used.
 *
 * Comparison baselines:
 *   - data/eval/replay-latest.json            aggregate ensemble metrics
 *   - data/eval/replay-1x2-records.json       per-match ensemble probabilities
 *                                             (fin = post-recalibration 1X2,
 *                                             bttsY, o25) for paired/blend evals
 *
 * Blend analysis (honest): for 1X2 / BTTS / O2.5 we grid-search the ensemble↔DC
 * mixing weight on the FIRST HALF of the dataset only, then report metrics on
 * the SECOND HALF (untouched by selection). Full-sample grid is also shown
 * for reference but flagged in-sample.
 *
 * Usage: node scripts/eval-dixon-coles.js [--limit N]
 * Output: data/eval/dixon-coles-<ts>.json + data/eval/dixon-coles-latest.json
 */

const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const ROOT = path.join(__dirname, "..");
const DATASET = path.join(ROOT, "data", "research-dataset.json");
const RECORDS = path.join(ROOT, "data", "eval", "replay-1x2-records.json");
const REPLAY_LATEST = path.join(ROOT, "data", "eval", "replay-latest.json");
const OUT_DIR = path.join(ROOT, "data", "eval");

const dc = require(path.join(ROOT, "worker", "models", "market-dixon-coles.js"));

// ── Team normalizer (same transpile trick as eval-walk-forward-replay.js) ──
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

// ── Outcome helpers (identical semantics to eval-walk-forward-replay.js) ──
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

function wilsonCI(correct, n, z = 1.96) {
  if (!n) return [0, 0];
  const p = correct / n;
  const denom = 1 + z * z / n;
  const center = (p + z * z / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p) + z * z / (4 * n)) / n)) / denom;
  return [Math.max(0, center - half), Math.min(1, center + half)];
}
const pct = (x) => (x * 100).toFixed(1) + "%";

// Group DC flat markets map into per-group selection→prob (same parsing as replay)
function groupProbs(markets) {
  const byGroup = {};
  for (const [mk, prob] of Object.entries(markets)) {
    const parts = mk.split("_");
    const mkt = parts[0];
    const sel = parts.slice(1).join("_");
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
  }
  return byGroup;
}

// Accumulate per-group stats exactly like the replay harness
function accumulate(groupStats, byGroup, hs, as) {
  for (const [gkey, sels] of Object.entries(byGroup)) {
    const allowed = MARKET_GROUPS[gkey];
    const entries = allowed.filter((s) => sels[s] !== undefined).map((s) => [s, sels[s]]);
    if (!entries.length) continue;
    if (!groupStats[gkey]) groupStats[gkey] = { n: 0, correct: 0, brier: 0, logloss: 0, sumProb: 0, llClass: 0 };
    const g = groupStats[gkey];
    g.n++;
    entries.sort((a, b) => b[1] - a[1]);
    const [bestSel, bestProb] = entries[0];
    const mktName = gkey === "1X2" ? "1X2" : gkey === "BTTS" ? "BTTS" : gkey === "DNB" ? "DNB" : gkey === "DC" ? "DC" : gkey.startsWith("OU") ? "OU" : gkey.startsWith("HomeGoals") ? "HomeGoals" : "AwayGoals";
    const bestWon = selectionWon(mktName, bestSel, hs, as);
    if (bestWon) g.correct++;
    g.sumProb += bestProb;
    const tot = entries.reduce((s, [, p]) => s + p, 0) || 1;
    let brier = 0;
    for (const [s, p] of entries) {
      const pn = p / tot;
      const y = selectionWon(mktName, s, hs, as) ? 1 : 0;
      brier += (pn - y) * (pn - y);
    }
    g.brier += brier;
    for (const [s, p] of entries) {
      const pn = Math.min(Math.max(p / tot, 1e-6), 1 - 1e-6);
      const y = selectionWon(mktName, s, hs, as) ? 1 : 0;
      g.logloss += -(y * Math.log(pn) + (1 - y) * Math.log(1 - pn));
    }
    // proper multiclass log-loss on the normalized vector (1X2 mainly)
    if (gkey === "1X2") {
      const norm = entries.map(([, p]) => Math.min(Math.max(p / tot, 1e-9), 1));
      const t2 = norm.reduce((s, v) => s + v, 0);
      for (let k = 0; k < entries.length; k++) {
        const [s] = entries[k];
        if (selectionWon(mktName, s, hs, as)) {
          g.llClass += -Math.log(Math.min(Math.max(norm[k] / t2, 1e-9), 1));
        }
      }
    }
  }
}

function finalize(groupStats) {
  const out = {};
  for (const [g, v] of Object.entries(groupStats)) {
    out[g] = {
      n: v.n,
      argmaxAccuracy: +(v.correct / v.n).toFixed(4),
      ci95: wilsonCI(v.correct, v.n).map((x) => +x.toFixed(4)),
      meanBrier: +(v.brier / (v.n * MARKET_GROUPS[g].length)).toFixed(4),
      meanBinaryLogLoss: +(v.logloss / (v.n * MARKET_GROUPS[g].length)).toFixed(4),
      ...(g === "1X2" ? { multiclassLogLoss: +(v.llClass / v.n).toFixed(4) } : {}),
      meanTopProb: +(v.sumProb / v.n).toFixed(4),
    };
  }
  return out;
}

// ── Binary-metric helpers for blend analysis ──
function binLogloss(p, y) {
  p = Math.min(Math.max(p, 1e-6), 1 - 1e-6);
  return -(y * Math.log(p) + (1 - y) * Math.log(1 - p));
}
function brierBin(p, y) {
  return (p - y) * (p - y);
}
function accBin(p, y) {
  return (p >= 0.5 ? 1 : 0) === y ? 1 : 0;
}

function evalBinarySeries(pairs) {
  // pairs: [{p, y}] → {n, acc, logloss, brier}
  let correct = 0, ll = 0, br = 0;
  for (const { p, y } of pairs) {
    correct += accBin(p, y);
    ll += binLogloss(p, y);
    br += brierBin(p, y);
  }
  const n = pairs.length;
  return {
    n,
    acc: +(correct / n).toFixed(4),
    ci95: wilsonCI(correct, n).map((x) => +x.toFixed(4)),
    logloss: +(ll / n).toFixed(4),
    brier: +(br / n).toFixed(4),
  };
}

const RECAL_PATH = path.join(ROOT, "data", "calibration", "1x2-recal.json");

/**
 * replay-1x2-records.json stores PRE-recalibration probs (stage "fin" before
 * applyRecalibration in meta-ensemble.predictMatch). The production ensemble
 * applies data/calibration/1x2-recal.json (multinomial temp+bias on 1X2,
 * Platt on BTTS). We re-apply it here so the paired "ensemble" baseline is
 * the real production model (~46.5% 1X2 argmax), not the raw sub-model.
 */
function recalibrateRecords(records) {
  let recal = null;
  try { recal = JSON.parse(fs.readFileSync(RECAL_PATH, "utf8")); } catch { return records; }
  const theta = recal.theta;
  const bp = recal.btts;
  for (const r of records) {
    if (Array.isArray(theta) && theta.length >= 3 && Array.isArray(r.fin)) {
      const [alpha, bH, bD] = theta;
      const p = [r.fin[0], r.fin[1], r.fin[2]];
      const s = [
        alpha * Math.log(Math.max(p[0], 1e-6)) + bH,
        alpha * Math.log(Math.max(p[1], 1e-6)) + bD,
        alpha * Math.log(Math.max(p[2], 1e-6)),
      ];
      const mx = Math.max(s[0], s[1], s[2]);
      const e = s.map((v) => Math.exp(v - mx));
      const t = e[0] + e[1] + e[2];
      r.finR = [e[0] / t, e[1] / t, e[2] / t];
    } else {
      r.finR = r.fin;
    }
    if (bp && typeof bp.a === "number" && typeof bp.b === "number" && typeof r.bttsY === "number") {
      const p = Math.min(Math.max(r.bttsY, 1e-6), 1 - 1e-6);
      const logit = Math.log(p / (1 - p));
      r.bttsYR = 1 / (1 + Math.exp(-(bp.a * logit + bp.b)));
    } else {
      r.bttsYR = r.bttsY;
    }
  }
  return records;
}

// 1X2 multiclass metrics for arbitrary prob triples
function eval1x2Series(triples, results) {
  // triples: [[h,d,a],...]; results: "H"|"D"|"A"
  let correct = 0, ll = 0;
  const idx = { H: 0, D: 1, A: 2 };
  for (let i = 0; i < triples.length; i++) {
    const t = triples[i];
    const s = t[0] + t[1] + t[2] || 1;
    const p = [t[0] / s, t[1] / s, t[2] / s];
    const best = p.indexOf(Math.max(...p));
    const yi = idx[results[i]];
    if (best === yi) correct++;
    ll += -Math.log(Math.min(Math.max(p[yi], 1e-9), 1));
  }
  const n = triples.length;
  return {
    n,
    argmaxAccuracy: +(correct / n).toFixed(4),
    ci95: wilsonCI(correct, n).map((x) => +x.toFixed(4)),
    multiclassLogLoss: +(ll / n).toFixed(4),
  };
}

// ── Main ──
async function main() {
  const args = process.argv.slice(2);
  const limit = args.includes("--limit") ? parseInt(args[args.indexOf("--limit") + 1]) : Infinity;

  const dataset = JSON.parse(fs.readFileSync(DATASET, "utf8"));
  let matches = dataset.data;
  if (limit !== Infinity) matches = matches.slice(0, limit);
  console.log(`[dc-eval] Dixon-Coles challenger over ${matches.length} matches (${dataset.date_range.from} → ${dataset.date_range.to})`);

  // Chronology check (records alignment depends on dataset order)
  let sorted = true;
  for (let i = 1; i < matches.length; i++) {
    if (matches[i].date < matches[i - 1].date) { sorted = false; break; }
  }
  console.log(`[dc-eval] dataset chronological: ${sorted}`);

  // Load ensemble per-match records + verify index alignment
  let records = null;
  if (fs.existsSync(RECORDS)) {
    records = JSON.parse(fs.readFileSync(RECORDS, "utf8")).records;
    let mismatches = 0;
    const checkN = Math.min(records.length, matches.length, 5000);
    for (let i = 0; i < checkN; i++) {
      if (records[i].d !== matches[i].date) mismatches++;
    }
    // also verify tail
    for (let i = Math.max(0, records.length - 500); i < Math.min(records.length, matches.length); i++) {
      if (records[i].d !== matches[i].date) mismatches++;
    }
    console.log(`[dc-eval] ensemble records: ${records.length}; date mismatches in sample: ${mismatches}`);
    if (mismatches > 0 || records.length !== matches.length) records = null;
    else {
      recalibrateRecords(records);
      console.log(`[dc-eval] applied post-hoc recalibration (1x2-recal.json) to ensemble records`);
    }
  }

  const tracker = new dc.DixonColesTracker();
  const groupStats = {};
  const outcomes = { H: 0, D: 0, A: 0 };

  // Per-match DC predictions kept for blend analysis (only if records align)
  const dcStore = records ? [] : null;

  let skipped = 0;
  const t0 = Date.now();
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const hs = m.home_goals, as = m.away_goals;
    if (hs == null || as == null) { skipped++; continue; }
    const home = normalizeTeamName(m.home_team);
    const away = normalizeTeamName(m.away_team);
    outcomes[m.result] = (outcomes[m.result] || 0) + 1;

    // PREDICT before observing (strict walk-forward)
    const pred = tracker.predict(home, away);
    accumulate(groupStats, groupProbs(pred.markets), hs, as);
    if (dcStore) {
      dcStore.push({
        i,
        res: m.result,
        hs, as,
        dc1x2: [pred.oneXtwo.home, pred.oneXtwo.draw, pred.oneXtwo.away],
        dcOver25: pred.markets["OU_Over_2.5"],
        dcBttsYes: pred.markets["BTTS_Yes"],
      });
    }
    // THEN update ratings
    tracker.observe(home, away, hs, as);

    if (i % 5000 === 0) console.log(`  ... ${i}/${matches.length} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  }

  const markets = finalize(groupStats);

  // ── Paired comparison + honest blend analysis vs ensemble records ──
  let blend = null;
  if (records && dcStore) {
    const half = Math.floor(matches.length / 2);
    // Build paired arrays aligned by index (dcStore[i].i === i for kept matches;
    // skipped matches break index alignment — rebuild keyed by i)
    const dcByI = new Map(dcStore.map((d) => [d.i, d]));

    const pairs1x2 = [];
    const pb = [], po = [];
    for (let i = 0; i < matches.length; i++) {
      const rec = records[i];
      const d = dcByI.get(i);
      const m = matches[i];
      if (!rec || !d || m.home_goals == null || rec.finR == null) continue;
      pairs1x2.push({ ens: rec.finR, ensPre: rec.fin, dc: d.dc1x2, res: d.res });
      pb.push({ ens: rec.bttsYR, dc: d.dcBttsYes, y: (m.home_goals > 0 && m.away_goals > 0) ? 1 : 0 });
      po.push({ ens: rec.o25, dc: d.dcOver25, y: (m.home_goals + m.away_goals) > 2.5 ? 1 : 0 });
    }

    function gridBlend(metricFn, getP, items, splitIdx) {
      // choose w on first half, evaluate second half; also full-sample grid
      const ws = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];
      const evalW = (w, arr) => metricFn(arr.map((it) => getP(it, w)));
      const first = items.slice(0, splitIdx);
      const second = items.slice(splitIdx);
      let bestW = 0, bestScore = -Infinity;
      for (const w of ws) {
        const s = evalW(w, first);
        // score by logloss (lower better) → use negative
        const score = -(s.logloss ?? s.multiclassLogLoss ?? 0);
        if (score > bestScore) { bestScore = score; bestW = w; }
      }
      return {
        chosenWeightOnFirstHalf: bestW,
        secondHalf: evalW(bestW, second),
        firstHalfAtChosen: evalW(bestW, first),
        secondHalfEnsembleOnly: evalW(0, second),
        secondHalfDcOnly: evalW(1, second),
        fullSampleGrid: ws.map((w) => ({ w, ...evalW(w, items) })),
      };
    }

    blend = {
      note: "Weight selected on first half only; second half is honest held-out. Ensemble probs = replay-1x2-records 'fin' (post-recalibration).",
      pairedN: pairs1x2.length,
      "1X2": gridBlend(
        (ps) => eval1x2Series(ps.map((p) => p.t), ps.map((p) => p.res)),
        (it, w) => ({ t: [
          (1 - w) * it.ens[0] + w * it.dc[0],
          (1 - w) * it.ens[1] + w * it.dc[1],
          (1 - w) * it.ens[2] + w * it.dc[2],
        ], res: it.res }),
        pairs1x2,
        Math.floor(pairs1x2.length / 2)
      ),
      BTTS: gridBlend(
        (ps) => evalBinarySeries(ps.map((p) => ({ p: p.p, y: p.y }))),
        (it, w) => ({ p: (1 - w) * it.ens + w * it.dc, y: it.y }),
        pb,
        Math.floor(pb.length / 2)
      ),
      "OU_2.5": gridBlend(
        (ps) => evalBinarySeries(ps.map((p) => ({ p: p.p, y: p.y }))),
        (it, w) => ({ p: (1 - w) * it.ens + w * it.dc, y: it.y }),
        po,
        Math.floor(po.length / 2)
      ),
    };

    // standalone ensemble + DC on same paired subset (sanity vs replay-latest)
    blend.standaloneOnPairedSet = {
      ensemble1x2_prerecal: eval1x2Series(pairs1x2.map((p) => p.ensPre), pairs1x2.map((p) => p.res)),
      ensemble1x2_recal: eval1x2Series(pairs1x2.map((p) => p.ens), pairs1x2.map((p) => p.res)),
      dc1x2: eval1x2Series(pairs1x2.map((p) => p.dc), pairs1x2.map((p) => p.res)),
    };
  }

  // ── Report ──
  const replayLatest = fs.existsSync(REPLAY_LATEST) ? JSON.parse(fs.readFileSync(REPLAY_LATEST, "utf8")) : null;
  const report = {
    generatedAt: new Date().toISOString(),
    model: "worker/models/market-dixon-coles.js DixonColesTracker (EWMA attack/defence + DC tau, rho=-0.10, homeAdv=1.22, alpha=0.02)",
    status: "CHALLENGER — not wired into production predict path",
    dataset: { path: "data/research-dataset.json", matches: matches.length, range: dataset.date_range, chronological: sorted },
    method: "Strict walk-forward: predict() before observe() per match; team names normalized via src/lib/football/team-normalizer.ts.",
    outcomeBaseRates: {
      home: +(outcomes.H / matches.length).toFixed(4),
      draw: +(outcomes.D / matches.length).toFixed(4),
      away: +(outcomes.A / matches.length).toFixed(4),
    },
    markets: markets,
    ensembleReference: replayLatest
      ? { file: "data/eval/replay-latest.json", markets: replayLatest.markets }
      : null,
    pairedBlendVsEnsemble: blend,
    skipped,
    runtimeSec: +((Date.now() - t0) / 1000).toFixed(1),
    trackerStats: tracker.stats(),
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const outPath = path.join(OUT_DIR, `dixon-coles-${stamp}.json`);
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "dixon-coles-latest.json"), JSON.stringify(report, null, 2));

  // ── Console summary ──
  console.log("\n═══ DIXON-COLES CHALLENGER — WALK-FORWARD RESULTS ═══");
  console.log(`Matches: ${matches.length} | skipped: ${skipped} | ${report.runtimeSec}s`);
  console.log(`Base rates — H:${pct(report.outcomeBaseRates.home)} D:${pct(report.outcomeBaseRates.draw)} A:${pct(report.outcomeBaseRates.away)}\n`);
  console.log("Market            n       Acc     95% CI              Brier   BinLogL  TopP");
  for (const [g, v] of Object.entries(markets).sort((a, b) => b[1].n - a[1].n)) {
    console.log(
      `${g.padEnd(17)}${String(v.n).padStart(7)}  ${(v.argmaxAccuracy * 100).toFixed(1).padStart(5)}%  [${(v.ci95[0] * 100).toFixed(1)}–${(v.ci95[1] * 100).toFixed(1)}]  ${String(v.meanBrier).padStart(6)}  ${String(v.meanBinaryLogLoss).padStart(7)}  ${v.meanTopProb.toFixed(3)}`
    );
  }
  if (blend) {
    console.log("\n── Paired vs ensemble (per-match records) ──");
    console.log(`pairedN=${blend.pairedN}`);
    console.log("1X2 standalone (paired set):");
    console.log(`  ensemble pre-recal acc=${blend.standaloneOnPairedSet.ensemble1x2_prerecal.argmaxAccuracy} ll=${blend.standaloneOnPairedSet.ensemble1x2_prerecal.multiclassLogLoss}`);
    console.log(`  ensemble recal    acc=${blend.standaloneOnPairedSet.ensemble1x2_recal.argmaxAccuracy} ll=${blend.standaloneOnPairedSet.ensemble1x2_recal.multiclassLogLoss}`);
    console.log(`  dc                acc=${blend.standaloneOnPairedSet.dc1x2.argmaxAccuracy} ll=${blend.standaloneOnPairedSet.dc1x2.multiclassLogLoss}`);
    for (const mk of ["1X2", "BTTS", "OU_2.5"]) {
      const b = blend[mk];
      console.log(`${mk}: chosen w=${b.chosenWeightOnFirstHalf} (first-half selection)`);
      console.log(`  2nd-half blend   : ${JSON.stringify(b.secondHalf)}`);
      console.log(`  2nd-half ensemble: ${JSON.stringify(b.secondHalfEnsembleOnly)}`);
      console.log(`  2nd-half dc-only : ${JSON.stringify(b.secondHalfDcOnly)}`);
    }
  }
  console.log(`\nReport: ${outPath}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
