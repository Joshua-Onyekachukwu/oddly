#!/usr/bin/env node
/**
 * Backfill model_performance from settled predictions
 * 
 * Reads all settled predictions from Supabase and writes aggregated
 * accuracy records to model_performance (one per market).
 * 
 * Usage: node worker/backfill-model-performance.js
 */

const fs = require('fs');
const path = require('path');

function loadEnv() {
  const env = {};
  for (const line of fs.readFileSync(path.join(__dirname, '../.env.local'), 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    env[key] = val;
  }
  return env;
}

const env = loadEnv();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

// ─── Market outcome calculation ─────────────────────────────

function calculateOutcome(market, selection, homeScore, awayScore) {
  if (homeScore === null || awayScore === null) return null;
  
  const m = market.toLowerCase();
  const s = selection;
  const totalGoals = homeScore + awayScore;
  const matchResult = homeScore > awayScore ? 'Home' : homeScore < awayScore ? 'Away' : 'Draw';
  
  // 1X2 / Match Result
  if (m === '1x2' || m === 'match_result' || m === 'h2h') {
    return s === matchResult;
  }
  
  // Over/Under
  if (m.startsWith('ou_over') || m.startsWith('ou_under') || m === 'totals') {
    const isOver = s.toLowerCase().includes('over') || m.includes('over');
    const lineMatch = m.match(/(\d+\.?\d*)/);
    const line = lineMatch ? parseFloat(lineMatch[1]) : 2.5;
    return isOver ? totalGoals > line : totalGoals < line;
  }
  
  // BTTS
  if (m === 'btts' || m.includes('btts')) {
    const bothScored = homeScore > 0 && awayScore > 0;
    return s.toLowerCase().includes('yes') ? bothScored : !bothScored;
  }
  
  // Double Chance
  if (m.startsWith('dc_')) {
    if (m.includes('home') || m.includes('1x')) return homeScore >= awayScore;
    if (m.includes('away') || m.includes('x2')) return awayScore >= homeScore;
    if (m.includes('12')) return homeScore !== awayScore;
  }
  
  return null;
}

function logLoss(predicted, actual) {
  const p = Math.max(0.001, Math.min(0.999, predicted));
  return actual ? -Math.log(p) : -Math.log(1 - p);
}

function brierScore(predicted, actual) {
  return (predicted - (actual ? 1 : 0)) ** 2;
}

// ─── Main ──────────────────────────────────────────────────

async function main() {
  console.log('🔄 Backfilling model_performance from settled predictions...\n');
  
  // Step 1: Get all settled predictions with fixture data
  console.log('1️⃣  Fetching settled predictions...');
  
  const BATCH = 2000;
  let offset = 0;
  let totalFetched = 0;
  const marketStats = {};
  const tierStats = {};
  
  while (true) {
    const { data, error } = await supabase
      .from('predictions')
      .select(`
        id, market, selection, model_probability, result,
        fixtures (home_score, away_score, status, league_id, kickoff_time)
      `)
      .not('result', 'is', null)
      .order('created_at', { ascending: true })
      .range(offset, offset + BATCH - 1);
    
    if (error) {
      console.error('   ❌ Query error:', error.message);
      break;
    }
    
    if (!data || data.length === 0) break;
    
    for (const pred of data) {
      const fixture = pred.fixtures;
      if (!fixture || !fixture.home_score === null) continue;
      
      const outcome = calculateOutcome(pred.market, pred.selection, fixture.home_score, fixture.away_score);
      if (outcome === null) continue;
      
      const ll = logLoss(pred.model_probability, outcome);
      const bs = brierScore(pred.model_probability, outcome);
      const isCorrect = pred.result === 'correct';
      
      // Aggregate by market
      if (!marketStats[pred.market]) {
        marketStats[pred.market] = { correct: 0, total: 0, logLossSum: 0, brierSum: 0 };
      }
      marketStats[pred.market].total++;
      if (isCorrect) marketStats[pred.market].correct++;
      marketStats[pred.market].logLossSum += ll;
      marketStats[pred.market].brierSum += bs;
      
      // Aggregate by confidence tier
      const tier = pred.model_probability >= 0.8 ? 'very_high' :
                   pred.model_probability >= 0.65 ? 'high' :
                   pred.model_probability >= 0.5 ? 'medium' : 'low';
      if (!tierStats[tier]) tierStats[tier] = { correct: 0, total: 0 };
      tierStats[tier].total++;
      if (isCorrect) tierStats[tier].correct++;
    }
    
    totalFetched += data.length;
    offset += BATCH;
    process.stdout.write(`   Fetched ${totalFetched.toLocaleString()} settled predictions\r`);
  }
  
  console.log(`\n   ✅ ${totalFetched.toLocaleString()} settled predictions processed`);
  
  // Step 2: Write aggregated records to model_performance
  console.log('\n2️⃣  Writing aggregated model_performance records...');
  
  // Clear existing data
  await supabase.from('model_performance').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  
  const records = [];
  
  // Market-level records
  for (const [market, stats] of Object.entries(marketStats)) {
    records.push({
      model_version: 'v5.1',
      market,
      total_predictions: stats.total,
      correct_predictions: stats.correct,
      brier_score: Number((stats.brierSum / stats.total).toFixed(4)),
      calibration_data: {
        avg_log_loss: Number((stats.logLossSum / stats.total).toFixed(4)),
        avg_brier: Number((stats.brierSum / stats.total).toFixed(4)),
        accuracy_pct: Number(((stats.correct / stats.total) * 100).toFixed(1)),
        tracked_at: new Date().toISOString(),
        source: 'backfill',
      },
    });
  }
  
  // Tier-level records
  for (const [tier, stats] of Object.entries(tierStats)) {
    records.push({
      model_version: `tier_${tier}`,
      market: 'ALL',
      total_predictions: stats.total,
      correct_predictions: stats.correct,
      brier_score: 0,
      calibration_data: {
        accuracy_pct: Number(((stats.correct / stats.total) * 100).toFixed(1)),
        tier,
        tracked_at: new Date().toISOString(),
        source: 'backfill',
      },
    });
  }
  
  // Overall record
  const totalCorrect = Object.values(marketStats).reduce((sum, s) => sum + s.correct, 0);
  const totalPreds = Object.values(marketStats).reduce((sum, s) => sum + s.total, 0);
  const totalLL = Object.values(marketStats).reduce((sum, s) => sum + s.logLossSum, 0);
  const totalBS = Object.values(marketStats).reduce((sum, s) => sum + s.brierSum, 0);
  
  records.push({
    model_version: 'v5.1',
    market: 'OVERALL',
    total_predictions: totalPreds,
    correct_predictions: totalCorrect,
    brier_score: totalPreds > 0 ? Number((totalBS / totalPreds).toFixed(4)) : 0,
    calibration_data: {
      avg_log_loss: totalPreds > 0 ? Number((totalLL / totalPreds).toFixed(4)) : 0,
      avg_brier: totalPreds > 0 ? Number((totalBS / totalPreds).toFixed(4)) : 0,
      accuracy_pct: totalPreds > 0 ? Number(((totalCorrect / totalPreds) * 100).toFixed(1)) : 0,
      total_markets: Object.keys(marketStats).length,
      tracked_at: new Date().toISOString(),
      source: 'backfill',
    },
  });
  
  // Batch insert (Supabase limit ~1000 per request)
  for (let i = 0; i < records.length; i += 500) {
    const batch = records.slice(i, i + 500);
    const { error } = await supabase.from('model_performance').insert(batch);
    if (error) {
      console.error('   ❌ Insert error:', error.message);
    }
  }
  
  console.log(`   ✅ ${records.length} model_performance records written`);
  
  // Step 3: Print summary
  console.log('\n📊 Backfill Summary:');
  console.log('═══════════════════════════════════════');
  console.log(`Total predictions: ${totalPreds.toLocaleString()}`);
  console.log(`Correct: ${totalCorrect.toLocaleString()}`);
  console.log(`Overall accuracy: ${totalPreds > 0 ? ((totalCorrect / totalPreds) * 100).toFixed(1) : 0}%`);
  console.log(`Avg log loss: ${totalPreds > 0 ? (totalLL / totalPreds).toFixed(4) : 0}`);
  console.log(`Avg Brier score: ${totalPreds > 0 ? (totalBS / totalPreds).toFixed(4) : 0}`);
  console.log('\nMarket Breakdown:');
  for (const [market, stats] of Object.entries(marketStats).sort((a, b) => b[1].total - a[1].total)) {
    const acc = ((stats.correct / stats.total) * 100).toFixed(1);
    console.log(`  ${market.padEnd(20)} ${String(stats.total).padStart(6)} preds  ${acc}% accuracy`);
  }
  console.log('\nConfidence Tiers:');
  for (const [tier, stats] of Object.entries(tierStats)) {
    const acc = ((stats.correct / stats.total) * 100).toFixed(1);
    console.log(`  ${tier.padEnd(12)} ${String(stats.total).padStart(6)} preds  ${acc}% accuracy`);
  }
  console.log('═══════════════════════════════════════');
}

main().catch(err => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
