#!/usr/bin/env node
/**
 * ODDLY Asian Handicap Features
 *
 * Extracts predictive features from AH odds scraped from OddsPortal.
 * These features represent the sharpest market signal available.
 *
 * Key AH-derived features:
 *   - ah_main_line: The main AH line (most balanced odds)
 *   - ah_home_implied: Home win implied probability from main line
 *   - ah_draw_implied: Draw implied probability (probability of exact line)
 *   - ah_line_movement: How far the main line has shifted from opening
 *   - ah_sharp_signal: Whether professional money is moving the line
 *   - ah_margin: Bookmaker margin on AH market
 *   - ah_value_spread: Width of the AH line spread
 *   - ah_asymmetry: Whether the line is tilted toward home or away
 *
 * Usage:
 *   node worker/ah-features.js compute  # Compute AH features for upcoming matches
 *   node worker/ah-features.js status   # Show AH feature coverage
 *
 * Output: data/ah-features.json
 */

const fs = require('fs');
const path = require('path');

const AH_ODDS_PATH = path.join(__dirname, '../data/ah-odds.json');
const AH_FEATURES_PATH = path.join(__dirname, '../data/ah-features.json');
const PREDICTIONS_PATH = path.join(__dirname, '../data/predictions.json');

function loadJSON(p, fallback = {}) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch { return fallback; }
}

function saveJSON(p, data) {
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
}

/**
 * Convert AH odds to implied probabilities
 * AH odds: homeOdds / awayOdds at a given handicap
 * Implied prob = (1 / odds) after removing margin
 */
function ahOddsToImplied(homeOdds, awayOdds) {
  const rawHome = 1 / homeOdds;
  const rawAway = 1 / awayOdds;
  const overround = rawHome + rawAway;

  return {
    homeImplied: rawHome / overround,
    awayImplied: rawAway / overround,
    margin: (overround - 1) * 100,
  };
}

/**
 * Compute AH features for a single match
 */
