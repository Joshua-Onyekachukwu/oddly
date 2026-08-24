#!/usr/bin/env node

/**
 * ODDLY Odds Sync — New Leagues
 * 
 * Fetches odds from The Odds API for Liga MX, Saudi Pro League,
 * J League, K League, and other leagues not yet in our database.
 * 
 * The Odds API free tier: 500 requests/day, resets at midnight UTC.
 * Each request fetches one market (h2h, totals, btts) for one league.
 * 
 * Usage: node worker/sync-odds-new-leagues.js
 * 
 * Quota usage per league:
 *   - h2h (1X2): 1 request
 *   - totals (O/U): 1 request  
 *   - btts: 1 request
 *   = 3 requests per league
 * 
 * 10 new leagues = 30 requests (well within daily quota)
 */

const { createClient } = require("@supabase/supabase-js");
const https = require("https");
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
const ODDS_KEY = env.THE_ODDS_API_KEY;

// New leagues to sync (not yet in our database)
const NEW_LEAGUES = [
  { key: "soccer_mexico_ligamx", name: "Liga MX", country: "Mexico" },
  { key: "soccer_saudi_arabia_pro_league", name: "Saudi Pro League", country: "Saudi Arabia" },
  { key: "soccer_japan_j_league", name: "J League", country: "Japan" },
  { key: "soccer_korea_kleague1", name: "K League 1", country: "South Korea" },
  { key: "soccer_china_superleague", name: "Chinese Super League", country: "China" },
  { key: "soccer_turkey_super_league", name: "Turkey Super League", country: "Turkey" },
  { key: "soccer_greece_super_league", name: "Greece Super League", country: "Greece" },
  { key: "soccer_denmark_superliga", name: "Denmark Superliga", country: "Denmark" },
  { key: "soccer_norway_eliteserien", name: "Eliteserien", country: "Norway" },
  { key: "soccer_sweden_allsvenskan", name: "Allsvenskan", country: "Sweden" },
];

