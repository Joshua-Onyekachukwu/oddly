/**
 * Realign player_appearances.team_name_normalized with the CURRENT
 * normalizeTeamName() implementation.
 *
 * Rows ingested by scripts/ingest-lineups-statsbomb.ts store
 * normalizeTeamName(team_name) computed at ingest time. When the shared
 * alias table (src/lib/football/team-normalizer.ts) changes, stored keys can
 * drift from what read-side code computes. This script recomputes the key
 * from the raw team_name and updates rows whose stored key differs.
 *
 * Run:
 *   npx ts-node --transpile-only --compiler-options '{"module":"commonjs","moduleResolution":"node"}' scripts/realign-appearance-team-keys.ts
 */

import * as fs from "fs";
import * as path from "path";
import { createClient } from "@supabase/supabase-js";
import { normalizeTeamName } from "../src/lib/football/team-normalizer";

const SOURCE = "statsbomb-open-data";

function loadEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  const p = path.join(__dirname, "..", ".env.local");
  if (!fs.existsSync(p)) return env;
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    env[t.slice(0, i).trim()] = v;
  }
  return env;
}

async function main() {
  const env = loadEnv();
  const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

  // team_name -> set of stored normalized keys (should be exactly one)
  const storedByName = new Map<string, Set<string>>();
  let scanned = 0;
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("player_appearances")
      .select("team_name, team_name_normalized")
      .eq("source", SOURCE)
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    scanned += data.length;
    for (const r of data) {
      const name = r.team_name || "";
      const key = r.team_name_normalized || "";
      if (!storedByName.has(name)) storedByName.set(name, new Set());
      storedByName.get(name)!.add(key);
    }
    if (data.length < 1000) break;
  }
  console.log(`scanned ${scanned} rows, ${storedByName.size} distinct team names`);

  let updatedTeams = 0;
  let updatedRows = 0;
  let dupErrors = 0;
  const changes: string[] = [];

  for (const [name, storedKeys] of storedByName) {
    const newKey = normalizeTeamName(name);
    // If a team_name was stored under multiple keys (shouldn't happen),
    // realign all of them to the recomputed key.
    const needsUpdate = [...storedKeys].some((k) => k !== newKey);
    if (!needsUpdate) continue;

    const { data, error } = await supabase
      .from("player_appearances")
      .update({ team_name_normalized: newKey || null })
      .eq("source", SOURCE)
      .eq("team_name", name)
      .select("id");
    if (error) {
      if (error.code === "23505") {
        dupErrors += 1;
        console.log(`  dup-key conflict for '${name}' → '${newKey}' (skipped)`);
      } else {
        console.log(`  error updating '${name}': ${error.message}`);
      }
      continue;
    }
    updatedTeams += 1;
    updatedRows += (data || []).length;
    changes.push(`'${name}': [${[...storedKeys].join(", ")}] → '${newKey}'`);
  }

  console.log(`\nupdated ${updatedRows} rows across ${updatedTeams} team names (${dupErrors} dup conflicts)`);
  if (changes.length) {
    console.log("\nchanges:");
    for (const c of changes.slice(0, 100)) console.log("  " + c);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
