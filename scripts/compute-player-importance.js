#!/usr/bin/env node
/**
 * ODDLY Player Importance — compute & persist
 *
 * Computes 0-1 importance scores per (team, player) using
 * src/lib/players/importance.ts and persists them:
 *   1. upserts into the player_importance table (score_0_1 + legacy score_1_10)
 *   2. backfills player_injury_data.player_importance (1-10 scale) for current
 *      injured/suspended/doubtful players
 *   3. refreshes player_availability.is_key_player (score_1_10 >= 7)
 *
 * Data sources (local JSON, no network):
 *   data/player-stats.json            — goals/assists/minutes/rating (stats tier)
 *   data/injuries-suspensions.json    — per-match absence records (history tier)
 *   data/premier-injuries.json,
 *   data/transfermarkt-injuries.json  — current injury rows to score
 *
 * Usage:
 *   node scripts/compute-player-importance.js [--dry-run] [--apply-migration]
 *
 * --dry-run          print the coverage report and planned writes, no DB writes
 * --apply-migration  create the player_importance table if missing (idempotent)
 */

const fs = require("fs");
const path = require("path");
const { Client } = require("pg");
const { loadImportanceEngine } = require("./importance-engine");

const ROOT = path.join(__dirname, "..");
const DRY_RUN = process.argv.includes("--dry-run");
const APPLY_MIGRATION = process.argv.includes("--apply-migration");
const MIGRATION = path.join(
  ROOT,
  "supabase",
  "migrations",
  "20261210000000_player_importance.sql"
);

// ─── env / db (same pattern as scripts/dbq.js) ────────────────────────────
for (const line of fs.readFileSync(path.join(ROOT, ".env.local"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

function loadJSON(name) {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, "data", name), "utf8"));
  } catch (e) {
    console.log(`  ⚠️  ${name}: ${e.message}`);
    return null;
  }
}

function asArray(d, ...keys) {
  if (Array.isArray(d)) return d;
  for (const k of keys) if (d && Array.isArray(d[k])) return d[k];
  return [];
}

