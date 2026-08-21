#!/usr/bin/env node

/**
 * ODDLY Feature Engineering Pipeline
 *
 * Computes all 23 data points from historical match data.
 * These features feed into the prediction models (Dixon-Coles, Elo, XGBoost, NVIDIA AI).
 *
 * Usage: node scripts/compute-features.js [--matches=all] [--league=<id>]
 *
 * Data Points Computed:
 *   Category 1: Team Form & Performance (35% weight)
 *     - Recent Form (Last 5/10)
 *     - Points Per Game (PPG)
 *     - Goals Scored/Conceded Average
 *     - Clean Sheet %
 *     - Both Teams Scored %
 *
 *   Category 2: Home/Away Performance (20% weight)
 *     - Home Win Rate
 *     - Away Win Rate
 *     - Home/Away Goals Scored/Conceded
 *
 *   Category 3: Head-to-Head (15% weight)
 *     - H2H Win Rate
 *     - H2H Goals Average
 *
 *   Category 4: Market Data (20% weight)
 *     - Implied Probabilities from Odds
 *     - Odds Movement (if historical odds exist)
 *     - Market Consensus
 *
 *   Category 5: Contextual Factors (10% weight)
 *     - Days Since Last Match
 *     - League Position
 *     - Goal Difference
 */

const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");
const path = require("path");

// Load environment
function loadEnv() {
  const envPath = path.join(__dirname, "..", ".env.local");
  if (!fs.existsSync(envPath)) {
    console.error("❌ .env.local not found. Copy from main checkout.");
    process.exit(1);
  }
  const envContent = fs.readFileSync(envPath, "utf8");
  const env = {};
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    env[trimmed.slice(0, eqIndex).trim()] = trimmed.slice(eqIndex + 1).trim();
  }
  return env;
}

const env = loadEnv();
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

// ─── Form Calculations ───────────────────────────────────────────────────────

/**
 * Compute form string from a list of results (most recent last).
 * @param {Array<{gf: number, ga: number}>} results - Goals for/against per match
 * @param {number} n - Number of recent matches to consider
 * @returns {string} Form string like "WWDLW"
 */
function computeForm(results, n = 5) {
  const recent = results.slice(-n);
  return recent.map(r => {
    if (r.gf > r.ga) return "W";
    if (r.gf < r.ga) return "L";
    return "D";
  }).join("");
}

/**
 * Compute Points Per Game from results.
 */
function computePPG(results, n = 5) {
  const recent = results.slice(-n);
  if (recent.length === 0) return null;
  const points = recent.reduce((sum, r) => {
    if (r.gf > r.ga) return sum + 3;
    if (r.gf === r.ga) return sum + 1;
    return sum;
  }, 0);
  return Number((points / recent.length).toFixed(2));
}

/**
 * Compute average goals scored/conceded.
 */
function computeGoalsAvg(results, n = 5) {
  const recent = results.slice(-n);
  if (recent.length === 0) return { scored: null, conceded: null };
  const scored = recent.reduce((sum, r) => sum + r.gf, 0) / recent.length;
  const conceded = recent.reduce((sum, r) => sum + r.ga, 0) / recent.length;
  return { scored: Number(scored.toFixed(2)), conceded: Number(conceded.toFixed(2)) };
}

/**
 * Compute clean sheet percentage.
 */
function computeCleanSheetPct(results, n = 10) {
  const recent = results.slice(-n);
  if (recent.length === 0) return null;
  const cleanSheets = recent.filter(r => r.ga === 0).length;
  return Number(((cleanSheets / recent.length) * 100).toFixed(1));
}

/**
 * Compute both-teams-scored percentage.
 */
function computeBttsPct(results, n = 10) {
  const recent = results.slice(-n);
  if (recent.length === 0) return null;
  const btts = recent.filter(r => r.gf > 0 && r.ga > 0).length;
  return Number(((btts / recent.length) * 100).toFixed(1));
}

// ─── Home/Away Calculations ──────────────────────────────────────────────────

