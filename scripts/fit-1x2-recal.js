#!/usr/bin/env node
/**
 * ODDLY — 1X2 (+BTTS) recalibration fitting on walk-forward replay records.
 *
 * Input:  data/eval/replay-1x2-records.json  (from scripts/eval-dump-1x2-records.js)
 *
 * Honest protocol:
 *   - records are already strict walk-forward predictions (no leakage in features)
 *   - FIT on the first --train-frac (default 0.80) of records (chronological order)
 *   - VALIDATE on the held-out tail (last 20%) — the honest estimate
 *   - Optionally refit on ALL records for the deployable artifact (--fit-all)
 *
 * Candidates (1X2):
 *   base      : production final probs (fin) — the baseline
 *   biasOnly  : q_k ∝ p_k * exp(b_k)          (intercept/bias only, T=1)
 *   tempBias  : q_k ∝ p_k^(1/T) * exp(b_k)    (temperature + class biases)
 *   logitBias : same but on log(p) with per-class scale — same as tempBias actually
 *   fullMN    : multinomial logistic regression on the 14 raw features
 *               (diagnostic ceiling — shows how much signal the features carry)
 *   stageX    : same tempBias applied to 'raw'/'adj' stages (diagnosis)
 *
 * BTTS: Platt scaling on logit(bttsY): q = sigmoid(a*logit(p)+b)
 *
 * Output: data/calibration/1x2-recal.json (+ console report)
 *
 * Usage: node scripts/fit-1x2-recal.js [--train-frac 0.8] [--fit-all]
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const REC_PATH = path.join(ROOT, "data", "eval", "replay-1x2-records.json");
const OUT_DIR = path.join(ROOT, "data", "calibration");
const OUT_PATH = path.join(OUT_DIR, "1x2-recal.json");

const args = process.argv.slice(2);
const trainFrac = args.includes("--train-frac") ? parseFloat(args[args.indexOf("--train-frac") + 1]) : 0.8;
const fitAll = args.includes("--fit-all");

const data = JSON.parse(fs.readFileSync(REC_PATH, "utf8"));
const records = data.records;
const n = records.length;
const split = Math.floor(n * trainFrac);
const train = records.slice(0, split);
const tail = records.slice(split);
console.log(`[fit] records=${n} train=${train.length} tail=${tail.length}`);

// ── helpers ──
const CLIP = 1e-6;
function logit(p) { p = Math.min(Math.max(p, CLIP), 1 - CLIP); return Math.log(p / (1 - p)); }
function sigmoid(x) { return 1 / (1 + Math.exp(-x)); }

// softmax over 3 classes from score vector
function softmax3(s) {
  const mx = Math.max(s[0], s[1], s[2]);
  const e = [Math.exp(s[0] - mx), Math.exp(s[1] - mx), Math.exp(s[2] - mx)];
  const t = e[0] + e[1] + e[2];
  return [e[0] / t, e[1] / t, e[2] / t];
}

const YIDX = { H: 0, D: 1, A: 2 };

// ── tempBias model: q_k ∝ p_k^(alpha) * exp(b_k), alpha=1/T, b_A=0 ──
// params: [alpha, bH, bD]
function tempBiasProbs(p, th) {
  const [alpha, bH, bD] = th;
  const lp = [Math.log(Math.max(p[0], CLIP)), Math.log(Math.max(p[1], CLIP)), Math.log(Math.max(p[2], CLIP))];
  return softmax3([alpha * lp[0] + bH, alpha * lp[1] + bD, alpha * lp[2]]);
}

function fitTempBias(recs, iters = 800, lr = 0.05, l2 = 1e-4) {
  // Adam
  const th = [1.0, 0.0, 0.0];
  const mt = [0, 0, 0], vt = [0, 0, 0];
  const b1 = 0.9, b2 = 0.999, eps = 1e-8;
  for (let it = 1; it <= iters; it++) {
    const g = [0, 0, 0];
    for (const r of recs) {
      const y = YIDX[r.res];
      const q = tempBiasProbs(r._p, th);
      // dL/d scores: q - y ; scores = alpha*logp + b
      const lp = [Math.log(Math.max(r._p[0], CLIP)), Math.log(Math.max(r._p[1], CLIP)), Math.log(Math.max(r._p[2], CLIP))];
      const dScore = [q[0] - (y === 0 ? 1 : 0), q[1] - (y === 1 ? 1 : 0), q[2] - (y === 2 ? 1 : 0)];
      g[0] += dScore[0] * lp[0] + dScore[1] * lp[1] + dScore[2] * lp[2]; // d/d alpha
      g[1] += dScore[0];                                        // d/d bH
      g[2] += dScore[1];                                        // d/d bD
    }
    const scale = 1 / recs.length;
    for (let j = 0; j < 3; j++) {
      let gj = g[j] * scale + l2 * th[j];
      if (j === 1) gj += l2 * th[1]; // tiny extra pull on biases? keep symmetric: no
      mt[j] = b1 * mt[j] + (1 - b1) * gj;
      vt[j] = b2 * vt[j] + (1 - b2) * gj * gj;
      const mh = mt[j] / (1 - Math.pow(b1, it));
      const vh = vt[j] / (1 - Math.pow(b2, it));
      th[j] -= lr * mh / (Math.sqrt(vh) + eps);
    }
  }
  return th;
}

// biasOnly = tempBias with alpha fixed to 1
function fitBiasOnly(recs, iters = 800, lr = 0.05) {
  const th = [1.0, 0.0, 0.0];
  const mt = [0, 0], vt = [0, 0];
  const b1 = 0.9, b2 = 0.999, eps = 1e-8;
  for (let it = 1; it <= iters; it++) {
    const g = [0, 0];
    for (const r of recs) {
      const y = YIDX[r.res];
      const q = tempBiasProbs(r._p, th);
      const dScore = [q[0] - (y === 0 ? 1 : 0), q[1] - (y === 1 ? 1 : 0), q[2] - (y === 2 ? 1 : 0)];
      g[0] += dScore[0];
      g[1] += dScore[1];
    }
    const scale = 1 / recs.length;
    for (let j = 0; j < 2; j++) {
      const gj = g[j] * scale + 1e-4 * th[j + 1];
      mt[j] = b1 * mt[j] + (1 - b1) * gj;
      vt[j] = b2 * vt[j] + (1 - b2) * gj * gj;
      th[j + 1] -= lr * (mt[j] / (1 - Math.pow(b1, it))) / (Math.sqrt(vt[j] / (1 - Math.pow(b2, it))) + eps);
    }
  }
  return th;
}

// ── evaluation ──
function eval1x2(recs, probFn) {
  let correct = 0, ll = 0, brier = 0;
  const meanP = [0, 0, 0];
  const actual = [0, 0, 0];
  const picks = { H: 0, D: 0, A: 0 };
  for (const r of recs) {
    const q = probFn(r);
    const y = YIDX[r.res];
    actual[y]++;
    meanP[0] += q[0]; meanP[1] += q[1]; meanP[2] += q[2];
    let bi = 0;
    for (let k = 0; k < 3; k++) {
      const yy = k === y ? 1 : 0;
      brier += (q[k] - yy) * (q[k] - yy);
      ll += -(yy * Math.log(Math.max(q[k], CLIP)) + (1 - yy) * Math.log(Math.max(1 - q[k], CLIP)));
    }
    brier /= 1; // multiclass brier summed over classes; divide by n later (keep sum-of-squares convention)
    if (q[bi] < q[0]) bi = 0; if (q[1] > q[bi]) bi = 1; if (q[2] > q[bi]) bi = 2;
    // simpler argmax:
    bi = q[0] >= q[1] && q[0] >= q[2] ? 0 : q[1] >= q[2] ? 1 : 2;
    picks[["H", "D", "A"][bi]]++;
    if (bi === y) correct++;
  }
  const nn = recs.length;
  return {
    n: nn,
    acc: +(correct / nn).toFixed(4),
    logloss: +(ll / (nn * 3)).toFixed(4),     // per-selection binary logloss (same convention as replay harness)
    multiclassLogLoss: +(ll / nn).toFixed(4), // true multiclass NLL — better comparability
    brier: +(brier / nn).toFixed(4),
    meanP: meanP.map((x) => +(x / nn).toFixed(4)),
    actual: actual.map((x) => +(x / nn).toFixed(4)),
    picks,
  };
}

function wilsonCI(correct, n, z = 1.96) {
  if (!n) return [0, 0];
  const p = correct / n;
  const denom = 1 + z * z / n;
  const center = (p + z * z / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p) + z * z / (4 * n)) / n)) / denom;
  return [Math.max(0, center - half), Math.min(1, center + half)];
}

// ── attach _p for chosen stage ──
function setStage(recs, field) {
  for (const r of recs) r._p = r[field];
}

function report(name, recs, probFn) {
  const e = eval1x2(recs, probFn);
  const ci = wilsonCI(Math.round(e.acc * recs.length), recs.length);
  console.log(
    `${name.padEnd(22)} acc=${(e.acc * 100).toFixed(2)}% [${(ci[0] * 100).toFixed(1)}–${(ci[1] * 100).toFixed(1)}] ` +
    `mcLL=${e.multiclassLogLoss} binLL=${e.logloss} brier=${e.brier} ` +
    `meanP(H/D/A)=${e.meanP} actual=${e.actual} picks=${JSON.stringify(e.picks)}`
  );
  return e;
}

// ═══ DIAGNOSIS: stage-wise ablation on FULL sample (descriptive only) ═══
console.log("\n═══ STAGE ABLATION (full sample, descriptive) ═══");
for (const stage of ["raw", "adj", "fin"]) {
  setStage(records, stage);
  report(`stage:${stage}`, records, (r) => r._p);
}
// also: raw probs WITHOUT draw model but with residual away? raw already is that.
// mean probs per stage
for (const stage of ["raw", "adj", "fin"]) {
  const mp = [0, 0, 0];
  for (const r of records) { mp[0] += r[stage][0]; mp[1] += r[stage][1]; mp[2] += r[stage][2]; }
  console.log(`  mean ${stage}: H=${(mp[0] / n).toFixed(4)} D=${(mp[1] / n).toFixed(4)} A=${(mp[2] / n).toFixed(4)}`);
}
console.log(`  actual base rates: H=0.435 D=0.261 A=0.303 (approx)`);

// ═══ FIT on train, VALIDATE on tail ═══
console.log(`\n═══ FIT on first ${trainFrac} → VALIDATE on held-out tail ═══`);
const results = {};

for (const stage of ["fin", "adj", "raw"]) {
  setStage(train, stage); setStage(tail, stage);
  const thB = fitBiasOnly(train);
  const thT = fitTempBias(train);
  console.log(`  [${stage}] biasOnly theta(alpha=1,bH,bD)=[${thB.map((x) => x.toFixed(4))}]  tempBias=[${thT.map((x) => x.toFixed(4))}]`);
  results[`${stage}_biasOnly`] = {
    train: report(`${stage}+biasOnly TRAIN`, train, (r) => tempBiasProbs(r._p, thB)),
    tail: report(`${stage}+biasOnly TAIL `, tail, (r) => tempBiasProbs(r._p, thB)),
    theta: thB,
  };
  results[`${stage}_tempBias`] = {
    train: report(`${stage}+tempBias TRAIN`, train, (r) => tempBiasProbs(r._p, thT)),
    tail: report(`${stage}+tempBias TAIL `, tail, (r) => tempBiasProbs(r._p, thT)),
    theta: thT,
  };
}

// ── Full multinomial diagnostic (ceiling): 3-class softmax on 14 features + drawP ──
// features f[0..14]: eloDiff,homePPG,awayPPG,homeGF,homeGA,awayGF,awayGA,cleanSheet,
//                    homeWinRate,awayWinRate,streak,fatigue,h2h,eloHome,eloAway
// add derived: drawP (draw model), z (home logit)
function featVec(r, useDraw) {
  const v = r.f.slice();
  v.push(r.z);
  if (useDraw) v.push(r.drawP);
  return v;
}

function fitMultinomial(recs, iters = 1500, lr = 0.02, l2 = 1e-4) {
  const F = featVec(recs[0], true).length;
  // weights[cls][F+1] (last = intercept)
  const W = [Array(F + 1).fill(0), Array(F + 1).fill(0), Array(F + 1).fill(0)];
  const mt = W.map(() => Array(F + 1).fill(0));
  const vt = W.map(() => Array(F + 1).fill(0));
  const b1 = 0.9, b2 = 0.999, eps = 1e-8;
  // standardize features once
  const mean = Array(F).fill(0), sd = Array(F).fill(0);
  for (const r of recs) { const v = featVec(r, true); for (let j = 0; j < F; j++) mean[j] += v[j]; }
  for (let j = 0; j < F; j++) mean[j] /= recs.length;
  for (const r of recs) { const v = featVec(r, true); for (let j = 0; j < F; j++) sd[j] += (v[j] - mean[j]) ** 2; }
  for (let j = 0; j < F; j++) sd[j] = Math.sqrt(sd[j] / recs.length) || 1;

  const scores = (r) => {
    const v = featVec(r, true);
    const s = [0, 0, 0];
    for (let c = 0; c < 3; c++) {
      let acc = W[c][F];
      for (let j = 0; j < F; j++) acc += W[c][j] * ((v[j] - mean[j]) / sd[j]);
      s[c] = acc;
    }
    return softmax3(s);
  };

  for (let it = 1; it <= iters; it++) {
    const G = [Array(F + 1).fill(0), Array(F + 1).fill(0), Array(F + 1).fill(0)];
    for (const r of recs) {
      const y = YIDX[r.res];
      const v = featVec(r, true);
      const q = scores(r);
      for (let c = 0; c < 3; c++) {
        const d = q[c] - (c === y ? 1 : 0);
        G[c][F] += d;
        for (let j = 0; j < F; j++) G[c][j] += d * ((v[j] - mean[j]) / sd[j]);
      }
    }
    const scale = 1 / recs.length;
    for (let c = 0; c < 3; c++) for (let j = 0; j <= F; j++) {
      const gj = G[c][j] * scale + l2 * W[c][j];
      mt[c][j] = b1 * mt[c][j] + (1 - b1) * gj;
      vt[c][j] = b2 * vt[c][j] + (1 - b2) * gj * gj;
      W[c][j] -= lr * (mt[c][j] / (1 - Math.pow(b1, it))) / (Math.sqrt(vt[c][j] / (1 - Math.pow(b2, it))) + eps);
    }
  }
  return { W, mean, sd, F, scores };
}

console.log("\n  [fullMN] fitting multinomial on 14 features + z + drawP (diagnostic ceiling)...");
const mn = fitMultinomial(train, 1200, 0.03);
report("fullMN TRAIN", train, (r) => mn.scores(r));
report("fullMN TAIL ", tail, (r) => mn.scores(r));

// ═══ BTTS Platt ═══
console.log("\n═══ BTTS Platt scaling (logit → sigmoid(a*x+b)) ═══");
function evalBtts(recs, fn) {
  let ll = 0, br = 0, corr = 0, pos = 0;
  const mp = [0, 0];
  for (const r of recs) {
    const p = fn(r);
    const y = (r.hs > 0 && r.as > 0) ? 1 : 0;
    pos += y; mp[0] += p; mp[1] += 1 - p;
    ll += -(y * Math.log(Math.max(p, CLIP)) + (1 - y) * Math.log(Math.max(1 - p, CLIP)));
    br += (p - y) * (p - y);
    if ((p >= 0.5 ? 1 : 0) === y) corr++;
  }
  return { n: recs.length, acc: +(corr / recs.length).toFixed(4), ll: +(ll / recs.length).toFixed(4), brier: +(br / recs.length).toFixed(4), meanYes: +(mp[0] / recs.length).toFixed(4), actualYes: +(pos / recs.length).toFixed(4) };
}
function fitPlatt(recs, iters = 500, lr = 0.05) {
  let a = 1, b = 0;
  const mt = [0, 0], vt = [0, 0];
  for (let it = 1; it <= iters; it++) {
    let ga = 0, gb = 0;
    for (const r of recs) {
      const x = logit(r.bttsY);
      const p = sigmoid(a * x + b);
      const y = (r.hs > 0 && r.as > 0) ? 1 : 0;
      const d = p - y;
      ga += d * x; gb += d;
    }
    ga /= recs.length; gb /= recs.length;
    mt[0] = 0.9 * mt[0] + 0.1 * ga; vt[0] = 0.999 * vt[0] + 0.001 * ga * ga;
    mt[1] = 0.9 * mt[1] + 0.1 * gb; vt[1] = 0.999 * vt[1] + 0.001 * gb * gb;
    a -= lr * (mt[0] / (1 - Math.pow(0.9, it))) / (Math.sqrt(vt[0] / (1 - Math.pow(0.999, it))) + 1e-8);
    b -= lr * (mt[1] / (1 - Math.pow(0.9, it))) / (Math.sqrt(vt[1] / (1 - Math.pow(0.999, it))) + 1e-8);
  }
  return { a, b };
}
const bttsBase = { train: evalBtts(train, (r) => r.bttsY), tail: evalBtts(tail, (r) => r.bttsY) };
console.log(`  BTTS base   TRAIN ${JSON.stringify(bttsBase.train)}`);
console.log(`  BTTS base   TAIL  ${JSON.stringify(bttsBase.tail)}`);
const platt = fitPlatt(train);
const plattAll = fitPlatt(records); // deployable params fit on all records
const bttsPlatt = {
  train: evalBtts(train, (r) => sigmoid(platt.a * logit(r.bttsY) + platt.b)),
  tail: evalBtts(tail, (r) => sigmoid(platt.a * logit(r.bttsY) + platt.b)),
};
console.log(`  BTTS platt(train-fit) a=${platt.a.toFixed(4)} b=${platt.b.toFixed(4)}  all-fit a=${plattAll.a.toFixed(4)} b=${plattAll.b.toFixed(4)}`);
console.log(`  BTTS platt  TRAIN ${JSON.stringify(bttsPlatt.train)}`);
console.log(`  BTTS platt  TAIL  ${JSON.stringify(bttsPlatt.tail)}`);

// ═══ Pick best 1X2 candidate by tail multiclassLogLoss (then acc) ═══
console.log("\n═══ CANDIDATE SELECTION (by tail multiclass log-loss) ═══");
const candidates = {};
for (const stage of ["fin", "adj", "raw"]) {
  for (const kind of ["biasOnly", "tempBias"]) {
    const th = results[`${stage}_${kind}`].theta;
    candidates[`${stage}_${kind}`] = {
      stage, kind, theta: th,
      tailLL: results[`${stage}_${kind}`].tail.multiclassLogLoss,
      tailAcc: results[`${stage}_${kind}`].tail.acc,
      tail: results[`${stage}_${kind}`].tail,
    };
  }
}
// baseline tail for reference
setStage(tail, "fin");
const baseTail = eval1x2(tail, (r) => r._p);
candidates["baseline_fin"] = { stage: "fin", kind: "none", tailLL: baseTail.multiclassLogLoss, tailAcc: baseTail.acc, tail: baseTail };

const ranked = Object.values(candidates).sort((a, b) => a.tailLL - b.tailLL);
for (const c of ranked) {
  console.log(`  ${c.stage}_${c.kind.padEnd(9)} tailLL=${c.tailLL} tailAcc=${(c.tailAcc * 100).toFixed(2)}%`);
}
const best = ranked[0];
console.log(`\n  BEST: ${best.stage}_${best.kind}  theta=${JSON.stringify(best.theta)}`);

const forceStage = args.includes("--stage") ? args[args.indexOf("--stage") + 1] : null;
const forceKind = args.includes("--kind") ? args[args.indexOf("--kind") + 1] : null;

// ═══ Fit-all artifact: refit chosen config on ALL records ═══
let artifactTheta = best.theta;
let artifactStage = best.stage;
if (forceStage && forceKind) {
  artifactStage = forceStage;
  setStage(records, forceStage);
  artifactTheta = forceKind === "biasOnly" ? fitBiasOnly(records) : fitTempBias(records);
  const tailEval = (() => {
    // honest tail numbers for the forced config: refit on train only, eval tail
    setStage(train, forceStage); setStage(tail, forceStage);
    const th = forceKind === "biasOnly" ? fitBiasOnly(train) : fitTempBias(train);
    return eval1x2(tail, (r) => tempBiasProbs(r._p, th));
  })();
  results[`${forceStage}_${forceKind}_forced`] = { tail: tailEval, theta: artifactTheta };
  console.log(`\n[forced] ${forceStage}_${forceKind} all-fit theta: ${JSON.stringify(artifactTheta.map((x) => +x.toFixed(6)))}`);
  console.log(`[forced] honest tail eval: acc=${(tailEval.acc * 100).toFixed(2)}% mcLL=${tailEval.multiclassLogLoss}`);
} else if (fitAll || true) {
  setStage(records, best.stage);
  artifactTheta = best.kind === "biasOnly" ? fitBiasOnly(records) : fitTempBias(records);
  console.log(`\n[fit-all] ${best.stage}_${best.kind} theta on ALL records: ${JSON.stringify(artifactTheta.map((x) => +x.toFixed(6)))}`);
  setStage(records, "fin");
  const allEval = eval1x2(records, (r) => tempBiasProbs(r._p, artifactTheta));
  console.log(`[fit-all] in-sample eval (descriptive): acc=${(allEval.acc * 100).toFixed(2)}% mcLL=${allEval.multiclassLogLoss} brier=${allEval.brier}`);
}

// ═══ Write artifact ═══
fs.mkdirSync(OUT_DIR, { recursive: true });
const artifact = {
  version: 1,
  createdAt: new Date().toISOString(),
  method: "post-hoc multinomial temperature+bias calibration of production 1X2 probs",
  stage: artifactStage,               // which pipeline stage the probs come from ("fin" = final ensemble output)
  kind: forceKind || best.kind,
  // theta = [alpha (=1/temperature), biasHome, biasDraw]; biasAway fixed 0.
  // q_k ∝ p_k^alpha * exp(b_k); applied to normalized (h,d,a) probs.
  theta: artifactTheta.map((x) => +x.toFixed(8)),
  trainedOn: { records: n, trainFrac, tailN: tail.length, dataset: "data/research-dataset.json walk-forward replay" },
  honestValidation: {
    tail: (forceStage && forceKind ? results[`${forceStage}_${forceKind}_forced`].tail : best.tail),
    baselineTail: baseTail,
    note: "Params above were fit on ALL records for deployment; 'honestValidation.tail' is the held-out estimate from params fit on the first 80% only.",
  },
  btts: {
    method: "platt",
    a: +plattAll.a.toFixed(8),
    b: +plattAll.b.toFixed(8),
    honestValidation: { train: bttsPlatt.train, tail: bttsPlatt.tail, baselineTail: bttsBase.tail },
    trainedOnAll: true,
  },
};
fs.writeFileSync(OUT_PATH, JSON.stringify(artifact, null, 2));
console.log(`\n[fit] wrote ${OUT_PATH}`);
