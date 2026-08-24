/**
 * Convex Hybrid Data Access Layer
 * 
 * Routes queries to the right database:
 * - Supabase: Auth, real-time, recent/unsettled predictions, user-facing queries
 * - Convex: Historical data, analytics, ML training, cold storage
 * 
 * Usage:
 *   const { getRecentPredictions, getHistoricalPredictions } = require('../convex/data-layer');
 *   const recent = await getRecentPredictions({ market: '1X2', limit: 50 });
 *   const historical = await getHistoricalPredictions({ market: '1X2', limit: 5000 });
 */

const { createClient } = require('@supabase/supabase-js');
const { convexQuery, convexMutation } = require('./connection');
const fs = require('fs');
const path = require('path');

// ─── Configuration ─────────────────────────────────────────

function loadEnv() {
  const env = {};
  for (const line of fs.readFileSync(path.join(__dirname, '../../.env.local'), 'utf8').split('\n')) {
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
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

// ─── Hot Data (Supabase) ───────────────────────────────────
// Auth, real-time, recent predictions, user-facing queries

/**
 * Get upcoming fixtures for the UI (from Supabase)
 */
async function getUpcomingFixtures({ dateRange, limit = 500 } = {}) {
  let query = supabase
    .from('fixtures')
    .select('*, leagues(name, country, logo), home_team:teams!fixtures_home_team_id_fkey(canonical_name, logo), away_team:teams!fixtures_away_team_id_fkey(canonical_name, logo), predictions(market, selection, model_probability, confidence_lower, confidence_upper)')
    .eq('status', 'scheduled')
    .order('kickoff_time', { ascending: true })
    .limit(limit);
  
  if (dateRange) {
    query = query.gte('kickoff_time', dateRange.from).lte('kickoff_time', dateRange.to);
  }
  
  const { data, error } = await query;
  return { data: data || [], error };
}

/**
 * Get recent predictions for the UI (from Supabase)
 */
async function getRecentPredictions({ market, limit = 100 } = {}) {
  let query = supabase
    .from('predictions')
    .select('*, fixtures(home_team:teams!fixtures_home_team_id_fkey(canonical_name), away_team:teams!fixtures_away_team_id_fkey(canonical_name), kickoff_time, leagues(name))')
    .order('created_at', { ascending: false })
    .limit(limit);
  
  if (market) query = query.eq('market', market);
  
  const { data, error } = await query;
  return { data: data || [], error };
}

/**
 * Get unsettled predictions for settlement (from Supabase)
 */
async function getUnsettledPredictions({ limit = 5000 } = {}) {
  const { data, error } = await supabase
    .from('predictions')
    .select('id, fixture_id, market, selection, model_probability, model_version')
    .is('result', null)
    .limit(limit);
  
  return { data: data || [], error };
}

/**
 * Write prediction result to Supabase
 */
async function updatePredictionResult(predictionId, result, actualOutcome) {
  const { error } = await supabase
    .from('predictions')
    .update({ result, actual_outcome: actualOutcome, settled_at: new Date().toISOString() })
    .eq('id', predictionId);
  
  return { error };
}

// ─── Cold Data (Convex) ────────────────────────────────────
// Historical data, analytics, ML training

/**
 * Get historical predictions for model training (from Convex)
 */
async function getHistoricalPredictions({ market, limit = 10000, result, minProb, maxProb } = {}) {
  const data = await convexQuery('predictions:getHistoricalPredictions', {
    market,
    limit,
    result,
    minProb,
    maxProb,
  });
  
  return { data: data || [], error: null };
}

/**
 * Get accuracy by market from historical data (from Convex)
 */
async function getMarketAccuracy() {
  const data = await convexQuery('predictions:getMarketAccuracy');
  return data || [];
}

/**
 * Get calibration buckets from historical data (from Convex)
 */
async function getCalibrationBuckets() {
  const data = await convexQuery('predictions:getCalibrationBuckets');
  return data || [];
}

/**
 * Get per-league accuracy (from Convex via predictions + fixtures join)
 */
async function getLeagueAccuracy({ limit = 20 } = {}) {
  // Convex doesn't have SQL JOIN, so we'll compute this client-side
  const predictions = await convexQuery('predictions:getHistoricalPredictions', {
    result: 'correct',
    limit: 100000,
  });
  
  const wrongPredictions = await convexQuery('predictions:getHistoricalPredictions', {
    result: 'wrong',
    limit: 100000,
  });
  
  // Group by league (would need fixture lookup)
  // For now, return market-level accuracy
  const accuracy = await convexQuery('predictions:getMarketAccuracy');
  return accuracy?.slice(0, limit) || [];
}

/**
 * Get xG features for a team (from Convex)
 */
async function getTeamXG(teamName) {
  const data = await convexQuery('predictions:getXgByTeam', { teamName });
  return data;
}

/**
 * Get referee profile (from Convex)
 */
async function getRefereeProfile(refereeName) {
  const data = await convexQuery('predictions:getRefereeByName', { name: refereeName });
  return data;
}

/**
 * Get referee ranking (from Convex)
 */
async function getRefereeRanking({ sortBy, limit = 50 } = {}) {
  const data = await convexQuery('predictions:getRefereeRanking', { sortBy, limit });
  return data || [];
}

/**
 * Store a completed prediction to Convex (cold storage)
 */
async function archivePrediction(prediction) {
  const result = await convexMutation('predictions:archivePrediction', {
    fixtureId: prediction.fixture_id,
    market: prediction.market,
    selection: prediction.selection,
    modelProbability: prediction.model_probability,
    confidenceLower: prediction.confidence_lower,
    confidenceUpper: prediction.confidence_upper,
    modelVersion: prediction.model_version,
    poissonProb: prediction.poisson_prob,
    eloProb: prediction.elo_prob,
    regressionProb: prediction.regression_prob,
    xgAdjustedProb: prediction.xg_adjusted_prob,
    bookmakerOdds: prediction.bookmaker_odds,
    impliedProbability: prediction.implied_probability,
    edge: prediction.edge,
    result: prediction.result,
    actualOutcome: prediction.actual_outcome,
    settledAt: prediction.settled_at,
  });
  
  return { error: result ? null : new Error('Archive failed') };
}

/**
 * Batch archive predictions to Convex
 */
async function archiveBatch(predictions) {
  const batch = predictions.map((p) => ({
    fixtureId: p.fixture_id,
    market: p.market,
    selection: p.selection,
    modelProbability: p.model_probability,
    modelVersion: p.model_version,
    result: p.result,
    actualOutcome: p.actual_outcome,
    settledAt: p.settled_at,
  }));
  
  const result = await convexMutation('predictions:archiveBatch', { predictions: batch });
  return { error: result ? null : new Error('Batch archive failed'), count: result?.count || 0 };
}

/**
 * Get training data for model training (from Convex)
 */
async function getTrainingData({ market, limit = 50000 } = {}) {
  const data = await convexQuery('predictions:getHistoricalPredictions', {
    market,
    limit,
    result: undefined, // Get all
  });
  
  return { data: data || [], error: null };
}

/**
 * Get value picks from historical analysis (from Convex)
 */
async function getValuePicks({ tier, market, limit = 100 } = {}) {
  const data = await convexQuery('predictions:getValuePicks', { tier, market, limit });
  return { data: data || [], error: null };
}

/**
 * Get database statistics
 */
async function getStats() {
  // Supabase stats
  const [predCount, fixCount, settCount] = await Promise.all([
    supabase.from('predictions').select('id', { count: 'exact', head: true }),
    supabase.from('fixtures').select('id', { count: 'exact', head: true }),
    supabase.from('predictions').select('id', { count: 'exact', head: true }).not('result', 'is', null),
  ]);
  
  // Convex stats
  const convexStats = await convexQuery('predictions:getStats');
  
  return {
    supabase: {
      predictions: predCount.count || 0,
      fixtures: fixCount.count || 0,
      settled: settCount.count || 0,
    },
    convex: convexStats || {},
  };
}

module.exports = {
  // Hot (Supabase)
  getUpcomingFixtures,
  getRecentPredictions,
  getUnsettledPredictions,
  updatePredictionResult,
  
  // Cold (Convex)
  getHistoricalPredictions,
  getMarketAccuracy,
  getCalibrationBuckets,
  getLeagueAccuracy,
  getTeamXG,
  getRefereeProfile,
  getRefereeRanking,
  archivePrediction,
  archiveBatch,
  getTrainingData,
  getValuePicks,
  
  // Both
  getStats,
  
  // Expose for direct access
  supabase,
};
