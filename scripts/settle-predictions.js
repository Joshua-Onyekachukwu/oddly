#!/usr/bin/env node

/**
 * Settlement Engine — evaluates predictions against actual match results
 * Updates the `result` column: "correct" or "incorrect"
 */

const { createClient } = require("@supabase/supabase-js");

const s = createClient(
  "https://ulelicrbgicgnhmuulup.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVsZWxpY3JiZ2ljZ25obXV1bHVwIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NzA0ODU1NCwiZXhwIjoyMTAyNjI0NTU0fQ.8Ku5TIXU04kWZAW2N_qQYSA9grTlq3btoTAUNmEC8L0"
);

function isCorrect(market, selection, homeScore, awayScore) {
  const total = homeScore + awayScore;
  const sel = (selection || "").toLowerCase();
  const mkt = (market || "").toLowerCase();

  // 1X2
  if (mkt === "1x2") {
    if (sel === "home" || sel === "1") return homeScore > awayScore;
    if (sel === "draw" || sel === "x") return homeScore === awayScore;
    if (sel === "away" || sel === "2") return homeScore < awayScore;
  }

  // Double Chance
  if (mkt === "dc") {
    if (sel === "1x" || sel === "home_draw") return homeScore >= awayScore;
    if (sel === "x2" || sel === "draw_away") return homeScore <= awayScore;
    if (sel === "12" || sel === "home_away") return homeScore !== awayScore;
  }

  // Draw No Bet
  if (mkt === "dnb") {
    if (sel === "home") return homeScore > awayScore; // draw = void (treat as incorrect for simplicity)
    if (sel === "away") return awayScore > homeScore;
  }

  // Over/Under
  if (mkt === "ou") {
    const isOver = sel.startsWith("over_");
    const line = parseFloat(sel.replace("over_", "").replace("under_", ""));
    if (isNaN(line)) return false;
    if (isOver) return total > line;
    return total < line;
  }

  // BTTS
  if (mkt === "btts") {
    const bothScored = homeScore > 0 && awayScore > 0;
    if (sel === "yes" || sel === "btts_yes") return bothScored;
    if (sel === "no" || sel === "btts_no") return !bothScored;
  }

  return false;
}

async function main() {
  const startTime = Date.now();
  console.log("🔄 Settlement Engine Starting...");

  // 1. Get finished fixtures with scores
  const { data: fixtures, count: fixCount } = await s
    .from("fixtures")
    .select("id, home_score, away_score", { count: "exact" })
    .eq("status", "finished")
    .not("home_score", "is", null);

  console.log(`📊 Found ${fixCount} finished fixtures with scores`);

  if (!fixtures?.length) {
    console.log("No finished fixtures to settle against.");
    return;
  }

  let totalSettled = 0;
  let totalCorrect = 0;
  let totalIncorrect = 0;
  let fixtureIdx = 0;

  for (const fixture of fixtures) {
    fixtureIdx++;

    // Get all unsettled predictions for this fixture
    const { data: preds } = await s
      .from("predictions")
      .select("id, market, selection, model_probability")
      .eq("fixture_id", fixture.id)
      .eq("result", "pending");

    if (!preds?.length) continue;

    const homeScore = fixture.home_score;
    const awayScore = fixture.away_score;
    const batch = [];

    for (const p of preds) {
      const correct = isCorrect(p.market, p.selection, homeScore, awayScore);
      batch.push({
        id: p.id,
        result: correct ? "correct" : "incorrect",
        settled_at: new Date().toISOString(),
      });
      totalSettled++;
      if (correct) totalCorrect++;
      else totalIncorrect++;
    }

    // Batch update (50 at a time)
    for (let i = 0; i < batch.length; i += 50) {
      const chunk = batch.slice(i, i + 50);
      for (const item of chunk) {
        await s
          .from("predictions")
          .update({ result: item.result, settled_at: item.settled_at })
          .eq("id", item.id);
      }
    }

    if (fixtureIdx % 100 === 0) {
      console.log(
        `  ✅ ${fixtureIdx}/${fixtures.length} fixtures — ${totalSettled} settled (${totalCorrect} correct, ${totalIncorrect} incorrect)`
      );
    }
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  const accuracy = totalSettled > 0 ? ((totalCorrect / totalSettled) * 100).toFixed(1) : "N/A";
  console.log(`\n✅ Settlement complete in ${duration}s`);
  console.log(`   Total settled: ${totalSettled}`);
  console.log(`   Correct: ${totalCorrect}`);
  console.log(`   Incorrect: ${totalIncorrect}`);
  console.log(`   Accuracy: ${accuracy}%`);
}

main().catch((e) => {
  console.error("❌ Fatal:", e.message);
  process.exit(1);
});
