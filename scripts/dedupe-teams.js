#!/usr/bin/env node
/**
 * dedupe-teams.js — merge duplicate team rows whose names normalize to the
 * same key under src/lib/football/team-normalizer.ts
 * (e.g. "Man City" vs "Manchester City", "Atletico Madrid" vs "atlético madrid").
 *
 * For each duplicate group the canonical row is the one with the most
 * fixture references (ties → earliest created_at). All team-id references
 * are repointed to the canonical row and the duplicate is deleted.
 *
 * Usage:
 *   node scripts/dedupe-teams.js --dry-run   # report only
 *   node scripts/dedupe-teams.js             # merge
 */

const fs = require("fs");
const path = require("path");
const ts = require("typescript");
const { Client } = require("pg");

const ROOT = path.join(__dirname, "..");
const DRY_RUN = process.argv.includes("--dry-run");

for (const line of fs.readFileSync(path.join(ROOT, ".env.local"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

// Same normalizer prod uses (transpiled TS → CJS)
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

// Every public table column that stores a teams.id reference.
// Discovered dynamically so non-FK columns (match_features etc.) are covered.
const TEAM_REF_COLUMNS = ["team_id", "home_team_id", "away_team_id"];

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

  // Discover (table, column) pairs holding team ids
  const { rows: colRows } = await client.query(
    `select table_name, column_name
     from information_schema.columns
     where table_schema = 'public'
       and column_name = any($1::text[])
       and data_type = 'uuid'`,
    [TEAM_REF_COLUMNS]
  );
  const refCols = colRows
    .filter((r) => r.table_name !== "teams") // teams has no self team-id cols anyway
    .map((r) => ({ table: r.table_name, column: r.column_name }));
  console.log(`Team-id columns found: ${refCols.length}`);

  const { rows: teams } = await client.query(
    "select id, canonical_name, created_at from teams order by created_at"
  );
  console.log(`Teams: ${teams.length}`);

  // Group by normalized key
  const groups = new Map();
  for (const t of teams) {
    const key = normalizeTeamName(t.canonical_name) || t.canonical_name.toLowerCase();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }
  const dups = [...groups.entries()].filter(([, v]) => v.length > 1);
  console.log(`Duplicate normalized-name groups: ${dups.length}`);

  if (!dups.length) { await client.end(); return; }

  // Fixture reference counts for canonical selection
  const { rows: fxCounts } = await client.query(
    `select tid, count(*)::int c from (
       select home_team_id tid from fixtures
       union all select away_team_id from fixtures
     ) x group by tid`
  );
  const fxCount = new Map(fxCounts.map((r) => [r.tid, r.c]));

  const merges = [];
  for (const [key, members] of dups) {
    // Canonical: most fixture refs, then earliest created_at
    const sorted = [...members].sort((a, b) => {
      const ca = fxCount.get(a.id) || 0, cb = fxCount.get(b.id) || 0;
      if (cb !== ca) return cb - ca;
      return new Date(a.created_at) - new Date(b.created_at);
    });
    const canonical = sorted[0];
    for (const dup of sorted.slice(1)) {
      merges.push({ key, canonical, dup });
    }
  }

  for (const m of merges) {
    console.log(
      `  merge "${m.dup.canonical_name}" (${m.dup.id}) → "${m.canonical.canonical_name}" (${m.canonical.id})  [key: ${m.key}]`
    );
  }

  if (DRY_RUN) {
    // Report reference counts per dup
    for (const m of merges) {
      const counts = [];
      for (const { table, column } of refCols) {
        const { rows } = await client.query(
          `select count(*)::int c from "${table}" where "${column}" = $1`,
          [m.dup.id]
        );
        if (rows[0].c > 0) counts.push(`${table}.${column}=${rows[0].c}`);
      }
      console.log(`    refs for "${m.dup.canonical_name}": ${counts.join(", ") || "none"}`);
    }
    await client.end();
    return;
  }

  await client.query("begin");
  try {
    for (const m of merges) {
      const canonId = m.canonical.id;
      const dupId = m.dup.id;

      for (const { table, column } of refCols) {
        // team_strengths is PK'd on team_id alone — if canonical already has
        // a row, drop the dup's row instead of repointing (would violate PK).
        if (table === "team_strengths" && column === "team_id") {
          const { rows: canonRows } = await client.query(
            `select 1 from team_strengths where team_id = $1 limit 1`, [canonId]
          );
          if (canonRows.length) {
            await client.query(`delete from team_strengths where team_id = $1`, [dupId]);
            continue;
          }
        }
        await client.query(
          `update "${table}" set "${column}" = $1 where "${column}" = $2`,
          [canonId, dupId]
        );
      }

      // team_aliases.canonical_name is a name string, not an FK — repoint it
      await client.query(
        `update team_aliases set canonical_name = $1
         where lower(canonical_name) = lower($2)`,
        [m.canonical.canonical_name, m.dup.canonical_name]
      );

      // Fill gaps on the canonical row (country/league_id) from the dup
      await client.query(
        `update teams c set
           country = coalesce(c.country, d.country),
           league_id = coalesce(c.league_id, d.league_id)
         from teams d
         where c.id = $1 and d.id = $2`,
        [canonId, dupId]
      );

      await client.query(`delete from teams where id = $1`, [dupId]);
      console.log(`  merged "${m.dup.canonical_name}" → "${m.canonical.canonical_name}"`);
    }
    await client.query("commit");
    console.log(`Done. Merged ${merges.length} duplicate team row(s).`);
  } catch (e) {
    await client.query("rollback");
    console.error("Merge failed, rolled back:", e.message);
    process.exit(1);
  }

  await client.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
