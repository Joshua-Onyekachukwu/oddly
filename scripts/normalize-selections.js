#!/usr/bin/env node

/**
 * Normalize capitalized selections to lowercase in predictions table.
 * 
 * Fixes: Home→home, Away→away, Draw→draw, Over_2.5→over_2.5, etc.
 * Safe: only updates text selection field, not IDs/dates/numbers.
 * Idempotent: running twice produces no additional changes.
 *
 * Usage: node scripts/normalize-selections.js [--dry-run]
 */

const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

const env = {};
fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf8")
  .split("\n")
  .forEach((l) => {
    if (l.startsWith("#") || !l.includes("=")) return;
    const idx = l.indexOf("=");
    const key = l.substring(0, idx).trim();
    let val = l.substring(idx + 1).trim();
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    env[key] = val;
  });

const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  Normalize Predictions Selections");
  console.log(`  Mode: ${DRY_RUN ? "DRY RUN (no changes)" : "LIVE"}`);
  console.log("═══════════════════════════════════════════════════════════");

  // Find all unique capitalized selections
  console.log("\n🔍 Finding capitalized selections...");

  let allSelections = [];
  let offset = 0;
  const limit = 1000;

  while (offset < 200000) {
    const { data, error } = await sb
      .from("predictions")
      .select("id, selection")
      .range(offset, offset + limit - 1);

    if (error || !data || data.length === 0) break;

    for (const row of data) {
      if (row.selection !== row.selection?.toLowerCase() && row.selection?.length > 1) {
        allSelections.push({ id: row.id, old: row.selection, new: row.selection.toLowerCase() });
      }
    }

    if (data.length < limit) break;
    offset += limit;
    process.stdout.write(`  Scanned ${offset} rows...\r`);
  }

  console.log(`\n  Found ${allSelections.length} capitalized selections`);

  if (allSelections.length === 0) {
    console.log("\n  ✅ All selections already lowercase. Nothing to do.");
    return;
  }

  // Show breakdown
  const types = {};
  allSelections.forEach((s) => {
    types[s.old] = (types[s.old] || 0) + 1;
  });
  console.log("\n  Breakdown:");
  Object.entries(types)
    .sort((a, b) => b[1] - a[1])
    .forEach(([k, v]) => console.log(`    ${k.padEnd(15)} → ${k.toLowerCase().padEnd(15)} (${v})`));

  if (DRY_RUN) {
    console.log("\n  [DRY RUN] Would update", allSelections.length, "rows");
    return;
  }

  // Batch update
  console.log("\n💾 Updating in batches of 100...");
  let updated = 0;
  let failed = 0;

  for (let i = 0; i < allSelections.length; i += 100) {
    const batch = allSelections.slice(i, i + 100);

    // Update each row individually (Supabase doesn't support bulk UPDATE with different values)
    for (const row of batch) {
      const { error } = await sb
        .from("predictions")
        .update({ selection: row.new })
        .eq("id", row.id);

      if (error) {
        failed++;
      } else {
        updated++;
      }
    }

    process.stdout.write(`  Updated ${Math.min(i + 100, allSelections.length)}/${allSelections.length}...\r`);
  }

  console.log(`\n\n  ✅ Updated: ${updated}`);
  if (failed > 0) console.log(`  ❌ Failed: ${failed}`);

  // Verify
  console.log("\n🔍 Verifying...");
  let remaining = 0;
  offset = 0;
  while (offset < 200000) {
    const { data } = await sb
      .from("predictions")
      .select("selection")
      .range(offset, offset + limit - 1);

    if (!data || data.length === 0) break;
    remaining += data.filter(
      (r) => r.selection !== r.selection?.toLowerCase() && r.selection?.length > 1
    ).length;
    if (data.length < limit) break;
    offset += limit;
  }

  console.log(`  Remaining capitalized: ${remaining}`);
  console.log(remaining === 0 ? "\n  ✅ All selections normalized!" : "\n  ⚠️  Some selections still capitalized");
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
