#!/usr/bin/env node

/**
 * ODDLY Market-Specific Prediction Models v2
 * 
 * Three independent models, each optimized for its market:
 * 
 * 1X2 MODEL — Match result prediction
 *   Features: Home/away PPG, Elo, H2H, goal difference, league position,
 *             streaks, home/away win rates, xG differential, fatigue
 *   Optimized for: correct win/draw/away classification
 * 
 * OVER/UNDER MODEL — Total goals prediction
 *   Features: Combined xG, team attack ratings, defensive ratings,
 *             league avg goals, BTTS rate, home/away goal rates
 *   Optimized for: total goals line accuracy
 * 
 * BTTS MODEL — Both teams to score
 *   Features: Both teams' scoring consistency, defensive vulnerability,
 *             home/away goal patterns, H2H BTTS rate, shot quality
 *   Optimized for: both-teams-scored classification
 * 
 * Each model produces calibrated probabilities.
 * The system then uses smart selection to pick the best market per match.
 */

const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");
const path = require("path");

function loadEnv() {
  const envPath = path.join(__dirname, "..", ".env.local");
  const env = {};
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    let val = t.slice(i + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
      val = val.slice(1, -1);
    env[t.slice(0, i).trim()] = val;
  }
  return env;
}

const env = loadEnv();
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

function clamp(v, lo = 0.01, hi = 0.99) { return Math.max(lo, Math.min(hi, v)); }

// ═══════════════════════════════════════════════════════════════════════════
// DATA TRACKER — Shared state for all models
// ═══════════════════════════════════════════════════════════════════════════

class MatchTracker {
  constructor() {
    this.history = {};
    this.elo = {};
    this.h2h = {};
    this.leagueTable = {};
    this.leagueAvgGoals = {};
    this.leagueMatchCount = {};
  }

  recordMatch(home, away, hg, ag, date, leagueId) {
    if (!this.history[home]) this.history[home] = [];
    if (!this.history[away]) this.history[away] = [];
    this.history[home].push({ opp: away, gf: hg, ga: ag, isHome: true, date });
    this.history[away].push({ opp: home, gf: ag, ga: hg, isHome: false, date });
    if (this.history[home].length > 60) this.history[home].shift();
    if (this.history[away].length > 60) this.history[away].shift();

    // H2H
    const h2hKey = [home, away].sort().join(" vs ");
    if (!this.h2h[h2hKey]) this.h2h[h2hKey] = [];
    this.h2h[h2hKey].push({ home, away, hg, ag });

    // League stats
    if (leagueId) {
      if (!this.leagueAvgGoals[leagueId]) { this.leagueAvgGoals[leagueId] = 0; this.leagueMatchCount[leagueId] = 0; }
      this.leagueAvgGoals[leagueId] += hg + ag;
      this.leagueMatchCount[leagueId]++;

      if (!this.leagueTable[leagueId]) this.leagueTable[leagueId] = {};
      const lt = this.leagueTable[leagueId];
      for (const [team, gf, ga] of [[home, hg, ag], [away, ag, hg]]) {
        if (!lt[team]) lt[team] = { played: 0, won: 0, drawn: 0, gf: 0, ga: 0, pts: 0 };
        lt[team].played++;
        lt[team].gf += gf;
        lt[team].ga += ga;
        if (gf > ga) { lt[team].won++; lt[team].pts += 3; }
        else if (gf === ga) { lt[team].drawn++; lt[team].pts += 1; }
      }
    }

    this.updateElo(home, away, hg, ag);
  }

  updateElo(home, away, hg, ag) {
    const h = (this.elo[home] || 1500) + 65;
    const a = this.elo[away] || 1500;
    const eH = 1 / (1 + Math.pow(10, (a - h) / 400));
    const actual = hg > ag ? 1 : hg < ag ? 0 : 0.5;
    this.elo[home] = (this.elo[home] || 1500) + 32 * (actual - eH);
    this.elo[away] = (this.elo[away] || 1500) + 32 * ((1 - actual) - (1 - eH));
  }

  getLeagueAvgGoals(leagueId) {
    if (!leagueId || !this.leagueMatchCount[leagueId]) return 2.6;
    return this.leagueAvgGoals[leagueId] / this.leagueMatchCount[leagueId];
  }

