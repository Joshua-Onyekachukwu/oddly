#!/usr/bin/env node
/**
 * ODDLY Asian Handicap Odds Scraper
 *
 * Scrapes AH odds from OddsPortal for the top 5 leagues using Puppeteer.
 * AH odds are the sharpest market signal - professional bettors use them
 * to express their true view of match quality.
 *
 * How it works:
 *   1. Load league page, extract match URLs from embedded script tags
 *   2. Navigate to each match URL directly
 *   3. Click "Asian Handicap" tab
 *   4. Extract all AH lines (handicap, home/away odds, payout)
 *
 * Usage:
 *   node worker/scrape-ah-odds.js              # Scrape all top 5 leagues
 *   node worker/scrape-ah-odds.js --league epl # Scrape specific league
 *   node worker/scrape-ah-odds.js --status     # Show collected data status
 *
 * Output: data/ah-odds.json
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../data');
const AH_ODDS_PATH = path.join(DATA_DIR, 'ah-odds.json');
const BASE_URL = 'https://www.oddsportal.com';
const RATE_LIMIT_MS = 3000;

// --- Top 5 Leagues ---
const LEAGUES = {
  epl: {
    name: 'Premier League',
    country: 'England',
    url: 'https://www.oddsportal.com/football/england/premier-league/',
  },
  laliga: {
    name: 'La Liga',
    country: 'Spain',
    url: 'https://www.oddsportal.com/football/spain/laliga/',
  },
  bundesliga: {
    name: 'Bundesliga',
    country: 'Germany',
    url: 'https://www.oddsportal.com/football/germany/bundesliga/',
  },
  seriea: {
    name: 'Serie A',
    country: 'Italy',
    url: 'https://www.oddsportal.com/football/italy/serie-a/',
  },
  ligue1: {
    name: 'Ligue 1',
    country: 'France',
    url: 'https://www.oddsportal.com/football/france/ligue-1/',
  },
};

// --- Data Management ---

function loadAHData() {
  if (fs.existsSync(AH_ODDS_PATH)) {
    return JSON.parse(fs.readFileSync(AH_ODDS_PATH, 'utf8'));
  }
  return { scraped_at: null, leagues: {}, matches: {} };
}

function saveAHData(data) {
  data.scraped_at = new Date().toISOString();
  fs.writeFileSync(AH_ODDS_PATH, JSON.stringify(data, null, 2));
}

// --- Extract match URLs from league page ---

async function getMatchUrls(page, leagueUrl) {
  await page.goto(leagueUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise(r => setTimeout(r, 8000));

  // Extract match URLs from embedded script tags
  const matchUrls = await page.evaluate(() => {
    const urls = [];
    const scripts = document.querySelectorAll('script');
    for (const script of scripts) {
      const text = script.textContent || '';
      const matches = text.match(/\/football\/h2h\/[^"'\s]+/g);
      if (matches) urls.push(...matches);
    }
    return [...new Set(urls)];
  });

  return matchUrls;
}

// --- Extract AH odds from a match page ---

async function scrapeMatchAH(page, matchUrl) {
  const fullUrl = matchUrl.startsWith('http') ? matchUrl : BASE_URL + matchUrl;

  // Clean URL - remove hash fragment for navigation, keep for reference
  const cleanUrl = fullUrl.split('#')[0];

  await page.goto(cleanUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await new Promise(r => setTimeout(r, 6000));

  // Click Asian Handicap tab
  const ahClicked = await page.evaluate(() => {
    const els = [...document.querySelectorAll('*')];
    const ahTab = els.find(el => {
      return el.textContent.trim() === 'Asian Handicap' &&
             el.children.length === 0 &&
             (el.tagName === 'SPAN' || el.tagName === 'A' || el.tagName === 'BUTTON' || el.tagName === 'DIV');
    });
    if (ahTab) {
      ahTab.click();
      return true;
    }
    return false;
  });

  if (!ahClicked) return null;
  await new Promise(r => setTimeout(r, 3000));

  // Extract AH lines from page text
  const ahData = await page.evaluate(() => {
    const text = document.body.innerText;
    const lines = text.split('\n').filter(l => l.trim());

    // Find AH section
    let inAH = false;
    const ahSection = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed === 'Handicap' || trimmed === 'Asian Handicap') {
        inAH = true;
        continue;
      }
      if (inAH && (trimmed === 'Over/Under' || trimmed === '1X2' || trimmed === 'Match Result' ||
          trimmed === 'Goals' || trimmed === 'Both Teams To Score' || trimmed === 'Correct Score' ||
          trimmed === 'Double Chance')) {
        inAH = false;
        continue;
      }
      if (inAH) ahSection.push(trimmed);
    }

    // Parse AH lines - the text tokens appear as:
    // "Asian Handicap -1.5" "3" "10.50" "1.02" "93.0%"
    // Join them and regex match
    const fullText = ahSection.join(' ');
    const parsed = [];

    // Method 1: Regex on joined text
    const regex = /Asian Handicap ([+-]?\d+\.?\d*)\s+(\d+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)%?/g;
    let m;
    while ((m = regex.exec(fullText)) !== null) {
      parsed.push({
        handicap: parseFloat(m[1]),
        bookmakerCount: parseInt(m[2]),
        homeOdds: parseFloat(m[3]),
        awayOdds: parseFloat(m[4]),
        payout: parseFloat(m[5]),
      });
    }

    // Method 2: Line-by-line fallback
    if (parsed.length === 0) {
      for (let i = 0; i < ahSection.length; i++) {
        const line = ahSection[i];
        if (line.startsWith('Asian Handicap')) {
          const parts = line.replace('Asian Handicap', '').trim().split(/[\s|]+/).filter(Boolean);
          if (parts.length >= 5) {
            parsed.push({
              handicap: parseFloat(parts[0]),
              bookmakerCount: parseInt(parts[1]),
              homeOdds: parseFloat(parts[2]),
              awayOdds: parseFloat(parts[3]),
              payout: parseFloat(parts[4]),
            });
          }
        }
      }
    }

    parsed.sort((a, b) => a.handicap - b.handicap);

    // Find main line (closest to even odds)
    let mainLine = null;
    let minDeviation = Infinity;
    for (const line of parsed) {
      const deviation = Math.abs(line.homeOdds - 1.0) + Math.abs(line.awayOdds - 1.0);
      if (deviation < minDeviation) {
        minDeviation = deviation;
        mainLine = line.handicap;
      }
    }

    // Extract match title
    const title = document.querySelector('title')?.textContent || '';

    return { lines: parsed, mainLine, title };
  });

  if (ahData.lines.length === 0) return null;

  // Parse match name from title
  const titleMatch = ahData.title.match(/^(.+?)\s+Odds/);
  const matchName = titleMatch ? titleMatch[1] : ahData.title;

  return {
    match: matchName,
    url: cleanUrl,
    lines: ahData.lines,
    mainLine: ahData.mainLine,
    scraped_at: new Date().toISOString(),
  };
}

// --- Main ---

async function main() {
  const args = process.argv.slice(2);
  const isStatus = args.includes('--status');
  const leagueArg = args.find(a => !a.startsWith('--'));

  if (isStatus) {
    showStatus();
    return;
  }

  console.log('=== AH Odds Scraper (OddsPortal) ===\n');

  const data = loadAHData();
  const startTime = Date.now();

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36');

  const leaguesToScrape = leagueArg
    ? { [leagueArg]: LEAGUES[leagueArg] }
    : LEAGUES;

  for (const [key, league] of Object.entries(leaguesToScrape)) {
    if (!league) {
      console.log(`Unknown league: ${leagueArg}. Available: ${Object.keys(LEAGUES).join(', ')}`);
      continue;
    }

    console.log(`\n  Scraping ${league.name} (${league.country})...`);

    // Step 1: Get all match URLs from the league page
    const matchUrls = await getMatchUrls(page, league.url);
    console.log(`  Found ${matchUrls.length} match URLs`);

    // Step 2: Visit each match and extract AH odds
    const results = [];

    for (let i = 0; i < Math.min(matchUrls.length, 15); i++) {
      try {
        const matchData = await scrapeMatchAH(page, matchUrls[i]);
        if (matchData) {
          results.push(matchData);
          console.log(`    [${i + 1}/${Math.min(matchUrls.length, 15)}] ${matchData.match}: ${matchData.lines.length} AH lines, main: ${matchData.mainLine}`);
        } else {
          console.log(`    [${i + 1}/${Math.min(matchUrls.length, 15)}] No AH data`);
        }
        await new Promise(r => setTimeout(r, RATE_LIMIT_MS));
      } catch (e) {
        console.log(`    [${i + 1}] ERROR: ${e.message.substring(0, 60)}`);
      }
    }

    data.leagues[key] = {
      name: league.name,
      country: league.country,
      matches_scraped: results.length,
      scraped_at: new Date().toISOString(),
    };

    for (const match of results) {
      const matchKey = `${match.match}_${key}`;
      data.matches[matchKey] = match;
    }

    saveAHData(data);
    console.log(`  ${league.name}: ${results.length} matches scraped`);
  }

  await browser.close();

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  const totalMatches = Object.keys(data.matches).length;
  const totalLines = Object.values(data.matches).reduce((s, m) => s + m.lines.length, 0);

  console.log(`\n=== Scraping Complete ===`);
  console.log(`  Duration: ${duration}s`);
  console.log(`  Matches: ${totalMatches}`);
  console.log(`  AH lines: ${totalLines}`);
  console.log(`  Output: ${AH_ODDS_PATH}`);
}

function showStatus() {
  const data = loadAHData();
  const matches = Object.values(data.matches);
  const totalLines = matches.reduce((s, m) => s + m.lines.length, 0);

  console.log('=== AH Odds Status ===\n');
  console.log(`  Last scraped: ${data.scraped_at || 'never'}`);
  console.log(`  Total matches: ${matches.length}`);
  console.log(`  Total AH lines: ${totalLines}`);

  if (data.leagues) {
    console.log(`\n  By league:`);
    for (const [key, info] of Object.entries(data.leagues)) {
      console.log(`    ${info.name}: ${info.matches_scraped} matches (${info.scraped_at || 'never'})`);
    }
  }

  if (matches.length > 0) {
    console.log(`\n  Sample match:`);
    const sample = matches[0];
    console.log(`    ${sample.match}`);
    console.log(`    Main AH line: ${sample.mainLine}`);
    for (const line of sample.lines) {
      console.log(`      AH ${line.handicap > 0 ? '+' : ''}${line.handicap}: Home ${line.homeOdds} / Away ${line.awayOdds} (${line.bookmakerCount} books, ${line.payout}% payout)`);
    }
  }
}

main().catch(console.error);
