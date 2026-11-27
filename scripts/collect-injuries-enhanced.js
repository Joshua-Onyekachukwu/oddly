#!/usr/bin/env node

/**
 * ODDLY Enhanced Injury & Suspension Collector
 * 
 * Features:
 * - Multiple data sources with validation
 * - Historical snapshot preservation
 * - Data quality monitoring
 * - Duplicate prevention
 * - Structured logging
 * - Graceful failure handling
 * 
 * Usage: node scripts/collect-injuries-enhanced.js [--dry-run] [--source premierinjuries]
 */

const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");
const path = require("path");
const https = require("https");

// Load environment
function loadEnv() {
  const envPath = path.join(__dirname, "..", ".env.local");
  if (fs.existsSync(envPath)) {
    fs.readFileSync(envPath, "utf8").split("\n").forEach((l) => {
      const m = l.match(/^([^#=]+)="?([^"]*)"?\s*$/);
      if (m) process.env[m[1].trim()] = m[2].trim();
    });
  }
}
loadEnv();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY
);

const DRY_RUN = process.argv.includes("--dry-run");
const SOURCE_FILTER = process.argv.includes("--source")
  ? process.argv[process.argv.indexOf("--source") + 1]
  : null;

// ─── Logging ─────────────────────────────────────────────────────────────

function log(level, message, data = {}) {
  const timestamp = new Date().toISOString();
  const logEntry = { timestamp, level, message, ...data };
  
  if (level === "error") {
    console.error(`[${timestamp}] ERROR: ${message}`, data);
  } else if (level === "warn") {
    console.warn(`[${timestamp}] WARN: ${message}`, data);
  } else {
    console.log(`[${timestamp}] ${level.toUpperCase()}: ${message}`);
  }
  
  return logEntry;
}

// ─── Data Validation ─────────────────────────────────────────────────────

function validateInjuryRecord(record) {
  const errors = [];
  
  if (!record.player_name || record.player_name.trim().length === 0) {
    errors.push("Missing player name");
  }
  
  if (!record.team_name || record.team_name.trim().length === 0) {
    errors.push("Missing team name");
  }
  
  if (!record.status || !["injured", "suspended", "doubtful", "out", "questionable", "fit", "returned", "unknown"].includes(record.status)) {
    errors.push(`Invalid status: ${record.status}`);
  }
  
  if (record.expected_return && isNaN(Date.parse(record.expected_return))) {
    errors.push(`Invalid expected_return date: ${record.expected_return}`);
  }
  
  return {
    valid: errors.length === 0,
    errors,
    record: {
      ...record,
      player_name: record.player_name?.trim(),
      team_name: record.team_name?.trim(),
      status: record.status?.toLowerCase(),
    },
  };
}

function validateSourceResponse(source, records, expectedMin = 1, expectedMax = 1000) {
  const issues = [];
  
  if (!Array.isArray(records)) {
    issues.push("Response is not an array");
    return { valid: false, issues, records: [] };
  }
  
  if (records.length === 0) {
    issues.push("Empty response (no records)");
  } else if (records.length < expectedMin) {
    issues.push(`Unexpectedly few records: ${records.length} (expected >= ${expectedMin})`);
  } else if (records.length > expectedMax) {
    issues.push(`Unexpectedly many records: ${records.length} (expected <= ${expectedMax})`);
  }
  
  // Check for required fields
  const requiredFields = ["player_name", "team_name", "status"];
  const sampleSize = Math.min(10, records.length);
  
  for (let i = 0; i < sampleSize; i++) {
    const record = records[i];
    for (const field of requiredFields) {
      if (!record[field]) {
        issues.push(`Record ${i} missing required field: ${field}`);
      }
    }
  }
  
  // Check for duplicate team names (potential data issue)
  const teamNames = records.map(r => r.team_name).filter(Boolean);
  const uniqueTeams = new Set(teamNames);
  if (uniqueTeams.size < teamNames.length * 0.5) {
    issues.push("Unusual distribution of team names (possible data issue)");
  }
  
  return {
    valid: issues.length === 0,
    issues,
    records,
  };
}

// ─── Premier Injuries Scraper ────────────────────────────────────────────

function fetchURL(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 15000 }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve(data));
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("Timeout")); });
  });
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function collectFromPremierInjuries() {
  const source = "premierinjuries.com";
  log("info", `Collecting from ${source}`);
  
  const collectionId = crypto.randomUUID();
  const startedAt = new Date();
  
  // Log collection start
  if (!DRY_RUN) {
    await supabase.from("injury_collection_log").insert({
      id: collectionId,
      source,
      started_at: startedAt.toISOString(),
      status: "running",
    });
  }
  
  try {
    // Check if we have cached data
    const cachePath = path.join(__dirname, "..", "data", "premier-injuries.json");
    let rawData = [];
    
    if (fs.existsSync(cachePath)) {
      const cached = JSON.parse(fs.readFileSync(cachePath, "utf8"));
      rawData = cached.injuries || [];
      log("info", `Loaded ${rawData.length} records from cache`);
    }
    
    // Validate source response
    const validation = validateSourceResponse(source, rawData, 10, 200);
    
    if (!validation.valid) {
      log("warn", `Source validation failed`, { issues: validation.issues });
      
      if (!DRY_RUN) {
        await supabase.from("injury_collection_log").update({
          completed_at: new Date().toISOString(),
          status: "failed",
          error_message: validation.issues.join("; "),
          records_found: 0,
        }).eq("id", collectionId);
      }
      
      return { success: false, records: 0, errors: validation.issues };
    }
    
    // Validate and normalize each record
    const validatedRecords = [];
    const rejectedRecords = [];
    
    for (const record of rawData) {
      const result = validateInjuryRecord({
        ...record,
        source,
        expected_return: record.expected_return === "No Return Date" ? null : record.expected_return,
      });
      
      if (result.valid) {
        validatedRecords.push(result.record);
      } else {
        rejectedRecords.push({ record, errors: result.errors });
      }
    }
    
    log("info", `Validated ${validatedRecords.length} records, rejected ${rejectedRecords.length}`);
    
    // Save to database with duplicate prevention
    let inserted = 0;
    let updated = 0;
    
    if (!DRY_RUN) {
      for (const record of validatedRecords) {
        // Check if record exists
        const { data: existing } = await supabase
          .from("player_availability")
          .select("id, updated_at")
          .eq("player_name", record.player_name)
          .eq("team_name", record.team_name)
          .single();
        
        if (existing) {
          // Update if source is newer
          const existingDate = new Date(existing.updated_at);
          const newDate = new Date(record.fetched_at || record.updated_at || Date.now());
          
          if (newDate > existingDate) {
            await supabase
              .from("player_availability")
              .update({
                status: record.status,
                injury_type: record.injury_type,
                reason: record.reason,
                expected_return: record.expected_return,
                source: record.source,
                updated_at: new Date().toISOString(),
              })
              .eq("id", existing.id);
            updated++;
          }
        } else {
          // Insert new record
          await supabase.from("player_availability").insert({
            player_name: record.player_name,
            team_name: record.team_name,
            status: record.status,
            injury_type: record.injury_type,
            reason: record.reason || record.injury_type,
            expected_return: record.expected_return,
            source: record.source,
            is_key_player: false,
            updated_at: new Date().toISOString(),
          });
          inserted++;
        }
      }
    }
    
    // Create historical snapshots for upcoming fixtures
    if (!DRY_RUN && validatedRecords.length > 0) {
      await createSnapshotsForUpcomingFixtures(validatedRecords);
    }
    
    // Update collection log
    const completedAt = new Date();
    const duration = (completedAt.getTime() - startedAt.getTime()) / 1000;
    
    if (!DRY_RUN) {
      await supabase.from("injury_collection_log").update({
        completed_at: completedAt.toISOString(),
        status: "success",
        records_found: rawData.length,
        records_inserted: inserted,
        records_updated: updated,
        records_rejected: rejectedRecords.length,
        metadata: {
          duration_seconds: duration,
          validated_count: validatedRecords.length,
          rejected_count: rejectedRecords.length,
        },
      }).eq("id", collectionId);
    }
    
    log("info", `Collection completed`, {
      source,
      found: rawData.length,
      inserted,
      updated,
      rejected: rejectedRecords.length,
      duration: `${duration.toFixed(1)}s`,
    });
    
    return {
      success: true,
      records: inserted + updated,
      errors: rejectedRecords.map(r => r.errors).flat(),
    };
    
  } catch (error) {
    log("error", `Collection failed: ${error.message}`, { source, error });
    
    if (!DRY_RUN) {
      await supabase.from("injury_collection_log").update({
        completed_at: new Date().toISOString(),
        status: "failed",
        error_message: error.message,
      }).eq("id", collectionId);
    }
    
    return { success: false, records: 0, errors: [error.message] };
  }
}

