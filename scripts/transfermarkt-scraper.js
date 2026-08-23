#!/usr/bin/env node

/**
 * ODDLY Transfermarkt Injury Scraper
 * 
 * Scrapes real injury and suspension data from Transfermarkt for:
 * - Premier League
 * - La Liga
 * - Bundesliga
 * - Serie A
 * - Ligue 1
 * 
 * Uses web scraping (not API) since Transfermarkt has no public API.
 * Respects rate limits (1 request per 2 seconds).
 * 
 * Usage: node scripts/transfermarkt-scraper.js [--dry-run]
 */

const { createClient } = require("@supabase/supabase-js");
const https = require("https");
const http = require("http");
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
const DRY_RUN = process.argv.includes("--dry-run");

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function fetchPage(url) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith("https") ? https : http;
    const req = proto.get(url, {
      headers: { "User-Agent": USER_AGENT, "Accept": "text/html,application/xhtml+xml" },
      timeout: 15000,
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const loc = res.headers.location.startsWith("http") ? res.headers.location : `https://www.transfermarkt.com${res.headers.location}`;
        return fetchPage(loc).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}`)); return; }
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => resolve(data));
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("Timeout")); });
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── HTML Parser (simple, no dependencies) ──────────────────────────────

function extractBetween(html, startTag, endTag, startFrom = 0) {
  const start = html.indexOf(startTag, startFrom);
  if (start === -1) return null;
  const end = html.indexOf(endTag, start + startTag.length);
  if (end === -1) return null;
  return html.slice(start + startTag.length, end);
}

function extractAll(html, startTag, endTag) {
  const results = [];
  let pos = 0;
  while (true) {
    const start = html.indexOf(startTag, pos);
    if (start === -1) break;
    const end = html.indexOf(endTag, start + startTag.length);
    if (end === -1) break;
    results.push(html.slice(start + startTag.length, end));
    pos = end + endTag.length;
  }
  return results;
}

function stripTags(html) {
  return html.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#\d+;/g, "").trim();
}

// ─── Transfermarkt League Pages ────────────────────────────────────────

const LEAGUES = [
  { name: "Premier League", slug: "premier-league", id: "GB1", tmId: "1" },
  { name: "La Liga", slug: "laliga", id: "ES1", tmId: "13" },
  { name: "Bundesliga", slug: "bundesliga", id: "L1", tmId: "1" },
  { name: "Serie A", slug: "serie-a", id: "IT1", tmId: "1" },
  { name: "Ligue 1", slug: "ligue-1", id: "FR1", tmId: "1" },
];

// ─── Parse Injury Table ────────────────────────────────────────────────

function parseInjuryPage(html) {
  const injuries = [];

  // Find all player names, teams, and injury types in the HTML stream
  const nameRegex = /<a[^>]*title="([^"]+)"[^>]*href="\/[^/]+\/profil\/spieler\/\d+"/g;
  const teamRegex = /<a[^>]*title="([^"]+)"[^>]*href="\/[^/]+\/startseite\/verein\/\d+"/g;
  const injuryRegex = /<td[^>]*class="links"[^>]*>([^<]+)<\/td>/gi;
  const returnRegex = /(\d{1,2}\.\d{1,2}\.\d{4})/g;

  const names = [], teams = [], injuries_raw = [], returns = [];
  let m;
  while ((m = nameRegex.exec(html)) !== null) names.push({ pos: m.index, name: m[1].trim() });
  while ((m = teamRegex.exec(html)) !== null) teams.push({ pos: m.index, team: m[1].trim() });
  while ((m = injuryRegex.exec(html)) !== null) injuries_raw.push({ pos: m.index, type: m[1].trim() });
  while ((m = returnRegex.exec(html)) !== null) returns.push({ pos: m.index, date: m[1] });

  // Match each player to the nearest team and injury type after their position
  for (const player of names) {
    const team = teams.find(t => t.pos > player.pos && t.pos < player.pos + 500);
    const inj = injuries_raw.find(i => i.pos > player.pos && i.pos < player.pos + 500);
    const ret = returns.find(r => r.pos > player.pos && r.pos < player.pos + 1000);

    const injuryType = inj ? inj.type.trim() : "Unknown";
    injuries.push({
      playerName: player.name,
      team: team ? team.team : null,
      injuryType,
      expectedReturn: ret ? ret.date : null,
      status: injuryType.toLowerCase().includes("suspension") ? "suspended" : "injured",
    });
  }

  return injuries;
}

// ─── Main ────────────────────────────────────────────────────────────────

async function main() {
  console.log("🏥 ODDLY Transfermarkt Injury Scraper");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("   Leagues: Premier League, La Liga, Bundesliga, Serie A, Ligue 1");
  if (DRY_RUN) console.log("   ⚠️  DRY RUN MODE");
  console.log("");

  // Check if player_availability table exists
  let dbAvailable = true;
  const { error: tblErr } = await supabase.from("player_availability").select("id").limit(1);
  if (tblErr) {
    console.log("⚠️  player_availability table not found — storing locally.");
    console.log("   Run supabase/create-player-availability.sql to enable DB storage.");
    dbAvailable = false;
  }

  let totalInjuries = 0;
  let totalInserted = 0;
  const localInjuries = [];

  for (const league of LEAGUES) {
    await sleep(2500); // Rate limit: 1 request per 2.5 seconds

    console.log(`\n⚽ ${league.name}...`);

    try {
      // Transfermarkt injuries page for this league
      const url = `https://www.transfermarkt.com/${league.slug}/verletztespieler/wettbewerb/${league.id}`;
      console.log(`   Fetching: ${url}`);

      const html = await fetchPage(url);

      // Check if we got a valid page
      if (html.length < 1000) {
        console.log(`   ⚠️  Page too short (${html.length} bytes) — likely blocked or redirected`);
        continue;
      }

      const injuries = parseInjuryPage(html);
      totalInjuries += injuries.length;

      console.log(`   📋 Found ${injuries.length} injuries/suspensions`);

      if (injuries.length === 0) {
        // Try alternate URL format
        const altUrl = `https://www.transfermarkt.com/${league.slug}/verletztespieler/wettbewerb/${league.id}/plus/1`;
        await sleep(2500);
        try {
          const altHtml = await fetchPage(altUrl);
          const altInjuries = parseInjuryPage(altHtml);
          if (altInjuries.length > 0) {
            console.log(`   📋 Alt page: Found ${altInjuries.length} injuries`);
            injuries.push(...altInjuries);
          }
        } catch { /* ignore */ }
      }

      // Store in database
      for (const inj of injuries) {
        if (DRY_RUN) {
          console.log(`   [DRY] ${inj.playerName} (${inj.team || "?"}) — ${inj.injuryType} — ${inj.status}`);
          totalInserted++;
          continue;
        }

        // Find matching team
        let teamId = null;
        if (inj.team) {
          const { data: dbTeam } = await supabase
            .from("teams")
            .select("id")
            .ilike("canonical_name", `%${inj.team}%`)
            .limit(1);
          teamId = dbTeam?.[0]?.id || null;
        }

        if (dbAvailable) {
          const { error } = await supabase.from("player_availability").upsert({
            player_name: inj.playerName,
            team_id: teamId,
            team_name: inj.team,
            status: inj.status,
            injury_type: inj.injuryType,
            expected_return: inj.expectedReturn,
            source: "transfermarkt",
            updated_at: new Date().toISOString(),
          }, { onConflict: "player_name,team_name" });
          if (!error) totalInserted++;
        } else {
          // Store locally
          localInjuries.push({
            player_name: inj.playerName,
            team_name: inj.team,
            status: inj.status,
            injury_type: inj.injuryType,
            expected_return: inj.expectedReturn,
            source: "transfermarkt",
            fetched_at: new Date().toISOString(),
          });
          totalInserted++;
        }
      }

      // Show first few
      for (const inj of injuries.slice(0, 5)) {
        console.log(`   🏥 ${inj.playerName} (${inj.team || "?"}) — ${inj.injuryType}`);
      }
      if (injuries.length > 5) {
        console.log(`   ... and ${injuries.length - 5} more`);
      }

    } catch (err) {
      console.log(`   ❌ Error: ${err.message}`);
    }
  }

  // Summary
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("📊 Summary");
  console.log(`   Total found:    ${totalInjuries}`);
  console.log(`   Inserted:       ${totalInserted}`);

  if (dbAvailable) {
    const { count } = await supabase
      .from("player_availability")
      .select("*", { count: "exact", head: true })
      .in("status", ["injured", "suspended"]);
    console.log(`   Active in DB:   ${count}`);
  } else if (localInjuries.length > 0) {
    // Save locally
    const outPath = path.join(__dirname, "..", "data", "transfermarkt-injuries.json");
    const existing = fs.existsSync(outPath) ? JSON.parse(fs.readFileSync(outPath, "utf8")) : [];
    const merged = [...existing, ...localInjuries];
    fs.writeFileSync(outPath, JSON.stringify(merged, null, 2));
    console.log(`   Saved locally:  ${localInjuries.length} injuries to data/transfermarkt-injuries.json`);
    console.log(`   Total in file:  ${merged.length}`);
  }
  console.log(`${"━".repeat(60)}`);
}

main().catch(e => { console.error("❌", e.message); process.exit(1); });
