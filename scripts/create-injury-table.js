#!/usr/bin/env node
/**
 * Create player_availability table via Supabase SQL execution
 */
const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");
const path = require("path");

const env = {};
fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf8").split("\n").forEach((l) => {
  if (l.startsWith("#") || !l.includes("=")) return;
  const idx = l.indexOf("=");
  const key = l.substring(0, idx).trim();
  let val = l.substring(idx + 1).trim();
  if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
  env[key] = val;
});

const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function main() {
  // Try to query the table — if it fails, we need to create it via SQL Editor
  const { data, error } = await sb.from("player_availability").select("id").limit(1);
  
  if (!error) {
    const { count } = await sb.from("player_availability").select("id", { count: "exact", head: true });
    console.log(`✅ player_availability table exists with ${count} rows`);
    return;
  }
  
  console.log("❌ player_availability table does not exist");
  console.log("   Error:", error.message);
  console.log("\n📋 You need to run this SQL in Supabase SQL Editor:");
  console.log("   Go to: https://supabase.com/dashboard/project/ulelicrbgicgnhmuulup/sql/new");
  console.log("   Paste the contents of supabase/add-injury-tracking.sql");
  console.log("   Click 'Run'");
  
  // Print the SQL
  const sql = fs.readFileSync(path.join(__dirname, "..", "supabase", "add-injury-tracking.sql"), "utf8");
  console.log("\n" + "━".repeat(60));
  console.log(sql);
  console.log("━".repeat(60));
}

main().catch(console.error);
