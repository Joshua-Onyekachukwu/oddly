#!/usr/bin/env node

/**
 * Fast Historical Fetch — All leagues, progress-tracked
 * Uses football-data.org free tier (10 req/min)
 * Saves progress so it can resume if interrupted.
 */

const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");
const path = require("path");

function loadEnv() {
  const envPath = path.join(__dirname, "..", ".env.local");
  const env = {};
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    let val = t.slice(i + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
      val = val.slice(1, -1);
    env[t.slice(0, i).trim()] = val;
  }
  return env;
}

const env = loadEnv();
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const API_KEY = env.FOOTBALL_DATA_ORG_KEY || "395f3e8cbe6b4a149f3d854fcdac7ad9";

const LEAGUES = [
  { code: "ELC", name: "Championship", country: "England" },
  { code: "DED", name: "Eredivisie", country: "Netherlands" },
  { code: "PPL", name: "Primeira Liga", country: "Portugal" },
  { code: "CL", name: "Champions League", country: "Europe" },
  { code: "PL", name: "Premier League", country: "England" },
  { code: "PD", name: "La Liga", country: "Spain" },
  { code: "SA", name: "Serie A", country: "Italy" },
  { code: "FL1", name: "Ligue 1", country: "France" },
];

const SEASONS = [2023, 2024, 2025]; // Free tier restricts pre-2023
const PROGRESS_FILE = path.join(__dirname, "..", "data", "fetch-progress.json");

function loadProgress() {
  try { return JSON.parse(fs.readFileSync(PROGRESS_FILE, "utf8")); } catch { return {}; }
}
function saveProgress(p) {
  if (!fs.existsSync(path.dirname(PROGRESS_FILE))) fs.mkdirSync(path.dirname(PROGRESS_FILE), { recursive: true });
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(p, null, 2));
}

const lcache = {};
const tcache = {};

async function getLid(name, country) {
  if (lcache[name]) return lcache[name];
  const { data } = await supabase.from("leagues").select("id").eq("name", name).limit(1).single();
  if (data) { lcache[name] = data.id; return data.id; }
  const { data: created } = await supabase.from("leagues").insert({ name, country, sport: "football", is_active: true, priority: 5 }).select("id").single();
  lcache[name] = created?.id;
  return created?.id;
}

async function getTid(name, lid) {
  const norm = name.replace(/\s+FC$/i, "").replace(/\s+AFC$/i, "").toLowerCase().trim();
  if (tcache[norm]) return tcache[norm];
  const { data } = await supabase.from("teams").select("id").eq("canonical_name", norm).limit(1).single();
  if (data) { tcache[norm] = data.id; return data.id; }
  const { data: created } = await supabase.from("teams").insert({ canonical_name: norm, league_id: lid }).select("id").single();
  tcache[norm] = created?.id;
  return created?.id;
}

async function fetchWithRetry(url, maxRetries = 3) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const res = await fetch(url, { headers: { "X-Auth-Token": API_KEY } });
      if (res.status === 429) {
        console.log(`   ⏳ Rate limited, waiting 65s...`);
        await new Promise(r => setTimeout(r, 65000));
        continue;
      }
      if (res.status === 403) return { error: "restricted" };
      if (!res.ok) return { error: `HTTP ${res.status}` };
      return { data: await res.json() };
    } catch (e) {
      if (attempt < maxRetries - 1) await new Promise(r => setTimeout(r, 3000));
      else return { error: e.message };
    }
  }
  return { error: "max retries" };
}

async function main() {
  const progress = loadProgress();
  console.log("🔄 Fast Historical Data Fetch");
  console.log("━".repeat(50));

  let totalNew = 0;

  for (const league of LEAGUES) {
    const lid = await getLid(league.name, league.country);
    if (!lid) { console.log(`❌ No league: ${league.name}`); continue; }

    console.log(`\n⚽ ${league.name} (${league.code})`);

    for (const season of SEASONS) {
      const key = `${league.code}-${season}`;
      if (progress[key]?.done) {
        console.log(`   ${season}/${season + 1}: ✅ done (${progress[key].stored} stored)`);
        continue;
      }

      process.stdout.write(`   ${season}/${season + 1}... `);

      const result = await fetchWithRetry(
        `https://api.football-data.org/v4/competitions/${league.code}/matches?season=${season}`
      );

      if (result.error) {
        console.log(result.error);
        if (result.error === "restricted") break; // Skip remaining seasons for this league
        continue;
      }

      const matches = (result.data.matches || []).filter(m => m.status === "FINISHED");
      if (matches.length === 0) { console.log("empty"); continue; }

      let stored = 0, dupes = 0;
      for (const m of matches) {
        const hid = await getTid(m.homeTeam?.name || "Unknown", lid);
        const aid = await getTid(m.awayTeam?.name || "Unknown", lid);
        if (!hid || !aid) continue;

        const { error } = await supabase.from("fixtures").insert({
          external_id: String(m.id),
          home_team_id: hid,
          away_team_id: aid,
          league_id: lid,
          kickoff_time: m.utcDate,
          home_score: m.score?.fullTime?.home ?? null,
          away_score: m.score?.fullTime?.away ?? null,
          status: "finished",
        });

        if (error) {
          if (error.message.includes("duplicate") || error.message.includes("unique")) dupes++;
        } else {
          stored++;
        }
      }

      totalNew += stored;
      progress[key] = { done: true, stored, dupes, fetched: matches.length, ts: new Date().toISOString() };
      saveProgress(progress);

      console.log(`${matches.length} fetched → ${stored} new, ${dupes} dupes`);

      // Rate limit: ~7s between requests (safe for 10 req/min)
      await new Promise(r => setTimeout(r, 7000));
    }
  }

  // Summary
  const { count: total } = await supabase.from("fixtures").select("*", { count: "exact", head: true }).eq("status", "finished");
  console.log("\n" + "━".repeat(50));
  console.log(`📊 New stored this run: ${totalNew}`);
  console.log(`📊 Total finished matches: ${total}`);

  const { data: allFixtures } = await supabase.from("fixtures").select("league_id, leagues!inner(name)").eq("status", "finished");
  const counts = {};
  for (const f of allFixtures || []) {
    const n = f.leagues?.name || "?";
    counts[n] = (counts[n] || 0) + 1;
  }
  console.log("\nBy league:");
  for (const [n, c] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${n}: ${c}`);
  }
  console.log("━".repeat(50));
}

main().catch(e => { console.error("❌", e.message); process.exit(1); });
