/**
 * GET /api/v1/admin/announcements
 *
 * List ALL announcements including inactive ones.
 * Admin only — uses the service-role client because announcements
 * writes are restricted to the service role.
 *
 * POST /api/v1/admin/announcements
 *
 * Create a new announcement.
 * Body: title, body, target (all|free|premium|elite), is_active,
 *       scheduled_at?, expires_at?
 */

import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import {
  successResponse,
  createdResponse,
  requireAdmin,
  badRequest,
  internalError,
  addRateLimitHeaders,
  checkRateLimit,
} from "@/lib/api/utils";
import {
  announcementCreateSchema,
  validateBody,
} from "@/lib/api/validation";
import { logAdminAction } from "@/lib/admin/audit";

const supabaseAdmin = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireAdmin(request);
    const rl = checkRateLimit(`admin:announcements:${user.id}`, request, 60, 60000);

    const { data, error } = await supabaseAdmin
      .from("announcements")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      return internalError(`Failed to fetch announcements: ${error.message}`);
    }

    const response = successResponse(data || []);
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
    console.error("GET /api/v1/admin/announcements error:", error);
    return internalError();
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireAdmin(request);
    const rl = checkRateLimit(`admin:announcements:create:${user.id}`, request, 30, 60000);

    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return badRequest("Invalid JSON body");
    }

    const validation = validateBody(announcementCreateSchema, rawBody);
    if (!validation.success) {
      return badRequest("Invalid announcement data", { details: validation.error });
    }

    const { data, error } = await supabaseAdmin
      .from("announcements")
      .insert({
        ...validation.data,
        created_by: user.id,
      })
      .select()
      .single();

    if (error || !data) {
      return internalError(`Failed to create announcement: ${error?.message || "unknown error"}`);
    }

    await logAdminAction(user.id, "announcement.create", "announcement", data.id, {
      title: data.title,
      target: data.target,
    });

    const response = createdResponse(data);
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
    console.error("POST /api/v1/admin/announcements error:", error);
    return internalError();
  }
}
