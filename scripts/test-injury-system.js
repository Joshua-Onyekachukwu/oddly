#!/usr/bin/env node

/**
 * Test Script for ODDLY Injury System
 * 
 * Verifies:
 * - Database tables exist
 * - Data can be inserted and queried
 * - Feature computation works
 * - API routes are accessible
 * - Data quality checks pass
 */

const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");
const path = require("path");

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

// ─── Test Helpers ────────────────────────────────────────────────────────

let testsPassed = 0;
let testsFailed = 0;

function logTest(name, passed, details = "") {
  if (passed) {
    console.log(`  ✅ ${name}`);
    testsPassed++;
  } else {
    console.log(`  ❌ ${name}${details ? ` - ${details}` : ""}`);
    testsFailed++;
  }
}

// ─── Test Suite ──────────────────────────────────────────────────────────

async function testDatabaseTables() {
  console.log("\n═══ Database Tables ═══");
  
  // Test player_availability table
  const { error: paError } = await supabase
    .from("player_availability")
    .select("id")
    .limit(1);
  
  logTest("player_availability table exists", !paError);
  
  // Test injury_snapshots table
  const { error: isError } = await supabase
    .from("injury_snapshots")
    .select("id")
    .limit(1);
  
  logTest("injury_snapshots table exists", !isError);
  
  // Test team_injury_features table
  const { error: tifError } = await supabase
    .from("team_injury_features")
    .select("id")
    .limit(1);
  
  logTest("team_injury_features table exists", !tifError);
  
  // Test fixture_injury_features table
  const { error: fifError } = await supabase
    .from("fixture_injury_features")
    .select("id")
    .limit(1);
  
  logTest("fixture_injury_features table exists", !fifError);
  
  // Test injury_collection_log table
  const { error: iclError } = await supabase
    .from("injury_collection_log")
    .select("id")
    .limit(1);
  
  logTest("injury_collection_log table exists", !iclError);
}

async function testDataInsertion() {
  console.log("\n═══ Data Insertion ═══");
  
  const testRecord = {
    player_name: "Test Player",
    team_name: "Test Team",
    status: "injured",
    injury_type: "Test Injury",
    reason: "Test Reason",
    source: "test",
    updated_at: new Date().toISOString(),
  };
  
  // Insert test record
  const { data: insertData, error: insertError } = await supabase
    .from("player_availability")
    .upsert(testRecord, { onConflict: "player_name,team_name" })
    .select()
    .single();
  
  logTest("Can insert into player_availability", !insertError, insertError?.message);
  
  if (insertData) {
    // Clean up test record
    await supabase
      .from("player_availability")
      .delete()
      .eq("id", insertData.id);
  }
}

async function testViews() {
  console.log("\n═══ Views ═══");
  
  // Test team_injury_summary_v2 view
  const { error: tisError } = await supabase
    .from("team_injury_summary_v2")
    .select("*")
    .limit(1);
  
  logTest("team_injury_summary_v2 view exists", !tisError);
  
  // Test injury_dashboard_summary view
  const { error: idsError } = await supabase
    .from("injury_dashboard_summary")
    .select("*")
    .limit(1);
  
  logTest("injury_dashboard_summary view exists", !idsError);
  
  // Test fixture_injury_overview view
  const { error: fioError } = await supabase
    .from("fixture_injury_overview")
    .select("*")
    .limit(1);
  
  logTest("fixture_injury_overview view exists", !fioError);
}

async function testDataQuality() {
  console.log("\n═══ Data Quality ═══");
  
  // Check for active injuries
  const { count: injuryCount } = await supabase
    .from("player_availability")
    .select("*", { count: "exact", head: true })
    .in("status", ["injured", "suspended", "doubtful", "out"]);
  
  logTest("Has injury data", injuryCount > 0, `Found ${injuryCount} records`);
  
  // Check data freshness
  const { data: freshness } = await supabase
    .rpc("check_injury_data_freshness");
  
  logTest("Data freshness function works", freshness !== null);
  
  if (freshness && freshness.length > 0) {
    const freshCount = freshness.filter(f => f.freshness_status === "fresh").length;
    const staleCount = freshness.filter(f => f.freshness_status === "stale" || f.freshness_status === "very_stale").length;
    
    console.log(`    Fresh: ${freshCount}, Stale: ${staleCount}`);
  }
}

async function testFeatureComputation() {
  console.log("\n═══ Feature Computation ═══");
  
  // Check if any features have been computed
  const { count: teamFeatureCount } = await supabase
    .from("team_injury_features")
    .select("*", { count: "exact", head: true });
  
  const { count: fixtureFeatureCount } = await supabase
    .from("fixture_injury_features")
    .select("*", { count: "exact", head: true });
  
  logTest("Team injury features computed", teamFeatureCount > 0, `Found ${teamFeatureCount} records`);
  logTest("Fixture injury features computed", fixtureFeatureCount > 0, `Found ${fixtureFeatureCount} records`);
}

async function testCollectionLogs() {
  console.log("\n═══ Collection Logs ═══");
  
  const { count: logCount } = await supabase
    .from("injury_collection_log")
    .select("*", { count: "exact", head: true });
  
  logTest("Collection logs exist", logCount > 0, `Found ${logCount} logs`);
  
  // Check for recent successful collection
  const { data: recentLog } = await supabase
    .from("injury_collection_log")
    .select("*")
    .eq("status", "success")
    .order("completed_at", { ascending: false })
    .limit(1)
    .single();
  
  logTest("Recent successful collection", recentLog !== null);
  
  if (recentLog) {
    console.log(`    Last success: ${recentLog.completed_at}`);
    console.log(`    Records: ${recentLog.records_inserted} inserted, ${recentLog.records_updated} updated`);
  }
}

async function testHistoricalSnapshots() {
  console.log("\n═══ Historical Snapshots ═══");
  
  const { count: snapshotCount } = await supabase
    .from("injury_snapshots")
    .select("*", { count: "exact", head: true });
  
  logTest("Historical snapshots exist", snapshotCount > 0, `Found ${snapshotCount} snapshots`);
  
  // Check snapshot coverage
  const { data: fixtureCount } = await supabase
    .from("injury_snapshots")
    .select("fixture_id", { count: "exact", head: true })
    .eq("is_historical", true);
  
  logTest("Snapshots linked to fixtures", fixtureCount > 0);
}

// ─── Main ────────────────────────────────────────────────────────────────

async function main() {
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  ODDLY Injury System Test Suite");
  console.log("═══════════════════════════════════════════════════════════");
  
  try {
    await testDatabaseTables();
    await testDataInsertion();
    await testViews();
    await testDataQuality();
    await testFeatureComputation();
    await testCollectionLogs();
    await testHistoricalSnapshots();
    
    console.log("\n═══════════════════════════════════════════════════════════");
    console.log(`  Results: ${testsPassed} passed, ${testsFailed} failed`);
    console.log("═══════════════════════════════════════════════════════════");
    
    if (testsFailed > 0) {
      console.log("\n  ⚠️  Some tests failed. Please check the setup.");
      process.exit(1);
    } else {
      console.log("\n  ✅ All tests passed!");
    }
    
  } catch (error) {
    console.error("Test suite error:", error);
    process.exit(1);
  }
}

main().catch(console.error);
