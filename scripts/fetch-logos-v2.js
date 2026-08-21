#!/usr/bin/env node

/**
 * Logo Fetcher v2 — Free alternatives for team and league logos
 * 
 * Sources (all free):
 * 1. football-data.org API — provides team crest URLs for 50+ leagues
 * 2. Wikipedia/Wikimedia — free CC-licensed team logos as fallback
 * 3. Existing API-Football CDN URLs already in database
 * 
 * Usage: node scripts/fetch-logos-v2.js [--dry-run] [--teams-only] [--leagues-only]
 */

const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");

// ─── Config ──────────────────────────────────────────────────────────────

function loadEnv() {
  const envPath = path.join(__dirname, "..", ".env.local");
  const envContent = fs.readFileSync(envPath, "utf8");
  envContent.split("\n").forEach((line) => {
    const match = line.match(/^([^#=]+)="?(.*?)"?\s*$/);
    if (match) process.env[match[1].trim()] = match[2].trim();
  });
}

loadEnv();

const FOOTBALL_DATA_KEY = "395f3e8cbe6b4a149f3d854fcdac7ad9";
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

const DRY_RUN = process.argv.includes("--dry-run");
const TEAMS_ONLY = process.argv.includes("--teams-only");
const LEAGUES_ONLY = process.argv.includes("--leagues-only");

// football-data.org competition codes mapped to our league names
const COMPETITION_MAP = {
  "PL": "Premier League",
  "PD": "La Liga", 
  "BL1": "Bundesliga",
  "SA": "Serie A",
  "FL1": "Ligue 1",
  "ELC": "Championship",
  "DED": "Eredivisie",
  "PPL": "Primeira Liga",
  "BSA": "Brasileirão",
  "CL": "Champions League",
  "EL": "Europa League",
  "WC": "World Cup",
  "EC": "European Championship",
  "CLI": "Copa Libertadores",
  "BS": "Serie B",
  "FL2": "Ligue 2",
  "PD2": "La Liga 2",
  "BL2": "Bundesliga 2",
  "SL": "Super Lig",
  "ECL": "Conference League",
};

// ─── HTTP Helper ─────────────────────────────────────────────────────────

function fetchJSON(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith("https") ? https : http;
    const req = proto.get(url, { headers, timeout: 10000 }, (res) => {
      if (res.statusCode === 429) {
        // Rate limited — wait and retry
        const retryAfter = parseInt(res.headers["retry-after"] || "60");
        console.log(`  ⏳ Rate limited. Waiting ${retryAfter}s...`);
        setTimeout(() => fetchJSON(url, headers).then(resolve).catch(reject), retryAfter * 1000);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`Parse error: ${e.message}`)); }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error(`Timeout for ${url}`)); });
  });
}

function downloadImage(url, filepath) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith("https") ? https : http;
    const req = proto.get(url, { timeout: 10000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadImage(res.headers.location, filepath).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      const file = fs.createWriteStream(filepath);
      res.pipe(file);
      file.on("finish", () => { file.close(); resolve(filepath); });
      file.on("error", reject);
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("Timeout")); });
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── Strategy 1: football-data.org Team Crests ──────────────────────────

