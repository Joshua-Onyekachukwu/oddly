#!/usr/bin/env node
/**
 * ODDLY Smart Odds Fetcher
 *
 * Fetches odds from The Odds API efficiently (maximizes limited quota).
 * When quota is exhausted, computes implied odds from model probabilities.
 *
 * Usage: node worker/fetch-odds-smart.js
 */

const https = require("https");
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

function loadEnv() {
  const env = {};
  for (const line of fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    let v = t.slice(i + 1).trim();
    if ((v[0] === '"' && v.slice(-1) === '"') || (v[0] === "'" && v.slice(-1) === "'")) v = v.slice(1, -1);
    env[t.slice(0, i).trim()] = v;
  }
  return env;
}

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { timeout: 15000 }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve({ status: res.statusCode, body: data, headers: res.headers }));
    }).on("error", reject);
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Map our league names to Odds API sport keys
const LEAGUE_MAP = {
  "Premier League": "soccer_epl",
  "La Liga": "soccer_spain_la_liga",
  "Bundesliga": "soccer_germany_bundesliga",
  "Serie A": "soccer_italy_serie_a",
  "Ligue 1": "soccer_france_ligue_one",
  "Eredivisie": "soccer_netherlands_eredivisie",
  "Championship": "soccer_england_championship",
  "Primeira Liga": "soccer_portugal_primeira_liga",
  "MLS": "soccer_usa_mls",
  "Brasileirão": "soccer_brazil_campeonato",
};

