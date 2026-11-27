#!/usr/bin/env node
/**
 * map-backfill-leagues.js — set fixtures.league_id for the ~12k research
 * backfill rows (external_id 'rd:<idx>') whose league code had no DB league.
 *
 * rd:<idx> is the index into data/research-dataset.json `data` array
 * (see scripts/backfill-history.js). League codes E2/E3/D2/I2/SP2/F2/B1 now
 * map to league rows created by
 * supabase/migrations/20261115000000_fixture_provider_and_league_ids.sql.
 *
 * Usage:
 *   node scripts/map-backfill-leagues.js --dry-run
 *   node scripts/map-backfill-leagues.js
 */

const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

const ROOT = path.join(__dirname, "..");
const DRY_RUN = process.argv.includes("--dry-run");

for (const line of fs.readFileSync(path.join(ROOT, ".env.local"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

// football-data.co.uk code → leagues.name (must match migration seeds)
const LEAGUE_MAP = {
  E0: "Premier League",
  E1: "Championship",
  E2: "League One",
  E3: "League Two",
  SC0: "Scottish Premiership",
  D1: "Bundesliga",
  D2: "2. Bundesliga",
  I1: "Serie A",
  I2: "Serie B",
  SP1: "La Liga",
  SP2: "LaLiga2",
  F1: "Ligue 1",
  F2: "Ligue 2",
  N1: "Eredivisie",
  P1: "Primeira Liga",
  T1: "Super Lig",
  B1: "Belgian Pro League",
};

async function main() {
  const dataset = JSON.parse(
    fs.readFileSync(path.join(ROOT, "data", "research-dataset.json"), "utf8")
  );
  const matches = dataset.data;
  console.log(`Dataset rows: ${matches.length}`);

  const client = new Client({
    host: process.env.SUPABASE_POOLER_HOST || "aws-0-eu-west-1.pooler.supabase.com",
    port: 5432,
    user: `postgres.${process.env.SUPABASE_PROJECT_REF || "xruhvekcowdwocydqnmp"}`,
    password: process.env.SUPABASE_DB_PASSWORD,
    database: "postgres",
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  const { rows: leagues } = await client.query("select id, name from leagues");
  const leagueIdByName = {};
  for (const l of leagues) leagueIdByName[l.name.toLowerCase()] = l.id;

  // idx → league uuid (only rows still missing league_id matter, but build all)
  const idxToLeague = new Map();
  const stats = {};
  for (let i = 0; i < matches.length; i++) {
    const code = matches[i].league;
    const lname = LEAGUE_MAP[code];
    const lid = lname ? leagueIdByName[lname.toLowerCase()] : null;
    if (lid) idxToLeague.set(i, lid);
    stats[code] = (stats[code] || 0) + 1;
  }
  console.log("Dataset league codes:", stats);

  const { rows: nullRows } = await client.query(
    "select id, external_id from fixtures where league_id is null and external_id like 'rd:%'"
  );
  console.log(`Fixtures with NULL league_id and rd: external_id: ${nullRows.length}`);

  // Group fixture ids by target league
  const byLeague = new Map(); // league_id -> [fixture_id]
  let unmapped = 0;
  for (const f of nullRows) {
    const idx = parseInt(f.external_id.slice(3), 10);
    const lid = idxToLeague.get(idx);
    if (!lid) { unmapped++; continue; }
    if (!byLeague.has(lid)) byLeague.set(lid, []);
    byLeague.get(lid).push(f.id);
  }
  console.log(`Mappable: ${nullRows.length - unmapped}, unmapped: ${unmapped}`);

  if (DRY_RUN) {
    for (const [lid, ids] of byLeague) {
      const name = leagues.find((l) => l.id === lid)?.name;
      console.log(`  ${name}: ${ids.length}`);
    }
    await client.end();
    return;
  }

  let updated = 0;
  for (const [lid, ids] of byLeague) {
    for (let i = 0; i < ids.length; i += 1000) {
      const slice = ids.slice(i, i + 1000);
      const r = await client.query(
        "update fixtures set league_id = $1, updated_at = now() where id = any($2::uuid[])",
        [lid, slice]
      );
      updated += r.rowCount;
    }
  }
  console.log(`Updated ${updated} fixtures`);

  const { rows: check } = await client.query(
    "select count(*) c from fixtures where league_id is null"
  );
  console.log(`Remaining NULL league_id fixtures: ${check[0].c}`);
  await client.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
