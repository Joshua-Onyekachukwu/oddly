// ============================================
// ODDLY — Type Definitions
// ============================================

// --------------------------------------------
// Database Types (matching Supabase schema)
// --------------------------------------------

export interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  role: 'user' | 'admin';
  subscription_tier: 'free' | 'premium' | 'elite';
  subscription_expires_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface League {
  id: string;
  name: string;
  country: string;
  country_code: string;
  logo_url: string | null;
  season: string;
  api_id: number | null;
  is_active: boolean;
  created_at: string;
}

export interface Team {
  id: string;
  name: string;
  short_name: string | null;
  logo_url: string | null;
  country: string | null;
  league_id: string | null;
  api_id: number | null;
  created_at: string;
}

export interface TeamAlias {
  id: string;
  canonical_name: string;
  alias: string;
  source: string | null;
}

export interface Fixture {
  id: string;
  league_id: string;
  home_team_id: string;
  away_team_id: string;
  match_date: string;
  match_time: string;
  status: 'scheduled' | 'live' | 'finished' | 'postponed' | 'cancelled';
  home_score: number | null;
  away_score: number | null;
  home_ht_score: number | null;
  away_ht_score: number | null;
  venue: string | null;
  attendance: number | null;
  referee: string | null;
  api_id: number | null;
  created_at: string;
  updated_at: string;
  // Joined relations
  league?: League;
  home_team?: Team;
  away_team?: Team;
}

export interface OddsSnapshot {
  id: string;
  fixture_id: string;
  bookmaker: string;
  market: string;
  home_odds: number;
  draw_odds: number | null;
  away_odds: number;
  over_odds: number | null;
  under_odds: number | null;
  line: number | null;
  timestamp: string;
  created_at: string;
}

export interface Prediction {
  id: string;
  fixture_id: string;
  model_version: string;
  market: string;
  prediction: string;
  model_probability: number;
  confidence_interval_low: number;
  confidence_interval_high: number;
  fair_implied_probability: number;
  edge: number;
  opportunity_score: number;
  data_quality_score: number;
  kelly_stake: number;
  recommendation: 'STRONG_BET' | 'BET' | 'LEAN' | 'AVOID';
  status: 'pending' | 'in_play' | 'settled';
  result: 'correct' | 'wrong' | 'void' | null;
  Dixon_Coles_prob: number | null;
  XGBoost_prob: number | null;
  elo_prob: number | null;
  market_consensus_prob: number | null;
  ensemble_weights: Record<string, number> | null;
  explanation: string | null;
  created_at: string;
  updated_at: string;
  // Joined relations
  fixture?: Fixture;
}

export interface Recommendation {
  id: string;
  prediction_id: string;
  fixture_id: string;
  market: string;
  selection: string;
  odds: number;
  model_probability: number;
  edge: number;
  opportunity_score: number;
  data_quality_score: number;
  risk_level: 'low' | 'medium' | 'high';
  kelly_stake: number;
  is_rollover_pick: boolean;
  created_at: string;
  // Joined relations
  prediction?: Prediction;
  fixture?: Fixture;
}

export interface UserBet {
  id: string;
  user_id: string;
  fixture_id: string;
  prediction_id: string | null;
  market: string;
  selection: string;
  odds: number;
  stake: number;
  potential_return: number;
  status: 'pending' | 'won' | 'lost' | 'void' | 'cashout';
  actual_return: number | null;
  profit_loss: number | null;
  bookmaker: string | null;
  bet_reference: string | null;
  placed_at: string;
  settled_at: string | null;
  created_at: string;
  // Joined relations
  fixture?: Fixture;
  prediction?: Prediction;
}

export interface Accumulator {
  id: string;
  user_id: string;
  name: string | null;
  selections: AccumulatorSelection[];
  total_odds: number;
  estimated_probability: number;
  risk_adjusted_ev: number;
  stake: number | null;
  potential_return: number | null;
  status: 'active' | 'won' | 'lost' | 'partial' | 'void';
  result: number | null;
  profit_loss: number | null;
  strategy: 'conservative' | 'balanced' | 'aggressive' | 'longshot';
  created_at: string;
  settled_at: string | null;
}

export interface AccumulatorSelection {
  prediction_id: string;
  fixture_id: string;
  market: string;
  selection: string;
  odds: number;
  model_probability: number;
  result: 'pending' | 'correct' | 'wrong' | 'void';
}

