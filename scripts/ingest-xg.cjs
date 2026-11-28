#!/usr/bin/env node

/**
 * ODDLY xG Ingest
 *
 * Maps local xG source files into the `xg_features` table (one row per
 * team per match) and refreshes the xG columns of `team_feature_profiles`
 * from the ingested per-match history.
 *
 * Sources:
 *   - data/understat-xg.json  → per-match xG (home_xg/away_xg + date),
 *     5 leagues, seasons 2021–2026. This is the primary source.
 *   - data/statsbomb-xg.json  → team AGGREGATES only (no per-match rows,
 *     no dates). NOT ingested into xg_features; it already flows into
 *     team_feature_profiles via worker/feature-store-sync.js.
 *
 * Fixture linkage: each Understat match is matched to `fixtures` by
 * kickoff date (±1 day tolerance) + normalizeTeamName() on both team
 * names in home/away orientation. Matches that can't be linked get
 * fixture_id = NULL and are counted/logged — never forced.
 *
 * Usage:
 *   node scripts/ingest-xg.js [--dry-run] [--no-profiles] [--file path] [--source name]
 *
 * `--source` sets xg_features.source (default "understat") and the
 * team_feature_profiles.xg_source label (`<source>_matches`).
 */

const fs = require("fs");
const path = require("path");
const ts = require("typescript");
const { Client } = require("pg");

const ROOT = path.join(__dirname, "..");
const DRY_RUN = process.argv.includes("--dry-run");
const NO_PROFILES = process.argv.includes("--no-profiles");
const fileArg = process.argv.indexOf("--file");
const sourceArg = process.argv.indexOf("--source");
const SOURCE = sourceArg > -1 ? process.argv[sourceArg + 1] : "understat";
const DATA_FILE =
  fileArg > -1
    ? path.resolve(process.argv[fileArg + 1])
    : path.join(ROOT, "data", `${SOURCE}-xg.json`);

