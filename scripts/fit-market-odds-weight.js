#!/usr/bin/env node
/**
 * ODDLY — Walk-forward fitter for weightConfig.market_odds_weight.
 *
 * Question: how much should final 1X2 probabilities be blended toward
 * opening-odds implied probabilities? Production default is 0.15
 * (worker/models/market-feature.js DEFAULT_MARKET_ODDS_WEIGHT); this script
 * measures the honest held-out optimum on replay records joined to
 * odds_snapshots. REPORT ONLY — it does not change the default or the DB.
 *
 * Method:
 *   1. Load data/eval/replay-1x2-records.json (strict walk-forward preds).
 *   2. Match each record to a finished fixture via
 *      (league code → leagues.name → league_id, kickoff::date ≈ record date,
 *      home_score, away_score). Ambiguous/zero matches are dropped and counted.
 *   3. Pull odds_snapshots for matched fixtures; compute devigged OPENING
 *      1X2 implied probs with worker/models/market-feature.js
 *      computeOpeningOddsFeatures (strictly-pre-kickoff snapshots only).
 *   4. Chronological split of matched records (first --fit-frac = fit,
 *      remainder = held-out tail). Grid w ∈ [0, 0.5]; pick w* on the fit
 *      portion by multiclass log-loss, then report honest tail metrics for
 *      w*, w=0 (pure model) and w=0.15 (current default).
 *
 * Caveats (printed in output):
 *   - odds_snapshots retention is short (~30–90 days, currently a single day),
 *     so coverage of the 2021–2026 replay window is expected to be ~0. If
 *     matchedN is tiny the recommendation is 'insufficient_data'.
 *   - Replay records do not store team names, so fixture matching is by
 *     league+date+score; collisions are dropped rather than guessed.
 *   - Production blends market odds into result1x2 BEFORE cross-model refine
 *     + recalibration; this harness blends the FINAL probs as a proxy.
 *
 * Usage: node scripts/fit-market-odds-weight.js [--fit-frac 0.7]
 */

const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

