/**
 * Football Data API Integration
 * 
 * Uses two football data providers for redundancy:
 * 1. API-Football (api-football.com via RapidAPI) — primary
 * 2. APISports (apifootball.com) — secondary/fallback
 */

const API_FOOTBALL_KEY = process.env.API_FOOTBALL_KEY || "";
const APISPORTS_KEY = process.env.APISPORTS_KEY || "";

// API-Football uses RapidAPI format
const API_FOOTBALL_BASE = "https://v3.football.api-sports.io";
// APISports uses apifootball.com
const APISPORTS_BASE = "https://api-football-v1.p.rapidapi.com/v3";

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
// API-Football (primary)
// ==========================================

async function apiFootballFetch(endpoint: string): Promise<unknown> {
  if (!API_FOOTBALL_KEY) {
    throw new Error("API_FOOTBALL_KEY not configured");
  }

  const response = await fetch(`${API_FOOTBALL_BASE}${endpoint}`, {
    headers: {
      "x-rapidapi-key": API_FOOTBALL_KEY,
      "x-rapidapi-host": "v3.football.api-sports.io",
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
// APISports (fallback)
// ==========================================

async function apisportsFetch(endpoint: string): Promise<unknown> {
  if (!APISPORTS_KEY) {
    throw new Error("APISPORTS_KEY not configured");
  }

  const response = await fetch(`${APISPORTS_BASE}${endpoint}`, {
    headers: {
      "x-rapidapi-key": APISPORTS_KEY,
      "x-rapidapi-host": "api-football-v1.p.rapidapi.com",
    },
  });

  if (!response.ok) {
    throw new Error(`APISports error: ${response.status}`);
  }

  return response.json();
}

// ==========================================
// Combined API with fallback
// ==========================================

interface LeagueStandings { league: { standings: TeamStanding[][] } }
interface StandingsApiResponse { response: LeagueStandings[] }

async function fetchWithFallback<T>(
  primaryFn: () => Promise<T>,
  fallbackFn: () => Promise<T>
): Promise<T> {
  try {
    return await primaryFn();
  } catch (primaryError) {
    console.warn("Primary API failed, trying fallback:", primaryError);
    try {
      return await fallbackFn();
    } catch (fallbackError) {
      throw new Error(`Both APIs failed. Primary: ${primaryError}. Fallback: ${fallbackError}`);
    }
  }
}

/**
 * Get today's fixtures for a specific league.
 */
export async function getTodayFixtures(
  leagueId: number,
  season?: number
): Promise<FootballFixture[]> {
  // Free plan only supports 2022-2024 seasons
  // Use current year but fall back to 2024 if free plan rejects
  const currentSeason = season || Math.min(new Date().getFullYear(), 2024);
  const today = new Date().toISOString().split("T")[0];

  const data = await fetchWithFallback(
    async () => {
      const result = await apiFootballFetch(
        `/fixtures?league=${leagueId}&date=${today}&season=${currentSeason}`
      ) as { response: FootballFixture[] };
      return result.response;
    },
    async () => {
      const result = await apisportsFetch(
        `/fixtures?league=${leagueId}&date=${today}&season=${currentSeason}`
      ) as { response: FootballFixture[] };
      return result.response;
    }
  );

  return data;
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

  const data = await fetchWithFallback(
    async () => {
      const result = await apiFootballFetch(
        `/fixtures?league=${leagueId}&from=${from}&to=${to}&season=${currentSeason}`
      ) as { response: FootballFixture[] };
      return result.response;
    },
    async () => {
      const result = await apisportsFetch(
        `/fixtures?league=${leagueId}&from=${from}&to=${to}&season=${currentSeason}`
      ) as { response: FootballFixture[] };
      return result.response;
    }
  );

  return data;
}

/**
 * Get league standings.
 */
export async function getStandings(
  leagueId: number,
  season?: number
): Promise<TeamStanding[]> {
  const currentSeason = season || new Date().getFullYear();

  const data = await fetchWithFallback(
    async () => {
      const result = (await apiFootballFetch(
        `/standings?league=${leagueId}&season=${currentSeason}`
      )) as StandingsApiResponse;
      return result.response[0]?.league?.standings[0] || [];
    },
    async () => {
      const result = (await apisportsFetch(
        `/standings?league=${leagueId}&season=${currentSeason}`
      )) as StandingsApiResponse;
      return result.response[0]?.league?.standings[0] || [];
    }
  );

  return data;
}

/**
 * Get team recent form (last 5-10 matches).
 */
export async function getTeamForm(teamId: number): Promise<TeamForm> {
  const data = await fetchWithFallback(
    async () => {
      const result = (await apiFootballFetch(`/teams/statistics?team=${teamId}&league=39&season=2024`)) as { response: TeamForm };
      return result.response;
    },
    async () => {
      const result = (await apisportsFetch(`/teams/statistics?team=${teamId}&league=39&season=2024`)) as { response: TeamForm };
      return result.response;
    }
  );

  return data;
}

/**
 * Search for a team by name.
 */
export async function searchTeam(
  name: string
): Promise<Array<{ id: number; name: string; country: string; logo: string }>> {
  const data = await fetchWithFallback(
    async () => {
      const result = await apiFootballFetch(`/teams?search=${encodeURIComponent(name)}`) as {
        response: Array<{ team: { id: number; name: string; country: string; logo: string } }>;
      };
      return result.response.map((r) => r.team);
    },
    async () => {
      const result = await apisportsFetch(`/teams?search=${encodeURIComponent(name)}`) as {
        response: Array<{ team: { id: number; name: string; country: string; logo: string } }>;
      };
      return result.response.map((r) => r.team);
    }
  );

  return data;
}

/**
 * Get head-to-head record between two teams.
 */
export async function getHeadToHead(
  team1Id: number,
  team2Id: number
): Promise<FootballFixture[]> {
  const data = await fetchWithFallback(
    async () => {
      const result = await apiFootballFetch(
        `/fixtures?h2h=${team1Id}-${team2Id}`
      ) as { response: FootballFixture[] };
      return result.response;
    },
    async () => {
      const result = await apisportsFetch(
        `/fixtures?h2h=${team1Id}-${team2Id}`
      ) as { response: FootballFixture[] };
      return result.response;
    }
  );

  return data;
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
