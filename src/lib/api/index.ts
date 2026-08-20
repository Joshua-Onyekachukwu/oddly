/**
 * ODDLY API Layer
 * 
 * Central export for all API integrations:
 * - Supabase (database + auth)
 * - NVIDIA NIM (AI predictions with key rotation)
 * - The Odds API + Odds-Api.io (live odds)
 * - API-Football + APISports (fixtures, scores, standings)
 */

// Supabase
export { createClient } from "@supabase/supabase-js";

// NVIDIA AI (simple wrapper)
export {
  nvidiaChat,
  analyzeMatch,
  getNvidiaKeyCount,
} from "./nvidia";

// NVIDIA AI (full module — client, prompts, prediction engine)
export {
  getNVIDIAClient,
  SYSTEM_PROMPTS,
  buildChatMessages,
  buildPredictionPrompt,
  generatePredictionsForFixture,
  generateTodayPredictions,
  generateCrownJewel,
} from "@/lib/nvidia";

// Odds
export {
  fetchOddsApiFixtures,
  fetchOddsIoFixtures,
  getAvailableSports,
  findBestOdds,
  oddsToImpliedProbability,
  probabilityToFairOdds,
  calculateEdge,
  detectValueBets,
  checkOddsApiUsage,
  BOOKMAKERS,
} from "./odds";
export type { OddsFixture, BookmakerOdds, MarketOdds, OutcomeOdds, ValueBet } from "./odds";

// Football Data
export {
  getTodayFixtures,
  getFixturesByDate,
  getStandings,
  getTeamForm,
  searchTeam,
  getHeadToHead,
  getLiveFixtures,
  getAllTodayFixtures,
  LEAGUE_IDS,
} from "./football";
export type { FootballFixture, TeamStanding, TeamForm } from "./football";