const ROOT = path.join(__dirname, "..");
for (const line of fs.readFileSync(path.join(ROOT, ".env.local"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const marketFeature = require(path.join(ROOT, "worker", "models", "market-feature.js"));

const REC_PATH = path.join(ROOT, "data", "eval", "replay-1x2-records.json");
const args = process.argv.slice(2);
const fitFrac = args.includes("--fit-frac") ? parseFloat(args[args.indexOf("--fit-frac") + 1]) : 0.7;

// football-data.co.uk code → leagues.name (same map as map-backfill-leagues.js)
const LEAGUE_NAME = {
  E0: "Premier League", E1: "Championship", E2: "League One", E3: "League Two",
  SC0: "Scottish Premiership", D1: "Bundesliga", D2: "2. Bundesliga",
  I1: "Serie A", I2: "Serie B", SP1: "La Liga", SP2: "LaLiga2",
  F1: "Ligue 1", F2: "Ligue 2", N1: "Eredivisie", P1: "Primeira Liga",
  T1: "Super Lig", B1: "Belgian Pro League",
};

const YIDX = { H: 0, D: 1, A: 2 };
const CLIP = 1e-6;

function eval1x2(recs, probFn) {
  let correct = 0, ll = 0, brier = 0;
  for (const r of recs) {
    const q = probFn(r);
    const y = YIDX[r.res];
    let bi = q[0] >= q[1] && q[0] >= q[2] ? 0 : q[1] >= q[2] ? 1 : 2;
    if (bi === y) correct++;
    for (let k = 0; k < 3; k++) {
      const yy = k === y ? 1 : 0;
      brier += (q[k] - yy) * (q[k] - yy);
      ll += -(yy * Math.log(Math.max(q[k], CLIP)) + (1 - yy) * Math.log(Math.max(1 - q[k], CLIP)));
    }
  }
  const n = recs.length || 1;
  return {
    n: recs.length,
    acc: +(correct / n).toFixed(4),
    multiclassLogLoss: +(ll / n).toFixed(4),
    brier: +(brier / n).toFixed(4),
  };
}

(async () => {
  const data = JSON.parse(fs.readFileSync(REC_PATH, "utf8"));
  const records = data.records;
  console.log(`[fit-market-odds] replay records: ${records.length}`);

  const client = new Client({
    host: process.env.SUPABASE_POOLER_HOST || "aws-0-eu-west-1.pooler.supabase.com",
    port: 5432,
    user: `postgres.${process.env.SUPABASE_PROJECT_REF || "xruhvekcowdwocydqnmp"}`,
    password: process.env.SUPABASE_DB_PASSWORD,
    database: "postgres",
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  // league code → league_id
  const { rows: leagues } = await client.query("SELECT id, name FROM leagues");
  const idByName = {};
  for (const l of leagues) idByName[String(l.name).toLowerCase()] = l.id;
  const leagueIdByCode = {};
  for (const [code, name] of Object.entries(LEAGUE_NAME)) {
    const id = idByName[String(name).toLowerCase()];
    if (id) leagueIdByCode[code] = id;
  }
  console.log(`[fit-market-odds] league codes mapped: ${Object.keys(leagueIdByCode).length}/${Object.keys(LEAGUE_NAME).length}`);

  // Load all finished fixtures in those leagues (id, league, kickoff, score).
  const leagueIds = Object.values(leagueIdByCode);
  const { rows: fixtures } = await client.query(
    `SELECT id, league_id, kickoff_time, home_score, away_score
     FROM fixtures
     WHERE status = 'finished' AND home_score IS NOT NULL AND away_score IS NOT NULL
       AND league_id = ANY($1::uuid[])`,
    [leagueIds]
  );
  console.log(`[fit-market-odds] finished fixtures in mapped leagues: ${fixtures.length}`);

  const fixtureKickoff = new Map();
  const byKeyExact = new Map(); // league|date|hs|as → fixture ids (kickoff UTC date)
  const byKeyWide = new Map();  // same but ±1 day (fallback only)
  const push = (m, k, id) => { if (!m.has(k)) m.set(k, []); m.get(k).push(id); };
  for (const f of fixtures) {
    const d = new Date(f.kickoff_time);
    const dateStr = d.toISOString().slice(0, 10);
    fixtureKickoff.set(f.id, f.kickoff_time);
    push(byKeyExact, `${f.league_id}|${dateStr}|${f.home_score}|${f.away_score}`, f.id);
    for (const off of [-1, 0, 1]) {
      const dd = new Date(d.getTime() + off * 86400000).toISOString().slice(0, 10);
      push(byKeyWide, `${f.league_id}|${dd}|${f.home_score}|${f.away_score}`, f.id);
    }
  }

  // Match records → fixtures. Prefer exact kickoff-date matches; fall back to
  // the ±1 day window only when the exact date has no candidate. Ambiguous
  // (>1 distinct fixture) or none → drop.
  let matched = 0, noFixture = 0, ambiguous = 0, noLeague = 0;
  const matchedRecs = [];
  for (const r of records) {
    const lid = leagueIdByCode[r.lg];
    if (!lid) { noLeague++; continue; }
    let cands = byKeyExact.get(`${lid}|${r.d}|${r.hs}|${r.as}`) || [];
    if (cands.length === 0) cands = byKeyWide.get(`${lid}|${r.d}|${r.hs}|${r.as}`) || [];
    const uniq = [...new Set(cands)];
    if (uniq.length === 0) { noFixture++; continue; }
    if (uniq.length > 1) { ambiguous++; continue; }
    matchedRecs.push({ r, fixtureId: uniq[0] });
    matched++;
  }
  console.log(`[fit-market-odds] matched=${matched} noFixture=${noFixture} ambiguous=${ambiguous} unmappedLeague=${noLeague}`);

  // Pull odds rows for matched fixtures only.
  const fixtureIds = [...new Set(matchedRecs.map((m) => m.fixtureId))];
  let oddsByFixture = new Map();
  if (fixtureIds.length) {
    const { rows: oddsRows } = await client.query(
      `SELECT fixture_id, bookmaker, market, selection, odds, snapshot_time
       FROM odds_snapshots WHERE fixture_id = ANY($1::uuid[])`,
      [fixtureIds]
    );
    for (const o of oddsRows) {
      if (!oddsByFixture.has(o.fixture_id)) oddsByFixture.set(o.fixture_id, []);
      oddsByFixture.get(o.fixture_id).push(o);
    }
    console.log(`[fit-market-odds] odds rows fetched: ${oddsRows.length} across ${oddsByFixture.size} fixtures`);
  }
  await client.end();

  // Compute opening implied probs per matched record (leakage-safe).
  let withOdds = 0;
  const usable = [];
  for (const m of matchedRecs) {
    const rows = oddsByFixture.get(m.fixtureId) || [];
    const mf = marketFeature.computeOpeningOddsFeatures(rows, fixtureKickoff.get(m.fixtureId));
    if (mf.hasMarketOdds && mf.marketImpliedHome != null) {
      withOdds++;
      usable.push({
        r: m.r,
        market: { home: mf.marketImpliedHome, draw: mf.marketImpliedDraw, away: mf.marketImpliedAway },
        snapTime: mf.marketOpeningSnapshotTime,
      });
    }
  }
  console.log(`[fit-market-odds] records with usable opening 1X2 odds: ${withOdds}`);

  if (withOdds < 100) {
    console.log("\n[fit-market-odds] RESULT: insufficient_data");
    console.log(`  Only ${withOdds} replay records have joined opening-odds coverage.`);
    console.log("  odds_snapshots retention is short (~30-90 days; currently a single day),");
    console.log("  replay dataset spans 2021-07-23 → 2026-05-24). Re-run once coverage accumulates.");
    console.log("  Recommendation: KEEP market_odds_weight = 0.15 (unvalidated default).");
    return;
  }

  // Chronological split (records already chronological; sort defensively).
  usable.sort((a, b) => (a.r.d < b.r.d ? -1 : a.r.d > b.r.d ? 1 : a.r.i - b.r.i));
  const split = Math.floor(usable.length * fitFrac);
  const fitRecs = usable.slice(0, split);
  const tailRecs = usable.slice(split);
  console.log(`[fit-market-odds] fit=${fitRecs.length} held-out tail=${tailRecs.length} (split by date)`);

  // Blend final model probs toward market implied (proxy for prod's earlier
  // blend point — see header caveats).
  const blendedFn = (w) => (u) => {
    const b = marketFeature.blend1x2(
      { home: u.r.fin[0], draw: u.r.fin[1], away: u.r.fin[2] },
      u.market,
      w
    );
    return [b.home, b.draw, b.away];
  };
  const pureFn = (u) => u.r.fin;

  // Grid on fit portion → pick w* by multiclass log-loss (acc tiebreak).
  const grid = [];
  for (let w = 0; w <= 0.5001; w += 0.05) {
    const e = eval1x2(fitRecs, blendedFn(+w.toFixed(2)));
    grid.push({ w: +w.toFixed(2), ...e });
  }
  grid.sort((a, b) => a.multiclassLogLoss - b.multiclassLogLoss || b.acc - a.acc);
  const wStar = grid[0].w;
  console.log("\n[fit-market-odds] fit-portion grid (sorted by mcLL):");
  for (const g of grid) {
    console.log(`  w=${g.w.toFixed(2)} acc=${(g.acc * 100).toFixed(2)}% mcLL=${g.multiclassLogLoss} brier=${g.brier}`);
  }
  console.log(`  → w* = ${wStar} on fit portion`);

  // Honest held-out tail report.
  const tailReport = {};
  for (const [label, w] of [["pure_model_w0", 0], ["current_default_w0.15", 0.15], ["recommended", wStar]]) {
    tailReport[label] = eval1x2(tailRecs, blendedFn(w));
    const t = tailReport[label];
    console.log(`  TAIL ${label.padEnd(22)} acc=${(t.acc * 100).toFixed(2)}% mcLL=${t.multiclassLogLoss} brier=${t.brier}`);
  }

  const rec = tailReport.recommended;
  const pure = tailReport.pure_model_w0;
  const better = rec.multiclassLogLoss < pure.multiclassLogLoss ||
                 (Math.abs(rec.multiclassLogLoss - pure.multiclassLogLoss) < 1e-9 && rec.acc > pure.acc);
  console.log(`\n[fit-market-odds] RESULT: ${better ? "blend_improves" : "no_improvement"}`);
  console.log(`  Recommended market_odds_weight ≈ ${wStar} (held-out tail mcLL ${rec.multiclassLogLoss} vs pure ${pure.multiclassLogLoss}, acc ${(rec.acc * 100).toFixed(2)}% vs ${(pure.acc * 100).toFixed(2)}%)`);
  console.log("  NOTE: report only — production default remains 0.15 until validated on more opening-odds history.");

  const out = {
    generatedAt: new Date().toISOString(),
    matchedRecords: withOdds,
    fitN: fitRecs.length,
    tailN: tailRecs.length,
    fitFrac,
    grid: grid.sort((a, b) => a.w - b.w),
    wStar,
    tail: tailReport,
    caveats: [
      "odds_snapshots retention ~30-90d; coverage of replay window may be partial",
      "fixture matching by league+date+score (records lack team names); ambiguous dropped",
      "prod blends market odds pre-refine; harness blends final probs as proxy",
    ],
  };
  const outPath = path.join(ROOT, "data", "calibration", "market-odds-weight.json");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`[fit-market-odds] wrote ${outPath}`);
})().catch((e) => { console.error(e); process.exit(1); });
