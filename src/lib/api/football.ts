/**
 * Football Data API Integration
 * 
 * Uses API-Football (api-sports.io) for fixtures, scores, and standings.
 */

const API_FOOTBALL_KEY = process.env.API_FOOTBALL_KEY || "";
const API_FOOTBALL_BASE = "https://v3.football.api-sports.io";

// League IDs for popular leagues
export const LEAGUE_IDS: Record<string, number> = {
  EPL: 39,
  "La Liga": 140,
  Bundesliga: 78,
  "Serie A": 135,
  "Ligue 1": 61,
  Eredivisie: 88,
  "Primeira Liga": 94,
  NPFL: 168,
  Brasileirão: 71,
  MLS: 253,
  "Champions League": 2,
  "Europa League": 3,
  "World Cup": 1,
};

// Football API interfaces
export interface FootballFixture {
  id: number;
  league: {
    id: number;
    name: string;
    country: string;
    logo: string;
    flag: string;
    season: number;
  };
  teams: {
    home: { id: number; name: string; logo: string; winner: boolean | null };
    away: { id: number; name: string; logo: string; winner: boolean | null };
  };
  goals: { home: number | null; away: number | null };
  score: {
    halftime: { home: number | null; away: number | null };
    fulltime: { home: number | null; away: number | null };
  };
  fixture: {
    id: number;
    date: string;
    timestamp: number;
    status: {
      short: string; // "NS" | "1H" | "HT" | "2H" | "FT" | etc.
      long: string;
      elapsed: number | null;
    };
  };
  statistics?: Array<{
    type: string;
    value: string | number;
  }>;
}

export interface TeamStanding {
  rank: number;
  team: { id: number; name: string; logo: string };
  points: number;
  goalsDiff: number;
  form: string;
  status: string;
  all: {
    played: number;
    win: number;
    draw: number;
    lose: number;
    goals: { for: number; against: number };
  };
}

export interface TeamForm {
  team: { id: number; name: string };
  fixtures: {
    played: number;
    wins: number;
    draws: number;
    loses: number;
  };
  goals: {
    for: { total: number; average: number };
    against: { total: number; average: number };
  };
  form: string; // "WWWDWL"
}

// ==========================================
// API-Football (secondary — free plan limited to 2022-2024 seasons)
// Primary data source is The Odds API (see sync/odds.ts)
// ==========================================

async function apiFootballFetch(endpoint: string): Promise<unknown> {
  if (!API_FOOTBALL_KEY) {
    throw new Error("API_FOOTBALL_KEY not configured");
  }

  const response = await fetch(`${API_FOOTBALL_BASE}${endpoint}`, {
    headers: {
      "x-apisports-key": API_FOOTBALL_KEY,
    },
  });

  if (!response.ok) {
    throw new Error(`API-Football error: ${response.status}`);
  }

  const data = await response.json();
  
  if (data.errors && Object.keys(data.errors).length > 0) {
    throw new Error(`API-Football: ${JSON.stringify(data.errors)}`);
  }

  return data;
}

// ==========================================
// ==========================================
// Combined API with fallback
// ==========================================

interface LeagueStandings { league: { standings: TeamStanding[][] } }
interface StandingsApiResponse { response: LeagueStandings[] }



/**
 * Get today's fixtures for a specific league.
 */
export async function getTodayFixtures(
  leagueId: number,
  season?: number
): Promise<FootballFixture[]> {
  // Free plan supports seasons 2022-2024 only.
  // For 2026+ fixtures, The Odds API is the primary source (see sync/odds.ts).
  // This function is used as a secondary fallback for live score updates.
  const currentSeason = season || Math.min(new Date().getFullYear(), 2024);
  const today = new Date().toISOString().split("T")[0];

  try {
    const result = await apiFootballFetch(
      `/fixtures?league=${leagueId}&date=${today}&season=${currentSeason}`
    ) as { response: FootballFixture[] };
    return result.response || [];
  } catch (error) {
    // Silently return empty if season not supported on free plan
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("Free plans do not have access")) {
      return []; // Expected for 2026+ seasons on free plan
    }
    throw error;
  }
}

