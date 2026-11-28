/** One-off coverage report: which of our teams have StatsBomb appearances? */
import * as fs from "fs";
import * as path from "path";
import { createClient } from "@supabase/supabase-js";
import { normalizeTeamName } from "../src/lib/football/team-normalizer";

function loadEnv() {
  const env: Record<string, string> = {};
  for (const line of fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf8").split("\n")) {
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

  const { data: teamRows } = await supabase.from("teams").select("canonical_name").limit(1000);
  const ourKeys = new Map<string, string>();
  for (const t of teamRows || []) {
    const k = normalizeTeamName(t.canonical_name || "");
    if (k) ourKeys.set(k, t.canonical_name || "");
  }

  // all distinct appearance team keys (paginate)
  const appKeys = new Set<string>();
  const appNames = new Map<string, string>();
  for (let from = 0; ; from += 1000) {
    const { data } = await supabase
      .from("player_appearances")
      .select("team_name, team_name_normalized")
      .eq("source", "statsbomb-open-data")
      .range(from, from + 999);
    if (!data || data.length === 0) break;
    for (const r of data) {
      if (r.team_name_normalized) {
        appKeys.add(r.team_name_normalized);
        if (!appNames.has(r.team_name_normalized)) appNames.set(r.team_name_normalized, r.team_name || "");
      }
    }
    if (data.length < 1000) break;
  }

  const covered: string[] = [];
  const missing: string[] = [];
  for (const [k, name] of ourKeys) {
    (appKeys.has(k) ? covered : missing).push(name);
  }
  console.log(`Our teams: ${ourKeys.size}`);
  console.log(`With StatsBomb appearances: ${covered.length}`);
  console.log(`Missing: ${missing.length}`);
  console.log("\nCovered (sample):", covered.slice(0, 60).join(", "));
  console.log("\nMissing (sample):", missing.slice(0, 80).join(", "));

  // near-miss candidates: appearance keys that look similar to missing teams
  console.log("\nAppearance team keys not matching ours (first 80):");
  const extra = [...appKeys].filter((k) => !ourKeys.has(k));
  console.log(extra.slice(0, 80).map((k) => `${k} (${appNames.get(k)})`).join("\n"));
}
main().catch((e) => { console.error(e); process.exit(1); });