async function createSnapshotsForUpcomingFixtures(injuries) {
  // Get upcoming fixtures (next 7 days)
  const { data: fixtures } = await supabase
    .from("fixtures")
    .select("id, kickoff_time, home_team_name, away_team_name")
    .gte("kickoff_time", new Date().toISOString())
    .lte("kickoff_time", new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString())
    .in("status", ["scheduled"]);
  
  if (!fixtures?.length) return;
  
  const snapshotDate = new Date();
  
  for (const fixture of fixtures) {
    const fixtureInjuries = injuries.filter(i => 
      i.team_name === fixture.home_team_name || 
      i.team_name === fixture.away_team_name
    );
    
    for (const injury of fixtureInjuries) {
      await supabase.from("injury_snapshots").upsert({
        snapshot_date: snapshotDate.toISOString(),
        player_name: injury.player_name,
        team_name: injury.team_name,
        fixture_id: fixture.id,
        fixture_date: fixture.kickoff_time,
        status: injury.status,
        injury_type: injury.injury_type,
        reason: injury.reason,
        source: injury.source,
        collection_timestamp: snapshotDate.toISOString(),
        is_historical: true,
      }, {
        onConflict: "player_name,team_name,fixture_id,snapshot_date",
      });
    }
  }
}

// ─── API-Football Collection ─────────────────────────────────────────────

