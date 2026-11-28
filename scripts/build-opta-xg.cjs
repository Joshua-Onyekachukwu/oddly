#!/usr/bin/env node
/**
 * ODDLY Opta xG Builder
 *
 * Converts pannadata Opta parquet releases into an Understat-compatible
 * match JSON that scripts/ingest-xg.cjs can consume (--file data/opta-xg.json
 * --source opta).
 *
 * Source: https://github.com/peteowen1/pannadata/releases/tag/opta-latest
 *   - opta_fixtures.parquet          match_id → teams/date/score/competition/season
 *   - opta_xmetrics_bymatch.parquet  player×match xG (summed per team per match)
 *
 * Competition whitelist: domestic leagues that fill xG gaps in our DB
 * (Eredivisie, Primeira, Super Lig, Championship, MLS, Brasileirão,
 * Scottish, Belgian, + domestic leagues of our Champions League teams)
 * plus UEFA UCL/UEL/Conference League, plus the big-5 leagues for seasons
 * BEFORE 2021 (Understat already covers 2021+ for those — avoids double
 * counting the same matches under two sources).
 *
 * Season filter: start-year >= 2021 everywhere, EXCEPT the five Understat
 * leagues where pre-2021 seasons are also included (they extend history
 * without overlapping Understat's 2021–2025 window).
 *
 * Usage:
 *   node scripts/build-opta-xg.cjs [--fetch] [--min-year 2021] [--out path]
 */

const fs = require("fs");
const path = require("path");
const https = require("https");
const { parquetReadObjects } = require("hyparquet");

const ROOT = path.join(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data", "pannadata");
const OUT = path.join(ROOT, "data", "opta-xg.json");

const RELEASE = "https://github.com/peteowen1/pannadata/releases/download/opta-latest";
const FILES = {
  fixtures: { url: `${RELEASE}/opta_fixtures.parquet`, file: "opta_fixtures.parquet" },
  bymatch: { url: `${RELEASE}/opta_xmetrics_bymatch.parquet`, file: "opta_xmetrics_bymatch.parquet" },
};

const args = process.argv.slice(2);
const FETCH = args.includes("--fetch");
const minYearIdx = args.indexOf("--min-year");
const MIN_YEAR = minYearIdx > -1 ? parseInt(args[minYearIdx + 1], 10) : 2021;
const outIdx = args.indexOf("--out");
const OUTPUT = outIdx > -1 ? path.resolve(args[outIdx + 1]) : OUT;

// Competitions to ingest (opta competition codes → display league name).
// Big-5 leagues are included but restricted to pre-MIN_YEAR seasons below.
const COMPETITIONS = {
  // New domestic coverage (no Understat equivalent)
  Championship: "Championship",
  League_One: "League One",
  League_Two: "League Two",
  Eredivisie: "Eredivisie",
  Primeira_Liga: "Primeira Liga",
  Super_Lig: "Super Lig",
  Scottish_Premiership: "Scottish Premiership",
  MLS: "MLS",
  Brazilian_Serie_A: "Brasileirão",
  Belgian_First_Division: "Belgian Pro League",
  Greek_Super_League: "Greek Super League",
  Austrian_Bundesliga: "Austrian Bundesliga",
  Czech_Liga: "Czech Liga",
  Slovak_Liga: "Slovak Liga",
  Eliteserien: "Eliteserien",
  Ukrainian_Premier_League: "Ukrainian Premier League",
  Azerbaijan_Premier: "Azerbaijan Premier League",
  // UEFA club competitions (only xG source for several CL teams)
  UCL: "Champions League",
  UEL: "Europa League",
  Conference_League: "UEFA Conference League",
  // Big-5 leagues: ONLY seasons before MIN_YEAR (Understat covers 2021+)
  EPL: "Premier League",
  La_Liga: "La Liga",
  Bundesliga: "Bundesliga",
  Serie_A: "Serie A",
  Ligue_1: "Ligue 1",
};
const BIG5 = new Set(["EPL", "La_Liga", "Bundesliga", "Serie_A", "Ligue_1"]);

function seasonStartYear(season) {
  const m = String(season).match(/^(\d{4})/);
  return m ? parseInt(m[1], 10) : null;
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, { headers: { "User-Agent": "ODDLY-xG/1.0" } }, (res) => {
      if (res.statusCode === 302 || res.statusCode === 301) {
        file.close();
        fs.unlinkSync(dest);
        return download(res.headers.location, dest).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        file.close();
        fs.unlinkSync(dest);
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      res.pipe(file);
      file.on("finish", () => file.close(resolve));
    }).on("error", (e) => { file.close(); fs.unlinkSync(dest); reject(e); });
  });
}

