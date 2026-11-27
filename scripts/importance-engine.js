#!/usr/bin/env node
/**
 * Loader for the TypeScript player-importance engine.
 *
 * src/lib/players/importance.ts is TS; worker/scripts run under plain node.
 * This bundles it (plus its imports) with esbuild into a temp CJS file once
 * per process and returns the module exports.
 *
 * Usage:
 *   const { buildPlayerIndex, computeImportance } = require('./importance-engine');
 */

const fs = require("fs");
const os = require("os");
const path = require("path");

const ENTRY = path.join(__dirname, "..", "src", "lib", "players", "importance.ts");

let cached = null;

function loadImportanceEngine() {
  if (cached) return cached;
  const esbuild = require("esbuild");
  const out = path.join(os.tmpdir(), `oddly-importance-engine-${process.pid}.cjs`);
  esbuild.buildSync({
    entryPoints: [ENTRY],
    bundle: true,
    format: "cjs",
    platform: "node",
    target: "node18",
    outfile: out,
    logLevel: "silent",
  });
  cached = require(out);
  return cached;
}

module.exports = { loadImportanceEngine };