export interface RolloverChain {
  id: string;
  user_id: string;
  name: string;
  starting_stake: number;
  current_balance: number;
  day_count: number;
  max_day_count: number;
  status: 'active' | 'completed' | 'broken' | 'paused';
  highest_balance: number;
  growth_percentage: number;
  started_at: string;
  ended_at: string | null;
  created_at: string;
  // Joined relations
  picks?: RolloverPick[];
}

export interface RolloverPick {
  id: string;
  chain_id: string;
  day_number: number;
  fixture_id: string;
  prediction_id: string;
  market: string;
  selection: string;
  odds: number;
  model_probability: number;
  edge: number;
  opportunity_score: number;
  stake_amount: number;
  potential_return: number;
  status: 'pending' | 'placed' | 'won' | 'lost' | 'skipped';
  result: 'correct' | 'wrong' | 'void' | null;
  placed_at: string | null;
  settled_at: string | null;
  created_at: string;
  // Joined relations
  fixture?: Fixture;
  prediction?: Prediction;
}

export interface ModelPerformance {
  id: string;
  model_version: string;
  market: string;
  total_predictions: number;
  correct_predictions: number;
  accuracy: number;
  brier_score: number | null;
  roi: number | null;
  yield: number | null;
  calibration_drift: number | null;
  period_start: string;
  period_end: string;
  created_at: string;
}

export interface AICache {
  id: string;
  query_hash: string;
  query_text: string;
  response_text: string;
  model_used: string;
  tokens_used: number;
  expires_at: string;
  created_at: string;
}

export interface Notification {
  id: string;
  user_id: string;
  type: 'prediction' | 'result' | 'rollover' | 'system' | 'announcement';
  title: string;
  message: string;
  data: Record<string, unknown> | null;
  is_read: boolean;
  created_at: string;
}

export interface ScoringConfig {
  id: string;
  key: string;
  value: number;
  description: string | null;
  updated_at: string;
}

export interface Announcement {
  id: string;
  title: string;
  content: string;
  type: 'info' | 'warning' | 'success' | 'urgent';
  is_active: boolean;
  published_at: string | null;
  created_at: string;
}

export interface AdminActivityLog {
  id: string;
  admin_id: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  details: Record<string, unknown> | null;
  ip_address: string | null;
  created_at: string;
}

// --------------------------------------------
// API & AI Types
// --------------------------------------------

export interface NVIDIAKey {
  key: string;
  usageCount: number;
  lastUsed: string | null;
  isActive: boolean;
}

export interface AIChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  model?: string;
  tokens?: number;
  timestamp: string;
}

export interface AIChatSession {
  id: string;
  userId: string;
  messages: AIChatMessage[];
  createdAt: string;
  updatedAt: string;
}

// --------------------------------------------
// Dashboard & UI Types
// --------------------------------------------

export interface DashboardStats {
  totalPredictions: number;
  accuracy: number;
  todayPicks: number;
  activeUsers: number;
  activeChains: number;
  revenue: number;
}

export interface MatchFilter {
  league?: string;
  date?: string;
  minProbability?: number;
  maxProbability?: number;
  market?: string;
  oddsRange?: [number, number];
  riskLevel?: 'low' | 'medium' | 'high';
}

export interface AccumulatorSlip {
  selections: AccumulatorSelection[];
  totalOdds: number;
  estimatedProbability: number;
  riskAdjustedEV: number;
  strategy: 'conservative' | 'balanced' | 'aggressive' | 'longshot';
}

// --------------------------------------------
// Subscription Types
// --------------------------------------------

export type SubscriptionTier = 'free' | 'premium' | 'elite';

export interface SubscriptionPlan {
  tier: SubscriptionTier;
  name: string;
  price: number;
  currency: string;
  interval: 'monthly';
  features: string[];
  limits: {
    maxAccumulatorLegs: number;
    maxAIQueries: number;
    rolloverAccess: boolean;
    crownJewelPick: boolean;
    advancedAnalytics: boolean;
  };
}

// --------------------------------------------
// Chart Types
// --------------------------------------------

export interface ChartDataPoint {
  x: string | number;
  y: number;
  label?: string;
}

export interface PerformanceChart {
  dates: string[];
  accuracy: number[];
  roi: number[];
  brierScore: number[];
}

// --------------------------------------------
// Utility Types
// --------------------------------------------

export type ApiResponse<T> = {
  data: T;
  error: null;
} | {
  data: null;
  error: {
    message: string;
    code?: string;
  };
};

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface TimeRange {
  start: string;
  end: string;
}