async function fetchFromFootballData() {
  console.log("\n📡 Strategy 1: football-data.org team crests");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  
  const results = { found: 0, updated: 0, errors: 0 };
  
  for (const [code, leagueName] of Object.entries(COMPETITION_MAP)) {
    try {
      // Rate limit: 10 requests/min on free tier
      await sleep(6500);
      
      console.log(`  ⚽ ${leagueName} (${code})...`);
      
      const data = await fetchJSON(
        `https://api.football-data.org/v4/competitions/${code}/teams`,
        { "X-Auth-Token": FOOTBALL_DATA_KEY }
      );
      
      if (!data.teams || !Array.isArray(data.teams)) {
        console.log(`    ⚠️  No teams data for ${code}`);
        continue;
      }
      
      let leagueUpdated = 0;
      
      for (const team of data.teams) {
        const crestUrl = team.crest || team.emblem;
        if (!crestUrl) continue;
        
        results.found++;
        
        if (DRY_RUN) {
          console.log(`    [DRY] ${team.name} → ${crestUrl}`);
          leagueUpdated++;
          continue;
        }
        
        // Find matching team in our database
        const teamName = team.name || team.shortName || team.tla;
        const { data: existing } = await supabase
          .from("teams")
          .select("id,logo,canonical_name")
          .or(`canonical_name.ilike.%${teamName}%,canonical_name.ilike.%${team.shortName || team.tla}%`)
          .is("logo", null)
          .limit(1);
        
        if (existing && existing.length > 0) {
          const { error } = await supabase
            .from("teams")
            .update({ logo: crestUrl })
            .eq("id", existing[0].id);
          
          if (!error) {
            leagueUpdated++;
            results.updated++;
            process.stdout.write(`    ✅ ${existing[0].canonical_name}\n`);
          } else {
            results.errors++;
          }
        }
      }
      
      console.log(`    📊 Updated ${leagueUpdated} teams from ${leagueName}`);
      
    } catch (err) {
      if (err.message.includes("429") || err.message.includes("rate")) {
        console.log(`    ⏳ Rate limited on ${code}, waiting 60s...`);
        await sleep(60000);
      } else {
        console.log(`    ❌ ${code}: ${err.message}`);
        results.errors++;
      }
    }
  }
  
  return results;
}

// ─── Strategy 2: Wikipedia/Wikimedia Logo Lookup ────────────────────────

async function fetchFromWikipedia(teamName) {
  try {
    // Search Wikipedia for the team
    const searchUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(teamName)}`;
    const data = await fetchJSON(searchUrl);
    
    if (data.thumbnail && data.thumbnail.source) {
      // Get the full-size image
      const thumbUrl = data.thumbnail.source;
      // Wikipedia thumbnails have /220px-... pattern, replace with higher res
      return thumbUrl.replace(/\/\d+px-/, "/300px-");
    }
  } catch (err) {
    // Try alternate name formats
    const altNames = [
      `${teamName} F.C.`,
      `${teamName} FC`,
      `${teamName} Football Club`,
    ];
    
    for (const alt of altNames) {
      try {
        const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(alt)}`;
        const data = await fetchJSON(url);
        if (data.thumbnail && data.thumbnail.source) {
          return data.thumbnail.source.replace(/\/\d+px-/, "/300px-");
        }
      } catch { /* continue */ }
    }
  }
  return null;
}

async function fetchFromWikipediaFallback() {
  console.log("\n📚 Strategy 2: Wikipedia/Wikimedia fallback");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  
  const results = { found: 0, updated: 0, errors: 0 };
  
  // Get all teams without logos
  const { data: teams } = await supabase
    .from("teams")
    .select("id,canonical_name")
    .is("logo", null)
    .limit(200);
  
  if (!teams || teams.length === 0) {
    console.log("  ✅ All teams already have logos!");
    return results;
  }
  
  console.log(`  📋 ${teams.length} teams without logos`);
  
  for (let i = 0; i < teams.length; i++) {
    const team = teams[i];
    const name = team.canonical_name;
    
    // Rate limit Wikipedia: 1 req/sec
    await sleep(1100);
    
    try {
      const logoUrl = await fetchFromWikipedia(name);
      
      if (logoUrl) {
        results.found++;
        
        if (DRY_RUN) {
          console.log(`  [DRY] ${name} → ${logoUrl}`);
          results.updated++;
        } else {
          const { error } = await supabase
            .from("teams")
            .update({ logo: logoUrl })
            .eq("id", team.id);
          
          if (!error) {
            results.updated++;
            process.stdout.write(`  ✅ [${i+1}/${teams.length}] ${name}\n`);
          }
        }
      } else {
        // Try a simplified name
        const simplified = name.replace(/\s+(FC|CF|SC|AC|AS|SS|US|UD|CD|RC|RCF|CA|Club|Football|de|del|dos|do)\b.*/i, "").trim();
        if (simplified !== name) {
          const logoUrl2 = await fetchFromWikipedia(simplified);
          if (logoUrl2) {
            results.found++;
            if (!DRY_RUN) {
              await supabase.from("teams").update({ logo: logoUrl2 }).eq("id", team.id);
              results.updated++;
              process.stdout.write(`  ✅ [${i+1}/${teams.length}] ${name} (simplified)\n`);
            }
          }
        }
      }
    } catch (err) {
      console.log(`  ❌ ${name}: ${err.message}`);
      results.errors++;
    }
  }
  
  return results;
}