function computeHomeAwayStats(matches, teamId) {
  const homeMatches = matches.filter(m => m.home_team_id === teamId);
  const awayMatches = matches.filter(m => m.away_team_id === teamId);

  const homeWinRate = homeMatches.length > 0
    ? Number(((homeMatches.filter(m => m.home_score > m.away_score).length / homeMatches.length) * 100).toFixed(1))
    : null;

  const awayWinRate = awayMatches.length > 0
    ? Number(((awayMatches.filter(m => m.away_score > m.home_score).length / awayMatches.length) * 100).toFixed(1))
    : null;

  const homeGoalsScored = homeMatches.length > 0
    ? Number((homeMatches.reduce((s, m) => s + m.home_score, 0) / homeMatches.length).toFixed(2))
    : null;

  const homeGoalsConceded = homeMatches.length > 0
    ? Number((homeMatches.reduce((s, m) => s + m.away_score, 0) / homeMatches.length).toFixed(2))
    : null;

  const awayGoalsScored = awayMatches.length > 0
    ? Number((awayMatches.reduce((s, m) => s + m.away_score, 0) / awayMatches.length).toFixed(2))
    : null;

  const awayGoalsConceded = awayMatches.length > 0
    ? Number((awayMatches.reduce((s, m) => s + m.home_score, 0) / awayMatches.length).toFixed(2))
    : null;

  return {
    home_win_rate: homeWinRate,
    away_win_rate: awayWinRate,
    home_goals_scored: homeGoalsScored,
    home_goals_conceded: homeGoalsConceded,
    away_goals_scored: awayGoalsScored,
    away_goals_conceded: awayGoalsConceded,
  };
}

// ─── Head-to-Head ────────────────────────────────────────────────────────────

function computeH2H(allMatches, homeTeamId, awayTeamId) {
  const h2hMatches = allMatches.filter(m =>
    (m.home_team_id === homeTeamId && m.away_team_id === awayTeamId) ||
    (m.home_team_id === awayTeamId && m.away_team_id === homeTeamId)
  );

  if (h2hMatches.length === 0) return { h2h_win_rate: null, h2h_goals_avg: null };

  const homeWins = h2hMatches.filter(m => {
    if (m.home_team_id === homeTeamId) return m.home_score > m.away_score;
    return m.away_score > m.home_score;
  }).length;

  const totalGoals = h2hMatches.reduce((s, m) => s + m.home_score + m.away_score, 0);

  return {
    h2h_win_rate: Number(((homeWins / h2hMatches.length) * 100).toFixed(1)),
    h2h_goals_avg: Number((totalGoals / h2hMatches.length).toFixed(2)),
  };
}

// ─── Market Data ─────────────────────────────────────────────────────────────

function computeMarketFeatures(oddsSnapshots) {
  if (!oddsSnapshots || oddsSnapshots.length === 0) {
    return {
      implied_home_prob: null,
      implied_draw_prob: null,
      implied_away_prob: null,
      market_consensus: null,
      odds_movement: null,
    };
  }

  // Get the latest odds snapshot
  const latest = oddsSnapshots[oddsSnapshots.length - 1];
  const prev = oddsSnapshots.length > 1 ? oddsSnapshots[oddsSnapshots.length - 2] : null;

  const impliedHome = latest.home_odds ? Number((1 / latest.home_odds).toFixed(4)) : null;
  const impliedDraw = latest.draw_odds ? Number((1 / latest.draw_odds).toFixed(4)) : null;
  const impliedAway = latest.away_odds ? Number((1 / latest.away_odds).toFixed(4)) : null;

  // Odds movement (change from previous snapshot)
  let oddsMovement = null;
  if (prev && latest.home_odds && prev.home_odds) {
    oddsMovement = Number((latest.home_odds - prev.home_odds).toFixed(3));
  }

  // Market consensus (how many bookmakers agree)
  const consensus = oddsSnapshots.length > 1 ? Number((oddsSnapshots.length).toFixed(0)) : null;

  return {
    implied_home_prob: impliedHome,
    implied_draw_prob: impliedDraw,
    implied_away_prob: impliedAway,
    market_consensus: consensus,
    odds_movement: oddsMovement,
  };
}

