/**
 * GET /api/v1/accumulators/[id]
 * Get a single accumulator with full details.
 * 
 * PATCH /api/v1/accumulators/[id]
 * Update accumulator (name, status, stake).
 * 
 * DELETE /api/v1/accumulators/[id]
 * Delete a pending accumulator.
 */

import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import {
  successResponse,
  noContentResponse,
  requireAuth,
  notFound,
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
      .from("accumulators")
      .select("*")
      .eq("id", id)
      .eq("user_id", user.id)
      .single();

    if (error || !data) {
      return notFound("Accumulator");
    }

    return successResponse(data);
  } catch (error: unknown) {
    if (error && typeof error === "object" && "code" in error) {
      const authErr = error as { code: string; message: string; status: number };
      if (authErr.code === "UNAUTHORIZED") return unprocessable(authErr.message);
    }
    console.error("GET /api/v1/accumulators/[id] error:", error);
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

    const updates: Record<string, unknown> = {};
    if (body.name) updates.name = body.name;
    if (body.status) updates.status = body.status;
    if (body.stake) updates.stake = body.stake;
    if (body.strategy) updates.strategy = body.strategy;

    if (Object.keys(updates).length === 0) {
      return unprocessable("No valid fields to update");
    }

    const { data, error } = await supabase
      .from("accumulators")
      .update(updates)
      .eq("id", id)
      .eq("user_id", user.id)
      .select()
      .single();

    if (error || !data) {
      return notFound("Accumulator");
    }

    return successResponse(data);
  } catch (error: unknown) {
    if (error && typeof error === "object" && "code" in error) {
      const authErr = error as { code: string; message: string; status: number };
      if (authErr.code === "UNAUTHORIZED") return unprocessable(authErr.message);
    }
    console.error("PATCH /api/v1/accumulators/[id] error:", error);
    return internalError();
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const { user, supabase } = await requireAuth(request);

    // Only allow deleting pending accumulators
    const { data: accumulator } = await supabase
      .from("accumulators")
      .select("id, status")
      .eq("id", id)
      .eq("user_id", user.id)
      .single();

    if (!accumulator) {
      return notFound("Accumulator");
    }

    if (accumulator.status !== "pending") {
      return unprocessable("Can only delete pending accumulators");
    }

    const { error } = await supabase
      .from("accumulators")
      .delete()
      .eq("id", id)
      .eq("user_id", user.id);

    if (error) {
      return internalError(`Failed to delete: ${error.message}`);
    }

    return noContentResponse();
  } catch (error: unknown) {
    if (error && typeof error === "object" && "code" in error) {
      const authErr = error as { code: string; message: string; status: number };
      if (authErr.code === "UNAUTHORIZED") return unprocessable(authErr.message);
    }
    console.error("DELETE /api/v1/accumulators/[id] error:", error);
    return internalError();
  }
}
