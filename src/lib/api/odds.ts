/**
 * Odds API Integration
 * 
 * Combines two odds providers for redundancy and coverage:
 * 1. The Odds API (the-odds-api.com) — primary, US/EU focus
 * 2. Odds-Api.io — secondary, wider coverage
 */

const THE_ODDS_API_KEY = process.env.THE_ODDS_API_KEY || "";
const ODDS_API_IO_KEY = process.env.ODDS_API_IO_KEY || "";

// Supported bookmakers
export const BOOKMAKERS = [
  "bet365",
  "betfair",
  "pinnacle",
  "betway",
  "1xbet",
  "sportybet",
  "bet9ja",
  "nairaBet",
  "merrybet",
  "nairabet",
  "betking",
] as const;

export type Bookmaker = (typeof BOOKMAKERS)[number];

// Odds API interfaces
export interface OddsFixture {
  id: string;
  sport_key: string;
  sport_title: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers: BookmakerOdds[];
}

export interface BookmakerOdds {
  key: string;
  title: string;
  last_update: string;
  markets: MarketOdds[];
}

export interface MarketOdds {
  key: string; // "h2h" | "spreads" | "totals"
  outcomes: OutcomeOdds[];
}

export interface OutcomeOdds {
  name: string;
  price: number;
  point?: number;
}

export interface ValueBet {
  fixtureId: string;
  homeTeam: string;
  awayTeam: string;
  league: string;
  kickoff: string;
  market: string;
  selection: string;
  modelProbability: number;
  bestOdds: number;
  impliedProbability: number;
  edge: number;
  bookmaker: string;
}

/**
 * Fetch upcoming fixtures with odds from The Odds API.
 */
export async function fetchOddsApiFixtures(
  sport: string = "soccer_epl",
  regions: string = "uk,eu",
  markets: string = "h2h,totals",
  bookmakers: string = "bet365,pinnacle,betway,1xbet"
): Promise<OddsFixture[]> {
  if (!THE_ODDS_API_KEY) {
    throw new Error("THE_ODDS_API_KEY not configured");
  }

  const url = `https://api.the-odds-api.com/v4/sports/${sport}/odds/?apiKey=${THE_ODDS_API_KEY}&regions=${regions}&markets=${markets}&bookmakers=${bookmakers}`;

  const response = await fetch(url);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`The Odds API error ${response.status}: ${errorText}`);
  }

  return response.json();
}

/**
 * Fetch fixtures from Odds-Api.io (secondary provider).
 */
export async function fetchOddsIoFixtures(
  sport: string = "soccer",
  bookmakers: string = "bet365,pinnacle,betway"
): Promise<unknown[]> {
  if (!ODDS_API_IO_KEY) {
    throw new Error("ODDS_API_IO_KEY not configured");
  }

  const url = `https://api.odds-api.io/v1/odds?sport=${sport}&bookmakers=${bookmakers}&apiKey=${ODDS_API_IO_KEY}`;

  const response = await fetch(url);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Odds-Api.io error ${response.status}: ${errorText}`);
  }

  return response.json();
}

/**
 * Get available sports/leagues from The Odds API.
 */
export async function getAvailableSports(): Promise<
  Array<{ key: string; title: string; active: boolean }>
> {
  if (!THE_ODDS_API_KEY) {
    throw new Error("THE_ODDS_API_KEY not configured");
  }

  const url = `https://api.the-odds-api.com/v4/sports/?apiKey=${THE_ODDS_API_KEY}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`The Odds API error ${response.status}`);
  }

  return response.json();
}

/**
 * Calculate the best odds across all bookmakers for a given market.
 */
export function findBestOdds(
  fixture: OddsFixture,
  market: "h2h" | "totals",
  selection: string
): { odds: number; bookmaker: string } | null {
  let bestOdds = 0;
  let bestBookmaker = "";

  for (const bookmaker of fixture.bookmakers) {
    const marketData = bookmaker.markets.find((m) => m.key === market);
    if (!marketData) continue;

    const outcome = marketData.outcomes.find((o) => o.name === selection);
    if (!outcome) continue;

    if (outcome.price > bestOdds) {
      bestOdds = outcome.price;
      bestBookmaker = bookmaker.title;
    }
  }

  return bestOdds > 0 ? { odds: bestOdds, bookmaker: bestBookmaker } : null;
}

/**
 * Convert decimal odds to implied probability.
 */
export function oddsToImpliedProbability(odds: number): number {
  return 1 / odds;
}

/**
 * Convert model probability to fair decimal odds.
 */
export function probabilityToFairOdds(probability: number): number {
  return 1 / probability;
}

/**
 * Calculate edge: model probability vs implied probability from odds.
 */
export function calculateEdge(
  modelProbability: number,
  odds: number
): number {
  const implied = oddsToImpliedProbability(odds);
  return modelProbability - implied;
}

/**
 * Filter fixtures for value bets using model predictions.
 * A value bet exists when model probability > implied probability.
 */
export function detectValueBets(
  fixtures: OddsFixture[],
  predictions: Array<{
    fixtureId: string;
    market: string;
    selection: string;
    probability: number;
  }>
): ValueBet[] {
  const valueBets: ValueBet[] = [];

  for (const prediction of predictions) {
    const fixture = fixtures.find((f) => f.id === prediction.fixtureId);
    if (!fixture) continue;

    const best = findBestOdds(fixture, prediction.market as "h2h" | "totals", prediction.selection);
    if (!best) continue;

    const edge = calculateEdge(prediction.probability, best.odds);

    if (edge > 0.05) {
      // Minimum 5% edge threshold
      valueBets.push({
        fixtureId: fixture.id,
        homeTeam: fixture.home_team,
        awayTeam: fixture.away_team,
        league: fixture.sport_title,
        kickoff: fixture.commence_time,
        market: prediction.market,
        selection: prediction.selection,
        modelProbability: prediction.probability,
        bestOdds: best.odds,
        impliedProbability: oddsToImpliedProbability(best.odds),
        edge,
        bookmaker: best.bookmaker,
      });
    }
  }

  // Sort by edge descending
  return valueBets.sort((a, b) => b.edge - a.edge);
}

/**
 * Check remaining API requests for The Odds API.
 */
export async function checkOddsApiUsage(): Promise<{
  used: number;
  remaining: number;
  total: number;
}> {
  if (!THE_ODDS_API_KEY) {
    throw new Error("THE_ODDS_API_KEY not configured");
  }

  const url = `https://api.the-odds-api.com/v4/sports/?apiKey=${THE_ODDS_API_KEY}`;
  const response = await fetch(url);

  const used = parseInt(response.headers.get("x-requests-used") || "0");
  const remaining = parseInt(response.headers.get("x-requests-remaining") || "0");

  return {
    used,
    remaining,
    total: used + remaining,
  };
}
