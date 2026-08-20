"use server";

import { revalidateTag } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

function getSupabase(token?: string) {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    token ? { global: { headers: { Authorization: `Bearer ${token}` } } } : undefined
  );
}

/**
 * Place a new bet on a recommendation.
 * Called from the client via form submission or Server Action.
 */
export async function placeBet(
  prevState: { error?: string; success?: boolean },
  formData: FormData
): Promise<{ error?: string; success?: boolean }> {
  const recommendationId = formData.get("recommendationId") as string;
  const stake = parseFloat(formData.get("stake") as string);
  const odds = parseFloat(formData.get("odds") as string);
  const bookmaker = formData.get("bookmaker") as string | null;
  const token = formData.get("token") as string;

  // Validation
  if (!recommendationId) {
    return { error: "Recommendation ID is required" };
  }
  if (!stake || stake <= 0) {
    return { error: "Stake must be a positive number" };
  }
  if (!odds || odds < 1) {
    return { error: "Invalid odds" };
  }

  const supabase = getSupabase(token);

  // Verify auth
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { error: "Please sign in to place a bet" };
  }

  // Verify recommendation exists
  const { data: rec, error: recError } = await supabase
    .from("recommendations")
    .select("id, fixture_id")
    .eq("id", recommendationId)
    .single();

  if (recError || !rec) {
    return { error: "Recommendation not found" };
  }

  // Create bet
  const { error: betError } = await supabase.from("user_bets").insert({
    user_id: user.id,
    recommendation_id: recommendationId,
    fixture_id: rec.fixture_id,
    market: formData.get("market") as string,
    selection: formData.get("selection") as string,
    bookmaker: bookmaker || null,
    odds_at_placement: odds,
    stake,
    status: "pending",
  });

  if (betError) {
    console.error("Failed to place bet:", betError);
    return { error: "Failed to place bet. Please try again." };
  }

  revalidateTag("bets");
  return { success: true };
}

/**
 * Create a new accumulator with prediction picks.
 */
export async function createAccumulator(
  prevState: { error?: string; success?: boolean; id?: string },
  formData: FormData
): Promise<{ error?: string; success?: boolean; id?: string }> {
  const selectionsJson = formData.get("selections") as string;
  const stake = parseFloat(formData.get("stake") as string) || 1000;
  const strategy = (formData.get("strategy") as string) || "balanced";
  const token = formData.get("token") as string;

  let selections: Array<{
    predictionId: string;
    market: string;
    selection: string;
    odds: number;
    modelProbability?: number;
  }>;

  try {
    selections = JSON.parse(selectionsJson);
  } catch {
    return { error: "Invalid selections data" };
  }

  if (!selections || selections.length < 2) {
    return { error: "Accumulator requires at least 2 selections" };
  }

  if (selections.length > 10) {
    return { error: "Maximum 10 selections allowed" };
  }

  const supabase = getSupabase(token);

  // Verify auth
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { error: "Please sign in to create an accumulator" };
  }

  // Calculate combined odds
  let combinedOdds = 1;
  let estimatedProbability = 1;
  for (const sel of selections) {
    if (!sel.odds || sel.odds < 1) {
      return { error: `Invalid odds for ${sel.selection}` };
    }
    combinedOdds *= sel.odds;
    if (sel.modelProbability) {
      estimatedProbability *= sel.modelProbability;
    }
  }

  // Create accumulator
  const { data: accumulator, error: accError } = await supabase
    .from("accumulators")
    .insert({
      user_id: user.id,
      name: `${selections.length}-leg accumulator`,
      selections,
      combined_odds: combinedOdds,
      estimated_probability: estimatedProbability,
      strategy,
      stake,
      status: "pending",
    })
    .select("id")
    .single();

  if (accError) {
    console.error("Failed to create accumulator:", accError);
    return { error: "Failed to create accumulator. Please try again." };
  }

  revalidateTag("accumulators");
  return { success: true, id: accumulator.id };
}

/**
 * Settle a bet (won/lost/void).
 * Only callable by admins.
 */
export async function settleBet(
  prevState: { error?: string; success?: boolean },
  formData: FormData
): Promise<{ error?: string; success?: boolean }> {
  const betId = formData.get("betId") as string;
  const status = formData.get("status") as string;
  const token = formData.get("token") as string;

  if (!betId || !["won", "lost", "void"].includes(status)) {
    return { error: "Invalid bet ID or status" };
  }

  const supabase = getSupabase(token);

  // Verify admin
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { error: "Authentication required" };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "admin") {
    return { error: "Admin access required" };
  }

  // Get bet details for payout calculation
  const { data: bet } = await supabase
    .from("user_bets")
    .select("stake, odds_at_placement")
    .eq("id", betId)
    .single();

  if (!bet) {
    return { error: "Bet not found" };
  }

  const updateData: Record<string, unknown> = {
    status,
    settled_at: new Date().toISOString(),
  };

  if (status === "won") {
    updateData.profit = bet.stake * (bet.odds_at_placement - 1);
  } else {
    updateData.profit = 0;
  }

  const { error: updateError } = await supabase
    .from("user_bets")
    .update(updateData)
    .eq("id", betId);

  if (updateError) {
    return { error: "Failed to settle bet" };
  }

  revalidateTag("bets");
  return { success: true };
}
