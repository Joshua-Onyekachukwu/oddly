/**
 * CockroachDB Connection Module
 * 
 * Hybrid Architecture:
 * - Supabase: Auth, real-time, recent predictions, user-facing queries
 * - CockroachDB: Historical data, analytics, ML training, cold storage
 * 
 * CockroachDB stores:
 * - All historical predictions (settled)
 * - Historical fixtures and results
 * - xG data (StatsBomb + Understat)
 * - Referee profiles and stats
 * - Injury/suspension data
 * - Training datasets
 * - Per-league model parameters
 * - Value analysis results
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

let pool = null;

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

function getPool() {
  if (pool) return pool;
  
  const env = loadEnv();
  const connectionString = env.COCKROACHDB_URL || process.env.COCKROACHDB_URL;
  
  if (!connectionString) {
    console.warn('[CockroachDB] No COCKROACHDB_URL found in .env.local — CockroachDB features disabled');
    return null;
  }
  
  pool = new Pool({
    connectionString,
    ssl: {
      rejectUnauthorized: false, // CockroachDB cloud requires this
    },
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });
  
  pool.on('error', (err) => {
    console.error('[CockroachDB] Pool error:', err.message);
    pool = null; // Reset so next call creates new pool
  });
  
  return pool;
}

async function query(text, params) {
  const p = getPool();
  if (!p) return { rows: [], error: new Error('CockroachDB not configured') };
  
  try {
    const result = await p.query(text, params);
    return { rows: result.rows, error: null };
  } catch (err) {
    console.error('[CockroachDB] Query error:', err.message);
    return { rows: [], error: err };
  }
}

async function testConnection() {
  const p = getPool();
  if (!p) return false;
  
  try {
    const result = await p.query('SELECT NOW() as time, current_database() as db');
    console.log('[CockroachDB] Connected:', result.rows[0]);
    return true;
  } catch (err) {
    console.error('[CockroachDB] Connection failed:', err.message);
    return false;
  }
}

async function close() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

module.exports = { getPool, query, testConnection, close, loadEnv };
