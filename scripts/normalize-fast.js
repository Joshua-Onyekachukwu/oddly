#!/usr/bin/env node

/**
 * Fast batch normalize: Home→home, Away→away, Draw→draw
 * Uses bulk updates with concurrency control.
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

async function updateBatch(updates) {
  const promises = updates.map(({ id, selection }) =>
    sb.from("predictions").update({ selection }).eq("id", id)
  );
  const results = await Promise.allSettled(promises);
  return results.filter((r) => r.status === "fulfilled" && !r.value.error).length;
}

async function main() {
  console.log("Fast normalize: Home/Away/Draw → lowercase\n");

  // Step 1: Find all IDs that need updating (3 targeted queries)
  const targets = [
    { old: "Home", new: "home" },
    { old: "Away", new: "away" },
    { old: "Draw", new: "draw" },
  ];

  const allUpdates = [];
  for (const t of targets) {
    let offset = 0;
    while (true) {
      const { data, error } = await sb
        .from("predictions")
        .select("id")
        .eq("selection", t.old)
        .range(offset, offset + 999);

      if (error || !data || data.length === 0) break;
      data.forEach((r) => allUpdates.push({ id: r.id, selection: t.new }));
      if (data.length < 1000) break;
      offset += 1000;
    }
    console.log(`  ${t.old} → ${t.new}: found ${allUpdates.filter((u) => u.selection === t.new).length} rows`);
  }

  console.log(`\n  Total to update: ${allUpdates.length}`);

  // Step 2: Batch update with concurrency
  const BATCH = 50;
  let updated = 0;
  for (let i = 0; i < allUpdates.length; i += BATCH) {
    const batch = allUpdates.slice(i, i + BATCH);
    const count = await updateBatch(batch);
    updated += count;
    process.stdout.write(`  Updated ${Math.min(i + BATCH, allUpdates.length)}/${allUpdates.length} (${updated} ok)\r`);
  }

  console.log(`\n\n  ✅ Done! Updated ${updated}/${allUpdates.length} rows`);

  // Step 3: Verify
  const { count } = await sb
    .from("predictions")
    .select("id", { count: "exact", head: true })
    .or("selection.eq.Home,selection.eq.Away,selection.eq.Draw");

  console.log(`  Remaining uppercase: ${count || 0}`);
}

main().catch(console.error);
