/**
 * GET /api/v1/admin/users
 * 
 * List all users with filtering and pagination.
 * Admin only.
 * 
 * Query Params:
 *   - page, pageSize: pagination
 *   - search: email or full name search
 *   - role: filter by role
 *   - subscription: filter by subscription tier
 *   - sortBy: created_at, email, last_sign_in_at
 *   - sortOrder: asc | desc
 */

import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import {
  successResponse,
  requireAdmin,
  parsePagination,
  buildPaginationMeta,
  parseFilters,
  internalError,
  addRateLimitHeaders,
  checkRateLimit,
} from "@/lib/api/utils";

export async function GET(request: NextRequest) {
  try {
    const { user, supabase } = await requireAdmin(request);
    const rl = checkRateLimit(`admin:users:${user.id}`, 60, 60000);

    const { searchParams } = new URL(request.url);
    const { page, pageSize, offset } = parsePagination(searchParams);
    const { search, sortBy, sortOrder } = parseFilters(searchParams);

    const role = searchParams.get("role");
    const subscription = searchParams.get("subscription");

    let query = supabase
      .from("profiles")
      .select("*", { count: "exact" });

    if (search) {
      query = query.or(`email.ilike.%${search}%,full_name.ilike.%${search}%`);
    }
    if (role) {
      query = query.eq("role", role as "user" | "admin");
    }
    if (subscription) {
      query = query.eq("subscription_tier", subscription as "free" | "premium" | "elite");
    }

    // Map sortBy to actual column
    const columnMap: Record<string, string> = {
      created_at: "created_at",
      email: "email",
      name: "full_name",
    };
    const sortColumn = columnMap[sortBy] || "created_at";
    query = query.order(sortColumn, { ascending: sortOrder === "asc" });

    query = query.range(offset, offset + pageSize - 1);

    const { data, count, error } = await query;

    if (error) {
      return internalError(`Database query failed: ${error.message}`);
    }

    const meta = buildPaginationMeta(page, pageSize, count || 0);
    const response = successResponse(data || [], meta);
    addRateLimitHeaders(response, rl.remaining, rl.resetAt);
    return response;
  } catch (error: unknown) {
    if (error && typeof error === "object" && "code" in error) {
      const authErr = error as { code: string; message: string; status: number };
      if (authErr.code === "FORBIDDEN") {
        const { errorResponse } = await import("@/lib/api/utils");
        return errorResponse("FORBIDDEN", authErr.message, 403);
      }
    }
    console.error("GET /api/v1/admin/users error:", error);
    return internalError();
  }
}
