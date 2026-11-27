#!/usr/bin/env node
/**
 * Apply supabase/migrations/*.sql to the configured Supabase Postgres
 * in filename order. Uses SUPABASE_DB_* env vars or sensible defaults
 * for the session pooler.
 *
 * Usage: node scripts/apply-migrations.js [--dry-run]
 */
const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

// Minimal .env.local loader (no dotenv dependency)
try {
  const envPath = path.join(__dirname, "..", ".env.local");
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
} catch {}

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || "xruhvekcowdwocydqnmp";
const REGION = process.env.SUPABASE_DB_REGION || "eu-west-1";
const DB_PASSWORD =
  process.env.SUPABASE_DB_PASSWORD || "***REMOVED-SECRET***";

const MIGRATIONS_DIR = path.join(__dirname, "..", "supabase", "migrations");
const dryRun = process.argv.includes("--dry-run");

async function main() {
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  console.log(`Found ${files.length} migration files`);
  if (dryRun) {
    files.forEach((f) => console.log("  would apply:", f));
    return;
  }

  const client = new Client({
    host: `aws-0-${REGION}.pooler.supabase.com`,
    port: 5432,
    user: `postgres.${PROJECT_REF}`,
    password: DB_PASSWORD,
    database: "postgres",
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 20000,
  });

  await client.connect();
  console.log("Connected to Supabase Postgres");

  const results = { ok: [], failed: [] };
  for (const file of files) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    try {
      await client.query(sql);
      results.ok.push(file);
      console.log(`  OK    ${file}`);
    } catch (err) {
      results.failed.push({ file, error: err.message });
      console.log(`  FAIL  ${file}: ${err.message}`);
    }
  }

  await client.end();
  console.log(`\nDone: ${results.ok.length} applied, ${results.failed.length} failed`);
  if (results.failed.length) {
    console.log("Failures:");
    results.failed.forEach((f) => console.log(`  - ${f.file}: ${f.error}`));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("Fatal:", e.message);
  process.exit(1);
});
