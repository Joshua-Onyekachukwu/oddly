/**
 * ODDLY Market-Feature Module — Opening-Odds Implied Probabilities
 *
 * Turns odds_snapshots rows into leakage-safe market features for the
 * meta-ensemble (marketImpliedHome / marketImpliedDraw / marketImpliedAway,
 * marketImpliedOver<line>, ...).
 *
 * ─── LEAKAGE GUARDS (read before modifying) ────────────────────────────────
 *
 * 1. OPENING ODDS ONLY. For each (market, selection) we take the EARLIEST
 *    snapshot_time strictly BEFORE kickoff_time. Later snapshots — including
 *    closing odds, which are only knowable after kickoff — are discarded and
 *    can never influence the output. If a fixture's first stored snapshot is
 *    at/after kickoff (late sync start), it yields NO market feature at all.
 *
 * 2. KICKOFF REQUIRED. `kickoffTime` is mandatory. If it is missing or
 *    unparseable, computeOpeningOddsFeatures() returns an empty feature set —
 *    we never guess whether a snapshot is pre-match.
 *
 * 3. STRICT INEQUALITY. snapshot_time === kickoff_time is EXCLUDED (treated
 *    as post-kickoff; kickoff timestamps have second/minute precision and an
 *    equal timestamp cannot be proven pre-match).
 *
 * 4. DEVIGGED. Raw decimal odds include bookmaker margin; we convert to
 *    implied probabilities and normalize within each market so the three 1X2
 *    probabilities sum to 1.
 *
 * 5. MULTI-BOOK. When several bookmakers share the same earliest timestamp
 *    for a selection we average their decimal odds (equal-weight consensus).
 *    Different bookmakers' first sightings at different times each contribute
 *    their own earliest price — the minimum timestamp wins per selection.
 *
 * odds_snapshots schema (src/lib/sync/odds.ts):
 *   { fixture_id, bookmaker, market, selection, odds, snapshot_time }
 *   market ∈ {"match_result", "over_under_2.5", "over_under_1.5",
 *             "over_under_3.5"}   selection ∈ {"home","draw","away","over","under"}
 */

"use strict";

// ─── Small utils ────────────────────────────────────────────────────────────

function toTime(v) {
  if (v == null) return NaN;
  if (v instanceof Date) return v.getTime();
  const t = new Date(v).getTime();
  return Number.isNaN(t) ? NaN : t;
}

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

/**
 * Normalize a market name to a canonical key.
 * Returns { kind: "1x2" } | { kind: "ou", line: number } | null
 */
function normalizeMarket(market) {
  if (market == null) return null;
  const m = String(market).toLowerCase().trim();
  if (m === "match_result" || m === "h2h" || m === "1x2" || m === "full_time_result") {
    return { kind: "1x2" };
  }
  const ou = m.match(/^over_under_(\d+(?:\.\d+)?)$/);
  if (ou) return { kind: "ou", line: parseFloat(ou[1]) };
  // "totals" without a point is ambiguous (The Odds API returns several
  // total-goals lines under one key) — refuse to guess the line.
  return null;
}

// ─── Core: opening-odds extraction ─────────────────────────────────────────

/**
 * Build market-implied probability features from raw odds_snapshots rows.
 *
 * @param {Array} rows - odds_snapshots rows (any subset; extra fields ignored)
 * @param {string|Date|number} kickoffTime - fixture kickoff. REQUIRED.
 * @returns {Object} feature object. `hasMarketOdds` is true only when at
 *   least one usable pre-kickoff market was found. Fields present depend on
 *   which markets had complete pre-kickoff prices:
 *     marketImpliedHome / marketImpliedDraw / marketImpliedAway  (sum to 1)
 *     marketImpliedOver<line with . → _>  e.g. marketImpliedOver2_5
 *     marketOpeningSnapshotTime  ISO of the earliest snapshot used
 *     marketBookmakers           number of distinct bookmakers contributing
 */
