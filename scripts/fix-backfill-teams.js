#!/usr/bin/env node
/**
 * One-off repair for scripts/backfill-history.js first run:
 * repoints fixtures that were attached to wrongly-created team rows
 * onto the correct pre-existing teams, then deletes orphan team rows.
 *
 * Usage: node scripts/fix-backfill-teams.js [--dry-run]
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

// created research-name team → correct existing teams.canonical_name
const REPOINT = {
  "Sociedad": "Real Sociedad",
  "Espanol": "espanyol",
  "Santander": "real racing club de santander",
  "For Sittard": "fortuna sittard",
  "Guimaraes": "vitória",
};

(async () => {
  const c = new Client({
    host: process.env.SUPABASE_POOLER_HOST || "aws-0-eu-west-1.pooler.supabase.com",
    port: 5432,
    user: `postgres.${process.env.SUPABASE_PROJECT_REF || "xruhvekcowdwocydqnmp"}`,
    password: process.env.SUPABASE_DB_PASSWORD,
    database: "postgres",
    ssl: { rejectUnauthorized: false },
  });
  await c.connect();

  for (const [createdName, targetName] of Object.entries(REPOINT)) {
    const { rows: created } = await c.query(
      "select id from teams where canonical_name = $1", [createdName]);
    const { rows: target } = await c.query(
      "select id, canonical_name from teams where canonical_name = $1", [targetName]);
    if (!created.length) { console.log(`skip ${createdName}: created row not found`); continue; }
    if (!target.length) { console.log(`!! ${createdName}: target '${targetName}' not found`); continue; }
    const cid = created[0].id, tid = target[0].id;
    const { rows: cnt } = await c.query(
      "select count(*) c from fixtures where home_team_id=$1 or away_team_id=$1", [cid]);
    console.log(`${createdName} (${cid.slice(0, 8)}) → ${target[0].canonical_name} (${tid.slice(0, 8)}): ${cnt[0].c} fixtures`);
    if (DRY_RUN) continue;
    await c.query("update fixtures set home_team_id=$1 where home_team_id=$2", [tid, cid]);
    await c.query("update fixtures set away_team_id=$1 where away_team_id=$2", [tid, cid]);
    // delete orphan team if nothing references it
    const { rows: still } = await c.query(
      "select (select count(*) from fixtures where home_team_id=$1 or away_team_id=$1) f, (select count(*) from teams where league_id=$1) t", [cid]);
    // also check other tables that might reference teams.id
    const { rows: refs } = await c.query(
      `select
        (select count(*) from fixtures where home_team_id=$1 or away_team_id=$1) as fixtures,
        (select count(*) from teams where id=$1) as self`, [cid]);
    const fcount = parseInt(refs[0].fixtures);
    if (fcount === 0) {
      await c.query("delete from teams where id=$1", [cid]);
      console.log(`   deleted orphan team ${createdName}`);
    } else {
      console.log(`   kept ${createdName}: still referenced by ${fcount} fixtures`);
    }
  }
  await c.end();
})().catch((e) => { console.error(e); process.exit(1); });
