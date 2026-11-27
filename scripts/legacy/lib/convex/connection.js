/**
 * Convex HTTP Client Module
 * 
 * Hybrid Architecture:
 * - Supabase (hot): Auth, real-time, recent predictions, user-facing queries
 * - Convex (cold/analytics): Historical data, ML training, analytics, cold storage
 * 
 * Convex stores:
 * - All historical predictions (settled)
 * - Historical fixtures and results
 * - xG data (StatsBomb + Understat)
 * - Referee profiles and stats
 * - Injury/suspension data
 * - Training datasets
 * - Per-league model parameters
 * - Value analysis results
 */

const fs = require('fs');
const path = require('path');

// ─── Configuration ─────────────────────────────────────────

function loadEnv() {
  const env = {};
  try {
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
  } catch (e) { /* ignore */ }
  return env;
}

const env = loadEnv();

// Convex deployment URLs
const CONVEX_URL = env.CONVEX_URL || process.env.CONVEX_URL || 'https://limitless-mole-387.convex.cloud';
const CONVEX_DEPLOY_KEY = env.CONVEX_DEPLOY_KEY || process.env.CONVEX_DEPLOY_KEY;
const CONVEX_ACCESS_TOKEN = env.CONVEX_ACCESS_TOKEN || process.env.CONVEX_ACCESS_TOKEN;

// ─── HTTP Client ───────────────────────────────────────────

/**
 * Call a Convex query function via HTTP API
 * @param {string} functionName - Convex function path (e.g., "predictions:getMarketAccuracy")
 * @param {object} args - Function arguments
 * @returns {Promise<any>} - Function result
 */
async function convexQuery(functionName, args = {}) {
  if (!CONVEX_URL) {
    console.warn('[Convex] No CONVEX_URL configured — Convex features disabled');
    return null;
  }

  try {
    const url = `${CONVEX_URL}/api/query`;
    const body = JSON.stringify({
      path: functionName,
      args,
    });

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body,
    });

    if (!response.ok) {
      const text = await response.text();
      console.error(`[Convex] Query ${functionName} failed (${response.status}):`, text);
      return null;
    }

    const result = await response.json();
    return result.value ?? result;
  } catch (err) {
    console.error(`[Convex] Query ${functionName} error:`, err.message);
    return null;
  }
}

/**
 * Call a Convex mutation function via HTTP API
 * @param {string} functionName - Convex function path (e.g., "predictions:archivePrediction")
 * @param {object} args - Function arguments
 * @returns {Promise<any>} - Function result
 */
async function convexMutation(functionName, args = {}) {
  if (!CONVEX_URL) {
    console.warn('[Convex] No CONVEX_URL configured — Convex features disabled');
    return null;
  }

  try {
    const url = `${CONVEX_URL}/api/mutation`;
    const body = JSON.stringify({
      path: functionName,
      args,
    });

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body,
    });

    if (!response.ok) {
      const text = await response.text();
      console.error(`[Convex] Mutation ${functionName} failed (${response.status}):`, text);
      return null;
    }

    const result = await response.json();
    return result.value ?? result;
  } catch (err) {
    console.error(`[Convex] Mutation ${functionName} error:`, err.message);
    return null;
  }
}

/**
 * Call a Convex action (for long-running operations)
 * @param {string} actionName - Convex action path
 * @param {object} args - Function arguments
 * @returns {Promise<any>} - Function result
 */
async function convexAction(actionName, args = {}) {
  if (!CONVEX_URL) {
    console.warn('[Convex] No CONVEX_URL configured — Convex features disabled');
    return null;
  }

  try {
    const url = `${CONVEX_URL}/api/action`;
    const body = JSON.stringify({
      path: actionName,
      args,
    });

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body,
    });

    if (!response.ok) {
      const text = await response.text();
      console.error(`[Convex] Action ${actionName} failed (${response.status}):`, text);
      return null;
    }

    const result = await response.json();
    return result.value ?? result;
  } catch (err) {
    console.error(`[Convex] Action ${actionName} error:`, err.message);
    return null;
  }
}

/**
 * Test the Convex connection
 */
async function testConnection() {
  if (!CONVEX_URL) {
    console.warn('[Convex] No CONVEX_URL configured');
    return false;
  }

  try {
    const result = await convexQuery('predictions:getStats');
    if (result) {
      console.log('[Convex] Connected! Stats:', result);
      return true;
    }
    return false;
  } catch (err) {
    console.error('[Convex] Connection test failed:', err.message);
    return false;
  }
}

module.exports = {
  convexQuery,
  convexMutation,
  convexAction,
  testConnection,
  loadEnv,
  CONVEX_URL,
  CONVEX_DEPLOY_KEY,
  CONVEX_ACCESS_TOKEN,
};
