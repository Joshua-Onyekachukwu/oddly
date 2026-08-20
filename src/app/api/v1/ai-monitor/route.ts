import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { getNVIDIAClient } from "@/lib/nvidia/client";

const supabaseAdmin = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * GET /api/v1/ai-monitor
 * 
 * Admin-only endpoint for monitoring AI usage:
 * - NVIDIA API key usage stats
 * - Cache hit rate
 * - Total API calls
 * - Response times
 */
export async function GET(request: NextRequest) {
  try {
    // Authenticate admin
    const authHeader = request.headers.get("authorization");
    const apiKey = request.headers.get("x-api-key");

    if (!authHeader && !apiKey) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.slice(7);
      const { data: { user } } = await supabaseAdmin.auth.getUser(token);

      if (!user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }

      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .single();

      if (profile?.role !== "admin") {
        return NextResponse.json({ error: "Admin access required" }, { status: 403 });
      }
    }

    // Get NVIDIA client usage stats
    const client = getNVIDIAClient();
    const keyUsage = client.getUsage();
    const activeKeys = client.getActiveKeysCount();

    // Get cache stats from Supabase
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [totalCache, todayCache, chatCache] = await Promise.all([
      supabaseAdmin
        .from("ai_cache")
        .select("id", { count: "exact", head: true }),
      supabaseAdmin
        .from("ai_cache")
        .select("id", { count: "exact", head: true })
        .gte("created_at", today.toISOString()),
      supabaseAdmin
        .from("ai_cache")
        .select("id", { count: "exact", head: true })
        .like("model_used", "chat:%")
        .gte("created_at", today.toISOString()),
    ]);

    return NextResponse.json({
      nvidia: {
        activeKeys,
        keyUsage: Object.entries(keyUsage).map(([key, count]) => ({
          keyPreview: key.substring(0, 12) + "...",
          requestCount: count,
        })),
        baseUrl: "https://integrate.api.nvidia.com/v1",
      },
      cache: {
        totalEntries: totalCache.count || 0,
        todayEntries: todayCache.count || 0,
        todayChatCalls: chatCache.count || 0,
      },
      models: {
        analyst: "meta/llama-3.1-70b-instruct",
        explainer: "mistralai/mistral-7b-instruct-v0.3",
        classifier: "microsoft/phi-3-mini-4k-instruct",
        riskNarrator: "google/gemma-2-9b-it",
        sqlGenerator: "meta/codellama-34b",
        fastTagger: "meta/llama-3.2-3b-instruct",
        fallback: "meta/llama-3.1-8b-instruct",
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("AI monitor error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
