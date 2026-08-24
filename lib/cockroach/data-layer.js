/**
 * Hybrid Data Access Layer
 * 
 * Routes queries to the right database:
 * - Supabase: Auth, real-time, recent/unsettled predictions, user-facing queries
 * - CockroachDB: Historical data, analytics, ML training, cold storage
 * 
 * Usage:
 *   const { getRecentPredictions, getHistoricalPredictions } = require('../cockroach/data-layer');
 *   const recent = await getRecentPredictions({ market: '1X2', limit: 50 });
 *   const historical = await getHistoricalPredictions({ market: '1X2', limit: 5000 });
 */

const { Pool } = require('pg');
const { createClient } = require('@supabase/supabase-js');
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

let cockroachPool = null;

function getCockroach() {
  if (cockroachPool) return cockroachPool;
  
  const url = env.COCKROACHDB_URL;
  if (!url) return null;
  
  cockroachPool = new Pool({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
    max: 5,
    idleTimeoutMillis: 30000,
  });
  
  return cockroachPool;
}

async function cockroachQuery(text, params) {
  const pool = getCockroach();
  if (!pool) return { rows: [], error: new Error('CockroachDB not configured') };
  
  try {
    const result = await pool.query(text, params);
    return { rows: result.rows, error: null };
  } catch (err) {
    console.error('[CockroachDB] Query error:', err.message);
    return { rows: [], error: err };
  }
}

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

// ─── Cold Data (CockroachDB) ───────────────────────────────
// Historical data, analytics, ML training

/**
 * Get historical predictions for model training (from CockroachDB)
 */
async function getHistoricalPredictions({ market, limit = 10000, result, minProb, maxProb } = {}) {
  let query = `SELECT * FROM cockroach_predictions WHERE 1=1`;
  const params = [];
  let paramIdx = 1;
  
  if (market) { query += ` AND market = $${paramIdx++}`; params.push(market); }
  if (result) { query += ` AND result = $${paramIdx++}`; params.push(result); }
  if (minProb) { query += ` AND model_probability >= $${paramIdx++}`; params.push(minProb); }
  if (maxProb) { query += ` AND model_probability <= $${paramIdx++}`; params.push(maxProb); }
  
  query += ` ORDER BY created_at DESC LIMIT $${paramIdx}`;
  params.push(limit);
  
  const { rows, error } = await cockroachQuery(query, params);
  return { data: rows || [], error };
}

/**
 * Get accuracy by market from historical data (from CockroachDB)
 */
async function getMarketAccuracy() {
  const { rows } = await cockroachQuery(`
    SELECT 
      market,
      COUNT(*) as total,
      SUM(CASE WHEN result = 'correct' THEN 1 ELSE 0 END) as correct,
      ROUND(AVG(CASE WHEN result = 'correct' THEN 1.0 ELSE 0.0 END) * 100, 1) as accuracy,
      ROUND(AVG(model_probability), 3) as avg_confidence,
      COUNT(DISTINCT model_version) as model_versions
    FROM cockroach_predictions
    WHERE result IN ('correct', 'wrong')
    GROUP BY market
    ORDER BY total DESC
  `);
  
  return rows || [];
}

/**
 * Get calibration buckets from historical data (from CockroachDB)
 */
async function getCalibrationBuckets() {
  const { rows } = await cockroachQuery(`
    SELECT 
      CASE 
        WHEN model_probability < 0.50 THEN '40-49%'
        WHEN model_probability < 0.55 THEN '50-54%'
        WHEN model_probability < 0.60 THEN '55-59%'
        WHEN model_probability < 0.65 THEN '60-64%'
        WHEN model_probability < 0.70 THEN '65-69%'
        WHEN model_probability < 0.75 THEN '70-74%'
        WHEN model_probability < 0.80 THEN '75-79%'
        WHEN model_probability < 0.85 THEN '80-84%'
        WHEN model_probability < 0.90 THEN '85-89%'
        ELSE '90%+'
      END as bucket,
      COUNT(*) as total,
      SUM(CASE WHEN result = 'correct' THEN 1 ELSE 0 END) as correct,
      ROUND(AVG(CASE WHEN result = 'correct' THEN 1.0 ELSE 0.0 END) * 100, 1) as actual_accuracy,
      ROUND(AVG(model_probability) * 100, 1) as avg_predicted
    FROM cockroach_predictions
    WHERE result IN ('correct', 'wrong')
    GROUP BY bucket
    ORDER BY MIN(model_probability)
  `);
  
  return rows || [];
}

/**
 * Get per-league accuracy (from CockroachDB)
 */
