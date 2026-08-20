/**
 * Standalone script to fetch and display live odds from The Odds API.
 * Run: node scripts/fetch-live-odds.js
 * 
 * No Supabase needed — just displays what the sync would pull.
 */

const ODDS_API_KEY = "23a0595792c559e4306c7aed4334210a";

const LEAGUES = [
  { key: "soccer_epl", name: "Premier League" },
  { key: "soccer_spain_la_liga", name: "La Liga" },
  { key: "soccer_germany_bundesliga", name: "Bundesliga" },
  { key: "soccer_italy_serie_a", name: "Serie A" },
  { key: "soccer_france_ligue_one", name: "Ligue 1" },
  { key: "soccer_netherlands_eredivisie", name: "Eredivisie" },
  { key: "soccer_portugal_primeira_liga", name: "Primeira Liga" },
  { key: "soccer_uefa_champs_league", name: "Champions League" },
  { key: "soccer_uefa_europa_league", name: "Europa League" },
  { key: "soccer_brazil_campeonato", name: "Brasileirão" },
];

async function fetchOdds(sportKey) {
  const url = `https://api.the-odds-api.com/v4/sports/${sportKey}/odds/?apiKey=${ODDS_API_KEY}&regions=uk,eu&markets=h2h,totals&bookmakers=bet365,pinnacle,betway,1xbet`;
  const res = await fetch(url);
  
  const used = parseInt(res.headers.get("x-requests-used") || "0");
  const remaining = parseInt(res.headers.get("x-requests-remaining") || "0");
  
  if (!res.ok) {
    return { fixtures: [], used, remaining, error: `HTTP ${res.status}` };
  }
  
  const fixtures = await res.json();
  return { fixtures, used, remaining, error: null };
}

async function main() {
  console.log("=".repeat(70));
  console.log("  ODDLY Live Odds Sync — The Odds API");
  console.log("=".repeat(70));
  console.log();
  
  let totalFixtures = 0;
  let totalOdds = 0;
  let totalBookmakers = 0;
  let apiUsed = 0;
  let apiRemaining = 0;
  
  for (const league of LEAGUES) {
    try {
      const { fixtures, used, remaining, error } = await fetchOdds(league.key);
      apiUsed = used;
      apiRemaining = remaining;
      
      if (error) {
        console.log(`  ❌ ${league.name}: ${error}`);
        continue;
      }
      
      if (fixtures.length === 0) {
        console.log(`  ⚪ ${league.name}: No upcoming fixtures`);
        continue;
      }
      
      console.log(`  ✅ ${league.name}: ${fixtures.length} fixtures`);
      totalFixtures += fixtures.length;
      
      for (const f of fixtures) {
        const kickoff = new Date(f.commence_time).toLocaleString();
        const bookmakers = f.bookmakers.length;
        totalBookmakers += bookmakers;
        
        // Get best h2h odds
        let bestHome = 0, bestDraw = 0, bestAway = 0;
        let bestHomeBm = "", bestDrawBm = "", bestAwayBm = "";
        
        for (const bm of f.bookmakers) {
          const h2h = bm.markets.find(m => m.key === "h2h");
          if (!h2h) continue;
          
          for (const o of h2h.outcomes) {
            if (o.name === f.home_team && o.price > bestHome) {
              bestHome = o.price;
              bestHomeBm = bm.title;
            }
            if (o.name === "Draw" && o.price > bestDraw) {
              bestDraw = o.price;
              bestDrawBm = bm.title;
            }
            if (o.name === f.away_team && o.price > bestAway) {
              bestAway = o.price;
              bestAwayBm = bm.title;
            }
          }
        }
        
        // Get over/under 2.5
        let over25 = 0, under25 = 0;
        for (const bm of f.bookmakers) {
          const totals = bm.markets.find(m => m.key === "totals");
          if (!totals) continue;
          for (const o of totals.outcomes) {
            if (o.name === "Over" && o.point === 2.5 && o.price > over25) over25 = o.price;
            if (o.name === "Under" && o.point === 2.5 && o.price > under25) under25 = o.price;
          }
        }
        
        const oddsCount = (bestHome ? 1 : 0) + (bestDraw ? 1 : 0) + (bestAway ? 1 : 0) + (over25 ? 1 : 0) + (under25 ? 1 : 0);
        totalOdds += oddsCount;
        
        console.log(`    ${f.home_team} vs ${f.away_team}`);
        console.log(`      Kickoff: ${kickoff} | Bookmakers: ${bookmakers}`);
        if (bestHome) console.log(`      Home: ${bestHome.toFixed(2)} (${bestHomeBm}) | Draw: ${bestDraw.toFixed(2)} (${bestDrawBm}) | Away: ${bestAway.toFixed(2)} (${bestAwayBm})`);
        if (over25) console.log(`      Over 2.5: ${over25.toFixed(2)} | Under 2.5: ${under25.toFixed(2)}`);
        console.log();
      }
      
      // Rate limit between leagues
      await new Promise(r => setTimeout(r, 500));
    } catch (err) {
      console.log(`  ❌ ${league.name}: ${err.message}`);
    }
  }
  
  console.log("=".repeat(70));
  console.log(`  SUMMARY`);
  console.log(`  Fixtures found: ${totalFixtures}`);
  console.log(`  Odds snapshots: ${totalOdds}`);
  console.log(`  Bookmaker refs: ${totalBookmakers}`);
  console.log(`  API requests used: ${apiUsed}`);
  console.log(`  API requests remaining: ${apiRemaining}`);
  console.log("=".repeat(70));
}

main().catch(console.error);
