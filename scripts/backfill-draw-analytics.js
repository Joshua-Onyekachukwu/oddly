/**
 * backfill-draw-analytics.js
 *
 * Fixes the case-sensitivity bug in draw analytics:
 * - Normalizes 1X2 selection values from 'Home'/'Draw'/'Away' to lowercase
 * - Refreshes all draw materialized views
 * - Reports backfill results
 *
 * Usage: node scripts/backfill-draw-analytics.js
 */

const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");

// Load env
const env = {};
fs.readFileSync(".env.local", "utf8")
  .split("\n")
  .forEach((l) => {
    const [k, ...v] = l.split("=");
    if (k && !k.startsWith("#") && v.length)
      env[k.trim()] = v
        .join("=")
        .trim()
        .replace(/^"|"$/g, "");
  });

const sb = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY
);

async function backfill() {
  console.log("=== BACKFILL DRAW ANALYTICS ===\n");

  // 1. Check current selection values
  console.log("Step 1: Checking current selection values...");
  const { data: sample } = await sb
    .from("predictions")
    .select("selection")
    .eq("market", "1X2")
    .in("result", ["correct", "wrong"])
    .limit(5000);

  const beforeCounts = {};
  for (const s of sample || []) {
    beforeCounts[s.selection] = (beforeCounts[s.selection] || 0) + 1;
  }
  console.log("  Before normalization:", JSON.stringify(beforeCounts));

  // 2. Update selection to lowercase for all 1X2 predictions
  //    (Supabase doesn't support raw SQL updates, so we need to do it in batches)
  console.log("\nStep 2: Normalizing selection casing...");

  // Get all 1X2 predictions that need fixing
  const needsFix = Object.keys(beforeCounts).filter(
    (k) => k !== k.toLowerCase() && k.toLowerCase() === k
  );

  // Actually, we need to find all predictions where selection is capitalized
  let totalUpdated = 0;
  const capitalizeMap = {
    Home: "home",
    Draw: "draw",
    Away: "away",
  };

  for (const [from, to] of Object.entries(capitalizeMap)) {
    // Get all predictions with this capitalized selection
    const { data: preds, error: fetchErr } = await sb
      .from("predictions")
      .select("id, selection")
      .eq("market", "1X2")
      .eq("selection", from)
      .limit(50000);

    if (fetchErr) {
      console.error("  Fetch error:", fetchErr.message);
      continue;
    }

    if (!preds || preds.length === 0) {
      console.log(`  No '${from}' selections to fix`);
      continue;
    }

    console.log(`  Found ${preds.length} '${from}' selections to normalize to '${to}'`);

    // Update in batches of 50
    let updated = 0;
    for (let i = 0; i < preds.length; i += 50) {
      const batch = preds.slice(i, i + 50);
      const ids = batch.map((p) => p.id);

      const { error: updateErr } = await sb
        .from("predictions")
        .update({ selection: to })
        .in("id", ids);

      if (updateErr) {
        console.error(`  Update batch error: ${updateErr.message}`);
      } else {
        updated += batch.length;
      }
    }

    console.log(`  Updated ${updated}/${preds.length} from '${from}' to '${to}'`);
    totalUpdated += updated;
  }

  console.log(`\n  Total selections normalized: ${totalUpdated}`);

  // 3. Verify normalization
  console.log("\nStep 3: Verifying normalization...");
  const { data: afterSample } = await sb
    .from("predictions")
    .select("selection")
    .eq("market", "1X2")
    .in("result", ["correct", "wrong"])
    .limit(5000);

  const afterCounts = {};
  for (const s of afterSample || []) {
    afterCounts[s.selection] = (afterCounts[s.selection] || 0) + 1;
  }
  console.log("  After normalization:", JSON.stringify(afterCounts));

  // 4. Check draw-specific stats
  const drawCount = afterCounts["draw"] || 0;
  const homeCount = afterCounts["home"] || 0;
  const awayCount = afterCounts["away"] || 0;
  console.log(`  Draw predictions: ${drawCount}`);
  console.log(`  Home predictions: ${homeCount}`);
  console.log(`  Away predictions: ${awayCount}`);

  // 5. Get total settled 1X2 from all records
  const { count: totalSettled } = await sb
    .from("predictions")
    .select("*", { count: "exact", head: true })
    .eq("market", "1X2")
    .in("result", ["correct", "wrong"]);
  console.log(`  Total settled 1X2 (all records): ${totalSettled}`);

  // 6. Refresh materialized views
  console.log("\nStep 4: Refreshing materialized views...");
  const startRefresh = Date.now();
  const { error: refreshErr } = await sb.rpc("refresh_draw_views");
  if (refreshErr) {
    console.error("  refresh_draw_views failed:", refreshErr.message);
    console.log("  Trying refresh_analytics_views instead...");
    const { error: refreshErr2 } = await sb.rpc("refresh_analytics_views");
    if (refreshErr2) {
      console.error("  refresh_analytics_views also failed:", refreshErr2.message);
    } else {
      console.log(`  All views refreshed (${Date.now() - startRefresh}ms)`);
    }
  } else {
    console.log(`  Draw views refreshed (${Date.now() - startRefresh}ms)`);
  }

  // 7. Verify draw views populated
  console.log("\nStep 5: Verifying draw analytics...");

  const { data: dp } = await sb.from("mv_draw_performance").select("*");
  console.log("\n  === DRAW PERFORMANCE BY LEAGUE ===");
  if (dp && dp.length > 0) {
    for (const r of dp) {
      const drawPct =
        r.predicted_draws > 0
          ? ((r.correct_draws / r.predicted_draws) * 100).toFixed(1)
          : "0.0";
      console.log(
        `  ${r.league_name}: ${r.total_predictions} total, ` +
          `${r.actual_draws} actual draws, ` +
          `${r.predicted_draws} predicted draws, ` +
          `${r.correct_draws} correct (${drawPct}% precision)`
      );
    }
  } else {
    console.log("  WARNING: No draw performance data");
  }

  const { data: db } = await sb
    .from("mv_draw_probability_buckets")
    .select("*");
  console.log("\n  === DRAW CALIBRATION BUCKETS ===");
  if (db && db.length > 0) {
    for (const b of db) {
      console.log(
        `  ${b.prob_bucket}: ${b.total_matches} matches, ` +
          `${b.actual_draws} actual draws, ` +
          `obs_rate=${b.observed_draw_rate}, ` +
          `avg_pred=${b.avg_predicted_draw_prob}`
      );
    }
  } else {
    console.log("  WARNING: No calibration bucket data");
  }

  const { data: dt } = await sb.from("mv_draw_trend").select("*");
  console.log("\n  === DRAW TREND ===");
  if (dt && dt.length > 0) {
    for (const t of dt.slice(-5)) {
      console.log(
        `  ${t.week}: ${t.total_predictions} total, ` +
          `${t.actual_draws} actual, ${t.predicted_draws} predicted, ` +
          `${t.correct_draws} correct`
      );
    }
  } else {
    console.log("  WARNING: No trend data");
  }

  // 8. Summary
  console.log("\n=== BACKFILL COMPLETE ===");
  console.log(`Selections normalized: ${totalUpdated}`);
  console.log(
    `Draw performance leagues: ${(dp || []).length}`
  );
  console.log(
    `Calibration buckets: ${(db || []).length}`
  );
  console.log(`Trend weeks: ${(dt || []).length}`);
}

backfill().catch((e) => console.error("FATAL:", e));