  getTeamStats(team) {
    const hist = (this.history[team] || []).slice(-20);
    if (hist.length < 3) return this.defaultStats();

    const r5 = hist.slice(-5);
    const r10 = hist.slice(-10);
    const home = hist.filter(m => m.isHome).slice(-8);
    const away = hist.filter(m => !m.isHome).slice(-8);
    const lastMatch = hist[hist.length - 1];
    const daysAgo = lastMatch?.date ? Math.max(1, Math.floor((Date.now() - new Date(lastMatch.date).getTime()) / 86400000)) : 7;

    // Scoring consistency (how often they score)
    const scoresInR10 = r10.filter(m => m.gf > 0).length;
    const concedesInR10 = r10.filter(m => m.ga > 0).length;

    return {
      // Core
      ppg: this._ppg(r5),
      goalsFor: this._avg(r5, "gf"),
      goalsAgainst: this._avg(r5, "ga"),
      winRate: this._winRate(r5),

      // Home/Away specific
      homePPG: home.length > 0 ? this._ppg(home) : 1.6,
      homeGF: home.length > 0 ? this._avg(home, "gf") : 1.4,
      homeGA: home.length > 0 ? this._avg(home, "ga") : 1.1,
      homeWinRate: this._winRate(home),
      awayPPG: away.length > 0 ? this._ppg(away) : 1.2,
      awayGF: away.length > 0 ? this._avg(away, "gf") : 1.0,
      awayGA: away.length > 0 ? this._avg(away, "ga") : 1.3,
      awayWinRate: this._winRate(away),

      // Defensive
      cleanSheetRate: r10.filter(m => m.ga === 0).length / r10.length,
      shutoutRate: r10.filter(m => m.ga === 0).length / r10.length,

      // Scoring consistency
      scoresInR10: scoresInR10 / r10.length,
      concedesInR10: concedesInR10 / r10.length,

      // Goals per match distributions
      avgTotalGoals: r10.reduce((s, m) => s + m.gf + m.ga, 0) / r10.length,
      over25Rate: r10.filter(m => m.gf + m.ga > 2.5).length / r10.length,
      over15Rate: r10.filter(m => m.gf + m.ga > 1.5).length / r10.length,
      under35Rate: r10.filter(m => m.gf + m.ga < 3.5).length / r10.length,

      // BTTS
      bttsRate: r10.filter(m => m.gf > 0 && m.ga > 0).length / r10.length,
      bothScoredLast5: r5.filter(m => m.gf > 0 && m.ga > 0).length / r5.length,

      // Streaks
      streak: this.getStreak(hist),

      // Fatigue
      daysSinceLast: daysAgo,

      // Form string
      form5: r5.map(m => m.gf > m.ga ? "W" : m.gf < m.ga ? "L" : "D").join(""),
    };
  }

  defaultStats() {
    return {
      ppg: 1.5, goalsFor: 1.3, goalsAgainst: 1.2, winRate: 0.4,
      homePPG: 1.6, homeGF: 1.4, homeGA: 1.1, homeWinRate: 0.45,
      awayPPG: 1.2, awayGF: 1.0, awayGA: 1.3, awayWinRate: 0.30,
      cleanSheetRate: 0.25, shutoutRate: 0.25,
      scoresInR10: 0.7, concedesInR10: 0.75,
      avgTotalGoals: 2.5, over25Rate: 0.50, over15Rate: 0.75, under35Rate: 0.60,
      bttsRate: 0.50, bothScoredLast5: 0.50,
      streak: 0, daysSinceLast: 7, form5: "WDLWW",
    };
  }

  getStreak(hist) {
    let s = 0;
    for (let i = hist.length - 1; i >= 0; i--) {
      const won = hist[i].gf > hist[i].ga;
      const lost = hist[i].gf < hist[i].ga;
      if (s >= 0 && won) s++;
      else if (s <= 0 && lost) s--;
      else break;
    }
    return s;
  }

