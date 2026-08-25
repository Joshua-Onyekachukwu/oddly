#!/usr/bin/env node

/**
 * ODDLY Referee Data Sync
 *
 * Pushes local referee profiles and match history to Supabase.
 * Also links referee names to existing fixtures where possible.
 */

const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

function loadEnv() {
  const envPath = path.join(__dirname, "..", ".env.local");
  const env = {};
  try {
    for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("=");
      if (i === -1) continue;
      let v = t.slice(i + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
        v = v.slice(1, -1);
      env[t.slice(0, i).trim()] = v;
    }
  } catch {}
  return env;
}

const env = loadEnv();
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

function loadJSON(filename) {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", filename), "utf8"));
  } catch (e) {
    console.log(`  ⚠️  ${filename}: ${e.message}`);
    return null;
  }
}

async function upsertBatch(table, records, batchSize = 200, conflictCol = "referee_name") {
  let inserted = 0;
  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);
    const { error } = await sb.from(table).upsert(batch, { onConflict: conflictCol });
    if (error) {
      // Try without onConflict
      const { error: err2 } = await sb.from(table).upsert(batch);
      if (err2) console.log(`  ⚠️  Batch error at ${i}: ${err2.message}`);
      else inserted += batch.length;
    } else {
      inserted += batch.length;
    }
  }
  return inserted;
}

// ─── Sync Referee Profiles ───────────────────────────────────────────────
async function syncRefereeProfiles() {
  console.log("\n👨‍⚖️ Syncing referee profiles...");
  const profiles = loadJSON("referee-profiles.json");
  if (!profiles || !Array.isArray(profiles)) return 0;

  const records = profiles.map((r) => ({
    referee_name: r.name,
    total_matches: r.matches || 0,
    home_win_pct: r.homeWinPct || null,
    draw_pct: r.drawPct || null,
    away_win_pct: r.awayWinPct || null,
    avg_total_goals: r.avgGoals || null,
    avg_yellow_per_match: r.avgYellow || null,
    avg_red_per_match: r.avgRed || null,
    avg_fouls_per_match: r.avgFouls || null,
    btts_pct: r.bttsPct || null,
    over_2_5_pct: r.over25Pct || null,
    home_bias: r.homeBias || null,
    leagues_officiated: r.leagues || [],
  }));

  const count = await upsertBatch("referee_profiles", records, 200, "referee_name");
  console.log(`  ✅ ${count} referee profiles synced`);
  return count;
}

