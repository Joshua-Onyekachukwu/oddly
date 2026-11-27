/**
 * ODDLY Dixon-Coles-Style Match Simulator (champion/challenger only)
 *
 * Produces 1X2 + Over/Under + BTTS (+ DC / DNB / team-goals) probabilities
 * from team attack/defence goal rates using a bivariate-Poisson score grid
 * with the Dixon-Coles low-score correlation adjustment (tau function).
 *
 * ─── Model ────────────────────────────────────────────────────────────────
 *
 * Team ratings are exponentially-weighted (EWMA) goals-for / goals-against
 * rates, normalized against the league-wide EWMA scoring rate:
 *
 *   attack_i  = ewmaGF_i / ewmaLeagueGF        (>1 = scores more than avg)
 *   defence_i = ewmaGA_i / ewmaLeagueGA        (>1 = concedes more than avg)
 *
 * Expected goals (home advantage preserved, expected TOTAL ≈ 2·μ):
 *
 *   base  = 2μ / (homeAdv + 1)
 *   λhome = base · homeAdv · attack_home · defence_away
 *   λaway = base ·              attack_away · defence_home
 *
 * The score grid is Poisson(λhome) × Poisson(λaway) with the Dixon-Coles
 * tau correction on the four lowest scorelines (ρ < 0 boosts 0-0 / 1-1 and
 * trims 1-0 / 0-1, the empirically observed low-score correlation):
 *
 *   τ(0,0) = 1 − λh·λa·ρ      τ(1,0) = 1 + λa·ρ
 *   τ(0,1) = 1 + λh·ρ          τ(1,1) = 1 − ρ
 *
 * ─── Usage ────────────────────────────────────────────────────────────────
 *
 *   const dc = require("./market-dixon-coles");
 *   const tracker = new dc.DixonColesTracker();          // cold start = league avg
 *   for (const m of historyChronological) {
 *     const pred = tracker.predict(m.home, m.away);     // BEFORE observing
 *     tracker.observe(m.home, m.away, m.hs, m.as);      // then update
 *   }
 *
 * predict() returns probabilities in the same shape family as
 * meta-ensemble's `markets` map (1X2_*, OU_Over/Under_*, BTTS_*, DC_*,
 * DNB_*, HomeGoals_*, AwayGoals_*) so it can be scored by the same harness.
 *
 * STATUS: challenger only — NOT wired into the production predict path.
 * See scripts/eval-dixon-coles.js for walk-forward metrics.
 */

"use strict";

const MAX_GOALS = 9; // grid 0..9 per team → totals 0..18 (tail mass < 1e-6)

