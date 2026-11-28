#!/usr/bin/env node
/**
 * ODDLY — Apply the walk-forward 1X2/BTTS recalibration to Supabase.
 *
 * 1. Backs up the current production_v5 row → data/optimized-weights.backup.json
 * 2. Adds column model_weight_config.recalibration JSONB (idempotent)
 * 3. Updates production_v5.recalibration with the fitted params from
 *    data/calibration/1x2-recal.json (theta + btts platt), bumps trained_at
 *    and matches_analyzed. Weight columns are NOT touched.
 *
 * Usage: node scripts/apply-1x2-recal.js [--dry-run]
 */

const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

const ROOT = path.join(__dirname, "..");
for (const line of fs.readFileSync(path.join(ROOT, ".env.local"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const ARTIFACT = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "calibration", "1x2-recal.json"), "utf8"));
const BACKUP = path.join(ROOT, "data", "optimized-weights.backup.json");
const dryRun = process.argv.includes("--dry-run");

// Compact recalibration payload stored in the JSONB column.
const payload = {
  version: ARTIFACT.version,
  createdAt: ARTIFACT.createdAt,
  method: ARTIFACT.method,
  stage: ARTIFACT.stage, // "fin" — applied to final refined.oneXtwo probs
  kind: ARTIFACT.kind,
  // q_k ∝ p_k^alpha * exp(b_k), k=H,D,A; biasAway fixed 0 (identifiability)
  theta: ARTIFACT.theta,
  btts: { method: ARTIFACT.btts.method, a: ARTIFACT.btts.a, b: ARTIFACT.btts.b },
  // Per-league residual bias overrides (fit on all replay records per league,
  // n >= 300). Applied with shrinkage strength = n/(n+shrinkK) at inference.
  league_overrides: ARTIFACT.league_overrides || {},
  league_overrides_meta: ARTIFACT.league_overrides_meta
    ? {
        minLeagueN: ARTIFACT.league_overrides_meta.minLeagueN,
        shrinkK: ARTIFACT.league_overrides_meta.shrinkK,
        formula: ARTIFACT.league_overrides_meta.formula,
        honestAggregate: ARTIFACT.league_overrides_meta.honestAggregate,
      }
    : undefined,
  honestValidation: {
    tail: ARTIFACT.honestValidation.tail,
    baselineTail: ARTIFACT.honestValidation.baselineTail,
    bttsTail: ARTIFACT.btts.honestValidation.tail,
    bttsBaselineTail: ARTIFACT.btts.honestValidation.baselineTail,
  },
  artifactFile: "data/calibration/1x2-recal.json",
};

(async () => {
  const password = process.env.SUPABASE_DB_PASSWORD || "";
  const host = process.env.SUPABASE_POOLER_HOST || "aws-0-eu-west-1.pooler.supabase.com";
  const user = `${process.env.SUPABASE_DB_USER || "postgres"}.${process.env.SUPABASE_PROJECT_REF || "xruhvekcowdwocydqnmp"}`;
  const client = new Client({ host, port: 5432, user, password, database: "postgres", ssl: { rejectUnauthorized: false } });
  await client.connect();

  // 1. Backup current row
  const { rows } = await client.query(
    "SELECT * FROM model_weight_config WHERE config_name = 'production_v5'"
  );
  if (!rows.length) throw new Error("production_v5 row not found");
  const backup = {
    backedUpAt: new Date().toISOString(),
    reason: "pre-recalibration backup before adding recalibration JSONB (scripts/apply-1x2-recal.js)",
    row: rows[0],
  };
  fs.writeFileSync(BACKUP, JSON.stringify(backup, null, 2));
  console.log(`[apply] backed up production_v5 → ${BACKUP}`);

  if (dryRun) {
    console.log("[apply] --dry-run: payload that would be written:");
    console.log(JSON.stringify(payload, null, 2));
    await client.end();
    return;
  }

  // 2. Add JSONB column (idempotent)
  await client.query("ALTER TABLE model_weight_config ADD COLUMN IF NOT EXISTS recalibration JSONB");
  console.log("[apply] ensured column model_weight_config.recalibration JSONB");

  // 3. Update the row
  await client.query(
    `UPDATE model_weight_config
     SET recalibration = $1::jsonb,
         trained_at = NOW(),
         matches_analyzed = $2
     WHERE config_name = 'production_v5'`,
    [JSON.stringify(payload), ARTIFACT.trainedOn.records]
  );
  console.log("[apply] updated production_v5.recalibration (trained_at bumped, matches_analyzed=27314)");

  const { rows: check } = await client.query(
    "SELECT config_name, trained_at, matches_analyzed, recalibration->>'kind' AS kind, recalibration->'theta' AS theta FROM model_weight_config WHERE config_name = 'production_v5'"
  );
  console.log("[apply] verify:", JSON.stringify(check[0]));
  await client.end();
})().catch((e) => { console.error(e); process.exit(1); });
