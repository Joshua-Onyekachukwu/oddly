/**
 * Shared environment loader for ODDLY scripts.
 * Handles quoted values in .env.local properly.
 */
const fs = require("fs");
const path = require("path");

function loadEnv(envPath) {
  const resolved = envPath || path.join(__dirname, "..", ".env.local");
  if (!fs.existsSync(resolved)) {
    console.error("❌ .env.local not found at", resolved);
    process.exit(1);
  }
  const env = {};
  for (const line of fs.readFileSync(resolved, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

module.exports = { loadEnv };