// ─── Contextual Factors ──────────────────────────────────────────────────────

function computeContextualFactors(teamMatches, matchDate, leagueId, allMatches) {
  // Days since last match
  const sortedMatches = teamMatches
    .filter(m => m.match_date < matchDate)
    .sort((a, b) => new Date(b.match_date) - new Date(a.match_date));

  const daysSinceLast = sortedMatches.length > 0
    ? Math.floor((new Date(matchDate) - new Date(sortedMatches[0].match_date)) / (1000 * 60 * 60 * 24))
    : null;

  // Goal difference
  const recentMatches = teamMatches.slice(-10);
  const goalDiff = recentMatches.length > 0
    ? recentMatches.reduce((s, m) => {
        const isHome = m.home_team_id === teamMatches[0]?.team_id;
        return s + (isHome ? m.home_score - m.away_score : m.away_score - m.home_score);
      }, 0)
    : null;

  return {
    days_since_last_match: daysSinceLast,
    goal_difference: goalDiff,
    league_position: null, // Computed separately from league table
  };
}

// ─── Elo Rating System ───────────────────────────────────────────────────────

class EloSystem {
  constructor(kFactor = 32, homeAdvantage = 65) {
    this.ratings = {};
    this.kFactor = kFactor;
    this.homeAdvantage = homeAdvantage;
  }

  getRating(teamId) {
    return this.ratings[teamId] || 1500;
  }

  update(homeTeamId, awayTeamId, homeScore, awayScore) {
    const homeRating = this.getRating(homeTeamId) + this.homeAdvantage;
    const awayRating = this.getRating(awayTeamId);

    // Expected scores
    const expectedHome = 1 / (1 + Math.pow(10, (awayRating - homeRating) / 400));
    const expectedAway = 1 - expectedHome;

    // Actual outcome
    let actualHome, actualAway;
    if (homeScore > awayScore) {
      actualHome = 1; actualAway = 0;
    } else if (homeScore < awayScore) {
      actualHome = 0; actualAway = 1;
    } else {
      actualHome = 0.5; actualAway = 0.5;
    }

    // Update ratings
    this.ratings[homeTeamId] = this.getRating(homeTeamId) + this.kFactor * (actualHome - expectedHome);
    this.ratings[awayTeamId] = this.getRating(awayTeamId) + this.kFactor * (actualAway - expectedAway);

    return {
      home_elo: Number(this.getRating(homeTeamId).toFixed(0)),
      away_elo: Number(this.getRating(awayTeamId).toFixed(0)),
      elo_expected_home: Number(expectedHome.toFixed(4)),
      elo_expected_away: Number(expectedAway.toFixed(4)),
    };
  }
}

// ─── Main Pipeline ───────────────────────────────────────────────────────────

