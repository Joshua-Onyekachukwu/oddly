/**
 * GET /api/v1/user/bets/[id]
 * Get a single user bet with full details.
 * 
 * PATCH /api/v1/user/bets/[id]
 * Update bet status (for admin settlement).
 */

import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import {
  successResponse,
  requireAuth,
  notFound,
  badRequest,
  unprocessable,
  internalError,
} from "@/lib/api/utils";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const { user, supabase } = await requireAuth(request);

    const { data, error } = await supabase
      .from("user_bets")
      .select("*")
      .eq("id", id)
      .eq("user_id", user.id)
      .single();

    if (error || !data) {
      return notFound("Bet");
    }

    return successResponse(data);
  } catch (error: unknown) {
    if (error && typeof error === "object" && "code" in error) {
      const authErr = error as { code: string; message: string; status: number };
      if (authErr.code === "UNAUTHORIZED") return unprocessable(authErr.message);
    }
    console.error("GET /api/v1/user/bets/[id] error:", error);
    return internalError();
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const { user, supabase } = await requireAuth(request);
    const body = await request.json();

    const { status } = body;

    if (!status || !["won", "lost", "void"].includes(status)) {
      return badRequest("Status must be 'won', 'lost', or 'void'");
    }

    const updateData: Record<string, unknown> = {
      status,
      settled_at: new Date().toISOString(),
    };

    // If won, calculate profit
    if (status === "won") {
      const { data: bet } = await supabase
        .from("user_bets")
        .select("stake, odds_at_placement")
        .eq("id", id)
        .single();

      if (bet) {
        updateData.profit = bet.stake * (bet.odds_at_placement - 1);
      }
    } else {
      updateData.profit = 0;
    }

    const { data, error } = await supabase
      .from("user_bets")
      .update(updateData)
      .eq("id", id)
      .eq("user_id", user.id)
      .select()
      .single();

    if (error || !data) {
      return notFound("Bet");
    }

    return successResponse(data);
  } catch (error: unknown) {
    if (error && typeof error === "object" && "code" in error) {
      const authErr = error as { code: string; message: string; status: number };
      if (authErr.code === "UNAUTHORIZED") return unprocessable(authErr.message);
    }
    console.error("PATCH /api/v1/user/bets/[id] error:", error);
    return internalError();
  }
}