async function ensureFile(key) {
  const { url, file } = FILES[key];
  const dest = path.join(DATA_DIR, file);
  if (fs.existsSync(dest) && fs.statSync(dest).size > 1000) return dest;
  if (!FETCH) throw new Error(`${dest} missing — rerun with --fetch to download`);
  console.log(`⬇️  Downloading ${file} ...`);
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  await download(url, dest);
  console.log(`   saved ${(fs.statSync(dest).size / 1e6).toFixed(1)} MB`);
  return dest;
}

function toArrayBuffer(buf) {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

async function main() {
  console.log("⚽ ODDLY Opta xG Builder");
  console.log("━".repeat(55));

  const fixturesPath = await ensureFile("fixtures");
  const bymatchPath = await ensureFile("bymatch");

  // ── 1. Aggregate player×match xG → team×match xG ──────────────────────
  // Column-projected object read: 3 fields × ~3.5M rows.
  console.log("\n📊 Aggregating player xG → team-match xG (this reads ~330MB)...");
  const teamXg = new Map(); // `${match_id}|${team_id}` → summed xg
  let playerRows = 0;
  const bymatchBuf = fs.readFileSync(bymatchPath);
  const rows = await parquetReadObjects({
    file: toArrayBuffer(bymatchBuf),
    columns: ["match_id", "team_id", "xg"],
  });
  for (const r of rows) {
    const xg = Number(r.xg);
    if (!Number.isFinite(xg)) continue;
    const k = r.match_id + "|" + r.team_id;
    teamXg.set(k, (teamXg.get(k) || 0) + xg);
    playerRows++;
  }
  rows.length = 0; // release
  console.log(`   ${playerRows} player-match rows → ${teamXg.size} team-match xG values`);

  // ── 2. Read fixtures, join, emit Understat-format matches ─────────────
  console.log("\n📋 Joining fixtures...");
  const fixturesBuf = fs.readFileSync(fixturesPath);
  const fixtures = await parquetReadObjects({
    file: toArrayBuffer(fixturesBuf),
    columns: [
      "match_id", "match_date", "match_status", "home_team", "away_team",
      "home_team_id", "away_team_id", "home_score", "away_score",
      "competition", "season",
    ],
  });
  console.log(`   ${fixtures.length} fixtures loaded`);

  const matches = [];
  let skippedNoXg = 0, skippedComp = 0, skippedSeason = 0, skippedStatus = 0;
  const compCounts = {};

  for (const f of fixtures) {
    const comp = f.competition;
    if (!COMPETITIONS[comp]) { skippedComp++; continue; }
    const yr = seasonStartYear(f.season);
    if (yr === null) { skippedSeason++; continue; }
    // Season window: big-5 leagues only pre-MIN_YEAR (Understat owns 2021+);
    // all other competitions require season start >= MIN_YEAR for recency
    // parity with the Understat window (2021–2025).
    if (BIG5.has(comp) ? yr >= MIN_YEAR : yr < MIN_YEAR) { skippedSeason++; continue; }
    if (f.match_status !== "Played") { skippedStatus++; continue; }

    const hx = teamXg.get(f.match_id + "|" + f.home_team_id);
    const ax = teamXg.get(f.match_id + "|" + f.away_team_id);
    if (hx === undefined || ax === undefined) { skippedNoXg++; continue; }

    matches.push({
      external_id: f.match_id,
      home: f.home_team,
      away: f.away_team,
      home_xg: Math.round(hx * 100000) / 100000,
      away_xg: Math.round(ax * 100000) / 100000,
      home_scored: parseInt(f.home_score, 10) || 0,
      away_scored: parseInt(f.away_score, 10) || 0,
      date: String(f.match_date).slice(0, 10),
      is_result: true,
      league: comp,
      league_name: COMPETITIONS[comp],
      season: yr,
    });
    compCounts[COMPETITIONS[comp]] = (compCounts[COMPETITIONS[comp]] || 0) + 1;
  }

  const output = {
    source: "pannadata Opta open data (opta_match_xg + xmetrics_bymatch)",
    source_url: "https://github.com/peteowen1/pannadata/releases/tag/opta-latest",
    built_at: new Date().toISOString(),
    min_season_year: MIN_YEAR,
    match_count: matches.length,
    competitions: compCounts,
    matches,
  };

  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, JSON.stringify(output));

  console.log("\n" + "═".repeat(55));
  console.log(`✅ Wrote ${matches.length} matches → ${path.relative(ROOT, OUTPUT)}`);
  console.log(`   skipped: ${skippedComp} comp, ${skippedSeason} season, ${skippedStatus} status, ${skippedNoXg} no-xG`);
  for (const [lg, n] of Object.entries(compCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`   ${lg.padEnd(28)} ${n}`);
  }
}

main().catch((e) => { console.error("❌ build failed:", e); process.exit(1); });