function poissonPmf(lambda, k) {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  // log pmf for numerical stability
  let logP = -lambda;
  for (let i = 1; i <= k; i++) logP += Math.log(lambda) - Math.log(i);
  return Math.exp(logP);
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Dixon-Coles tau adjustment for the four low-score cells.
 * rho < 0 (typical −0.05…−0.15) inflates draws / low-scoring draws.
 */
function dcTau(x, y, lambdaH, lambdaA, rho) {
  if (rho === 0) return 1;
  if (x === 0 && y === 0) return Math.max(0, 1 - lambdaH * lambdaA * rho);
  if (x === 1 && y === 0) return Math.max(0, 1 + lambdaA * rho);
  if (x === 0 && y === 1) return Math.max(0, 1 + lambdaH * rho);
  if (x === 1 && y === 1) return Math.max(0, 1 - rho);
  return 1;
}

/**
 * Build the Dixon-Coles score grid (row = home goals, col = away goals).
 * Grid is L1-normalized so truncated tail mass is redistributed.
 */
function scoreGridDC(lambdaH, lambdaA, rho = -0.1, maxGoals = MAX_GOALS) {
  const grid = [];
  let sum = 0;
  for (let i = 0; i <= maxGoals; i++) {
    grid[i] = new Array(maxGoals + 1).fill(0);
    for (let j = 0; j <= maxGoals; j++) {
      const p =
        poissonPmf(lambdaH, i) *
        poissonPmf(lambdaA, j) *
        dcTau(i, j, lambdaH, lambdaA, rho);
      grid[i][j] = p;
      sum += p;
    }
  }
  if (sum > 0) {
    for (let i = 0; i <= maxGoals; i++)
      for (let j = 0; j <= maxGoals; j++) grid[i][j] /= sum;
  }
  return grid;
}

/** Derive all market probabilities from a score grid. */
function probsFromGrid(grid) {
  const n = grid.length;
  const oneXtwo = { home: 0, draw: 0, away: 0 };
  const bttsYes = { p: 0 };
  const totalDist = new Array(2 * n).fill(0);
  const homeGoalsDist = new Array(n).fill(0);
  const awayGoalsDist = new Array(n).fill(0);

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const p = grid[i][j];
      if (i > j) oneXtwo.home += p;
      else if (i === j) oneXtwo.draw += p;
      else oneXtwo.away += p;
      if (i > 0 && j > 0) bttsYes.p += p;
      totalDist[i + j] += p;
      homeGoalsDist[i] += p;
      awayGoalsDist[j] += p;
    }
  }

  const ou = {};
  for (const line of [0.5, 1.5, 2.5, 3.5, 4.5, 5.5]) {
    // P(total > line): sum dist[k] for k > line
    let over = 0;
    for (let k = Math.floor(line) + 1; k < totalDist.length; k++) over += totalDist[k];
    // careful: line=2.5 → k>=3 = floor(2.5)+1 = 3 ✓; line=3.5 → k>=4 ✓
    ou[`over${String(line).replace(".", "_")}`] = over;
    ou[`under${String(line).replace(".", "_")}`] = 1 - over;
  }

  // team-goal lines (home/away over 0.5, 1.5)
  const teamGoals = {};
  for (const [prefix, dist] of [["HomeGoals", homeGoalsDist], ["AwayGoals", awayGoalsDist]]) {
    for (const line of [0.5, 1.5]) {
      let over = 0;
      for (let k = Math.floor(line) + 1; k < dist.length; k++) over += dist[k];
      teamGoals[`${prefix}_Over_${line}`] = over; // "HomeGoals_Over_0.5"
    }
  }

  const dc = {
    dc1X: clamp(oneXtwo.home + oneXtwo.draw, 0.01, 0.99),
    dcX2: clamp(oneXtwo.draw + oneXtwo.away, 0.01, 0.99),
    dc12: clamp(oneXtwo.home + oneXtwo.away, 0.01, 0.99),
  };

  const h = clamp(oneXtwo.home, 0.01, 0.99);
  const a = clamp(oneXtwo.away, 0.01, 0.99);
  const dnb = {
    home: h / (h + a),
    away: a / (h + a),
  };

  return {
    oneXtwo: {
      home: clamp(oneXtwo.home, 0.01, 0.99),
      draw: clamp(oneXtwo.draw, 0.01, 0.99),
      away: clamp(oneXtwo.away, 0.01, 0.99),
    },
    overUnder: ou,
    bttsYes: clamp(bttsYes.p, 0.01, 0.99),
    bttsNo: clamp(1 - bttsYes.p, 0.01, 0.99),
    dc,
    dnb,
    teamGoals,
  };
}

/**
 * Convert probsFromGrid() output into the flat `markets` map shape used by
 * meta-ensemble / the walk-forward harness.
 */
function toMarketsMap(p) {
  const m = {};
  m["1X2_Home"] = p.oneXtwo.home;
  m["1X2_Draw"] = p.oneXtwo.draw;
  m["1X2_Away"] = p.oneXtwo.away;
  // explicit lines to keep key format identical to meta-ensemble ("OU_Over_2.5")
  const lines = ["0.5", "1.5", "2.5", "3.5", "4.5", "5.5"];
  for (const l of lines) {
    m[`OU_Over_${l}`] = p.overUnder[`over${l.replace(".", "_")}`];
    m[`OU_Under_${l}`] = p.overUnder[`under${l.replace(".", "_")}`];
  }
  m["BTTS_Yes"] = p.bttsYes;
  m["BTTS_No"] = p.bttsNo;
  m["DC_1X"] = p.dc.dc1X;
  m["DC_X2"] = p.dc.dcX2;
  m["DC_12"] = p.dc.dc12;
  m["DNB_Home"] = p.dnb.home;
  m["DNB_Away"] = p.dnb.away;
  for (const [k, v] of Object.entries(p.teamGoals)) m[k] = v;
  return m;
}

