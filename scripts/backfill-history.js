#!/usr/bin/env node
/**
 * ODDLY — Backfill finished-match history into `fixtures` from
 * data/research-dataset.json (27,314 historical matches, football-data.co.uk
 * naming, league codes E0/E1/.../B1).
 *
 * The predict cron (src/app/api/v1/cron/predict/route.ts) builds Elo + form
 * from `fixtures` where status='finished' and home_score not null, joining
 * teams for canonical_name. This script inserts the research matches as
 * finished fixtures so that history exists.
 *
 * Usage:
 *   node scripts/backfill-history.js --dry-run     # match report only
 *   node scripts/backfill-history.js               # insert
 *   node scripts/backfill-history.js --limit 500   # insert first N matches
 */

const fs = require("fs");
const path = require("path");
const ts = require("typescript");
const { Client } = require("pg");

const ROOT = path.join(__dirname, "..");
const DATASET = path.join(ROOT, "data", "research-dataset.json");
const DRY_RUN = process.argv.includes("--dry-run");
const NO_CREATE = process.argv.includes("--no-create");
const LIMIT = process.argv.includes("--limit")
  ? parseInt(process.argv[process.argv.indexOf("--limit") + 1])
  : Infinity;

// ── env ──────────────────────────────────────────────────────────────
for (const line of fs.readFileSync(path.join(ROOT, ".env.local"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

// ── team normalizer (same code prod uses) ────────────────────────────
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

// ── football-data.co.uk league code → DB leagues.name ───────────────
const LEAGUE_MAP = {
  E0: "Premier League",
  E1: "Championship",
  SC0: "Scottish Premiership",
  D1: "Bundesliga",
  I1: "Serie A",
  SP1: "La Liga",
  F1: "Ligue 1",
  N1: "Eredivisie",
  P1: "Primeira Liga",
  T1: "Super Lig",
  // No DB league: E2, E3 (English L1/L2), D2 (2.Bundesliga), SP2, I2, F2, B1 (Belgium)
};

// ── Supplemental aliases: football-data.co.uk short names → DB canonical_name.
// Curated from --dry-run unmatched list; only for teams that EXIST in the DB
// under a different name. Reserve sides ("Sociedad B", "Villarreal B") are
// deliberately NOT mapped to the first teams.
const EXTRA_ALIASES = {
  "Ath Bilbao": "Athletic Bilbao",
  "Ath Madrid": "Atletico Madrid",
  "Ein Frankfurt": "Eintracht Frankfurt",
  "Koln": "1.  köln",
  "Leverkusen": "Bayer Leverkusen",
  "La Coruna": "deportivo la coruña",
  "Maritimo": "cs maritimo",
  "Nijmegen": "nec nijmegen",
  "Nott'm Forest": "nottingham forest",
  "Paris SG": "Paris Saint-Germain",
  "Sp Braga": "braga",
  "Sp Lisbon": "sporting lisbon",
  "Twente": "twente enschede",
  "Vallecano": "rayo vallecano",
  "Mainz": "fsv mainz 05",
  "Hamburg": "hamburger sv",
  // Added after first backfill audit (fixtures already repointed by
  // scripts/fix-backfill-teams.js; kept here for reruns)
  "Sociedad": "Real Sociedad",
  "Espanol": "espanyol",
  "Santander": "real racing club de santander",
  "For Sittard": "fortuna sittard",
  "Guimaraes": "vitória",
};

// Generic normalizer for matching: accent-strip, lowercase, collapse
// punctuation/whitespace, drop common noise tokens.
function looseKey(s) {
  return (s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\b(fc|cf|afc|sc|ac|cd|ud|rcd|ssc|as|club|de|the)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function main() {
  const client = new Client({
    host: process.env.SUPABASE_POOLER_HOST || "aws-0-eu-west-1.pooler.supabase.com",
    port: 5432,
    user: `postgres.${process.env.SUPABASE_PROJECT_REF || "xruhvekcowdwocydqnmp"}`,
    password: process.env.SUPABASE_DB_PASSWORD,
    database: "postgres",
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  const { rows: teams } = await client.query("select id, canonical_name, league_id from teams");
  const { rows: aliases } = await client.query("select canonical_name, alias from team_aliases");
  const { rows: leagues } = await client.query("select id, name from leagues");
  const leagueIdByName = {};
  for (const l of leagues) leagueIdByName[l.name.toLowerCase()] = l.id;

  console.log(`DB: ${teams.length} teams, ${aliases.length} aliases, ${leagues.length} leagues`);

  // canonical_name (any case) → team row
  const canonLower = {};
  for (const t of teams) canonLower[t.canonical_name.toLowerCase()] = t;
  // alias.canonical_name (any case) → team row
  const aliasCanonLower = {};
  for (const t of teams) aliasCanonLower[t.canonical_name.toLowerCase()] = t;

  // Build lookup: key → team. Keys: raw lower, normalizeTeamName, looseKey.
  const lookup = new Map(); // key → team
  const addKey = (key, team) => {
    if (!key || !team) return;
    for (const k of [key, key.toLowerCase(), normalizeTeamName(key), looseKey(key)]) {
      const kk = (k || "").trim();
      if (kk && !lookup.has(kk)) lookup.set(kk, team);
    }
  };
  for (const t of teams) addKey(t.canonical_name, t);
  for (const a of aliases) {
    const canon = aliasCanonLower[a.canonical_name.toLowerCase()];
    if (canon) addKey(a.alias, canon);
  }
  // extra aliases
  for (const [k, v] of Object.entries(EXTRA_ALIASES)) {
    const t = canonLower[v.toLowerCase()] || lookup.get(normalizeTeamName(v)) || lookup.get(looseKey(v));
    if (t) addKey(k, t);
    else console.log(`  ! EXTRA_ALIAS target not found: ${k} -> ${v}`);
  }

  const resolveTeam = (name) => {
    if (!name) return null;
    const n = name.trim();
    return (
      canonLower[n.toLowerCase()] ||
      lookup.get(n.toLowerCase()) ||
      lookup.get(normalizeTeamName(n)) ||
      lookup.get(looseKey(n)) ||
      lookup.get(n) ||
      null
    );
  };

  // ── Load dataset ──
  console.log("Loading research-dataset.json ...");
  const dataset = JSON.parse(fs.readFileSync(DATASET, "utf8"));
  let matches = dataset.data;
  if (LIMIT !== Infinity) matches = matches.slice(0, LIMIT);
  console.log(`Dataset: ${matches.length} matches (${dataset.date_range?.from} → ${dataset.date_range?.to})`);

  // ── Resolve all teams first ──
  const distinct = new Set();
  for (const m of matches) { distinct.add(m.home_team); distinct.add(m.away_team); }
  const teamId = new Map(); // research name → teams.id
  const unmatched = [];
  for (const name of distinct) {
    const t = resolveTeam(name);
    if (t) teamId.set(name, t.id);
    else unmatched.push(name);
  }
  console.log(`Distinct research teams: ${distinct.size}; matched existing: ${distinct.size - unmatched.length}; unmatched: ${unmatched.length}`);

  // League id helper for newly created teams (first mapped league seen wins)
  const teamLeagueGuess = new Map(); // research name → league uuid
  for (const m of matches) {
    const lname = LEAGUE_MAP[m.league];
    const lid = lname ? leagueIdByName[lname.toLowerCase()] : null;
    for (const tn of [m.home_team, m.away_team]) {
      if (!teamLeagueGuess.has(tn) && lid) teamLeagueGuess.set(tn, lid);
    }
  }

  // Create teams rows for unmatched research names so NO history is lost.
  // canonical_name = the research name verbatim → normalizeTeamName() keys
  // stay consistent between these fixtures and any future fixtures using
  // the same teams.id.
  const createdTeams = [];
  if (!NO_CREATE && !DRY_RUN) {
    const existingLower = new Set(teams.map((t) => t.canonical_name.toLowerCase()));
    const pendingLower = new Set();
    for (const name of unmatched.sort()) {
      const low = name.toLowerCase();
      if (existingLower.has(low) || pendingLower.has(low)) continue;
      pendingLower.add(low);
      createdTeams.push({
        canonical_name: name,
        league_id: teamLeagueGuess.get(name) || null,
      });
    }
    console.log(`Creating ${createdTeams.length} new teams rows ...`);
    // map lower(canonical_name) → research name for id write-back
    const lowerToResearch = new Map(createdTeams.map((r) => [r.canonical_name.toLowerCase(), r.canonical_name]));
    let createdCount = 0;
    for (let i = 0; i < createdTeams.length; i += 200) {
      const slice = createdTeams.slice(i, i + 200);
      const { rows: ins } = await client.query(
        `insert into teams (canonical_name, league_id)
         select * from unnest($1::text[], $2::uuid[]) returning id, canonical_name`,
        [slice.map((r) => r.canonical_name), slice.map((r) => r.league_id)]
      );
      createdCount += ins.length;
      for (const r of ins) {
        const researchName = lowerToResearch.get(r.canonical_name.toLowerCase());
        if (researchName && !teamId.has(researchName)) teamId.set(researchName, r.id);
      }
    }
    console.log(`Created ${createdCount} teams; resolved map size: ${teamId.size}`);
  } else if (DRY_RUN) {
    console.log("Unmatched teams (would be created unless --no-create):");
    unmatched.sort().slice(0, 400).forEach((n) => console.log("  - " + n));
    if (unmatched.length > 400) console.log(`  ... and ${unmatched.length - 400} more`);
  }

  if (unmatched.length) {
    const stillUnmatched = unmatched.filter((n) => !teamId.has(n));
    console.log(`Still unresolved: ${stillUnmatched.length}${stillUnmatched.length ? " (first 20): " + stillUnmatched.slice(0, 20).join(", ") : ""}`);
  }

  // League resolution stats
  const leagueStats = {};
  for (const m of matches) {
    const lname = LEAGUE_MAP[m.league];
    leagueStats[m.league] = (leagueStats[m.league] || 0) + 1;
    if (!lname) leagueStats[m.league + " (no DB league)"] = (leagueStats[m.league + " (no DB league)"] || 0) + 1;
  }
  console.log("League mapping:", leagueStats);

  // Count insertable matches (both teams resolved)
  let insertable = 0, skippedNoTeam = 0, skippedNoScore = 0;
  const perLeagueInsertable = {};
  for (const m of matches) {
    if (m.home_goals == null || m.away_goals == null) { skippedNoScore++; continue; }
    if (!teamId.has(m.home_team) || !teamId.has(m.away_team)) { skippedNoTeam++; continue; }
    insertable++;
    perLeagueInsertable[m.league] = (perLeagueInsertable[m.league] || 0) + 1;
  }
  console.log(`Insertable: ${insertable}; skipped (unresolved team): ${skippedNoTeam}; skipped (no score): ${skippedNoScore}`);
  console.log("Insertable per league:", perLeagueInsertable);

  if (DRY_RUN) {
    await client.end();
    return;
  }

  // ── Insert ──
  // Idempotency: external_id = 'rd:<idx>' lets us detect prior runs.
  const { rows: existing } = await client.query(
    "select count(*) c from fixtures where external_id like 'rd:%'"
  );
  if (parseInt(existing[0].c) > 0) {
    console.log(`WARNING: ${existing[0].c} rows with external_id 'rd:%' already exist. Aborting to avoid duplicates.`);
    await client.end();
    return;
  }

  const BATCH = 500;
  let inserted = 0;
  const t0 = Date.now();
  for (let i = 0; i < matches.length; i += BATCH) {
    const slice = matches.slice(i, i + BATCH);
    const rows = [];
    for (let j = 0; j < slice.length; j++) {
      const m = slice[j];
      const idx = i + j;
      const hid = teamId.get(m.home_team);
      const aid = teamId.get(m.away_team);
      if (!hid || !aid || m.home_goals == null || m.away_goals == null) continue;
      const lname = LEAGUE_MAP[m.league];
      const lid = lname ? leagueIdByName[lname.toLowerCase()] : null;
      rows.push({
        external_id: `rd:${idx}`,
        home_team_id: hid,
        away_team_id: aid,
        league_id: lid || null,
        kickoff_time: `${m.date}T12:00:00Z`,
        status: "finished",
        home_score: m.home_goals,
        away_score: m.away_goals,
        is_featured: false,
      });
    }
    if (!rows.length) continue;
    // multi-row insert via unnest with explicit type casts
    const sql2 = `insert into fixtures (external_id, home_team_id, away_team_id, league_id, kickoff_time, status, home_score, away_score, is_featured)
      select * from unnest($1::text[], $2::uuid[], $3::uuid[], $4::uuid[], $5::timestamptz[], $6::text[], $7::int[], $8::int[], $9::boolean[])`;
    await client.query(sql2, [
      rows.map((r) => r.external_id),
      rows.map((r) => r.home_team_id),
      rows.map((r) => r.away_team_id),
      rows.map((r) => r.league_id),
      rows.map((r) => r.kickoff_time),
      rows.map((r) => r.status),
      rows.map((r) => r.home_score),
      rows.map((r) => r.away_score),
      rows.map((r) => r.is_featured),
    ]);
    inserted += rows.length;
    if (inserted % 5000 < BATCH) console.log(`  inserted ${inserted} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  }
  console.log(`Done. Inserted ${inserted} finished fixtures in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  await client.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