const MARKETS = ["h2h", "totals", "btts"];

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = "";
      res.on("data", (d) => (data += d));
      res.on("end", () => {
        const remaining = parseInt(res.headers["x-requests-remaining"] || "0");
        const used = parseInt(res.headers["x-requests-used"] || "0");
        try {
          resolve({ data: JSON.parse(data), remaining, used, status: res.statusCode });
        } catch (e) {
          reject(new Error(`Parse error: ${data.substring(0, 200)}`));
        }
      });
      res.on("error", reject);
    }).on("error", reject);
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  console.log("🔄 ODDLY Odds Sync — New Leagues");
  console.log("━".repeat(60));

  if (!ODDS_KEY) {
    console.log("❌ No THE_ODDS_API_KEY found in .env.local");
    process.exit(1);
  }

  // Check quota first
  const status = await fetchJSON(`https://api.the-odds-api.com/v4/sports/?apiKey=${ODDS_KEY}`);
  console.log(`   Quota: ${status.used} used, ${status.remaining} remaining`);

  if (status.remaining < 5) {
    console.log(`   ⚠️  Only ${status.remaining} requests remaining. Quota resets at midnight UTC.`);
    console.log(`   Run this script after quota resets.\n`);
    
    // Show when it resets
    const now = new Date();
    const midnight = new Date(now);
    midnight.setUTCHours(24, 0, 0, 0);
    const hoursUntilReset = Math.ceil((midnight - now) / (1000 * 60 * 60));
    console.log(`   Next reset in ~${hoursUntilReset} hours (${midnight.toISOString()})`);
    return;
  }

  // Load existing fixtures for matching
  const { data: existingFixtures } = await supabase
    .from("fixtures")
    .select("external_id, home:teams!fixtures_home_team_id_fkey(canonical_name), away:teams!fixtures_away_team_id_fkey(canonical_name)")
    .eq("status", "scheduled")
    .limit(5000);

  const fixtureMap = {};
  for (const f of existingFixtures || []) {
    const key = `${f.home?.canonical_name} vs ${f.away?.canonical_name}`.toLowerCase();
    fixtureMap[key] = f;
  }
  console.log(`   Loaded ${Object.keys(fixtureMap).length} upcoming fixtures for matching\n`);

  let totalSynced = 0;
  let totalOdds = 0;
  let requestsUsed = 0;

  for (const league of NEW_LEAGUES) {
    console.log(`\n   📋 ${league.name} (${league.key})`);

    for (const market of MARKETS) {
      if (status.remaining - requestsUsed < 2) {
        console.log(`   ⚠️  Quota nearly exhausted. Stopping.`);
        break;
      }

      const url = `https://api.the-odds-api.com/v4/sports/${league.key}/odds/?apiKey=${ODDS_KEY}&regions=eu&markets=${market}&oddsFormat=decimal`;
      
      try {
        const result = await fetchJSON(url);
        requestsUsed++;
        status.remaining = result.remaining;

        if (result.status === 403) {
          console.log(`   ❌ Access denied — league may require paid plan`);
          break;
        }

        if (result.status === 429) {
          console.log(`   ⚠️  Rate limited. Waiting 2 seconds...`);
          await sleep(2000);
          continue;
        }

        const odds = result.data;
        if (!Array.isArray(odds) || odds.length === 0) {
          console.log(`   No upcoming ${market} odds`);
          continue;
        }

        console.log(`   ${market}: ${odds.length} matches`);

        // Store odds for each match
        for (const match of odds) {
          const homeTeam = match.home_team;
          const awayTeam = match.away_team;
          const matchKey = `${homeTeam} vs ${awayTeam}`.toLowerCase();

          // Find matching fixture in our DB
          const fixture = fixtureMap[matchKey];
          if (!fixture) {
            // Try partial match
            let found = false;
            for (const [key, f] of Object.entries(fixtureMap)) {
              if (key.includes(homeTeam.toLowerCase()) || homeTeam.toLowerCase().includes(key.split(" vs ")[0])) {
                if (key.includes(awayTeam.toLowerCase()) || awayTeam.toLowerCase().includes(key.split(" vs ")[1])) {
                  // Store odds for this fixture
                  for (const bookmaker of match.bookmakers || []) {
                    const marketData = bookmaker.markets?.find(m => m.key === market);
                    if (marketData) {
                      for (const outcome of marketData.outcomes || []) {
                        await supabase.from("odds_snapshots").insert({
                          fixture_id: f.external_id || f.id,
                          selection: outcome.name,
                          odds: outcome.price,
                          bookmaker: bookmaker.key,
                          market: market,
                        });
                        totalOdds++;
                      }
                    }
                  }
                  found = true;
                  totalSynced++;
                  break;
                }
              }
            }
            if (!found) {
              // Store with a synthetic fixture reference for future matching
              console.log(`     No match: ${homeTeam} vs ${awayTeam}`);
            }
          } else {
            // Store odds for matched fixture
            for (const bookmaker of match.bookmakers || []) {
              const marketData = bookmaker.markets?.find(m => m.key === market);
              if (marketData) {
                for (const outcome of marketData.outcomes || []) {
                  await supabase.from("odds_snapshots").insert({
                    fixture_id: fixture.external_id || fixture.id,
                    selection: outcome.name,
                    odds: outcome.price,
                    bookmaker: bookmaker.key,
                    market: market,
                  });
                  totalOdds++;
                }
              }
            }
            totalSynced++;
          }
        }

        // Be nice to the API
        await sleep(500);
      } catch (err) {
        console.log(`   ❌ Error: ${err.message}`);
      }
    }
  }

  console.log(`\n${"━".repeat(60)}`);
  console.log(`✅ Odds sync complete`);
  console.log(`   Matches synced: ${totalSynced}`);
  console.log(`   Odds stored: ${totalOdds}`);
  console.log(`   API requests used: ${requestsUsed}`);
  console.log(`   Remaining quota: ${status.remaining}`);
  console.log(`${"━".repeat(60)}`);
}

main().catch(e => { console.error("❌", e.message); process.exit(1); });
