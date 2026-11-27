/**
 * PATCH /api/v1/admin/announcements/[id]
 *
 * Update an announcement (title, body, target, is_active,
 * scheduled_at, expires_at). Admin only — service-role client.
 *
 * DELETE /api/v1/admin/announcements/[id]
 *
 * Delete an announcement. Admin only — service-role client.
 */

import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import {
  successResponse,
  noContentResponse,
  requireAdmin,
  notFound,
  badRequest,
  internalError,
  addRateLimitHeaders,
  checkRateLimit,
} from "@/lib/api/utils";
import {
  announcementUpdateSchema,
  validateBody,
} from "@/lib/api/validation";

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
    const rl = checkRateLimit(`admin:announcements:update:${user.id}`, request, 30, 60000);

    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return badRequest("Invalid JSON body");
    }

    const validation = validateBody(announcementUpdateSchema, rawBody);
    if (!validation.success) {
      return badRequest("Invalid update data", { details: validation.error });
    }

    const { data, error } = await supabaseAdmin
      .from("announcements")
      .update(validation.data)
      .eq("id", id)
      .select()
      .single();

    if (error || !data) {
      if (error?.code === "PGRST116") {
        return notFound("Announcement");
      }
      return internalError(`Failed to update announcement: ${error?.message || "unknown error"}`);
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
    console.error("PATCH /api/v1/admin/announcements/[id] error:", error);
    return internalError();
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const { user } = await requireAdmin(request);
    const rl = checkRateLimit(`admin:announcements:delete:${user.id}`, request, 30, 60000);

    const { error } = await supabaseAdmin
      .from("announcements")
      .delete()
      .eq("id", id);

    if (error) {
      return internalError(`Failed to delete announcement: ${error.message}`);
    }

    const response = noContentResponse();
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
    console.error("DELETE /api/v1/admin/announcements/[id] error:", error);
    return internalError();
  }
}