function computeOpeningOddsFeatures(rows, kickoffTime) {
  const kickoffMs = toTime(kickoffTime);
  const out = { hasMarketOdds: false };
  if (!Array.isArray(rows) || rows.length === 0) return out;
  if (Number.isNaN(kickoffMs)) return out; // no kickoff → cannot prove pre-match

  // Pass 1: keep only strictly-pre-kickoff rows; per (market,selection) find
  // the earliest snapshot_time and collect every bookmaker's price at that
  // earliest instant.
  // key: `${canonicalMarket}|${selection}` → { ts, odds: [] }
  const best = new Map();
  const bookmakers = new Set();
  let earliestTs = Infinity;

  for (const r of rows) {
    if (!r || r.odds == null) continue;
    const odds = Number(r.odds);
    if (!Number.isFinite(odds) || odds <= 1.0) continue; // decimal odds > 1.0
    const snapMs = toTime(r.snapshot_time);
    if (Number.isNaN(snapMs)) continue;
    // ── LEAKAGE GUARD: strictly before kickoff ──
    if (!(snapMs < kickoffMs)) continue;

    const nm = normalizeMarket(r.market);
    if (!nm) continue;
    const sel = String(r.selection || "").toLowerCase();
    if (nm.kind === "1x2") {
      if (sel !== "home" && sel !== "draw" && sel !== "away") continue;
    } else {
      if (sel !== "over" && sel !== "under") continue;
    }

    const mkey = nm.kind === "1x2" ? "1x2" : `ou_${nm.line}`;
    const key = `${mkey}|${sel}`;
    const cur = best.get(key);
    if (!cur || snapMs < cur.ts) {
      best.set(key, { ts: snapMs, odds: [odds] });
    } else if (snapMs === cur.ts) {
      cur.odds.push(odds);
    }
    // (snapMs > cur.ts → ignore: later price is not the opening price)
  }

  if (best.size === 0) return out;

  // Consensus decimal odds per selection = mean of prices at the earliest ts.
  const priceOf = (key) => {
    const e = best.get(key);
    if (!e) return null;
    return e.odds.reduce((s, o) => s + o, 0) / e.odds.length;
  };

  // Devig helper: implied_i = (1/odds_i) / Σ(1/odds_j)
  const devig = (entries) => {
    // entries: [[sel, decimalOdds], ...]
    const raw = entries.map(([sel, o]) => [sel, 1 / o]);
    const sum = raw.reduce((s, [, v]) => s + v, 0);
    if (!(sum > 0)) return null;
    const res = {};
    for (const [sel, v] of raw) res[sel] = clamp01(v / sum);
    return res;
  };

  // ── 1X2 market ──
  const h = priceOf("1x2|home");
  const d = priceOf("1x2|draw");
  const a = priceOf("1x2|away");
  if (h != null && d != null && a != null) {
    const probs = devig([["home", h], ["draw", d], ["away", a]]);
    if (probs) {
      out.marketImpliedHome = probs.home;
      out.marketImpliedDraw = probs.draw;
      out.marketImpliedAway = probs.away;
      out.hasMarketOdds = true;
    }
  }

  // ── Over/Under markets (any line present in the data) ──
  const ouLines = new Set();
  for (const key of best.keys()) {
    const m = key.match(/^ou_(\d+(?:\.\d+)?)\|(over|under)$/);
    if (m) ouLines.add(parseFloat(m[1]));
  }
  out.marketTotals = {};
  for (const line of ouLines) {
    const o = priceOf(`ou_${line}|over`);
    const u = priceOf(`ou_${line}|under`);
    if (o == null || u == null) continue;
    const probs = devig([["over", o], ["under", u]]);
    if (!probs) continue;
    const field = `marketImpliedOver${String(line).replace(".", "_")}`;
    out[field] = probs.over;
    out.marketTotals[String(line)] = {
      over: probs.over,
      under: probs.under,
      overOdds: o,
      underOdds: u,
    };
    out.hasMarketOdds = true;
  }

  if (out.hasMarketOdds) {
    // earliest contributing snapshot across all used selections
    let minTs = Infinity;
    for (const e of best.values()) if (e.ts < minTs) minTs = e.ts;
    out.marketOpeningSnapshotTime = new Date(minTs).toISOString();
    // count distinct bookmakers seen on pre-kickoff rows (informational)
    for (const r of rows) {
      const snapMs = toTime(r.snapshot_time);
      if (!Number.isNaN(snapMs) && snapMs < kickoffMs && r.bookmaker) {
        bookmakers.add(String(r.bookmaker).toLowerCase());
      }
    }
    out.marketBookmakers = bookmakers.size;
  } else {
    delete out.marketTotals;
  }

  return out;
}

/**
 * Merge market features into a feature vector (non-destructive).
 * Only sets marketImplied* fields; returns the same object for chaining.
 */
function attachToFeatures(features, oddsRows, kickoffTime) {
  const mf = computeOpeningOddsFeatures(oddsRows, kickoffTime);
  if (mf.hasMarketOdds) {
    Object.assign(features, mf);
    features.hasMarketOdds = true;
  }
  return features;
}

/**
 * Read market features already present on a feature vector.
 * Returns null unless all three 1X2 implied probs exist.
 */
function fromFeatures(features) {
  if (!features) return null;
  const h = Number(features.marketImpliedHome);
  const d = Number(features.marketImpliedDraw);
  const a = Number(features.marketImpliedAway);
  if (!Number.isFinite(h) || !Number.isFinite(d) || !Number.isFinite(a)) return null;
  if (h <= 0 || d <= 0 || a <= 0) return null;
  const t = h + d + a;
  return { home: h / t, draw: d / t, away: a / t };
}

/**
 * Convex blend of model 1X2 probabilities toward market-implied probabilities.
 * @param weight 0..1 — fraction of market probability mixed in.
 */
function blend1x2(modelProbs, marketProbs, weight) {
  const w = Math.max(0, Math.min(1, Number(weight) || 0));
  if (w === 0 || !marketProbs) {
    return { home: modelProbs.home, draw: modelProbs.draw, away: modelProbs.away };
  }
  const h = (1 - w) * modelProbs.home + w * marketProbs.home;
  const d = (1 - w) * modelProbs.draw + w * marketProbs.draw;
  const a = (1 - w) * modelProbs.away + w * marketProbs.away;
  const t = h + d + a || 1;
  return { home: h / t, draw: d / t, away: a / t };
}

/** Binary variant for O/U style probabilities. */
function blendBinary(modelP, marketP, weight) {
  const w = Math.max(0, Math.min(1, Number(weight) || 0));
  if (w === 0 || marketP == null) return modelP;
  return clamp01((1 - w) * modelP + w * marketP);
}

/**
 * Default blend weight for market-implied 1X2. Conservative on purpose:
 * opening odds are informative but our ensemble is weakly calibrated, and
 * this blend has NOT yet been validated on historical opening-odds data
 * (odds_snapshots retention is ~30–90 days; research dataset has no odds).
 * Override via model_weight_config.market_odds_weight.
 */
const DEFAULT_MARKET_ODDS_WEIGHT = 0.15;

module.exports = {
  computeOpeningOddsFeatures,
  attachToFeatures,
  fromFeatures,
  blend1x2,
  blendBinary,
  normalizeMarket,
  DEFAULT_MARKET_ODDS_WEIGHT,
};