/**
 * Get fixtures for a date range.
 */
export async function getFixturesByDate(
  leagueId: number,
  from: string,
  to: string,
  season?: number
): Promise<FootballFixture[]> {
  const currentSeason = season || Math.min(new Date().getFullYear(), 2024);

  try {
    const result = await apiFootballFetch(
      `/fixtures?league=${leagueId}&from=${from}&to=${to}&season=${currentSeason}`
    ) as { response: FootballFixture[] };
    return result.response || [];
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("Free plans do not have access")) return [];
    throw error;
  }
}

/**
 * Get league standings.
 */
export async function getStandings(
  leagueId: number,
  season?: number
): Promise<TeamStanding[]> {
  const currentSeason = season || new Date().getFullYear();

  try {
    const result = (await apiFootballFetch(
      `/standings?league=${leagueId}&season=${currentSeason}`
    )) as StandingsApiResponse;
    return result.response[0]?.league?.standings[0] || [];
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("Free plans do not have access")) return [];
    throw error;
  }
}

/**
 * Get team recent form (last 5-10 matches).
 */
export async function getTeamForm(teamId: number): Promise<TeamForm> {
  try {
    const result = (await apiFootballFetch(`/teams/statistics?team=${teamId}&league=39&season=2024`)) as { response: TeamForm };
    return result.response;
  } catch {
    return { team: { id: teamId, name: "" }, fixtures: { played: 0, wins: 0, draws: 0, loses: 0 }, goals: { for: { total: 0, average: 0 }, against: { total: 0, average: 0 } }, form: "" };
  }
}

/**
 * Search for a team by name.
 */
export async function searchTeam(
  name: string
): Promise<Array<{ id: number; name: string; country: string; logo: string }>> {
  try {
    const result = await apiFootballFetch(`/teams?search=${encodeURIComponent(name)}`) as {
      response: Array<{ team: { id: number; name: string; country: string; logo: string } }>;
    };
    return result.response.map((r) => r.team);
  } catch {
    return [];
  }
}

/**
 * Get head-to-head record between two teams.
 */
export async function getHeadToHead(
  team1Id: number,
  team2Id: number
): Promise<FootballFixture[]> {  try {
    const result = await apiFootballFetch(`/fixtures?h2h=${team1Id}-${team2Id}`) as { response: FootballFixture[] };
    return result.response || [];
  } catch {
    return [];
  }
}

/**
 * Get live fixtures across all tracked leagues.
 */
export async function getLiveFixtures(): Promise<FootballFixture[]> {
  const liveFixtures: FootballFixture[] = [];

  for (const [name, leagueId] of Object.entries(LEAGUE_IDS)) {
    try {
      const fixtures = await getTodayFixtures(leagueId);
      const live = fixtures.filter((f) => 
        ["1H", "HT", "2H", "ET", "P", "BT"].includes(f.fixture.status.short)
      );
      liveFixtures.push(...live);
    } catch (error) {
      console.warn(`Failed to fetch live fixtures for ${name}:`, error);
    }
  }

  return liveFixtures;
}

/**
 * Get all upcoming fixtures across all tracked leagues for today.
 */
/**
 * Get all upcoming fixtures across all tracked leagues for today.
 * NOTE: On free plan, this returns empty for 2026+ seasons.
 * The Odds API (sync/odds.ts) is the primary source for current fixtures.
 */
export async function getAllTodayFixtures(): Promise<FootballFixture[]> {
  const allFixtures: FootballFixture[] = [];

  for (const [name, leagueId] of Object.entries(LEAGUE_IDS)) {
    try {
      const fixtures = await getTodayFixtures(leagueId);
      allFixtures.push(...fixtures);
    } catch (error) {
      console.warn(`Failed to fetch fixtures for ${name}:`, error);
    }
  }

  return allFixtures.sort(
    (a, b) => a.fixture.timestamp - b.fixture.timestamp
  );
}