// ─── main ─────────────────────────────────────────────────────────────────
(async () => {
  const engine = loadImportanceEngine();
  const { buildPlayerIndex, computeImportance } = engine;

  const statsRows = asArray(loadJSON("player-stats.json"));
  const histDoc = loadJSON("injuries-suspensions.json");
  const absenceRows = asArray(histDoc, "injuries", "data", "records");
  const prem = asArray(loadJSON("premier-injuries.json"), "injuries");
  const tm = asArray(loadJSON("transfermarkt-injuries.json"), "injuries");
  const injuredRows = [...prem, ...tm];

  console.log(`Inputs: ${statsRows.length} stat rows, ${absenceRows.length} absence rows, ${injuredRows.length} current injury rows`);

  const index = buildPlayerIndex(statsRows, absenceRows);

  // Score everyone we might persist: current injury rows + every player with
  // stats or history presence (the table is a general importance store).
  const persistRows = [...injuredRows];
  const seen = new Set();
  const keyOf = (r) =>
    `${(r.team_name || "").toLowerCase().trim()}|${(r.player_name || "").toLowerCase().trim()}`;
  for (const r of persistRows) seen.add(keyOf(r));
  for (const s of statsRows) {
    if (s.player_name && s.team_name && !seen.has(keyOf(s))) {
      persistRows.push(s);
      seen.add(keyOf(s));
    }
  }
  // History players: reconstruct (team, name) pairs — one per unique key.
  const histPairs = new Map();
  for (const h of absenceRows) {
    if (!h.player_name || !h.team_name) continue;
    const k = keyOf(h);
    if (!seen.has(k) && !histPairs.has(k)) histPairs.set(k, h);
  }
  for (const h of histPairs.values()) persistRows.push(h);

  // ── coverage report for the CURRENT injured set ──
  const confCounts = { stats: 0, history: 0, neutral: 0 };
  const injuredResults = [];
  for (const r of injuredRows) {
    const res = computeImportance(r.team_name, r.player_name, index);
    injuredResults.push({ row: r, res });
    confCounts[res.confidence] = (confCounts[res.confidence] || 0) + 1;
  }

  console.log("\n=== Coverage: current injured players ===");
  console.log(`  stats-tier : ${confCounts.stats}`);
  console.log(`  history-tier: ${confCounts.history}`);
  console.log(`  neutral    : ${confCounts.neutral}  (score 0.5 — no fabrication)`);
  console.log(`\nTop / bottom scored injured players:`);
  const sorted = [...injuredResults].sort((a, b) => b.res.score01 - a.res.score01);
  for (const { row, res } of sorted.slice(0, 10)) {
    console.log(`  ${(res.score10).toFixed(1).padStart(4)}  ${res.confidence.padEnd(7)} ${row.player_name} @ ${row.team_name}  (${res.method})`);
  }
  console.log("  ...");
  for (const { row, res } of sorted.slice(-5)) {
    console.log(`  ${(res.score10).toFixed(1).padStart(4)}  ${res.confidence.padEnd(7)} ${row.player_name} @ ${row.team_name}  (${res.method})`);
  }

  // ── persist ──
  if (DRY_RUN) {
    console.log("\n[DRY RUN] no writes. Re-run without --dry-run to persist.");
    return;
  }

  const client = new Client({
    host: process.env.SUPABASE_POOLER_HOST || "aws-0-eu-west-1.pooler.supabase.com",
    port: 5432,
    user: `postgres.${process.env.SUPABASE_PROJECT_REF || "xruhvekcowdwocydqnmp"}`,
    password: process.env.SUPABASE_DB_PASSWORD,
    database: "postgres",
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  // Ensure table exists.
  const { rows: tbl } = await client.query(
    "select 1 from information_schema.tables where table_schema='public' and table_name='player_importance'"
  );
  if (tbl.length === 0) {
    if (!APPLY_MIGRATION) {
      console.log("\nplayer_importance table missing. Re-run with --apply-migration.");
      await client.end();
      return;
    }
    await client.query(fs.readFileSync(MIGRATION, "utf8"));
    console.log("  ✅ applied player_importance migration");
  }

  // Upsert player_importance rows. Dedupe on raw (team,player) — the same
  // person can appear under name variants; first occurrence wins, matching
  // computeImportanceBatch semantics closely enough for persistence.
  let upserted = 0;
  const BATCH = 200;
  const finalRows = [];
  const seenFinal = new Set();
  for (const r of persistRows) {
    // Dedupe on the exact (team_name, player_name) unique key — required so a
    // multi-row INSERT ... ON CONFLICT never touches the same row twice.
    const dk = `${r.team_name || ""}|${r.player_name || ""}`;
    if (seenFinal.has(dk)) continue;
    seenFinal.add(dk);
    const res = computeImportance(r.team_name, r.player_name, index);
    finalRows.push({ row: r, res });
  }

  for (let i = 0; i < finalRows.length; i += BATCH) {
    const batch = finalRows.slice(i, i + BATCH);
    const params = [];
    const tuples = batch.map(({ row, res }, j) => {
      const b = j * 10;
      params.push(
        row.team_name || "",
        row.player_name || "",
        res.signals.playerId ?? null,
        row.team_id_api ?? null,
        row.league || null,
        res.score01,
        res.score10,
        res.confidence,
        res.method,
        JSON.stringify(res.signals)
      );
      return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9},$${b + 10}::jsonb, now(), now())`;
    });
    await client.query(
      `insert into player_importance
         (team_name, player_name, player_id, team_id_api, league,
          score_0_1, score_1_10, confidence, method, signals, computed_at, updated_at)
       values ${tuples.join(",")}
       on conflict (team_name, player_name) do update set
         player_id = excluded.player_id,
         team_id_api = excluded.team_id_api,
         league = excluded.league,
         score_0_1 = excluded.score_0_1,
         score_1_10 = excluded.score_1_10,
         confidence = excluded.confidence,
         method = excluded.method,
         signals = excluded.signals,
         computed_at = excluded.computed_at,
         updated_at = now()`,
      params
    );
    upserted += batch.length;
  }
  console.log(`  ✅ upserted ${upserted} rows into player_importance`);

  // Backfill player_injury_data.player_importance (1-10 scale).
  let injUpdated = 0;
  const injMap = new Map();
  for (const { row, res } of injuredResults) {
    injMap.set(
      `${(row.team_name || "").toLowerCase()}|${(row.player_name || "").toLowerCase()}`,
      res.score10
    );
  }
  const { rows: cur } = await client.query(
    "select id, team_name, player_name, player_importance from player_injury_data"
  );
  for (const r of cur) {
    const k = `${(r.team_name || "").toLowerCase()}|${(r.player_name || "").toLowerCase()}`;
    const v = injMap.get(k);
    if (v != null && Number(r.player_importance) !== v) {
      await client.query("update player_injury_data set player_importance=$1 where id=$2", [v, r.id]);
      injUpdated++;
    }
  }
  console.log(`  ✅ updated ${injUpdated}/${cur.length} player_injury_data.player_importance values`);

  // Refresh is_key_player on player_availability from computed scores.
  const { rows: pa } = await client.query(
    "select id, team_name, player_name from player_availability"
  );
  let paUpdated = 0;
  for (const r of pa) {
    const k = `${(r.team_name || "").toLowerCase()}|${(r.player_name || "").toLowerCase()}`;
    const v = injMap.get(k);
    if (v == null) continue;
    const isKey = v >= 7;
    await client.query("update player_availability set is_key_player=$1, updated_at=now() where id=$2", [isKey, r.id]);
    paUpdated++;
  }
  console.log(`  ✅ refreshed is_key_player on ${paUpdated} player_availability rows`);

  await client.end();
  console.log("\nDone.");
})().catch((e) => {
  console.error("ERR:", e.message);
  process.exit(1);
});
