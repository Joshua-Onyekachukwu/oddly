#!/usr/bin/env node

/**
 * ODDLY Fast StatsBomb Collector
 * Only collects lineups for key competitions we track.
 * Run: node worker/collect-statsbomb-fast.js
 */

const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");
const path = require("path");

function loadEnv() {
  const envPath = path.join(__dirname, "..", ".env.local");
  const envContent = fs.readFileSync(envPath, "utf8");
  const env = {};
  for (const line of envContent.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return env;
}

const env = loadEnv();
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const BASE_URL = "https://raw.githubusercontent.com/hudl/open-data/master/data";
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Only collect these competitions (most relevant for our leagues)
const TARGET_COMPETITIONS = [
  { id: 9, name: "Bundesliga" },    // We track Bundesliga
  { id: 16, name: "Champions League" }, // We track UCL
  { id: 11, name: "La Liga" },
  { id: 12, name: "Ligue 1" },
  { id: 13, name: "Premier League" },
  { id: 35, name: "Serie A" },
];

async function getLineup(matchId) {
  try {
    const res = await fetch(`${BASE_URL}/lineups/${matchId}.json`);
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

async function storePlayer(name, statsbombId) {
  const { data: existing } = await supabase.from("players").select("id").eq("statsbomb_id", statsbombId).maybeSingle();
  if (existing) return existing.id;
  const { data: inserted } = await supabase.from("players").insert({ name, statsbomb_id: statsbombId }).select("id").single();
  return inserted?.id;
}

async function main() {
  console.log("⚽ Fast StatsBomb Collector");
  console.log("━".repeat(50));

  // Get competitions
  const res = await fetch(`${BASE_URL}/competitions.json`);
  const allComps = await res.json();

  // Filter to our target competitions
  const comps = allComps.filter(c =>
    c.competition_gender === "male" &&
    TARGET_COMPETITIONS.some(t => t.id === c.competition_id)
  );

  console.log(`\n📋 Found ${comps.length} relevant competition-seasons`);

  let totalPlayers = 0;
  let totalAppearances = 0;

  for (const comp of comps) {
    console.log(`\n🏆 ${comp.competition_name} (${comp.season_name})`);

    // Get matches
    const matchRes = await fetch(`${BASE_URL}/matches/${comp.competition_id}/${comp.season_id}.json`);
    if (!matchRes.ok) { console.log("   No matches"); continue; }
    const matches = await matchRes.json();
    console.log(`   ${matches.length} matches`);

    let processed = 0;
    for (const match of matches) {
      const lineup = await getLineup(match.match_id);
      if (!lineup) { processed++; continue; }

      for (const teamLineup of lineup) {
        for (const player of teamLineup.lineup) {
          const playerId = await storePlayer(player.player_name, player.player_id);
          if (!playerId) continue;
          totalPlayers++;

          // Parse appearance
          const positions = player.positions || [];
          const isStarter = positions.some(p => p.start_reason === "Starting XI");
          const isSub = positions.some(p => p.start_reason?.includes("Substitution"));
          let minutesPlayed = 0;
          let position = null;
          let subIn = null;

          for (const pos of positions) {
            position = pos.position;
            if (pos.start_reason === "Starting XI") {
              minutesPlayed += pos.to ? parseInt(pos.to.split(":")[0]) : 90;
            } else if (pos.start_reason?.includes("Substitution")) {
              subIn = parseInt(pos.from?.split(":")[0] || "0");
              minutesPlayed += (pos.to ? parseInt(pos.to.split(":")[0]) : 90) - subIn;
            }
          }

          const yellowCards = (player.cards || []).filter(c => c.card_type === "Yellow Card").length;
          const redCards = (player.cards || []).filter(c => c.card_type === "Red Card").length;

          // Check if already exists
          const { data: existing } = await supabase
            .from("player_appearances")
            .select("id")
            .eq("player_id", playerId)
            .eq("fixture_id", match.match_id)
            .maybeSingle();

          if (!existing) {
            await supabase.from("player_appearances").insert({
              player_id: playerId,
              fixture_id: match.match_id,
              team_id: teamLineup.team_id,
              is_starter: isStarter,
              is_substitute: isSub,
              substitute_in_minute: subIn,
              minutes_played: minutesPlayed,
              position: position,
              yellow_cards: yellowCards,
              red_cards: redCards,
            });
            totalAppearances++;
          }
        }
      }

      processed++;
      if (processed % 20 === 0) console.log(`   📊 ${processed}/${matches.length}`);
      await sleep(50); // Be nice to GitHub
    }
  }

  console.log("\n" + "═".repeat(50));
  console.log(`✅ Done! ${totalPlayers} players, ${totalAppearances} appearances`);
  console.log("═".repeat(50));
}

main().catch(e => { console.error("❌", e.message); process.exit(1); });
