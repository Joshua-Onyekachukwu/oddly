#!/usr/bin/env node

/**
 * Fetch REAL historical match data from football-data.org
 * Leagues: Premier League (2021), La Liga (2014), Bundesliga (2002), Serie A (2019), Ligue 1 (2015)
 * Seasons: 2022, 2023, 2024 (representing 2022/23, 2023/24, 2024/25)
 */

const fs = require("fs");
const path = require("path");

const API_KEY = "395f3e8cbe6b4a149f3d854fcdac7ad9";
const BASE_URL = "https://api.football-data.org/v4";

const LEAGUES = [
  { id: 2021, name: "Premier League", code: "PL" },
  { id: 2014, name: "La Liga", code: "PD" },
  { id: 2002, name: "Bundesliga", code: "BL1" },
  { id: 2019, name: "Serie A", code: "SA" },
  { id: 2015, name: "Ligue 1", code: "FL1" },
];

const SEASONS = [2022, 2023, 2024];

async function fetchWithRetry(url, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, {
        headers: { "X-Auth-Token": API_KEY },
      });
      if (response.status === 429) {
        // Rate limited — wait 60 seconds
        console.log("   ⏳ Rate limited, waiting 60s...");
        await new Promise(r => setTimeout(r, 60000));
        continue;
      }
      if (!response.ok) {
        const text = await response.text();
        console.log(`   ⚠️ HTTP ${response.status}: ${text.substring(0, 100)}`);
        return null;
      }
      return await response.json();
    } catch (err) {
      console.log(`   ⚠️ Error: ${err.message}`);
      if (i < retries - 1) await new Promise(r => setTimeout(r, 5000));
    }
  }
  return null;
}

async function main() {
  console.log("🔄 Fetching REAL historical data from football-data.org");
  console.log("━".repeat(70));

  const allMatches = [];

  for (const league of LEAGUES) {
    for (const season of SEASONS) {
      console.log(`\n⚽ ${league.name} (${season}/${season + 1})...`);

      const url = `${BASE_URL}/competitions/${league.id}/matches?season=${season}&status=FINISHED`;
      const data = await fetchWithRetry(url);

      if (!data || !data.matches) {
        console.log(`   ❌ No data available`);
        continue;
      }

      const matches = data.matches.filter(m => m.status === "FINISHED" && m.score?.fullTime?.home !== null);

      console.log(`   ✅ ${matches.length} finished matches`);

      for (const m of matches) {
        allMatches.push({
          id: m.id,
          league: league.name,
          leagueCode: league.code,
          season,
          homeTeam: m.homeTeam?.name || "Unknown",
          awayTeam: m.awayTeam?.name || "Unknown",
          homeGoals: m.score.fullTime.home,
          awayGoals: m.score.fullTime.away,
          htHome: m.score.halfTime?.home,
          htAway: m.score.halfTime?.away,
          date: m.utcDate,
          matchday: m.matchday,
          referee: m.referees?.[0]?.name || null,
        });
      }

      // Rate limit: 10 requests/minute for free tier
      await new Promise(r => setTimeout(r, 12000));
    }
  }

  console.log(`\n\n📊 Total matches fetched: ${allMatches.length}`);

  // Save to file
  const outputPath = path.join(__dirname, "..", "docs", "real-match-data.json");
  fs.writeFileSync(outputPath, JSON.stringify(allMatches, null, 2));
  console.log(`📄 Saved to ${outputPath}`);

  // Summary
  console.log("\n┌──────────────────────────────────────────────────────────┐");
  console.log("│                    DATA SUMMARY                          │");
  console.log("├──────────────────────┬──────────┬────────────────────────┤");
  console.log("│ League               │ Matches  │ Seasons                │");
  console.log("├──────────────────────┼──────────┼────────────────────────┤");

  for (const league of LEAGUES) {
    const leagueMatches = allMatches.filter(m => m.league === league.name);
    const seasons = [...new Set(leagueMatches.map(m => m.season))].sort();
    console.log(`│ ${league.name.padEnd(20)} │ ${String(leagueMatches.length).padStart(8)} │ ${seasons.join(", ").padEnd(22)} │`);
  }

  console.log("├──────────────────────┼──────────┼────────────────────────┤");
  console.log(`│ TOTAL                │ ${String(allMatches.length).padStart(8)} │                        │`);
  console.log("└──────────────────────┴──────────┴────────────────────────┘");
}

main().catch(e => { console.error("❌", e.message); process.exit(1); });