async function computeFeatures() {
  console.log("🔄 ODDLY Feature Engineering Pipeline");
  console.log("━".repeat(60));

  // Parse args
  const leagueFilter = process.argv.find(a => a.startsWith("--league="))?.split("=")[1];

  // Fetch all historical matches sorted by date
  let query = supabase
    .from("historical_matches")
    .select("id, season, league_id, home_team_id, away_team_id, home_score, away_score, match_date, home_odds, draw_odds, away_odds")
    .order("match_date", { ascending: true });

  if (leagueFilter) {
    query = query.eq("league_id", leagueFilter);
  }

  const { data: matches, error: matchError } = await query;

  if (matchError) {
    console.error("❌ Failed to fetch matches:", matchError);
    return;
  }

  if (!matches || matches.length === 0) {
    console.log("⚠️  No historical matches found. Run 'npm run sync:fixtures' first.");
    return;
  }

  console.log(`📊 Found ${matches.length} historical matches to process`);

  // Fetch all odds snapshots
  const { data: allOdds } = await supabase
    .from("odds_snapshots")
    .select("fixture_id, home_odds, draw_odds, away_odds, bookmaker, fetched_at")
    .order("fetched_at", { ascending: true });

  // Group odds by fixture
  const oddsByFixture = {};
  if (allOdds) {
    for (const odds of allOdds) {
      if (!oddsByFixture[odds.fixture_id]) oddsByFixture[odds.fixture_id] = [];
      oddsByFixture[odds.fixture_id].push(odds);
    }
  }

  // Initialize Elo system
  const elo = new EloSystem();

  // Build team match histories
  const teamMatchHistory = {};

  for (const match of matches) {
    if (!teamMatchHistory[match.home_team_id]) teamMatchHistory[match.home_team_id] = [];
    if (!teamMatchHistory[match.away_team_id]) teamMatchHistory[match.away_team_id] = [];

    teamMatchHistory[match.home_team_id].push({
      ...match,
      gf: match.home_score,
      ga: match.away_score,
      isHome: true,
    });

    teamMatchHistory[match.away_team_id].push({
      ...match,
      gf: match.away_score,
      ga: match.home_score,
      isHome: false,
    });
  }

  // Compute features for each match
  const featuresToInsert = [];
  let processed = 0;

  for (const match of matches) {
    const homeHistory = teamMatchHistory[match.home_team_id] || [];
    const awayHistory = teamMatchHistory[match.away_team_id] || [];

    // Only use matches before this one (no data leakage)
    const homePrev = homeHistory.filter(m => m.match_date < match.match_date);
    const awayPrev = awayHistory.filter(m => m.match_date < match.match_date);

    // Form & Performance
    const homeForm5 = computeForm(homePrev.map(m => ({ gf: m.gf, ga: m.ga })), 5);
    const homeForm10 = computeForm(homePrev.map(m => ({ gf: m.gf, ga: m.ga })), 10);
    const homePPG5 = computePPG(homePrev.map(m => ({ gf: m.gf, ga: m.ga })), 5);
    const homeGoals = computeGoalsAvg(homePrev.map(m => ({ gf: m.gf, ga: m.ga })), 5);
    const homeCleanSheet = computeCleanSheetPct(homePrev.map(m => ({ gf: m.gf, ga: m.ga })), 10);
    const homeBtts = computeBttsPct(homePrev.map(m => ({ gf: m.gf, ga: m.ga })), 10);

    const awayForm5 = computeForm(awayPrev.map(m => ({ gf: m.gf, ga: m.ga })), 5);
    const awayForm10 = computeForm(awayPrev.map(m => ({ gf: m.gf, ga: m.ga })), 10);
    const awayPPG5 = computePPG(awayPrev.map(m => ({ gf: m.gf, ga: m.ga })), 5);
    const awayGoals = computeGoalsAvg(awayPrev.map(m => ({ gf: m.gf, ga: m.ga })), 5);
    const awayCleanSheet = computeCleanSheetPct(awayPrev.map(m => ({ gf: m.gf, ga: m.ga })), 10);
    const awayBtts = computeBttsPct(awayPrev.map(m => ({ gf: m.gf, ga: m.ga })), 10);

    // Home/Away
    const homeHA = computeHomeAwayStats(homePrev, match.home_team_id);
    const awayHA = computeHomeAwayStats(awayPrev, match.away_team_id);

    // H2H
    const h2h = computeH2H(homePrev.concat(awayPrev), match.home_team_id, match.away_team_id);

    // Market
    const market = computeMarketFeatures(oddsByFixture[match.id] || []);

    // Contextual
    const homeCtx = computeContextualFactors(homePrev, match.match_date, match.league_id, matches);
    const awayCtx = computeContextualFactors(awayPrev, match.match_date, match.league_id, matches);

    // Elo (compute BEFORE updating)
    const eloRatings = elo.update(match.home_team_id, match.away_team_id, match.home_score, match.away_score);

    // Actual outcome
    const actualResult = match.home_score > match.away_score ? "home"
      : match.home_score < match.away_score ? "away" : "draw";

    featuresToInsert.push({
      match_id: match.id,
      season: match.season,
      league_id: match.league_id,
      home_team_id: match.home_team_id,
      away_team_id: match.away_team_id,

      // Category 1: Form & Performance
      home_form_last5: homeForm5 || null,
      home_form_last10: homeForm10 || null,
      home_ppg_last5: homePPG5,
      home_goals_scored_avg: homeGoals.scored,
      home_goals_conceded_avg: homeGoals.conceded,
      home_clean_sheet_pct: homeCleanSheet,
      home_btts_pct: homeBtts,

      away_form_last5: awayForm5 || null,
      away_form_last10: awayForm10 || null,
      away_ppg_last5: awayPPG5,
      away_goals_scored_avg: awayGoals.scored,
      away_goals_conceded_avg: awayGoals.conceded,
      away_clean_sheet_pct: awayCleanSheet,
      away_btts_pct: awayBtts,

      // Category 2: Home/Away
      home_home_win_rate: homeHA.home_win_rate,
      home_away_win_rate: homeHA.away_win_rate,
      home_home_goals_scored: homeHA.home_goals_scored,
      home_home_goals_conceded: homeHA.home_goals_conceded,
      away_home_win_rate: awayHA.home_win_rate,
      away_away_win_rate: awayHA.away_win_rate,
      away_away_goals_scored: awayHA.away_goals_scored,
      away_away_goals_conceded: awayHA.away_goals_conceded,

      // Category 3: H2H
      h2h_home_win_rate: h2h.h2h_win_rate,
      h2h_goals_avg: h2h.h2h_goals_avg,

      // Category 4: Market
      implied_home_prob: market.implied_home_prob,
      implied_draw_prob: market.implied_draw_prob,
      implied_away_prob: market.implied_away_prob,
      market_consensus: market.market_consensus,
      odds_movement: market.odds_movement,

      // Category 5: Contextual
      home_days_since_last: homeCtx.days_since_last_match,
      away_days_since_last: awayCtx.days_since_last_match,
      home_goal_difference: homeCtx.goal_difference,
      away_goal_difference: awayCtx.goal_difference,

      // Elo
      home_elo: eloRatings.home_elo,
      away_elo: eloRatings.away_elo,
      elo_expected_home: eloRatings.elo_expected_home,
      elo_expected_away: eloRatings.elo_expected_away,

      // Actual outcome
      actual_result: actualResult,
      home_score_actual: match.home_score,
      away_score_actual: match.away_score,
      total_goals: match.home_score + match.away_score,
      both_teams_scored: match.home_score > 0 && match.away_score > 0,
    });

    processed++;
    if (processed % 100 === 0) {
      console.log(`   ... ${processed}/${matches.length} features computed`);
    }
  }

  // Insert in batches
  console.log(`\n💾 Inserting ${featuresToInsert.length} feature rows...`);

  const batchSize = 50;
  let inserted = 0;

  for (let i = 0; i < featuresToInsert.length; i += batchSize) {
    const batch = featuresToInsert.slice(i, i + batchSize);
    const { error } = await supabase
      .from("match_features")
      .upsert(batch, { onConflict: "match_id" });

    if (error) {
      console.error(`   ❌ Batch ${Math.floor(i / batchSize)} failed:`, error.message);
    } else {
      inserted += batch.length;
    }
  }

  console.log(`   ✅ ${inserted} features stored`);

  // Summary
  console.log("\n" + "━".repeat(60));
  console.log("📊 Feature Engineering Summary");
  console.log(`   Matches processed: ${processed}`);
  console.log(`   Features stored: ${inserted}`);
  console.log(`   Data points per match: 30+ (form, home/away, H2H, market, contextual, Elo)`);
  console.log("━".repeat(60));
}

computeFeatures().catch(err => {
  console.error("\n❌ Feature engineering failed:", err.message);
  process.exit(1);
});
