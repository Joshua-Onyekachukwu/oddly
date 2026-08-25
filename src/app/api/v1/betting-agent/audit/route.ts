/**
 * GET /api/v1/betting-agent/audit
 *
 * Returns the agent audit trail — all recommendations, betslips, and actions.
 *
 * Query Params:
 *   - page, pageSize: pagination
 *   - action: filter by action type
 *   - status: filter by status
 *   - userId: filter by user (admin only)
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { requireAdmin } from "@/lib/api/utils";

const supabaseAdmin = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: NextRequest) {
  try {
    // SECURITY: Require admin access
    await requireAdmin(request);
    
    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get("page") || "1"));
    const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get("pageSize") || "20")));
    const action = searchParams.get("action");
    const status = searchParams.get("status");
    const offset = (page - 1) * pageSize;

    let query = supabaseAdmin
      .from("agent_audit_log")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (action) query = query.eq("action", action);
    if (status) query = query.eq("status", status);

    const { data, count, error } = await query;

    if (error) {
      return NextResponse.json({ error: `Query failed: ${error.message}` }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      data: data || [],
      meta: {
        page,
        pageSize,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / pageSize),
      },
    });
  } catch (error) {
    console.error("Audit trail error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
