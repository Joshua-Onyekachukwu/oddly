#!/usr/bin/env node
/**
 * Understat xG Scraper
 * 
 * Uses Understat's AJAX API to extract xG data for top 5 European leagues.
 * API: https://understat.com/getLeagueData/LEAGUE/SEASON
 * Returns gzip-compressed JSON with team xG, player xG, match xG data.
 * 
 * Usage: node scripts/scrape-understat-xg.js [--leagues EPL,La_liga] [--seasons 2025,2024]
 */

const https = require('https');
const http = require('http');
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const OUTPUT = path.join(DATA_DIR, 'understat-xg.json');
const DELAY_MS = 2000; // 2 seconds between requests to be polite

// Understat league codes
const LEAGUES = {
  EPL: 'Premier League',
  La_liga: 'La Liga',
  Bundesliga: 'Bundesliga',
  Serie_A: 'Serie A',
  Ligue_1: 'Ligue 1',
  Eredivisie: 'Eredivisie',
  Primeira_Liga: 'Primeira Liga',
  Championship: 'Championship',
};

// Default seasons to scrape (integer years)
const DEFAULT_SEASONS = [2025, 2024, 2023, 2022, 2021];

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function fetchGzip(url) {
  return new Promise((res, rej) => {
    const protocol = url.startsWith('https') ? https : http;
    const req = protocol.request(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'X-Requested-With': 'XMLHttpRequest',
        'Referer': 'https://understat.com/league/EPL',
        'Accept-Encoding': 'gzip, deflate, br',
      },
      timeout: 30000,
    }, r => {
      const chunks = [];
      let stream;
      if (r.headers['content-encoding'] === 'gzip') {
        stream = r.pipe(zlib.createGunzip());
      } else if (r.headers['content-encoding'] === 'br') {
        stream = r.pipe(zlib.createBrotliDecompress());
      } else if (r.headers['content-encoding'] === 'deflate') {
        stream = r.pipe(zlib.createInflate());
      } else {
        stream = r;
      }
      stream.on('data', c => chunks.push(c));
      stream.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        res({ status: r.statusCode, body, headers: r.headers });
      });
      stream.on('error', rej);
    });
    req.on('error', rej);
    req.on('timeout', () => { req.destroy(); rej(new Error('timeout')); });
    req.end();
  });
}

function extractTeamFeatures(teams) {
  const features = {};
  for (const [teamId, team] of Object.entries(teams)) {
    const name = team.title;
    const history = team.history || [];
    if (history.length === 0) continue;

    const xgValues = history.map(h => h.xG);
    const xgaValues = history.map(h => h.xGA);
    const npxgValues = history.map(h => h.npxG);
    const npxgaValues = history.map(h => h.npxGA);
    const scored = history.map(h => h.scored);
    const missed = history.map(h => h.missed);
    const xpts = history.map(h => h.xpts);

    // PPDA (passes per defensive action) - pressing intensity
    const ppda = history.map(h => h.ppda ? h.ppda.att / Math.max(h.ppda.def, 1) : 0);
    const ppdaAllowed = history.map(h => h.ppda_allowed ? h.ppda_allowed.att / Math.max(h.ppda_allowed.def, 1) : 0);

    // Deep completions (passes within 20 yards of goal)
    const deep = history.map(h => h.deep || 0);
    const deepAllowed = history.map(h => h.deep_allowed || 0);

    const avg = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
    const sum = arr => arr.reduce((a, b) => a + b, 0);

    features[name] = {
      team_id: teamId,
      matches: history.length,
      // Core xG metrics
      avg_xg: avg(xgValues),
      avg_xga: avg(xgaValues),
      avg_npxg: avg(npxgValues),
      avg_npxga: avg(npxgaValues),
      total_xg: sum(xgValues),
      total_xga: sum(xgaValues),
      total_scored: sum(scored),
      total_missed: sum(missed),
      // Over/underperformance
      xg_diff: sum(scored) - sum(xgValues),  // actual - expected
      xga_diff: sum(xgaValues) - sum(missed),  // expected - actual conceded
      xpts_total: sum(xpts),
      // Home/away splits
      home_xg: avg(history.filter(h => h.h_a === 'h').map(h => h.xG)),
      home_xga: avg(history.filter(h => h.h_a === 'h').map(h => h.xGA)),
      away_xg: avg(history.filter(h => h.h_a === 'a').map(h => h.xG)),
      away_xga: avg(history.filter(h => h.h_a === 'a').map(h => h.xGA)),
      home_matches: history.filter(h => h.h_a === 'h').length,
      away_matches: history.filter(h => h.h_a === 'a').length,
      // Form (last 5/10)
      xg_last5: avg(xgValues.slice(-5)),
      xga_last5: avg(xgaValues.slice(-5)),
      xg_last10: avg(xgValues.slice(-10)),
      xga_last10: avg(xgaValues.slice(-10)),
      // Pressing
      avg_ppda: avg(ppda),
      avg_ppda_allowed: avg(ppdaAllowed),
      // Deep play
      avg_deep: avg(deep),
      avg_deep_allowed: avg(deepAllowed),
      // xPTS per match
      avg_xpts: avg(xpts),
      // Shot quality (xG per shot estimate - use npxG/xG ratio)
      npxg_ratio: sum(npxgValues) / Math.max(sum(xgValues), 0.01),
    };
  }
  return features;
}

