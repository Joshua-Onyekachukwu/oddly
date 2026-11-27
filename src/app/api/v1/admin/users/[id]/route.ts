/**
 * PATCH /api/v1/admin/users/[id]
 *
 * Update a user's role and/or subscription tier.
 * Admin only — uses the service-role client because profiles RLS
 * only permits users to update their own profile.
 *
 * Body:
 *   - role?: "user" | "admin"
 *   - subscription_tier?: "free" | "premium" | "elite"
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import {
  successResponse,
  requireAdmin,
  notFound,
  badRequest,
  conflict,
  internalError,
  addRateLimitHeaders,
  checkRateLimit,
} from "@/lib/api/utils";
import { adminUserUpdateSchema, validateBody } from "@/lib/api/validation";

const supabaseAdmin = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const { user } = await requireAdmin(request);
    const rl = checkRateLimit(`admin:users:update:${user.id}`, request, 30, 60000);

    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return badRequest("Invalid JSON body");
    }

    const validation = validateBody(adminUserUpdateSchema, rawBody);
    if (!validation.success) {
      return badRequest("Invalid update data", { details: validation.error });
    }

    const updates = validation.data;

    // Safety: never allow demoting the last remaining admin.
    if (updates.role === "user") {
      const { data: target } = await supabaseAdmin
        .from("profiles")
        .select("role")
        .eq("id", id)
        .single();

      if (target?.role === "admin") {
        const { count } = await supabaseAdmin
          .from("profiles")
          .select("id", { count: "exact", head: true })
          .eq("role", "admin");

        if ((count || 0) <= 1) {
          return conflict("Cannot demote the last admin account");
        }
      }
    }

    const { data, error } = await supabaseAdmin
      .from("profiles")
      .update(updates)
      .eq("id", id)
      .select()
      .single();

    if (error || !data) {
      if (error?.code === "PGRST116") {
        return notFound("User");
      }
      return internalError(`Failed to update user: ${error?.message || "unknown error"}`);
    }

    const response = successResponse(data);
    addRateLimitHeaders(response, rl.remaining, rl.resetAt);
    return response;
  } catch (error: unknown) {
    if (error && typeof error === "object" && "code" in error) {
      const authErr = error as { code: string; message: string; status: number };
      if (authErr.code === "FORBIDDEN") {
        const { errorResponse } = await import("@/lib/api/utils");
        return errorResponse("FORBIDDEN", authErr.message, 403);
      }
      if (authErr.code === "UNAUTHORIZED") {
        const { errorResponse } = await import("@/lib/api/utils");
        return errorResponse("UNAUTHORIZED", authErr.message, 401);
      }
    }
    console.error("PATCH /api/v1/admin/users/[id] error:", error);
    return internalError();
  }
}
