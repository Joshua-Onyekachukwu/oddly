#!/usr/bin/env node
/**
 * ODDLY xG Coverage Audit
 *
 * Reports, per league in the `leagues` table, how many `teams` rows have
 * xG coverage — measured two ways:
 *   1. team_feature_profiles row exists with xg_source/avg_xg populated
 *      (matched via normalizeTeamName on canonical_name vs team_name)
 *   2. xg_features has per-match rows for the normalized team key
 *
 * Usage: node scripts/audit-xg-coverage.cjs [--json]
 */

const fs = require("fs");
const path = require("path");
const ts = require("typescript");
const { Client } = require("pg");

const ROOT = path.join(__dirname, "..");
for (const line of fs.readFileSync(path.join(ROOT, ".env.local"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

function loadTsModule(relPath) {
  const src = fs.readFileSync(path.join(ROOT, relPath), "utf8");
  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const m = new module.constructor();
  m.paths = module.paths;
  m._compile(js, path.join(ROOT, relPath.replace(/\.ts$/, ".js")));
  return m.exports;
}

const { normalizeTeamName } = loadTsModule("src/lib/football/team-normalizer.ts");

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

(async () => {
  const client = await connect();
  const { rows: leagues } = await client.query(
    `select l.id, l.name from leagues l order by l.name`
  );
  const { rows: teams } = await client.query(
    `select t.id, t.canonical_name, t.league_id from teams t`
  );
  const { rows: profiles } = await client.query(
    `select team_name, xg_source, avg_xg from team_feature_profiles`
  );
  const { rows: xgKeys } = await client.query(
    `select distinct team_name_normalized, league from xg_features where match_date is not null`
  );

  // profile lookup by normalized key (first profile wins on collision)
  const profileByKey = new Map();
  for (const p of profiles) {
    const k = normalizeTeamName(p.team_name);
    if (k && !profileByKey.has(k)) profileByKey.set(k, p);
  }
  const xgKeySet = new Set(xgKeys.map((r) => r.team_name_normalized));
  const xgLeaguesByKey = new Map();
  for (const r of xgKeys) {
    if (!xgLeaguesByKey.has(r.team_name_normalized)) xgLeaguesByKey.set(r.team_name_normalized, new Set());
    xgLeaguesByKey.get(r.team_name_normalized).add(r.league);
  }

  const teamsByLeague = new Map();
  for (const t of teams) {
    const lg = leagues.find((l) => l.id === t.league_id)?.name || "(no league)";
    if (!teamsByLeague.has(lg)) teamsByLeague.set(lg, []);
    teamsByLeague.get(lg).push(t);
  }

  const report = [];
  let totTeams = 0, totProf = 0, totXg = 0;
  for (const [league, list] of [...teamsByLeague.entries()].sort()) {
    let withProfile = 0, withXg = 0, withProfileXg = 0;
    const missing = [];
    for (const t of list) {
      const k = normalizeTeamName(t.canonical_name);
      const prof = profileByKey.get(k);
      const hasProfXg = !!(prof && prof.avg_xg !== null && prof.avg_xg !== undefined);
      const hasXgRows = xgKeySet.has(k);
      if (hasProfXg) withProfile++;
      if (hasXgRows) withXg++;
      if (hasProfXg && hasXgRows) withProfileXg++;
      if (!hasXgRows) missing.push(t.canonical_name);
    }
    totTeams += list.length; totProf += withProfile; totXg += withXg;
    report.push({ league, teams: list.length, profile_xg: withProfile, xg_features: withXg, both: withProfileXg, pct: list.length ? Math.round(1000 * withXg / list.length) / 10 : 0, missing });
  }

  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(report, null, 1));
  } else {
    console.log("league".padEnd(24), "teams".padStart(6), "profXG".padStart(7), "xgFeat".padStart(7), "both".padStart(6), "  %xg");
    for (const r of report) {
      console.log(r.league.padEnd(24), String(r.teams).padStart(6), String(r.profile_xg).padStart(7), String(r.xg_features).padStart(7), String(r.both).padStart(6), "  " + r.pct + "%");
    }
    console.log("-".repeat(70));
    console.log("TOTAL".padEnd(24), String(totTeams).padStart(6), String(totProf).padStart(7), String(totXg).padStart(7));
    const noLeague = teams.filter((t) => !t.league_id);
    console.log(`teams with no league_id: ${noLeague.length}`);
  }
  await client.end();
})().catch((e) => { console.error(e); process.exit(1); });