function extractMatchFeatures(dates) {
  const matches = [];
  for (const m of dates) {
    if (!m.h || !m.a) continue;
    matches.push({
      external_id: m.id,
      home: m.h.title,
      away: m.a.title,
      home_short: m.h.short_title,
      away_short: m.a.short_title,
      home_xg: parseFloat(m.xG?.h) || 0,
      away_xg: parseFloat(m.xG?.a) || 0,
      home_scored: parseInt(m.goals?.h) || 0,
      away_scored: parseInt(m.goals?.a) || 0,
      forecast_home_win: parseFloat(m.forecast?.w) || 0,
      forecast_draw: parseFloat(m.forecast?.d) || 0,
      forecast_away_win: parseFloat(m.forecast?.l) || 0,
      date: m.datetime,
      is_result: m.isResult || false,
    });
  }
  return matches;
}

async function main() {
  // Parse CLI args
  const args = process.argv.slice(2);
  let targetLeagues = Object.keys(LEAGUES);
  let targetSeasons = DEFAULT_SEASONS;
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--leagues' && args[i+1]) {
      targetLeagues = args[i+1].split(',');
      i++;
    }
    if (args[i] === '--seasons' && args[i+1]) {
      targetSeasons = args[i+1].split(',').map(Number);
      i++;
    }
  }

  console.log('🔍 Understat xG Scraper');
  console.log('='.repeat(50));
  console.log(`Leagues: ${targetLeagues.join(', ')}`);
  console.log(`Seasons: ${targetSeasons.join(', ')}`);
  console.log(`Total requests: ${targetLeagues.length * targetSeasons.length}`);
  console.log('');

  // Load existing data if available
  let existing = {};
  if (fs.existsSync(OUTPUT)) {
    try {
      existing = JSON.parse(fs.readFileSync(OUTPUT, 'utf8'));
      console.log(`📂 Loaded existing data: ${Object.keys(existing.teams || {}).length} teams, ${(existing.matches || []).length} matches`);
    } catch (e) {
      console.log('⚠️  Could not parse existing data, starting fresh');
    }
  }

  const allTeamFeatures = existing.teams || {};
  const allMatchFeatures = existing.matches || [];
  let successCount = 0;
  let errorCount = 0;
  let totalMatchCount = 0;

  for (const league of targetLeagues) {
    for (const season of targetSeasons) {
      const leagueName = LEAGUES[league] || league;
      const url = `https://understat.com/getLeagueData/${league}/${season}`;
      
      process.stdout.write(`  ${leagueName} ${season}... `);
      
      try {
        const r = await fetchGzip(url);
        
        if (r.status !== 200) {
          console.log(`❌ HTTP ${r.status}`);
          errorCount++;
          await sleep(DELAY_MS);
          continue;
        }

        const json = JSON.parse(r.body);
        const teams = json.teams || {};
        const dates = json.dates || [];
        const players = json.players || [];

        // Extract team features
        const teamFeatures = extractTeamFeatures(teams);
        for (const [name, feat] of Object.entries(teamFeatures)) {
          const key = `${name}_${league}_${season}`;
          allTeamFeatures[key] = { ...feat, league, season: String(season) };
        }

        // Extract match features
        const matches = extractMatchFeatures(dates);
        for (const m of matches) {
          m.league = league;
          m.league_name = leagueName;
          m.season = season;
        }
        allMatchFeatures.push(...matches);

        const teamCount = Object.keys(teamFeatures).length;
        successCount++;
        totalMatchCount += matches.length;
        console.log(`✅ ${teamCount} teams, ${matches.length} matches, ${players.length} players`);
      } catch (e) {
        console.log(`❌ ${e.message}`);
        errorCount++;
      }

      await sleep(DELAY_MS);
    }
  }

  // Save results
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  
  const output = {
    source: 'Understat.com AJAX API',
    scraped_at: new Date().toISOString(),
    leagues: targetLeagues.map(l => LEAGUES[l] || l),
    seasons: targetSeasons,
    team_count: Object.keys(allTeamFeatures).length,
    match_count: totalMatchCount,
    success: successCount,
    errors: errorCount,
    teams: allTeamFeatures,
    matches: allMatchFeatures,
  };

  fs.writeFileSync(OUTPUT, JSON.stringify(output, null, 2));
  
  console.log('\n' + '='.repeat(50));
  console.log('📊 Summary');
  console.log(`   Teams: ${Object.keys(allTeamFeatures).length}`);
  console.log(`   Matches: ${totalMatchCount}`);
  console.log(`   Success: ${successCount}, Errors: ${errorCount}`);
  console.log(`   Saved to: ${OUTPUT}`);
  
  // Show top teams by xG
  const sorted = Object.entries(allTeamFeatures)
    .sort((a, b) => b[1].avg_xg - a[1].avg_xg)
    .slice(0, 10);
  console.log('\n⚽ Top 10 teams by avg xG:');
  for (const [name, f] of sorted) {
    console.log(`   ${name.padEnd(30)} xG: ${f.avg_xg.toFixed(2)}  xGA: ${f.avg_xga.toFixed(2)}  Diff: ${(f.avg_xg - f.avg_xga).toFixed(2)}`);
  }
}

main().catch(console.error);