// ─── Sync Referee Match History ──────────────────────────────────────────
async function syncRefereeHistory() {
  console.log("\n📋 Syncing referee match history...");
  const history = loadJSON("football-data-referee-stats.json");
  if (!history || !Array.isArray(history)) return 0;

  // Get existing fixture IDs to link referee history
  const { data: existingFixtures } = await sb.from("fixtures")
    .select("id, kickoff_time, home_team:teams!fixtures_home_team_id_fkey(canonical_name), away_team:teams!fixtures_away_team_id_fkey(canonical_name)")
    .eq("status", "finished")
    .limit(11000);

  // Build lookup by team names + date
  const fixtureLookup = {};
  for (const f of existingFixtures || []) {
    const home = f.home_team?.canonical_name;
    const away = f.away_team?.canonical_name;
    const date = f.kickoff_time?.slice(0, 10);
    if (home && away && date) {
      const key = `${home.toLowerCase()}_${away.toLowerCase()}_${date}`;
      fixtureLookup[key] = f.id;
    }
  }

  // Also build lookup by external_id pattern
  const { data: extFixtures } = await sb.from("fixtures")
    .select("id, external_id")
    .eq("status", "finished")
    .not("external_id", "is", null)
    .limit(11000);

  const extLookup = {};
  for (const f of extFixtures || []) {
    if (f.external_id) extLookup[f.external_id] = f.id;
  }

  const records = [];
  let linked = 0;

  for (const h of history) {
    const matchDate = h.date;
    const fixtureId = fixtureLookup[`${h.home_team?.toLowerCase()}_${h.away_team?.toLowerCase()}_${matchDate}`] || null;

    if (fixtureId) linked++;

    const totalCards = (h.home_yellow || 0) + (h.away_yellow || 0) + (h.home_red || 0) + (h.away_red || 0);

    records.push({
      referee_name: h.referee,
      fixture_id: fixtureId,
      match_date: matchDate,
      home_goals: h.home_goals,
      away_goals: h.away_goals,
      ft_result: h.ft_result,
      home_yellow: h.home_yellow || 0,
      away_yellow: h.away_yellow || 0,
      home_red: h.home_red || 0,
      away_red: h.away_red || 0,
      total_cards: totalCards,
      home_fouls: h.home_fouls || null,
      away_fouls: h.away_fouls || null,
      home_shots: h.home_shots || null,
      away_shots: h.away_shots || null,
      home_corners: h.home_corners || null,
      away_corners: h.away_corners || null,
    });
  }

  // Batch insert (no upsert needed — these are new records)
  let inserted = 0;
  for (let i = 0; i < records.length; i += 500) {
    const batch = records.slice(i, i + 500);
    const { error } = await sb.from("referee_match_history").insert(batch);
    if (error) {
      console.log(`  ⚠️  Batch error at ${i}: ${error.message}`);
      // Try smaller batches
      for (let j = 0; j < batch.length; j += 50) {
        const smallBatch = batch.slice(j, j + 50);
        const { error: err2 } = await sb.from("referee_match_history").insert(smallBatch);
        if (!err2) inserted += smallBatch.length;
      }
    } else {
      inserted += batch.length;
    }
  }

  console.log(`  ✅ ${inserted} referee match records synced (${linked} linked to existing fixtures)`);
  return inserted;
}

// ─── Link Referees to Existing Fixtures ──────────────────────────────────
async function linkRefereesToFixtures() {
  console.log("\n🔗 Linking referees to existing fixtures...");

  // Get all referee history with fixture links
  const { data: history } = await sb.from("referee_match_history")
    .select("fixture_id, referee_name")
    .not("fixture_id", "is", null);

  if (!history || history.length === 0) {
    console.log("  No linked records found");
    return 0;
  }

  let updated = 0;
  for (let i = 0; i < history.length; i += 100) {
    const batch = history.slice(i, i + 100);
    for (const h of batch) {
      const { error } = await sb.from("fixtures")
        .update({ referee_name: h.referee_name })
        .eq("id", h.fixture_id)
        .is("referee_name", null);
      if (!error) updated++;
    }
  }

  console.log(`  ✅ ${updated} fixtures updated with referee names`);
  return updated;
}

// ─── Main ────────────────────────────────────────────────────────────────
async function main() {
  console.log("🔄 ODDLY Referee Data Sync");
  console.log("━".repeat(55));

  const results = {};
  results.profiles = await syncRefereeProfiles();
  results.history = await syncRefereeHistory();
  results.linked = await linkRefereesToFixtures();

  // Check coverage
  const { count: totalFx } = await sb.from("fixtures").select("*", { count: "exact", head: true }).eq("status", "finished");
  const { count: withRef } = await sb.from("fixtures").select("*", { count: "exact", head: true }).not("referee_name", "is", null);
  const { count: refProfiles } = await sb.from("referee_profiles").select("*", { count: "exact", head: true });
  const { count: refHistory } = await sb.from("referee_match_history").select("*", { count: "exact", head: true });

  console.log("\n" + "═".repeat(55));
  console.log("  SUMMARY");
  console.log("═".repeat(55));
  console.log(`  Referee profiles:      ${refProfiles}`);
  console.log(`  Referee match records: ${refHistory}`);
  console.log(`  Fixtures with referee: ${withRef}/${totalFx} (${((withRef / totalFx) * 100).toFixed(1)}%)`);
  console.log("═".repeat(55));
}

main().catch(console.error);
