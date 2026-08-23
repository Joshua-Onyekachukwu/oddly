#!/usr/bin/env node

/**
 * Enhanced Odds Fetcher v2 — pulls multiple market types from The Odds API
 * 
 * Markets fetched:
 * - h2h (1X2 / Match Result)
 * - totals (Over/Under 2.5 Goals)
 * - btts (Both Teams To Score)
 * - draw_no_bet (Draw No Bet)
 * - double_chance (Double Chance)
 * 
 * Usage: node scripts/fetch-odds-v2.js
 */

const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");
const path = require("path");

function loadEnv() {
  const env = {};
  const envPath = path.join(__dirname, "..", ".env.local");
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
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const ODDS_API_KEY = env.THE_ODDS_API_KEY;

// The Odds API region and markets
const REGIONS = "eu,uk";
const MARKETS = "h2h,totals,btts,draw_no_bet,double_chance";
const BOOKMAKERS = "bet365,williamhill,skybet,betfair,paddy_power,unibet";

// Map Odds API market names to our internal naming
const MARKET_MAP = {
  // h2h → 1X2
  "h2h_1": { market: "1X2", selection: "Home" },
  "h2h_2": { market: "1X2", selection: "Away" },
  "h2h_X": { market: "1X2", selection: "Draw" },
  // totals → Over/Under 2.5
  "totals_over": { market: "Over/Under 2.5", selection: "Over" },
  "totals_under": { market: "Over/Under 2.5", selection: "Under" },
  // btts
  "btts_yes": { market: "BTTS", selection: "Yes" },
  "btts_no": { market: "BTTS", selection: "No" },
  // draw_no_bet
  "draw_no_bet_1": { market: "DNB", selection: "Home" },
  "draw_no_bet_2": { market: "DNB", selection: "Away" },
  // double_chance
  "double_chance_1": { market: "DC", selection: "1X" },
  "double_chance_2": { market: "DC", selection: "X2" },
  "double_chance_X": { market: "DC", selection: "12" },
};

async function fetchOddsForSport(sportKey, region = REGIONS, markets = MARKETS) {
  const url = `https://api.the-odds-api.com/v4/sports/${sportKey}/odds/?apiKey=${ODDS_API_KEY}&regions=${region}&markets=${markets}&bookmakers=${BOOKMAKERS}&dateFormat=iso`;
  
  try {
    const res = await fetch(url);
    if (res.status === 429) {
      console.log(`  ⚠️ Rate limited on ${sportKey}`);
      return null;
    }
    if (!res.ok) {
      console.log(`  ❌ ${sportKey}: HTTP ${res.status}`);
      return null;
    }
    
    // Log remaining quota
    const remaining = res.headers.get("x-requests-remaining");
    const used = res.headers.get("x-requests-used");
    if (remaining) console.log(`  📊 Quota: ${used} used, ${remaining} remaining`);
    
    return await res.json();
  } catch (err) {
    console.log(`  ❌ ${sportKey}: ${err.message}`);
    return null;
  }
}

async function main() {
  console.log("📊 Enhanced Odds Fetcher v2");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  
  if (!ODDS_API_KEY) {
    console.error("❌ THE_ODDS_API_KEY not found in .env.local");
    process.exit(1);
  }
  
  // Get available sports
  const sportsUrl = `https://api.the-odds-api.com/v4/sports/?apiKey=${ODDS_API_KEY}`;
  const sportsRes = await fetch(sportsUrl);
  if (!sportsRes.ok) {
    console.error(`❌ Failed to fetch sports: HTTP ${sportsRes.status}`);
    process.exit(1);
  }
  const sports = await sportsRes.json();
  
  // Football/soccer sports we care about
  const footballSports = sports.filter(s => 
    s.active && (
      s.key.startsWith("soccer_") && !s.key.includes("epl") && !s.key.includes("premier_league")
    )
  );
  
  console.log(`\n📋 Found ${footballSports.length} active football markets`);
  
  let totalOdds = 0;
  let totalFixtures = 0;
  let quotaUsed = 0;
  
  // Fetch odds for each sport
  for (const sport of footballSports) {
    const oddsData = await fetchOddsForSport(sport.key);
    if (!oddsData || oddsData.length === 0) continue;
    
    console.log(`\n  📌 ${sport.title}: ${oddsData.length} fixtures`);
    totalFixtures += oddsData.length;
    
    for (const fixture of oddsData) {
      const homeTeam = fixture.home_team;
      const awayTeam = fixture.away_team;
      const kickoff = fixture.commence_time;
      
      // Find matching fixture in our database
      const { data: ourFixtures } = await sb
        .from("fixtures")
        .select("id")
        .eq("kickoff_time", kickoff)
        .limit(5);
      
      // Try to match by team names
      let matchedFix = null;
      for (const fix of ourFixtures || []) {
        const { data: home } = await sb.from("teams").select("canonical_name").eq("id", fix.id).single();
        const { data: away } = await sb.from("teams").select("canonical_name").eq("id", fix.id).single();
        // Simple string matching
        if (home && away) {
          if (homeTeam.toLowerCase().includes(home.canonical_name.toLowerCase().slice(0, 5)) ||
              home.canonical_name.toLowerCase().includes(homeTeam.toLowerCase().slice(0, 5))) {
            matchedFix = fix;
            break;
          }
        }
      }
      
      if (!matchedFix) continue;
      
      // Process each bookmaker's odds
      for (const bookmaker of fixture.bookmakers || []) {
        for (const market of bookmaker.markets || []) {
          for (const outcome of market.outcomes || []) {
            const oddsKey = `${market.key}_${outcome.name === homeTeam ? "1" : outcome.name === awayTeam ? "2" : "X"}`;
            const mapped = MARKET_MAP[oddsKey] || MARKET_MAP[`${market.key}_${outcome.name.toLowerCase()}`];
            
            if (!mapped) continue;
            
            // Upsert odds
            const { error } = await sb.from("odds_snapshots").upsert({
              fixture_id: matchedFix.id,
              bookmaker: bookmaker.key,
              market: mapped.market,
              selection: mapped.selection,
              odds: outcome.price,
              snapshot_time: new Date().toISOString(),
            }, { onConflict: "fixture_id,bookmaker,market,selection" });
            
            if (!error) totalOdds++;
          }
        }
      }
    }
  }
  
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`✅ Complete!`);
  console.log(`   Fixtures with odds: ${totalFixtures}`);
  console.log(`   Odds snapshots stored: ${totalOdds}`);
}

main().catch(console.error);