/**
 * DixonColesTracker — online EWMA attack/defence ratings + DC grid.
 *
 * @param {Object} opts
 * @param {number} opts.alpha      EWMA step per team-match (default 0.02 ≈
 *                                 ~100-match effective window; lower = slower)
 * @param {number} opts.leagueAlpha EWMA step for league scoring rate (default 0.005)
 * @param {number} opts.homeAdv    home-goal multiplier (default 1.22)
 * @param {number} opts.rho        Dixon-Coles low-score correlation (default -0.10)
 * @param {number} opts.leagueMean initial per-team goals rate (default 1.30)
 */
class DixonColesTracker {
  constructor(opts = {}) {
    this.alpha = opts.alpha ?? 0.02;
    this.leagueAlpha = opts.leagueAlpha ?? 0.005;
    this.homeAdv = opts.homeAdv ?? 1.22;
    this.rho = opts.rho ?? -0.10;
    this.leagueMean = opts.leagueMean ?? 1.30;
    // league EWMA of goals-for and goals-against per team-match
    this.leagueGF = this.leagueMean;
    this.leagueGA = this.leagueMean;
    this.leagueN = 0;
    this.teams = new Map(); // name → { gf, ga, n }
  }

  _team(name) {
    let t = this.teams.get(name);
    if (!t) {
      t = { gf: null, ga: null, n: 0 };
      this.teams.set(name, t);
    }
    return t;
  }

  /**
   * Predict market probabilities for home vs away.
   * Uses ONLY information observed so far — safe to call before observe().
   */
  predict(home, away) {
    const th = this._team(home);
    const ta = this._team(away);

    // League scoring rate μ = average goals per team-match
    const mu = this.leagueN > 0
      ? (this.leagueGF + this.leagueGA) / 2
      : this.leagueMean;

    // Ratings default to 1.0 (league average) for unseen/cold teams.
    const atkH = th.gf != null && this.leagueGF > 0 ? th.gf / this.leagueGF : 1;
    const defH = th.ga != null && this.leagueGA > 0 ? th.ga / this.leagueGA : 1;
    const atkA = ta.gf != null && this.leagueGF > 0 ? ta.gf / this.leagueGF : 1;
    const defA = ta.ga != null && this.leagueGA > 0 ? ta.ga / this.leagueGA : 1;

    // Expected goals — base preserves E[total] ≈ 2μ for neutral ratings.
    const base = (2 * mu) / (this.homeAdv + 1);
    let lambdaH = base * this.homeAdv * atkH * defA;
    let lambdaA = base * atkA * defH;
    lambdaH = clamp(lambdaH, 0.15, 5.0);
    lambdaA = clamp(lambdaA, 0.10, 4.5);

    const grid = scoreGridDC(lambdaH, lambdaA, this.rho);
    const probs = probsFromGrid(grid);
    const markets = toMarketsMap(probs);

    return {
      lambdaHome: lambdaH,
      lambdaAway: lambdaA,
      expectedGoals: lambdaH + lambdaA,
      oneXtwo: probs.oneXtwo,
      markets,
      grid,
    };
  }

  /** Record a finished match (call AFTER predict). */
  observe(home, away, homeGoals, awayGoals) {
    const hg = Number(homeGoals);
    const ag = Number(awayGoals);
    if (!Number.isFinite(hg) || !Number.isFinite(ag) || hg < 0 || ag < 0) return;

    // League EWMA — each team-match contributes one "for" and one "against"
    const aL = this.leagueAlpha;
    this.leagueGF = this.leagueGF * (1 - aL) + hg * aL;
    this.leagueGA = this.leagueGA * (1 - aL) + ag * aL;
    this.leagueN += 2; // two team-matches per fixture

    for (const [name, gf, ga] of [
      [home, hg, ag],
      [away, ag, hg],
    ]) {
      const t = this._team(name);
      const a = this.alpha;
      t.gf = t.gf == null ? gf : t.gf * (1 - a) + gf * a;
      t.ga = t.ga == null ? ga : t.ga * (1 - a) + ga * a;
      t.n += 1;
    }
  }

  /** Team count / debug info. */
  stats() {
    return { teams: this.teams.size, leagueGF: this.leagueGF, leagueGA: this.leagueGA, leagueN: this.leagueN };
  }
}

module.exports = {
  DixonColesTracker,
  poissonPmf,
  dcTau,
  scoreGridDC,
  probsFromGrid,
  toMarketsMap,
  MAX_GOALS,
};