// ─── Strategy 3: League Logos from Wikipedia ────────────────────────────

async function fetchLeagueLogos() {
  console.log("\n🏆 Strategy 3: League logos from Wikipedia");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  
  const results = { found: 0, updated: 0, errors: 0 };
  
  const { data: leagues } = await supabase
    .from("leagues")
    .select("id,name,logo")
    .is("logo", null);
  
  if (!leagues || leagues.length === 0) {
    console.log("  ✅ All leagues already have logos!");
    return results;
  }
  
  console.log(`  📋 ${leagues.length} leagues without logos`);
  
  // Known Wikipedia page names for leagues
  const WIKI_MAP = {
    "Premier League": "Premier_League",
    "La Liga": "La_Liga",
    "Bundesliga": "Bundesliga_(football)",
    "Serie A": "Serie_A",
    "Ligue 1": "Ligue_1",
    "Championship": "EFL_Championship",
    "Eredivisie": "Eredivisie",
    "Primeira Liga": "Primeira_Liga",
    "Brasileirão": "Campeonato_Brasileiro_Série_A",
    "Champions League": "UEFA_Champions_League",
    "Europa League": "UEFA_Europa_League",
    "Super Lig": "Süper_Lig",
    "Serie B": "Serie_B_(football)",
    "La Liga 2": "Segunda_División",
    "Ligue 2": "Ligue_2",
    "Bundesliga 2": "2._Bundesliga",
    "Conference League": "UEFA_Europa_Conference_League",
  };
  
  for (const league of leagues) {
    await sleep(1100);
    
    try {
      const wikiName = WIKI_MAP[league.name] || league.name.replace(/\s+/g, "_");
      const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${wikiName}`;
      const data = await fetchJSON(url);
      
      if (data.thumbnail && data.thumbnail.source) {
        const logoUrl = data.thumbnail.source.replace(/\/\d+px-/, "/300px-");
        
        if (!DRY_RUN) {
          const { error } = await supabase
            .from("leagues")
            .update({ logo: logoUrl })
            .eq("id", league.id);
          
          if (!error) {
            results.updated++;
            console.log(`  ✅ ${league.name}`);
          }
        } else {
          console.log(`  [DRY] ${league.name} → ${logoUrl}`);
          results.updated++;
        }
        results.found++;
      }
    } catch (err) {
      console.log(`  ❌ ${league.name}: ${err.message}`);
      results.errors++;
    }
  }
  
  return results;
}

// ─── Main ────────────────────────────────────────────────────────────────

async function main() {
  console.log("🔄 ODDLY Logo Fetcher v2 (Free Sources)");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`📡 Supabase: ${process.env.NEXT_PUBLIC_SUPABASE_URL}`);
  console.log(`🔑 football-data.org: ${FOOTBALL_DATA_KEY.slice(0, 8)}...`);
  if (DRY_RUN) console.log("⚠️  DRY RUN MODE — no changes will be made");
  console.log("");
  
  const allResults = { found: 0, updated: 0, errors: 0 };
  
  if (!LEAGUES_ONLY) {
    // Strategy 1: football-data.org (best quality, structured data)
    const r1 = await fetchFromFootballData();
    allResults.found += r1.found;
    allResults.updated += r1.updated;
    allResults.errors += r1.errors;
    
    // Strategy 2: Wikipedia fallback for remaining teams
    if (!DRY_RUN) {
      const r2 = await fetchFromWikipediaFallback();
      allResults.found += r2.found;
      allResults.updated += r2.updated;
      allResults.errors += r2.errors;
    }
  }
  
  if (!TEAMS_ONLY) {
    // Strategy 3: League logos
    const r3 = await fetchLeagueLogos();
    allResults.found += r3.found;
    allResults.updated += r3.updated;
    allResults.errors += r3.errors;
  }
  
  // Summary
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("📊 Summary");
  console.log(`   Logos found:   ${allResults.found}`);
  console.log(`   Updated:       ${allResults.updated}`);
  console.log(`   Errors:        ${allResults.errors}`);
  
  // Check remaining
  const { count: remaining } = await supabase
    .from("teams")
    .select("*", { count: "exact", head: true })
    .is("logo", null);
  console.log(`   Still missing: ${remaining}`);
}

main().catch(console.error);