async function collectFromAPIFootball() {
  const source = "api-football";
  const apiKey = "***REMOVED-SECRET***";
  
  log("info", `Collecting from ${source}`);
  
  const collectionId = crypto.randomUUID();
  const startedAt = new Date();
  
  // Log collection start
  if (!DRY_RUN) {
    await supabase.from("injury_collection_log").insert({
      id: collectionId,
      source,
      started_at: startedAt.toISOString(),
      status: "running",
    });
  }
  
  try {
    // Get leagues to collect
    const leagues = [
      { id: 39, name: "Premier League" },
      { id: 140, name: "La Liga" },
      { id: 78, name: "Bundesliga" },
      { id: 135, name: "Serie A" },
      { id: 61, name: "Ligue 1" },
    ];
    
    let totalFound = 0;
    let totalInserted = 0;
    let totalUpdated = 0;
    let totalRejected = 0;
    const allErrors = [];
    
    for (const league of leagues) {
      await sleep(1100); // Rate limiting
      
      try {
        const season = new Date().getFullYear();
        const data = await fetchURL(
          `https://v3.football.api-sports.io/injuries?league=${league.id}&season=${season}`
        ).then(d => JSON.parse(d));
        
        if (!data.response || !Array.isArray(data.response)) {
          log("warn", `No data for ${league.name}`);
          continue;
        }
        
        log("info", `${league.name}: Found ${data.response.length} injuries`);
        totalFound += data.response.length;
        
        // Validate and process each injury
        for (const item of data.response) {
          const record = {
            player_name: item.player?.name,
            team_name: item.team?.name,
            status: item.player?.type?.toLowerCase().includes("suspension") ? "suspended" : "injured",
            injury_type: item.player?.type || "Unknown",
            reason: item.player?.reason || item.player?.type || "Unknown",
            source,
          };
          
          const validation = validateInjuryRecord(record);
          
          if (!validation.valid) {
            totalRejected++;
            continue;
          }
          
          if (!DRY_RUN) {
            // Check for existing record
            const { data: existing } = await supabase
              .from("player_availability")
              .select("id, updated_at")
              .eq("player_name", validation.record.player_name)
              .eq("team_name", validation.record.team_name)
              .single();
            
            if (existing) {
              await supabase
                .from("player_availability")
                .update({
                  status: validation.record.status,
                  injury_type: validation.record.injury_type,
                  reason: validation.record.reason,
                  source: validation.record.source,
                  updated_at: new Date().toISOString(),
                })
                .eq("id", existing.id);
              totalUpdated++;
            } else {
              await supabase.from("player_availability").insert({
                ...validation.record,
                updated_at: new Date().toISOString(),
              });
              totalInserted++;
            }
          }
        }
        
      } catch (error) {
        log("error", `Error collecting ${league.name}: ${error.message}`);
        allErrors.push(`${league.name}: ${error.message}`);
      }
    }
    
    // Update collection log
    const completedAt = new Date();
    const duration = (completedAt.getTime() - startedAt.getTime()) / 1000;
    
    if (!DRY_RUN) {
      await supabase.from("injury_collection_log").update({
        completed_at: completedAt.toISOString(),
        status: allErrors.length > 0 ? "partial" : "success",
        records_found: totalFound,
        records_inserted: totalInserted,
        records_updated: totalUpdated,
        records_rejected: totalRejected,
        error_message: allErrors.length > 0 ? allErrors.join("; ") : null,
        metadata: {
          duration_seconds: duration,
          leagues_collected: leagues.length,
        },
      }).eq("id", collectionId);
    }
    
    log("info", `API-Football collection completed`, {
      found: totalFound,
      inserted: totalInserted,
      updated: totalUpdated,
      rejected: totalRejected,
      duration: `${duration.toFixed(1)}s`,
    });
    
    return {
      success: true,
      records: totalInserted + totalUpdated,
      errors: allErrors,
    };
    
  } catch (error) {
    log("error", `API-Football collection failed: ${error.message}`);
    
    if (!DRY_RUN) {
      await supabase.from("injury_collection_log").update({
        completed_at: new Date().toISOString(),
        status: "failed",
        error_message: error.message,
      }).eq("id", collectionId);
    }
    
    return { success: false, records: 0, errors: [error.message] };
  }
}

