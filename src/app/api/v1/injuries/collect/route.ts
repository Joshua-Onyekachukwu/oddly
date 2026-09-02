import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { checkRateLimit, addRateLimitHeaders } from "@/lib/api/utils";
import { z } from "zod";
import { validateBody } from "@/lib/api/validation";

const supabaseAdmin = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ── Schemas ────────────────────────────────────────────────────────

const injuryCollectSchema = z.object({
  source: z.enum(["premierinjuries", "apifootball", "all"]).default("all"),
});

const injuryFeaturesPostSchema = z.object({
  fixture_id: z.string().uuid("Invalid fixture ID").optional(),
  all: z.boolean().optional(),
}).refine((data) => data.fixture_id || data.all === true, {
  message: "Provide fixture_id or { all: true }",
});

// ── POST /api/v1/injuries/collect ──────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const rl = checkRateLimit("injuries:collect", 10, 60000);

    // Authenticate
    const authHeader = request.headers.get("authorization");
    const apiKey = request.headers.get("x-api-key");

    if (!authHeader && !apiKey) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let isAdmin = false;

    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.slice(7);
      const { data: { user } } = await supabaseAdmin.auth.getUser(token);

      if (user) {
        const { data: profile } = await supabaseAdmin
          .from("profiles")
          .select("role")
          .eq("id", user.id)
          .single();

        isAdmin = profile?.role === "admin";
      }
    }

    // Allow internal API key
    if (apiKey === process.env.INTERNAL_API_KEY) {
      isAdmin = true;
    }

    if (!isAdmin) {
      return NextResponse.json(
        { error: "Admin access required" },
        { status: 403 }
      );
    }

    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const validation = validateBody(injuryCollectSchema, rawBody);
    if (!validation.success) {
      return NextResponse.json(
        { error: "Invalid request", details: validation.error },
        { status: 400 }
      );
    }

    const { source } = validation.data;

    // Log collection attempt
    const { data: logEntry } = await supabaseAdmin
      .from("injury_collection_log" as any)
      .insert({
        source,
        status: "running",
        metadata: { triggered_by: "api", request_body: rawBody },
      })
      .select()
      .single();

    const response = NextResponse.json({
      success: true,
      message: "Injury collection triggered",
      log_id: (logEntry as any)?.id,
      instructions: {
        premierinjuries: "node scripts/collect-injuries-enhanced.js --source premierinjuries",
        apifootball: "node scripts/collect-injuries-enhanced.js --source apifootball",
        all: "node scripts/collect-injuries-enhanced.js",
      },
      note: "Run the appropriate command in the project directory to execute collection",
    });
    addRateLimitHeaders(response, rl.remaining, rl.resetAt);
    return response;
  } catch (error) {
    console.error("Injury collection error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * GET /api/v1/injuries/collect
 * Get collection status and recent logs.
 */
export async function GET() {
  try {
    const rl = checkRateLimit("injuries:collect:get", 30, 60000);

    // Get recent collection logs
    const { data: logs, error: logsError } = await supabaseAdmin
      .from("injury_collection_log" as any)
      .select("*")
      .order("created_at", { ascending: false })
      .limit(10);

    if (logsError) {
      console.error("Error fetching logs:", logsError);
    }

    // Get current injury statistics
    const { data: stats } = await supabaseAdmin
      .from("injury_dashboard_summary")
      .select("*")
      .single();

    // Get data freshness (simplified query)
    const { data: freshness } = await supabaseAdmin
      .from("player_availability" as any)
      .select("team_name, updated_at")
      .in("status", ["injured", "suspended", "doubtful", "out"]);

    const response = NextResponse.json({
      success: true,
      statistics: stats,
      recent_logs: logs || [],
      data_freshness: freshness || [],
    });
    addRateLimitHeaders(response, rl.remaining, rl.resetAt);
    return response;
  } catch (error) {
    console.error("Error fetching injury status:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