function computeMatchFeatures(matchData) {
  const lines = matchData.lines || [];
  if (lines.length === 0) return null;

  const mainHandicap = matchData.mainLine;
  const mainLineData = lines.find(l => l.handicap === mainHandicap);

  if (!mainLineData) return null;

  // Main line implied probabilities
  const mainImplied = ahOddsToImplied(mainLineData.homeOdds, mainLineData.awayOdds);

  let homeAdvantage = null;

  // Find draw probability from 0 line and adjacent lines
  // AH 0 (level ball): homeImplied = P(home covers 0) = P(goal_diff > 0) + 0.5 * P(goal_diff == 0)
  // AH +0.25: homeImplied = P(goal_diff > -0.25) = P(goal_diff >= 0)
  // Draw = P(goal_diff == 0) = P(goal_diff >= 0) - P(goal_diff > 0)
  // = AH+0.25 homeImpl - AH-0.25 homeImpl (approximately)
  const zeroLine = lines.find(l => l.handicap === 0);
  const plusQ = lines.find(l => l.handicap === 0.25);
  const minusQ = lines.find(l => l.handicap === -0.25);
  let drawProbability = null;
  if (zeroLine) {
    const zImpl = ahOddsToImplied(zeroLine.homeOdds, zeroLine.awayOdds);
    homeAdvantage = zImpl.homeImplied - zImpl.awayImplied;
    if (plusQ && minusQ) {
      const pqImpl = ahOddsToImplied(plusQ.homeOdds, plusQ.awayOdds);
      const mqImpl = ahOddsToImplied(minusQ.homeOdds, minusQ.awayOdds);
      drawProbability = pqImpl.homeImplied - mqImpl.homeImplied;
    } else if (plusQ) {
      const pqImpl = ahOddsToImplied(plusQ.homeOdds, plusQ.awayOdds);
      drawProbability = (pqImpl.homeImplied - zImpl.homeImplied) * 2;
    } else {
      drawProbability = 0.25;
    }
    drawProbability = Math.max(0, Math.min(0.40, drawProbability));
  }

  // Spread metrics
  const handicaps = lines.map(l => l.handicap);
  const minHandicap = Math.min(...handicaps);
  const maxHandicap = Math.max(...handicaps);
  const spread = maxHandicap - minHandicap;

  // Asymmetry: how many lines are below vs above 0
  const belowZero = lines.filter(l => l.handicap < 0).length;
  const aboveZero = lines.filter(l => l.handicap > 0).length;
  const asymmetry = (aboveZero - belowZero) / lines.length;

  // Average margin across all lines
  const avgMargin = lines.reduce((sum, l) => {
    const impl = ahOddsToImplied(l.homeOdds, l.awayOdds);
    return sum + impl.margin;
  }, 0) / lines.length;

  // Pinnacle line (lowest margin bookmaker if available, else average)
  const lowestMargin = lines.reduce((min, l) => {
    const impl = ahOddsToImplied(l.homeOdds, l.awayOdds);
    return impl.margin < min ? impl.margin : min;
  }, 100);

  // Sharp line confidence: more bookmakers = sharper
  const avgBookmakers = lines.reduce((s, l) => s + (l.bookmakerCount || 0), 0) / lines.length;

  // Convert AH to 1X2 probabilities
  // At the 0 line: homeImplied = P(home win) + 0.5*P(draw)
  //                awayImplied = P(away win) + 0.5*P(draw)
  // So: P(home win) = homeImplied - 0.5*draw
  //     P(away win) = awayImplied - 0.5*draw
  let hwdc_draw = drawProbability || 0.25;
  let hwdc_home, hwdc_away;
  if (zeroLine) {
    const zImpl = ahOddsToImplied(zeroLine.homeOdds, zeroLine.awayOdds);
    hwdc_home = Math.max(0.01, zImpl.homeImplied - 0.5 * hwdc_draw);
    hwdc_away = Math.max(0.01, zImpl.awayImplied - 0.5 * hwdc_draw);
  } else {
    // Fallback: use main line
    hwdc_home = mainImplied.homeImplied;
    hwdc_away = mainImplied.awayImplied;
  }

  // Normalize
  const total = hwdc_home + hwdc_draw + hwdc_away;
  hwdc_home /= total;
  hwdc_draw /= total;
  hwdc_away /= total;

  return {
    // Core features
    ah_main_line: mainHandicap,
    ah_home_implied: round(mainImplied.homeImplied),
    ah_away_implied: round(mainImplied.awayImplied),
    ah_draw_implied: round(drawProbability || 0),
    ah_home_advantage: round(homeAdvantage || 0),

    // Market structure
    ah_margin: round(avgMargin),
    ah_lowest_margin: round(lowestMargin),
    ah_spread: round(spread),
    ah_asymmetry: round(asymmetry),
    ah_bookmaker_count: round(avgBookmakers),
    ah_total_lines: lines.length,

    // Derived 1X2 from AH
    ah_hwdc_home: round(hwdc_home),
    ah_hwdc_draw: round(hwdc_draw),
    ah_hwdc_away: round(hwdc_away),

    // Confidence
    ah_line_confidence: round(avgBookmakers >= 5 ? 1.0 : avgBookmakers / 5),
  };
}

function round(v, dp = 4) {
  return Math.round(v * 10 ** dp) / 10 ** dp;
}

/**
 * Match AH data to our fixtures by team name fuzzy matching
 */
function matchTeamNames(ahMatch, fixtureTeams) {
  const ahHome = ahMatch.homeTeam.toLowerCase().trim();
  const ahAway = ahMatch.awayTeam.toLowerCase().trim();

  // Try exact match first
  for (const fixture of fixtureTeams) {
    const fHome = fixture.home.toLowerCase().trim();
    const fAway = fixture.away.toLowerCase().trim();

    if (fHome.includes(ahHome) || ahHome.includes(fHome)) {
      if (fAway.includes(ahAway) || ahAway.includes(fAway)) {
        return fixture;
      }
    }
  }
  return null;
}

/**
 * Main compute function
 */