  getH2H(home, away) {
    const key = [home, away].sort().join(" vs ");
    const matches = (this.h2h[key] || []).slice(-10);
    if (matches.length < 2) return { h2hHomeWins: 0.40, h2hDraws: 0.25, h2hAwayWins: 0.35, h2hAvgGoals: 2.6, h2hBTTS: 0.50 };
    let hW = 0, d = 0, aW = 0, totalGoals = 0, bttsCount = 0;
    for (const m of matches) {
      const hG = m.home === home ? m.hg : m.ag;
      const aG = m.home === home ? m.ag : m.hg;
      totalGoals += hG + aG;
      if (hG > aG) hW++;
      else if (hG === aG) d++;
      else aW++;
      if (hG > 0 && aG > 0) bttsCount++;
    }
    const n = matches.length;
    return {
      h2hHomeWins: hW / n,
      h2hDraws: d / n,
      h2hAwayWins: aW / n,
      h2hAvgGoals: totalGoals / n,
      h2hBTTS: bttsCount / n,
    };
  }

  _ppg(matches) {
    return matches.reduce((s, m) => s + (m.gf > m.ga ? 3 : m.gf === m.ga ? 1 : 0), 0) / Math.max(1, matches.length);
  }
  _avg(matches, key) {
    return matches.reduce((s, m) => s + m[key], 0) / Math.max(1, matches.length);
  }
  _winRate(matches) {
    return matches.filter(m => m.gf > m.ga).length / Math.max(1, matches.length);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// MODEL 1: 1X2 — Match Result
// ═══════════════════════════════════════════════════════════════════════════

class Model1X2 {
  predict(homeStats, awayStats, h2h, eloDiff, leagueAvg) {
    // ─── Home win probability ──────────────────────────────────────────
    let pH = 0.40; // Base home advantage

    // Elo power
    const eloExpected = 1 / (1 + Math.pow(10, (-eloDiff - 65) / 400));
    pH += (eloExpected - 0.45) * 0.35;

    // Home-specific form (strongest signal)
    pH += (homeStats.homePPG - 1.6) * 0.08;
    pH += (homeStats.homeWinRate - 0.45) * 0.10;
    pH += (homeStats.homeGF - 1.4) * 0.03;
    pH -= (homeStats.homeGA - 1.1) * 0.04;

    // Away weakness
    pH += (1 - awayStats.awayWinRate - 0.30) * 0.08;
    pH -= (awayStats.awayGF - 1.0) * 0.03;
    pH += (awayStats.awayGA - 1.3) * 0.04;

    // Clean sheets
    pH += (homeStats.cleanSheetRate - 0.25) * 0.06;
    pH -= (awayStats.scoresInR10 - 0.65) * 0.05;

    // H2H
    pH += (h2h.h2hHomeWins - 0.40) * 0.06;

    // Streaks
    pH += (homeStats.streak > 2 ? 0.04 : homeStats.streak < -2 ? -0.04 : 0);
    pH -= (awayStats.streak > 2 ? 0.03 : awayStats.streak < -2 ? -0.03 : 0);

    // Fatigue
    const homeRest = clamp((homeStats.daysSinceLast - 5) * 0.004, -0.025, 0.025);
    const awayRest = clamp((awayStats.daysSinceLast - 5) * -0.004, -0.025, 0.025);
    pH += homeRest + awayRest;

    pH = clamp(pH, 0.05, 0.90);

    // ─── Draw probability ──────────────────────────────────────────────
    let pD = h2h.h2hDraws * 0.15;
    pD += (homeStats.ppg + awayStats.ppg < 3.0 ? 0.04 : -0.02); // Low-scoring teams draw more
    pD += Math.abs(homeStats.ppg - awayStats.ppg) < 0.3 ? 0.03 : 0; // Close teams draw more
    pD += (leagueAvg < 2.4 ? 0.02 : -0.01);
    pD += 0.22; // Base draw rate
    pD = clamp(pD, 0.12, 0.38);

    // ─── Away win probability ──────────────────────────────────────────
    let pA = 1 - pH - pD;
    pA = clamp(pA, 0.05, 0.85);

    // Normalize
    const total = pH + pD + pA;
    pH /= total; pD /= total; pA /= total;

    return {
      homeWin: clamp(pH),
      draw: clamp(pD),
      awayWin: clamp(pA),
      model: "1X2",
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// MODEL 2: Over/Under — Total Goals
// ═══════════════════════════════════════════════════════════════════════════

class ModelOU {
  predict(homeStats, awayStats, h2h, eloDiff, leagueAvg) {
    // ─── Expected total goals ──────────────────────────────────────────
    const combinedAttack = (homeStats.homeGF + awayStats.awayGF) / 2;
    const combinedDefense = (homeStats.homeGA + awayStats.awayGA) / 2;

    // Base: league average
    let expectedTotal = leagueAvg;

    // Attack quality adjustment
    expectedTotal += (combinedAttack - 1.2) * 0.8;

    // Defensive quality (weaker defenses = more goals)
    expectedTotal += (combinedDefense - 1.2) * 0.6;

    // H2H goal tendency
    expectedTotal += (h2h.h2hAvgGoals - leagueAvg) * 0.2;

    // Elo mismatch (mismatches can be high-scoring or low-scoring)
    if (Math.abs(eloDiff) > 200) expectedTotal -= 0.15; // Dominant teams sometimes control games
    if (Math.abs(eloDiff) < 50) expectedTotal += 0.10; // Close games tend to be open

    expectedTotal = clamp(expectedTotal, 1.0, 5.5);

    // ─── Convert to over/under probabilities using Poisson ──────────────
    const lambda = expectedTotal / 2; // Split between teams for Poisson
    const p0 = Math.exp(-expectedTotal);
    const p1 = expectedTotal * Math.exp(-expectedTotal);
    const p2 = (expectedTotal ** 2 / 2) * Math.exp(-expectedTotal);
    const p3 = (expectedTotal ** 3 / 6) * Math.exp(-expectedTotal);

    // Cumulative under probabilities
    const under05 = p0;
    const under15 = p0 + p1;
    const under25 = p0 + p1 + p2;
    const under35 = p0 + p1 + p2 + p3;
    const under45 = under35 + (expectedTotal ** 4 / 24) * Math.exp(-expectedTotal);

    return {
      over05: clamp(1 - under05),
      under05: clamp(under05),
      over15: clamp(1 - under15),
      under15: clamp(under15),
      over25: clamp(1 - under25),
      under25: clamp(under25),
      over35: clamp(1 - under35),
      under35: clamp(under35),
      over45: clamp(1 - under45),
      under45: clamp(under45),
      expectedTotal: Math.round(expectedTotal * 100) / 100,
      model: "OU",
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// MODEL 3: BTTS — Both Teams to Score
// ═══════════════════════════════════════════════════════════════════════════

class ModelBTTS {
  predict(homeStats, awayStats, h2h, eloDiff, leagueAvg) {
    // ─── Base BTTS rate from team tendencies ────────────────────────────
    let pBTTS = 0.50;

    // Home team scoring consistency
    pBTTS += (homeStats.scoresInR10 - 0.65) * 0.12;
    // Away team scoring consistency
    pBTTS += (awayStats.scoresInR10 - 0.65) * 0.12;

    // Defensive vulnerability (both teams conceding = BTTS more likely)
    pBTTS += (homeStats.concedesInR10 - 0.70) * 0.08;
    pBTTS += (awayStats.concedesInR10 - 0.70) * 0.08;

    // BTTS history
    pBTTS += (homeStats.bttsRate - 0.50) * 0.10;
    pBTTS += (awayStats.bttsRate - 0.50) * 0.10;

    // Recent BTTS tendency
    pBTTS += (homeStats.bothScoredLast5 - 0.50) * 0.06;
    pBTTS += (awayStats.bothScoredLast5 - 0.50) * 0.06;

    // H2H BTTS rate
    pBTTS += (h2h.h2hBTTS - 0.50) * 0.12;

    // Goal output (higher-scoring teams BTTS more)
    pBTTS += (homeStats.homeGF - 1.2) * 0.04;
    pBTTS += (awayStats.awayGF - 1.0) * 0.04;

    // Clean sheet rate (strong defenses reduce BTTS)
    pBTTS -= (homeStats.cleanSheetRate - 0.25) * 0.06;
    pBTTS -= (awayStats.cleanSheetRate - 0.25) * 0.06;

    // League tendency
    pBTTS += (leagueAvg - 2.6) * 0.03;

    // Defensive weakness dominance (if both concede = BTTS very likely)
    if (homeStats.concedesInR10 > 0.80 && awayStats.concedesInR10 > 0.80) {
      pBTTS += 0.05;
    }

    // Strong defenses suppress BTTS
    if (homeStats.cleanSheetRate > 0.40 && awayStats.cleanSheetRate > 0.40) {
      pBTTS -= 0.08;
    }

    pBTTS = clamp(pBTTS, 0.15, 0.85);

    return {
      bttsYes: clamp(pBTTS),
      bttsNo: clamp(1 - pBTTS),
      model: "BTTS",
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SMART SELECTOR — Pick best market per match
// ═══════════════════════════════════════════════════════════════════════════

function selectBestMarket(r1X2, rOU, rBTTS) {
  const candidates = [];

  // 1X2 picks
  candidates.push({ market: "1X2", selection: "Home", probability: r1X2.homeWin, label: "Home Win" });
  candidates.push({ market: "1X2", selection: "Draw", probability: r1X2.draw, label: "Draw" });
  candidates.push({ market: "1X2", selection: "Away", probability: r1X2.awayWin, label: "Away Win" });

  // Over/Under picks
  candidates.push({ market: "OU", selection: "Over_2.5", probability: rOU.over25, label: "Over 2.5" });
  candidates.push({ market: "OU", selection: "Under_2.5", probability: rOU.under25, label: "Under 2.5" });
  candidates.push({ market: "OU", selection: "Over_1.5", probability: rOU.over15, label: "Over 1.5" });
  candidates.push({ market: "OU", selection: "Under_3.5", probability: rOU.under35, label: "Under 3.5" });
  candidates.push({ market: "OU", selection: "Over_0.5", probability: rOU.over05, label: "Over 0.5" });
  candidates.push({ market: "OU", selection: "Under_4.5", probability: rOU.under45, label: "Under 4.5" });

  // BTTS picks
  candidates.push({ market: "BTTS", selection: "Yes", probability: rBTTS.bttsYes, label: "BTTS Yes" });
  candidates.push({ market: "BTTS", selection: "No", probability: rBTTS.bttsNo, label: "BTTS No" });

  // Score: confidence × probability
  for (const c of candidates) {
    c.score = c.probability * c.probability;
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates;
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  console.log("🎯 ODDLY Market-Specific Models v2");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  const tracker = new MatchTracker();
  const model1X2 = new Model1X2();
  const modelOU = new ModelOU();
  const modelBTTS = new ModelBTTS();

  // Load historical matches
  console.log("   Loading historical matches...");
  let offset = 0, loaded = 0;
  while (true) {
    const { data: batch } = await supabase
      .from("fixtures")
      .select("home_score, away_score, kickoff_time, league_id, home:teams!fixtures_home_team_id_fkey(canonical_name), away:teams!fixtures_away_team_id_fkey(canonical_name)")
      .eq("status", "finished").not("home_score", "is", null)
      .order("kickoff_time", { ascending: true })
      .range(offset, offset + 999);
    if (!batch || batch.length === 0) break;
    for (const m of batch) {
      const home = m.home?.canonical_name, away = m.away?.canonical_name;
      if (home && away) tracker.recordMatch(home, away, m.home_score, m.away_score, m.kickoff_time, m.league_id);
    }
    loaded += batch.length; offset += 999;
    if (batch.length < 1000) break;
  }
  console.log(`   Loaded ${loaded} historical matches`);

  // Get upcoming fixtures
  const now = new Date().toISOString();
  const { data: upcoming } = await supabase
    .from("fixtures")
    .select(`id, kickoff_time, league_id,
      home:teams!fixtures_home_team_id_fkey(canonical_name, logo),
      away:teams!fixtures_away_team_id_fkey(canonical_name, logo),
      league:leagues!fixtures_league_id_fkey(name, logo)`)
    .eq("status", "scheduled").gte("kickoff_time", now)
    .order("kickoff_time", { ascending: true });

  if (!upcoming || upcoming.length === 0) { console.log("   No upcoming fixtures."); return; }
  console.log(`   Found ${upcoming.length} upcoming fixtures\n`);

  // Get odds
  const fixtureIds = upcoming.map(f => f.id);
  const { data: oddsData } = await supabase.from("odds_snapshots").select("fixture_id, selection, odds").in("fixture_id", fixtureIds);
  const oddsByFixture = {};
  for (const o of oddsData || []) {
    if (!oddsByFixture[o.fixture_id]) oddsByFixture[o.fixture_id] = {};
    if (!oddsByFixture[o.fixture_id][o.selection]) oddsByFixture[o.fixture_id][o.selection] = [];
    oddsByFixture[o.fixture_id][o.selection].push(o.odds);
  }
  const avgOdds = (arr) => arr && arr.length > 0 ? arr.reduce((s, v) => s + v, 0) / arr.length : null;

  // Generate predictions
  let totalMatches = 0, eliteCount = 0;
  const allPredictions = [];

  for (const fixture of upcoming) {
    const home = fixture.home?.canonical_name;
    const away = fixture.away?.canonical_name;
    if (!home || !away) continue;

    const hs = tracker.getTeamStats(home);
    const as = tracker.getTeamStats(away);
    const h2h = tracker.getH2H(home, away);
    const eloDiff = (tracker.elo[home] || 1500) - (tracker.elo[away] || 1500);
    const leagueAvg = tracker.getLeagueAvgGoals(fixture.league_id);

    // Run all three models
    const r1X2 = model1X2.predict(hs, as, h2h, eloDiff, leagueAvg);
    const rOU = modelOU.predict(hs, as, h2h, eloDiff, leagueAvg);
    const rBTTS = modelBTTS.predict(hs, as, h2h, eloDiff, leagueAvg);

    // Smart selection
    const candidates = selectBestMarket(r1X2, rOU, rBTTS);
    const best = candidates[0];
    const tier = best.probability >= 0.70 ? "ELITE" : best.probability >= 0.60 ? "HIGH" : best.probability >= 0.50 ? "MEDIUM" : "LOW";

    // Store all market predictions
    const predictions = [
      { fixture_id: fixture.id, market: "1X2", selection: "Home", model_probability: r1X2.homeWin, model_version: "v4.0-market-specific" },
      { fixture_id: fixture.id, market: "1X2", selection: "Draw", model_probability: r1X2.draw, model_version: "v4.0-market-specific" },
      { fixture_id: fixture.id, market: "1X2", selection: "Away", model_probability: r1X2.awayWin, model_version: "v4.0-market-specific" },
      { fixture_id: fixture.id, market: "over_under", selection: "over_2.5", model_probability: rOU.over25, model_version: "v4.0-market-specific" },
      { fixture_id: fixture.id, market: "over_under", selection: "under_2.5", model_probability: rOU.under25, model_version: "v4.0-market-specific" },
      { fixture_id: fixture.id, market: "over_under", selection: "over_1.5", model_probability: rOU.over15, model_version: "v4.0-market-specific" },
      { fixture_id: fixture.id, market: "over_under", selection: "under_3.5", model_probability: rOU.under35, model_version: "v4.0-market-specific" },
      { fixture_id: fixture.id, market: "over_under", selection: "over_0.5", model_probability: rOU.over05, model_version: "v4.0-market-specific" },
      { fixture_id: fixture.id, market: "over_under", selection: "under_4.5", model_probability: rOU.under45, model_version: "v4.0-market-specific" },
      { fixture_id: fixture.id, market: "btts", selection: "yes", model_probability: rBTTS.bttsYes, model_version: "v4.0-market-specific" },
      { fixture_id: fixture.id, market: "btts", selection: "no", model_probability: rBTTS.bttsNo, model_version: "v4.0-market-specific" },
    ];
    allPredictions.push(...predictions);
    totalMatches++;
    if (tier === "ELITE") eliteCount++;

    const leagueLabel = fixture.league?.name || "?";
    const matchLabel = `${home} vs ${away}`;
    console.log(`  ${leagueLabel.padEnd(18)} ${matchLabel.padEnd(30)} Best: ${best.label} ${Math.round(best.probability * 100)}% [${tier}]`);
  }

  // Delete old predictions and insert new
  console.log(`\n   Clearing old predictions...`);
  await supabase.from("predictions").delete().gte("created_at", "2026-01-01T00:00:00Z");

  console.log(`   Inserting ${allPredictions.length} predictions...`);
  for (let i = 0; i < allPredictions.length; i += 50) {
    const batch = allPredictions.slice(i, i + 50);
    const { error } = await supabase.from("predictions").insert(batch);
    if (error) console.log(`   ⚠️  Batch error: ${error.message}`);
  }

  console.log(`\n${"━".repeat(60)}`);
  console.log(`✅ Generated ${totalMatches} match predictions (${allPredictions.length} market predictions)`);
  console.log(`   ELITE picks: ${eliteCount}`);
  console.log(`   Model versions: 1X2 (v4.0) | O/U (v4.0) | BTTS (v4.0)`);
  console.log(`${"━".repeat(60)}`);
}

main().catch(e => { console.error("❌", e.message); process.exit(1); });
