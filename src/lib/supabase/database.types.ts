/**
 * Supabase Database Types
 *
 * Generated from the ODDLY schema (20260819000000_initial_schema.sql).
 * This file provides type-safe access to all tables, relationships, and functions.
 *
 * Usage:
 *   import { createClient } from "@/lib/supabase/client";
 *   const supabase = createClient();
 *   const { data } = await supabase.from("fixtures").select("*");
 *   // data is typed as FixtureRow[]
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

// ============================================
// Database Schema
// ============================================

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          role: "user" | "admin";
          display_name: string | null;
          bankroll: number;
          subscription_tier: "free" | "premium" | "elite";
          subscription_expires_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          role?: "user" | "admin";
          display_name?: string | null;
          bankroll?: number;
          subscription_tier?: "free" | "premium" | "elite";
          subscription_expires_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          role?: "user" | "admin";
          display_name?: string | null;
          bankroll?: number;
          subscription_tier?: "free" | "premium" | "elite";
          subscription_expires_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      leagues: {
        Row: {
          id: string;
          name: string;
          country: string | null;
          sport: string;
          is_active: boolean;
          priority: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          country?: string | null;
          sport?: string;
          is_active?: boolean;
          priority?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          country?: string | null;
          sport?: string;
          is_active?: boolean;
          priority?: number;
          created_at?: string;
        };
        Relationships: [];
      };
      teams: {
        Row: {
          id: string;
          canonical_name: string;
          country: string | null;
          league_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          canonical_name: string;
          country?: string | null;
          league_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          canonical_name?: string;
          country?: string | null;
          league_id?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      team_aliases: {
        Row: {
          canonical_name: string;
          alias: string;
          source: string | null;
        };
        Insert: {
          canonical_name: string;
          alias: string;
          source?: string | null;
        };
        Update: {
          canonical_name?: string;
          alias?: string;
          source?: string | null;
        };
        Relationships: [];
      };
      fixtures: {
        Row: {
          id: string;
          external_id: string | null;
          home_team_id: string | null;
          away_team_id: string | null;
          league_id: string | null;
          kickoff_time: string;
          status: "scheduled" | "live" | "halftime" | "finished" | "postponed" | "cancelled";
          home_score: number | null;
          away_score: number | null;
          is_featured: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          external_id?: string | null;
          home_team_id?: string | null;
          away_team_id?: string | null;
          league_id?: string | null;
          kickoff_time: string;
          status?: "scheduled" | "live" | "halftime" | "finished" | "postponed" | "cancelled";
          home_score?: number | null;
          away_score?: number | null;
          is_featured?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          external_id?: string | null;
          home_team_id?: string | null;
          away_team_id?: string | null;
          league_id?: string | null;
          kickoff_time?: string;
          status?: "scheduled" | "live" | "halftime" | "finished" | "postponed" | "cancelled";
          home_score?: number | null;
          away_score?: number | null;
          is_featured?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [{"foreignKeyName":"fixtures_league_id_fkey","columns":["league_id"],"isOneToOne":false,"referencedRelation":"leagues","referencedColumns":["id"]},{"foreignKeyName":"fixtures_home_team_id_fkey","columns":["home_team_id"],"isOneToOne":false,"referencedRelation":"teams","referencedColumns":["id"]},{"foreignKeyName":"fixtures_away_team_id_fkey","columns":["away_team_id"],"isOneToOne":false,"referencedRelation":"teams","referencedColumns":["id"]}];
      };
      odds_snapshots: {
        Row: {
          id: string;
          fixture_id: string;
          bookmaker: string;
          market: string;
          selection: string;
          odds: number;
          snapshot_time: string;
        };
        Insert: {
          id?: string;
          fixture_id: string;
          bookmaker: string;
          market: string;
          selection: string;
          odds: number;
          snapshot_time?: string;
        };
        Update: {
          id?: string;
          fixture_id?: string;
          bookmaker?: string;
          market?: string;
          selection?: string;
          odds?: number;
          snapshot_time?: string;
        };
        Relationships: [{"foreignKeyName":"odds_snapshots_fixture_id_fkey","columns":["fixture_id"],"isOneToOne":false,"referencedRelation":"fixtures","referencedColumns":["id"]}];
      };
      predictions: {
        Row: {
          id: string;
          fixture_id: string;
          market: string;
          selection: string;
          model_probability: number;
          confidence_lower: number | null;
          confidence_upper: number | null;
          model_version: string;
          training_data_cutoff: string | null;
          features_used: Json | null;
          sub_model_probabilities: Json | null;
          model_disagreement: number | null;
          data_quality_score: number | null;
          data_quality_breakdown: Json | null;
          result: "pending" | "correct" | "wrong" | "void";
          created_at: string;
          settled_at: string | null;
        };
        Insert: {
          id?: string;
          fixture_id: string;
          market: string;
          selection: string;
          model_probability: number;
          confidence_lower?: number | null;
          confidence_upper?: number | null;
          model_version: string;
          training_data_cutoff?: string | null;
          features_used?: Json | null;
          sub_model_probabilities?: Json | null;
          model_disagreement?: number | null;
          data_quality_score?: number | null;
          data_quality_breakdown?: Json | null;
          result?: "pending" | "correct" | "wrong" | "void";
          created_at?: string;
          settled_at?: string | null;
        };
        Update: {
          id?: string;
          fixture_id?: string;
          market?: string;
          selection?: string;
          model_probability?: number;
          confidence_lower?: number | null;
          confidence_upper?: number | null;
          model_version?: string;
          training_data_cutoff?: string | null;
          features_used?: Json | null;
          sub_model_probabilities?: Json | null;
          model_disagreement?: number | null;
          data_quality_score?: number | null;
          data_quality_breakdown?: Json | null;
          result?: "pending" | "correct" | "wrong" | "void";
          created_at?: string;
          settled_at?: string | null;
        };
        Relationships: [{"foreignKeyName":"predictions_fixture_id_fkey","columns":["fixture_id"],"isOneToOne":false,"referencedRelation":"fixtures","referencedColumns":["id"]}];
      };
      recommendations: {
        Row: {
          id: string;
          fixture_id: string;
          prediction_id: string | null;
          market: string;
          selection: string;
          bookmaker_odds: number;
          raw_implied_probability: number;
          fair_implied_probability: number | null;
          model_probability: number;
          edge: number;
          opportunity_score: number | null;
          opportunity_breakdown: Json | null;
          risk_tier: "low" | "medium" | "high";
          confidence_tier: "very_high" | "high" | "medium" | "low";
          kelly_fraction: number | null;
          is_recommended: boolean;
          is_avoid: boolean;
          explanation: Json | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          fixture_id: string;
          prediction_id?: string | null;
          market: string;
          selection: string;
          bookmaker_odds: number;
          raw_implied_probability: number;
          fair_implied_probability?: number | null;
          model_probability: number;
          edge: number;
          opportunity_score?: number | null;
          opportunity_breakdown?: Json | null;
          risk_tier: "low" | "medium" | "high";
          confidence_tier: "very_high" | "high" | "medium" | "low";
          kelly_fraction?: number | null;
          is_recommended?: boolean;
          is_avoid?: boolean;
          explanation?: Json | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          fixture_id?: string;
          prediction_id?: string | null;
          market?: string;
          selection?: string;
          bookmaker_odds?: number;
          raw_implied_probability?: number;
          fair_implied_probability?: number | null;
          model_probability?: number;
          edge?: number;
          opportunity_score?: number | null;
          opportunity_breakdown?: Json | null;
          risk_tier?: "low" | "medium" | "high";
          confidence_tier?: "very_high" | "high" | "medium" | "low";
          kelly_fraction?: number | null;
          is_recommended?: boolean;
          is_avoid?: boolean;
          explanation?: Json | null;
          created_at?: string;
        };
        Relationships: [{"foreignKeyName":"recommendations_fixture_id_fkey","columns":["fixture_id"],"isOneToOne":false,"referencedRelation":"fixtures","referencedColumns":["id"]},{"foreignKeyName":"recommendations_prediction_id_fkey","columns":["prediction_id"],"isOneToOne":false,"referencedRelation":"predictions","referencedColumns":["id"]}];
      };
      user_bets: {
        Row: {
          id: string;
          user_id: string;
          recommendation_id: string | null;
          fixture_id: string | null;
          market: string;
          selection: string;
          bookmaker: string | null;
          odds_at_placement: number | null;
          stake: number | null;
          status: "pending" | "won" | "lost" | "void";
          profit: number | null;
          placed_at: string;
          settled_at: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          recommendation_id?: string | null;
          fixture_id?: string | null;
          market: string;
          selection: string;
          bookmaker?: string | null;
          odds_at_placement?: number | null;
          stake?: number | null;
          status?: "pending" | "won" | "lost" | "void";
          profit?: number | null;
          placed_at?: string;
          settled_at?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string;
          recommendation_id?: string | null;
          fixture_id?: string | null;
          market?: string;
          selection?: string;
          bookmaker?: string | null;
          odds_at_placement?: number | null;
          stake?: number | null;
          status?: "pending" | "won" | "lost" | "void";
          profit?: number | null;
          placed_at?: string;
          settled_at?: string | null;
        };
        Relationships: [{"foreignKeyName":"user_bets_recommendation_id_fkey","columns":["recommendation_id"],"isOneToOne":false,"referencedRelation":"recommendations","referencedColumns":["id"]},{"foreignKeyName":"user_bets_fixture_id_fkey","columns":["fixture_id"],"isOneToOne":false,"referencedRelation":"fixtures","referencedColumns":["id"]}];
      };
      accumulators: {
        Row: {
          id: string;
          user_id: string;
          name: string | null;
          selections: Json;
          combined_odds: number | null;
          estimated_probability: number | null;
          monte_carlo_probability: number | null;
          risk_adjusted_ev: number | null;
          strategy: "conservative" | "balanced" | "aggressive" | "longshot" | null;
          stake: number | null;
          status: "pending" | "won" | "lost" | "partial";
          result: string | null;
          profit: number | null;
          created_at: string;
          settled_at: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          name?: string | null;
          selections: Json;
          combined_odds?: number | null;
          estimated_probability?: number | null;
          monte_carlo_probability?: number | null;
          risk_adjusted_ev?: number | null;
          strategy?: "conservative" | "balanced" | "aggressive" | "longshot" | null;
          stake?: number | null;
          status?: "pending" | "won" | "lost" | "partial";
          result?: string | null;
          profit?: number | null;
          created_at?: string;
          settled_at?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string;
          name?: string | null;
          selections?: Json;
          combined_odds?: number | null;
          estimated_probability?: number | null;
          monte_carlo_probability?: number | null;
          risk_adjusted_ev?: number | null;
          strategy?: "conservative" | "balanced" | "aggressive" | "longshot" | null;
          stake?: number | null;
          status?: "pending" | "won" | "lost" | "partial";
          result?: string | null;
          profit?: number | null;
          created_at?: string;
          settled_at?: string | null;
        };
        Relationships: [];
      };
      rollover_chains: {
        Row: {
          id: string;
          user_id: string | null;
          name: string | null;
          starting_stake: number;
          current_balance: number;
          banked_amount: number;
          target_days: number | null;
          current_day: number;
          odds_range_min: number | null;
          odds_range_max: number | null;
          min_probability: number | null;
          rollover_percentage: number;
          status: "active" | "completed" | "broken" | "paused";
          started_at: string;
          ended_at: string | null;
        };
        Insert: {
          id?: string;
          user_id?: string | null;
          name?: string | null;
          starting_stake: number;
          current_balance: number;
          banked_amount?: number;
          target_days?: number | null;
          current_day?: number;
          odds_range_min?: number | null;
          odds_range_max?: number | null;
          min_probability?: number | null;
          rollover_percentage?: number;
          status?: "active" | "completed" | "broken" | "paused";
          started_at?: string;
          ended_at?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string | null;
          name?: string | null;
          starting_stake?: number;
          current_balance?: number;
          banked_amount?: number;
          target_days?: number | null;
          current_day?: number;
          odds_range_min?: number | null;
          odds_range_max?: number | null;
          min_probability?: number | null;
          rollover_percentage?: number;
          status?: "active" | "completed" | "broken" | "paused";
          started_at?: string;
          ended_at?: string | null;
        };
        Relationships: [];
      };
      rollover_picks: {
        Row: {
          id: string;
          chain_id: string | null;
          day_number: number;
          fixture_id: string | null;
          prediction_id: string | null;
          market: string | null;
          selection: string | null;
          odds: number | null;
          model_probability: number | null;
          opportunity_score: number | null;
          stake: number | null;
          potential_return: number | null;
          result: "pending" | "won" | "lost" | "skipped";
          actual_return: number | null;
          user_marked: boolean;
          settled_at: string | null;
        };
        Insert: {
          id?: string;
          chain_id?: string | null;
          day_number: number;
          fixture_id?: string | null;
          prediction_id?: string | null;
          market?: string | null;
          selection?: string | null;
          odds?: number | null;
          model_probability?: number | null;
          opportunity_score?: number | null;
          stake?: number | null;
          potential_return?: number | null;
          result?: "pending" | "won" | "lost" | "skipped";
          actual_return?: number | null;
          user_marked?: boolean;
          settled_at?: string | null;
        };
        Update: {
          id?: string;
          chain_id?: string | null;
          day_number?: number;
          fixture_id?: string | null;
          prediction_id?: string | null;
          market?: string | null;
          selection?: string | null;
          odds?: number | null;
          model_probability?: number | null;
          opportunity_score?: number | null;
          stake?: number | null;
          potential_return?: number | null;
          result?: "pending" | "won" | "lost" | "skipped";
          actual_return?: number | null;
          user_marked?: boolean;
          settled_at?: string | null;
        };
        Relationships: [{"foreignKeyName":"rollover_picks_chain_id_fkey","columns":["chain_id"],"isOneToOne":false,"referencedRelation":"rollover_chains","referencedColumns":["id"]},{"foreignKeyName":"rollover_picks_fixture_id_fkey","columns":["fixture_id"],"isOneToOne":false,"referencedRelation":"fixtures","referencedColumns":["id"]},{"foreignKeyName":"rollover_picks_prediction_id_fkey","columns":["prediction_id"],"isOneToOne":false,"referencedRelation":"predictions","referencedColumns":["id"]}];
      };
      model_performance: {
        Row: {
          id: string;
          model_version: string;
          period_start: string | null;
          period_end: string | null;
          market: string | null;
          league_id: string | null;
          total_predictions: number | null;
          correct_predictions: number | null;
          brier_score: number | null;
          calibration_data: Json | null;
          roi: number | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          model_version: string;
          period_start?: string | null;
          period_end?: string | null;
          market?: string | null;
          league_id?: string | null;
          total_predictions?: number | null;
          correct_predictions?: number | null;
          brier_score?: number | null;
          calibration_data?: Json | null;
          roi?: number | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          model_version?: string;
          period_start?: string | null;
          period_end?: string | null;
          market?: string | null;
          league_id?: string | null;
          total_predictions?: number | null;
          correct_predictions?: number | null;
          brier_score?: number | null;
          calibration_data?: Json | null;
          roi?: number | null;
          created_at?: string;
        };
        Relationships: [{"foreignKeyName":"model_performance_league_id_fkey","columns":["league_id"],"isOneToOne":false,"referencedRelation":"leagues","referencedColumns":["id"]}];
      };
      ai_cache: {
        Row: {
          cache_key: string;
          response: string;
          model_used: string | null;
          created_at: string;
        };
        Insert: {
          cache_key: string;
          response: string;
          model_used?: string | null;
          created_at?: string;
        };
        Update: {
          cache_key?: string;
          response?: string;
          model_used?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      notifications: {
        Row: {
          id: string;
          user_id: string | null;
          type: "new_picks" | "rollover_pick" | "result_settled" | "chain_milestone" | "chain_broken" | "accumulator_settled" | "model_alert" | "announcement" | "drawdown_warning";
          title: string;
          body: string;
          data: Json | null;
          is_read: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id?: string | null;
          type: "new_picks" | "rollover_pick" | "result_settled" | "chain_milestone" | "chain_broken" | "accumulator_settled" | "model_alert" | "announcement" | "drawdown_warning";
          title: string;
          body: string;
          data?: Json | null;
          is_read?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string | null;
          type?: "new_picks" | "rollover_pick" | "result_settled" | "chain_milestone" | "chain_broken" | "accumulator_settled" | "model_alert" | "announcement" | "drawdown_warning";
          title?: string;
          body?: string;
          data?: Json | null;
          is_read?: boolean;
          created_at?: string;
        };
        Relationships: [];
      };
      scoring_config: {
        Row: {
          id: string;
          config_key: string;
          config_value: Json;
          updated_by: string | null;
          updated_at: string;
        };
        Insert: {
          id?: string;
          config_key: string;
          config_value: Json;
          updated_by?: string | null;
          updated_at?: string;
        };
        Update: {
          id?: string;
          config_key?: string;
          config_value?: Json;
          updated_by?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      announcements: {
        Row: {
          id: string;
          title: string;
          body: string;
          target: "all" | "free" | "premium" | "elite";
          is_active: boolean;
          scheduled_at: string | null;
          expires_at: string | null;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          title: string;
          body: string;
          target?: "all" | "free" | "premium" | "elite";
          is_active?: boolean;
          scheduled_at?: string | null;
          expires_at?: string | null;
          created_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          title?: string;
          body?: string;
          target?: "all" | "free" | "premium" | "elite";
          is_active?: boolean;
          scheduled_at?: string | null;
          expires_at?: string | null;
          created_by?: string | null;
          created_at?: string;
        };
        Relationships: [{"foreignKeyName":"announcements_updated_by_fkey","columns":["updated_by"],"isOneToOne":false,"referencedRelation":"profiles","referencedColumns":["id"]},{"foreignKeyName":"announcements_created_by_fkey","columns":["created_by"],"isOneToOne":false,"referencedRelation":"profiles","referencedColumns":["id"]}];
      };
      admin_activity_log: {
        Row: {
          id: string;
          admin_id: string | null;
          action: string;
          target_type: string | null;
          target_id: string | null;
          details: Json | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          admin_id?: string | null;
          action: string;
          target_type?: string | null;
          target_id?: string | null;
          details?: Json | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          admin_id?: string | null;
          action?: string;
          target_type?: string | null;
          target_id?: string | null;
          details?: Json | null;
          created_at?: string;
        };
        Relationships: [{"foreignKeyName":"admin_activity_log_admin_id_fkey","columns":["admin_id"],"isOneToOne":false,"referencedRelation":"profiles","referencedColumns":["id"]}];
      };
    };
    Views: Record<string, never>;
    Functions: {
      update_updated_at: {
        Args: Record<string, never>;
        Returns: unknown;
      };
      update_user_credits: {
        Args: Record<string, never>;
        Returns: unknown;
      };
      is_admin: {
        Args: Record<string, never>;
        Returns: boolean;
      };
      handle_updated_at: {
        Args: Record<string, never>;
        Returns: unknown;
      };
      get_user_bet_stats: {
        Args: { p_user_id: string };
        Returns: Json;
      };
      get_today_fixtures: {
        Args: Record<string, never>;
        Returns: Json;
      };
    };
    Enums: {
      user_role: "user" | "admin";
      subscription_tier: "free" | "premium" | "elite";
      fixture_status: "scheduled" | "live" | "halftime" | "finished" | "postponed" | "cancelled";
      prediction_result: "pending" | "correct" | "wrong" | "void";
      bet_status: "pending" | "won" | "lost" | "void";
      accumulator_status: "pending" | "won" | "lost" | "partial";
      rollover_status: "active" | "completed" | "broken" | "paused";
      rollover_pick_result: "pending" | "won" | "lost" | "skipped";
      risk_tier: "low" | "medium" | "high";
      confidence_tier: "very_high" | "high" | "medium" | "low";
      notification_type: "new_picks" | "rollover_pick" | "result_settled" | "chain_milestone" | "chain_broken" | "accumulator_settled" | "model_alert" | "announcement" | "drawdown_warning";
      announcement_target: "all" | "free" | "premium" | "elite";
    };
    CompositeTypes: Record<string, never>;
  };
}

// ============================================
// Helper Types
// ============================================

/** Shorthand for any table's Row type */
export type Tables<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"];

/** Shorthand for any table's Insert type */
export type TablesInsert<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Insert"];

/** Shorthand for any table's Update type */
export type TablesUpdate<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Update"];

/** Shorthand for any enum type */
export type Enums<T extends keyof Database["public"]["Enums"]> =
  Database["public"]["Enums"][T];