function compute() {
  const ahData = loadJSON(AH_ODDS_PATH, { matches: {} });
  const predictions = loadJSON(PREDICTIONS_PATH, { predictions: {} });
  const matches = Object.values(ahData.matches || {});

  if (matches.length === 0) {
    console.log('No AH odds data found. Run: npm run ah:scrape');
    return;
  }

  console.log(`\n=== AH Features Computation ===`);
  console.log(`  Input: ${matches.length} AH-odds matches`);

  const features = {};
  let computed = 0;
  let matched = 0;

  for (const match of matches) {
    const ahFeatures = computeMatchFeatures(match);
    if (!ahFeatures) continue;

    computed++;

    // Parse team names from match string like "Crystal Palace - Manchester City"
    const matchParts = (match.match || '').split(' - ').map(s => s.trim());
    const homeTeam = matchParts[0] || match.homeTeam || 'Unknown';
    const awayTeam = matchParts[1] || match.awayTeam || 'Unknown';
    const key = `${homeTeam}_vs_${awayTeam}`;
    features[key] = {
      ...ahFeatures,
      match: match.match,
      homeTeam,
      awayTeam,
      main_line: match.mainLine,
      total_lines: match.lines.length,
      computed_at: new Date().toISOString(),
    };
  }

  const output = {
    computed_at: new Date().toISOString(),
    source: 'OddsPortal',
    total_matches: matches.length,
    computed_features: computed,
    features,
  };

  saveJSON(AH_FEATURES_PATH, output);

  console.log(`  Computed features: ${computed}`);
  console.log(`  Output: ${AH_FEATURES_PATH}`);

  // Show sample
  const sample = Object.values(features)[0];
  if (sample) {
    console.log(`\n  Sample: ${sample.match}`);
    console.log(`    Main AH line: ${sample.ah_main_line}`);
    console.log(`    Home implied: ${(sample.ah_home_implied * 100).toFixed(1)}%`);
    console.log(`    Away implied: ${(sample.ah_away_implied * 100).toFixed(1)}%`);
    console.log(`    Draw implied: ${(sample.ah_draw_implied * 100).toFixed(1)}%`);
    console.log(`    Home advantage: ${(sample.ah_home_advantage * 100).toFixed(1)}%`);
    console.log(`    AH margin: ${sample.ah_margin.toFixed(1)}%`);
    console.log(`    AH spread: ${sample.ah_spread}`);
    console.log(`    Derived 1X2: ${(sample.ah_hwdc_home * 100).toFixed(1)}% / ${(sample.ah_hwdc_draw * 100).toFixed(1)}% / ${(sample.ah_hwdc_away * 100).toFixed(1)}%`);
  }
}

function status() {
  const features = loadJSON(AH_FEATURES_PATH, {});
  const featureList = Object.values(features.features || {});

  console.log('=== AH Features Status ===\n');
  console.log(`  Last computed: ${features.computed_at || 'never'}`);
  console.log(`  Total matches with features: ${featureList.length}`);

  if (featureList.length > 0) {
    const avgLines = featureList.reduce((s, f) => s + f.total_lines, 0) / featureList.length;
    const avgMargin = featureList.reduce((s, f) => s + f.ah_margin, 0) / featureList.length;
    const avgConfidence = featureList.reduce((s, f) => s + f.ah_line_confidence, 0) / featureList.length;

    console.log(`  Avg AH lines per match: ${avgLines.toFixed(1)}`);
    console.log(`  Avg margin: ${avgMargin.toFixed(1)}%`);
    console.log(`  Avg confidence: ${(avgConfidence * 100).toFixed(1)}%`);

    console.log(`\n  Top 5 by confidence:`);
    featureList
      .sort((a, b) => b.ah_line_confidence - a.ah_line_confidence)
      .slice(0, 5)
      .forEach(f => {
        console.log(`    ${f.match}: line=${f.ah_main_line}, margin=${f.ah_margin.toFixed(1)}%, conf=${(f.ah_line_confidence * 100).toFixed(0)}%`);
      });
  }
}

// --- CLI ---
const cmd = process.argv[2] || 'compute';
if (cmd === 'status') status();
else compute();