// ─── Main ────────────────────────────────────────────────────────────────

async function main() {
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  ODDLY Enhanced Injury & Suspension Collector");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`📡 Supabase: ${process.env.NEXT_PUBLIC_SUPABASE_URL}`);
  console.log(`🔧 Mode: ${DRY_RUN ? "DRY RUN" : "LIVE"}`);
  if (SOURCE_FILTER) console.log(`🎯 Source filter: ${SOURCE_FILTER}`);
  console.log("");
  
  const results = {
    premierinjuries: null,
    apifootball: null,
  };
  
  // Collect from Premier Injuries (unless filtered out)
  if (!SOURCE_FILTER || SOURCE_FILTER === "premierinjuries") {
    results.premierinjuries = await collectFromPremierInjuries();
  }
  
  // Collect from API-Football (unless filtered out)
  if (!SOURCE_FILTER || SOURCE_FILTER === "apifootball") {
    results.apifootball = await collectFromAPIFootball();
  }
  
  // Summary
  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("  Summary");
  console.log("═══════════════════════════════════════════════════════════");
  
  let totalRecords = 0;
  let totalErrors = 0;
  
  for (const [source, result] of Object.entries(results)) {
    if (result) {
      console.log(`  ${source}: ${result.success ? "✅" : "❌"} ${result.records} records`);
      totalRecords += result.records;
      totalErrors += result.errors.length;
    }
  }
  
  console.log(`\n  Total records: ${totalRecords}`);
  console.log(`  Total errors: ${totalErrors}`);
  
  // Check current database status
  if (!DRY_RUN) {
    const { count } = await supabase
      .from("player_availability")
      .select("*", { count: "exact", head: true })
      .in("status", ["injured", "suspended", "doubtful", "out"]);
    
    console.log(`  Active absences in DB: ${count}`);
  }
  
  console.log("\n═══════════════════════════════════════════════════════════");
}

main().catch(console.error);