// ── Env (.env.local) — same pattern as scripts/dbq.js ────────────────────
for (const line of fs.readFileSync(path.join(ROOT, ".env.local"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

// ── Load TS modules (team-normalizer + xg-core) via transpile ─────────────
function loadTsModule(relPath) {
  const src = fs.readFileSync(path.join(ROOT, relPath), "utf8");
  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const m = new module.constructor();
  m.paths = module.paths;
  const fakePath = path.join(ROOT, relPath.replace(/\.ts$/, ".js"));
  m._compile(js, fakePath);
  return m.exports;
}

const { normalizeTeamName } = loadTsModule("src/lib/football/team-normalizer.ts");
const { understatMatchesToRows, computeRollingXG } = loadTsModule("src/lib/xg/xg-core.ts");

// ── DB ───────────────────────────────────────────────────────────────────
async function connect() {
  const c = new Client({
    host: process.env.SUPABASE_POOLER_HOST || "aws-0-eu-west-1.pooler.supabase.com",
    port: 5432,
    user: `postgres.${process.env.SUPABASE_PROJECT_REF || "xruhvekcowdwocydqnmp"}`,
    password: process.env.SUPABASE_DB_PASSWORD,
    database: "postgres",
    ssl: { rejectUnauthorized: false },
  });
  await c.connect();
  return c;
}

// ── Fixture linkage ──────────────────────────────────────────────────────
function dateOnly(d) {
  return d.toISOString().slice(0, 10);
}
function shiftDate(dstr, days) {
  const d = new Date(dstr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function loadFixtureIndex(client) {
  const { rows } = await client.query(
    `select f.id, f.kickoff_time,
            ht.canonical_name as home_name, at.canonical_name as away_name
       from fixtures f
       join teams ht on ht.id = f.home_team_id
       join teams at on at.id = f.away_team_id
      where f.status = 'finished'`
  );
  const byDate = new Map(); // dateStr -> [{id, homeKey, awayKey}]
  for (const r of rows) {
    const dt = dateOnly(new Date(r.kickoff_time));
    const entry = {
      id: r.id,
      homeKey: normalizeTeamName(r.home_name),
      awayKey: normalizeTeamName(r.away_name),
    };
    if (!byDate.has(dt)) byDate.set(dt, []);
    byDate.get(dt).push(entry);
  }
  return byDate;
}

function linkFixture(byDate, row) {
  for (const off of [0, -1, 1]) {
    const candidates = byDate.get(shiftDate(row.matchDate, off)) || [];
    for (const c of candidates) {
      // row is one team's line; derive the match's home/away team keys
      // (for the away row, teamKey/opponentKey are swapped relative to
      // the fixture's home/away orientation).
      const matchHomeKey = row.isHome ? row.teamKey : row.opponentKey;
      const matchAwayKey = row.isHome ? row.opponentKey : row.teamKey;
      if (matchHomeKey === c.homeKey && matchAwayKey === c.awayKey) return c.id;
    }
  }
  return null;
}

// ── Insert ───────────────────────────────────────────────────────────────
const COLS = [
  "team_name", "team_name_normalized", "opponent", "is_home",
  "xg_for", "xg_against", "xg_diff", "league", "season",
  "match_date", "match_external_id", "source", "fixture_id",
];

async function insertRows(client, rows) {
  const BATCH = 400;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const values = [];
    const params = [];
    batch.forEach((r, j) => {
      const base = j * COLS.length;
      values.push(`(${COLS.map((_, k) => `$${base + k + 1}`).join(",")})`);
      params.push(
        r.teamName, r.teamKey, r.opponent, r.isHome,
        r.xgFor, r.xgAgainst, r.xgDiff, r.league, r.season,
        r.matchDate, r.externalId, SOURCE, r.fixtureId || null
      );
    });
    if (DRY_RUN) {
      inserted += batch.length;
      continue;
    }
    await client.query(
      `insert into xg_features (${COLS.join(",")})
       values ${values.join(",")}
       on conflict (source, match_external_id, team_name_normalized)
       do update set
         team_name = excluded.team_name,
         opponent = excluded.opponent,
         is_home = excluded.is_home,
         xg_for = excluded.xg_for,
         xg_against = excluded.xg_against,
         xg_diff = excluded.xg_diff,
         league = excluded.league,
         season = excluded.season,
         match_date = excluded.match_date,
         fixture_id = excluded.fixture_id`,
      params
    );
    inserted += batch.length;
  }
  return inserted;
}

// ── team_feature_profiles sync ───────────────────────────────────────────
// Compute season-long + last-5 rolling xG per team from xg_features and
// update the existing xG columns on team_feature_profiles (matched by
// normalizeTeamName). Only touches xG columns; never creates profiles.
async function syncTeamProfiles(client) {
  console.log("\n📊 Syncing team_feature_profiles xG columns from xg_features...");

  const { rows: xgRows } = await client.query(
    `select team_name, team_name_normalized, match_date, is_home, xg_for, xg_against, season
       from xg_features
      where match_date is not null`
  );
  const { rows: profiles } = await client.query(
    `select id, team_name from team_feature_profiles`
  );

  // Group xg rows by normalized team key
  const byKey = new Map();
  for (const r of xgRows) {
    const key = r.team_name_normalized || normalizeTeamName(r.team_name);
    if (!key) continue;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push({
      date: String(r.match_date).slice(0, 10),
      isHome: r.is_home === true,
      xgFor: Number(r.xg_for),
      xgAgainst: Number(r.xg_against),
      season: r.season,
    });
  }

  // Compute profile per xg team key (season-long window + last5 from core)
  const profileByKey = new Map();
  for (const [key, matches] of byKey) {
    const season = computeRollingXG(matches, { window: 100000 });
    if (!season) continue;
    const latestSeason = matches
      .map((m) => m.season)
      .filter(Boolean)
      .sort()
      .slice(-1)[0] || null;
    profileByKey.set(key, { season, latestSeason });
  }

  let updated = 0;
  const unmatchedProfiles = [];
  for (const p of profiles) {
    const key = normalizeTeamName(p.team_name);
    const prof = profileByKey.get(key);
    if (!prof || !prof.season.xgForAvg) continue; // no xG history → leave untouched
    const s = prof.season;
    if (DRY_RUN) {
      updated++;
      continue;
    }
    await client.query(
      `update team_feature_profiles set
         avg_xg = $2, avg_xga = $3,
         home_xg = $4, away_xg = $5, home_xga = $6, away_xga = $7,
         xg_last5 = $8, xg_source = $10,
         data_season = $9, last_updated = now()
       where id = $1`,
      [
        p.id,
        s.xgForAvg, s.xgAgainstAvg,
        s.homeXgForAvg, s.awayXgForAvg, s.homeXgAgainstAvg, s.awayXgAgainstAvg,
        s.last5XgForAvg, prof.latestSeason, `${SOURCE}_matches`,
      ]
    );
    updated++;
  }
  for (const p of profiles) {
    if (!profileByKey.has(normalizeTeamName(p.team_name))) unmatchedProfiles.push(p.team_name);
  }
  console.log(`  ✅ ${updated} team_feature_profiles rows updated with rolling xG`);
  console.log(`  ℹ️  ${unmatchedProfiles.length} profiles have no xG history (left unchanged)`);

  // Create minimal profiles for canonical teams that now have xG history
  // but no team_feature_profiles row yet (e.g. newly covered leagues such
  // as Eredivisie, Primeira Liga, Belgian Pro, MLS, Brasileirão). Only the
  // xG columns are populated; other rating columns stay NULL and consumers
  // fall back to defaults.
  const { rows: canonTeams } = await client.query(
    `select t.canonical_name, l.name as league
       from teams t left join leagues l on l.id = t.league_id`
  );
  const canonByKey = new Map();
  for (const t of canonTeams) {
    const k = normalizeTeamName(t.canonical_name);
    if (k && !canonByKey.has(k)) canonByKey.set(k, t);
  }
  const existingKeys = new Set(profiles.map((p) => normalizeTeamName(p.team_name)));
  let created = 0;
  for (const [key, prof] of profileByKey) {
    if (existingKeys.has(key)) continue;
    const canon = canonByKey.get(key);
    if (!canon || !prof.season.xgForAvg) continue;
    const s = prof.season;
    if (DRY_RUN) {
      created++;
      continue;
    }
    await client.query(
      `insert into team_feature_profiles
         (team_name, league, avg_xg, avg_xga, home_xg, away_xg,
          home_xga, away_xga, xg_last5, xg_source, data_season, last_updated)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now())
       on conflict (team_name) do nothing`,
      [
        canon.canonical_name, canon.league,
        s.xgForAvg, s.xgAgainstAvg,
        s.homeXgForAvg, s.awayXgForAvg, s.homeXgAgainstAvg, s.awayXgAgainstAvg,
        s.last5XgForAvg, `${SOURCE}_matches`, prof.latestSeason,
      ]
    );
    created++;
  }
  console.log(`  ✅ ${created} new team_feature_profiles rows created for xG-covered teams`);
  return updated + created;
}

// ── Main ─────────────────────────────────────────────────────────────────
async function main() {
  console.log("⚽ ODDLY xG Ingest");
  console.log("━".repeat(55));
  if (DRY_RUN) console.log("   [DRY RUN — no writes]\n");

  const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  const matches = Array.isArray(data.matches) ? data.matches : [];
  console.log(`   Source: ${path.relative(ROOT, DATA_FILE)}`);
  console.log(`   Matches: ${matches.length} (reported match_count: ${data.match_count})`);

  const { rows, skipped } = understatMatchesToRows(matches, normalizeTeamName);
  console.log(`   Mapped to ${rows.length} team-match rows (${skipped} matches skipped: missing xG/date/teams)`);

  const client = await connect();
  try {
    // Fixture linkage (per unique match, not per row)
    const byDate = await loadFixtureIndex(client);
    console.log(`   Loaded ${[...byDate.values()].reduce((s, v) => s + v.length, 0)} finished fixtures for linking`);

    let linkedRows = 0;
    const unlinkedSamples = [];
    for (const r of rows) {
      const fid = linkFixture(byDate, r);
      r.fixtureId = fid;
      if (fid) linkedRows++;
      else if (unlinkedSamples.length < 15) {
        unlinkedSamples.push(`${r.matchDate} ${r.opponent} vs ${r.teamName}`);
      }
    }
    const linkedMatchSet = new Set();
    const unlinkedMatchSet = new Set();
    for (const r of rows) {
      const k = `${r.externalId}|${r.matchDate}`;
      (r.fixtureId ? linkedMatchSet : unlinkedMatchSet).add(k);
    }
    console.log(
      `   Fixture linkage: ${linkedMatchSet.size} matches linked, ` +
        `${unlinkedMatchSet.size} unmatched (${linkedRows}/${rows.length} rows), fixture_id=NULL for unmatched`
    );
    if (unlinkedSamples.length) {
      console.log("   Unmatched samples:");
      for (const s of unlinkedSamples) console.log(`     - ${s}`);
    }

    const inserted = await insertRows(client, rows);
    console.log(`   ✅ ${inserted} xg_features rows ${DRY_RUN ? "would be" : ""} upserted`);

    if (!NO_PROFILES) await syncTeamProfiles(client);
  } finally {
    await client.end();
  }

  console.log("\n" + "═".repeat(55));
  console.log("✅ xG ingest complete");
}

main().catch((e) => {
  console.error("❌ ingest failed:", e);
  process.exit(1);
});