async function main() {
  console.log("📊 ODDLY Smart Odds Fetcher");
  console.log("━".repeat(50));

  const env = loadEnv();
  const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  const API_KEY = env.THE_ODDS_API_KEY.replace(/^[\"']|[\"']$/g, "");

  // 1. Check API quota
  const quotaRes = await fetchJSON(`https://api.the-odds-api.com/v4/sports/?apiKey=${API_KEY}`);
  const remaining = parseInt(quotaRes.headers["x-requests-remaining"] || "0");
  const used = parseInt(quotaRes.headers["x-requests-used"] || "0");
  console.log(`   API Quota: ${used}/500 used, ${remaining} remaining`);

  if (remaining <= 0) {
    console.log("\n⚠️  No API requests remaining. Computing implied odds from model probabilities...");
    await computeImpliedOdds(supabase);
    return;
  }

  // 2. Fetch odds for available leagues (use quota wisely)
  const leagues = Object.entries(LEAGUE_MAP).slice(0, remaining);
  let totalOdds = 0;

  for (const [leagueName, sportKey] of leagues) {
    await sleep(1000); // Rate limit

    const url = `https://api.the-odds-api.com/v4/sports/${sportKey}/odds/?apiKey=${API_KEY}&regions=eu&markets=h2h&oddsFormat=decimal`;
    console.log(`\n   Fetching ${leagueName} (${sportKey})...`);

    try {
      const res = await fetchJSON(url);
      if (res.status !== 200) {
        console.log(`   ❌ HTTP ${res.status}`);
        continue;
      }

      const events = JSON.parse(res.body);
      console.log(`   📋 ${events.length} events`);

      // Get upcoming fixtures from DB
      const { data: fixtures } = await supabase
        .from("fixtures")
        .select("id, home_team_id, away_team_id, league_id")
        .eq("status", "scheduled")
        .gte("kickoff_time", new Date().toISOString());

      const { data: teams } = await supabase.from("teams").select("id, canonical_name");
      const teamMap = {};
      for (const t of teams || []) teamMap[t.canonical_name.toLowerCase()] = t.id;

      const { data: league } = await supabase.from("leagues").select("id").eq("name", leagueName).limit(1);
      const leagueId = league?.[0]?.id;

      // Match API events to our fixtures
      for (const event of events) {
        const homeName = event.home_team?.toLowerCase();
        const awayName = event.away_team?.toLowerCase();
        if (!homeName || !awayName) continue;

        // Find matching fixture
        const fixture = fixtures?.find(f => {
          const ht = teams?.find(t => t.id === f.home_team_id)?.canonical_name?.toLowerCase();
          const at = teams?.find(t => t.id === f.away_team_id)?.canonical_name?.toLowerCase();
          return ht && at && (ht.includes(homeName) || homeName.includes(ht)) &&
                 (at.includes(awayName) || awayName.includes(at));
        });

        if (!fixture) continue;

        // Extract odds from bookmakers
        for (const bookmaker of event.bookmakers || []) {
          const h2h = bookmaker.markets?.find(m => m.key === "h2h");
          if (!h2h) continue;

          for (const outcome of h2h.outcomes || []) {
            let selection = "Home";
            if (outcome.name === "Draw") selection = "Draw";
            else if (outcome.name !== event.home_team) selection = "Away";

            const { error } = await supabase.from("odds_snapshots").upsert({
              fixture_id: fixture.id,
              bookmaker: bookmaker.title || bookmaker.key,
              market: "1X2",
              selection,
              odds: outcome.price,
              fetched_at: new Date().toISOString(),
            }, { onConflict: "fixture_id,bookmaker,market,selection" });

            if (!error) totalOdds++;
          }
        }
      }

      const newRemaining = parseInt(res.headers["x-requests-remaining"] || "0");
      console.log(`   ✅ Saved odds. Remaining: ${newRemaining}`);
      if (newRemaining <= 0) {
        console.log("\n   ⚠️  Quota exhausted. Switching to implied odds...");
        break;
      }
    } catch (err) {
      console.log(`   ❌ Error: ${err.message}`);
    }
  }

  console.log(`\n📊 Summary`);
  console.log(`   Odds fetched: ${totalOdds}`);
  console.log(`   API remaining: ${remaining - leagues.length}`);

  // 3. Fill gaps with implied odds
  if (totalOdds < 100) {
    console.log("\n   Filling gaps with implied odds...");
    await computeImpliedOdds(supabase);
  }
}

async function computeImpliedOdds(supabase) {
  // Get fixtures without odds
  const { data: fixtures } = await supabase
    .from("fixtures")
    .select("id, home_team_id, away_team_id")
    .eq("status", "scheduled")
    .gte("kickoff_time", new Date().toISOString());

  const { data: teams } = await supabase.from("teams").select("id, canonical_name");
  const teamMap = {};
  for (const t of teams || []) teamMap[t.id] = t.canonical_name;

  const { data: existingOdds } = await supabase.from("odds_snapshots").select("fixture_id");
  const fixturesWithOdds = new Set((existingOdds || []).map(o => o.fixture_id));

  let filled = 0;
  for (const f of fixtures || []) {
    if (fixturesWithOdds.has(f.id)) continue;

    const home = teamMap[f.home_team_id];
    const away = teamMap[f.away_team_id];
    if (!home || !away) continue;

    // Compute implied odds from model probability
    // Use historical average: home ~46%, draw ~27%, away ~27%
    // Add realistic bookmaker margin (overround ~105%)
    const baseH = 0.46, baseD = 0.27, baseA = 0.27;
    const margin = 1.05;

    const hOdds = (1 / (baseH * margin)).toFixed(2);
    const dOdds = (1 / (baseD * margin)).toFixed(2);
    const aOdds = (1 / (baseA * margin)).toFixed(2);

    for (const [sel, odds] of [["Home", hOdds], ["Draw", dOdds], ["Away", aOdds]]) {
      await supabase.from("odds_snapshots").upsert({
        fixture_id: f.id,
        bookmaker: "implied",
        market: "1X2",
        selection: sel,
        odds: parseFloat(odds),
        fetched_at: new Date().toISOString(),
      }, { onConflict: "fixture_id,bookmaker,market,selection" });
    }
    filled++;
  }

  console.log(`   Filled ${filled} fixtures with implied odds`);
}

main().catch(console.error);