async function getLeagueAccuracy({ limit = 20 } = {}) {
  const { rows } = await cockroachQuery(`
    SELECT 
      f.league_name as league,
      COUNT(*) as total,
      SUM(CASE WHEN p.result = 'correct' THEN 1 ELSE 0 END) as correct,
      ROUND(AVG(CASE WHEN p.result = 'correct' THEN 1.0 ELSE 0.0 END) * 100, 1) as accuracy
    FROM cockroach_predictions p
    JOIN cockroach_fixtures f ON p.fixture_id = f.id
    WHERE p.result IN ('correct', 'wrong')
    GROUP BY f.league_name
    ORDER BY total DESC
    LIMIT $1
  `, [limit]);
  
  return rows || [];
}

/**
 * Get xG features for a team (from CockroachDB)
 */
async function getTeamXG(teamName) {
  const { rows } = await cockroachQuery(
    `SELECT * FROM cockroach_xg_features WHERE LOWER(team_name) LIKE $1 ORDER BY created_at DESC LIMIT 1`,
    [`%${teamName.toLowerCase()}%`]
  );
  
  return rows?.[0] || null;
}

/**
 * Get referee profile (from CockroachDB)
 */
async function getRefereeProfile(refereeName) {
  const { rows } = await cockroachQuery(
    `SELECT * FROM cockroach_referee_profiles WHERE LOWER(name) LIKE $1 LIMIT 1`,
    [`%${refereeName.toLowerCase()}%`]
  );
  
  return rows?.[0] || null;
}

/**
 * Store a completed prediction to CockroachDB (cold storage)
 */
async function archivePrediction(prediction) {
  const { error } = await cockroachQuery(`
    INSERT INTO cockroach_predictions (id, fixture_id, market, selection, model_probability, confidence_lower, confidence_upper, model_version, poisson_prob, elo_prob, regression_prob, xg_adjusted_prob, bookmaker_odds, implied_probability, edge, result, actual_outcome, settled_at, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
    ON CONFLICT (id) DO UPDATE SET result = EXCLUDED.result, actual_outcome = EXCLUDED.actual_outcome, settled_at = EXCLUDED.settled_at
  `, [
    prediction.id, prediction.fixture_id, prediction.market, prediction.selection,
    prediction.model_probability, prediction.confidence_lower, prediction.confidence_upper,
    prediction.model_version, prediction.poisson_prob, prediction.elo_prob,
    prediction.regression_prob, prediction.xg_adjusted_prob,
    prediction.bookmaker_odds, prediction.implied_probability, prediction.edge,
    prediction.result, prediction.actual_outcome, prediction.settled_at, prediction.created_at
  ]);
  
  return { error };
}

/**
 * Get training data for model training (from CockroachDB)
 */
async function getTrainingData({ market, limit = 50000 } = {}) {
  let query = `SELECT * FROM cockroach_training_data`;
  const params = [];
  
  if (market) {
    query += ` WHERE market = $1`;
    params.push(market);
  }
  
  query += ` ORDER BY created_at DESC LIMIT $${params.length + 1}`;
  params.push(limit);
  
  const { rows, error } = await cockroachQuery(query, params);
  return { data: rows || [], error };
}

/**
 * Get value picks from historical analysis (from CockroachDB)
 */
async function getValuePicks({ tier, market, limit = 100 } = {}) {
  let query = `SELECT * FROM cockroach_value_picks WHERE 1=1`;
  const params = [];
  let idx = 1;
  
  if (tier) { query += ` AND tier = $${idx++}`; params.push(tier); }
  if (market) { query += ` AND market = $${idx++}`; params.push(market); }
  
  query += ` ORDER BY edge DESC LIMIT $${idx}`;
  params.push(limit);
  
  const { rows, error } = await cockroachQuery(query, params);
  return { data: rows || [], error };
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
  
  // CockroachDB stats
  const { rows: cockroachStats } = await cockroachQuery(`SELECT * FROM cockroach_db_stats`);
  
  return {
    supabase: {
      predictions: predCount.count || 0,
      fixtures: fixCount.count || 0,
      settled: settCount.count || 0,
    },
    cockroach: cockroachStats || [],
  };
}

module.exports = {
  // Hot (Supabase)
  getUpcomingFixtures,
  getRecentPredictions,
  getUnsettledPredictions,
  updatePredictionResult,
  
  // Cold (CockroachDB)
  getHistoricalPredictions,
  getMarketAccuracy,
  getCalibrationBuckets,
  getLeagueAccuracy,
  getTeamXG,
  getRefereeProfile,
  archivePrediction,
  getTrainingData,
  getValuePicks,
  
  // Both
  getStats,
  
  // Expose for direct access
  supabase,
  cockroachQuery,
};
