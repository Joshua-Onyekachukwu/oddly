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
 * - Per-model breakdown
 * - Cache hit/miss rates
 * - Recent cache entries
 * - Prediction pipeline stats
 * - 7-day trend data
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
      const {
        data: { user },
      } = await supabaseAdmin.auth.getUser(token);

      if (!user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }

      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .single();

      if (profile?.role !== "admin") {
        return NextResponse.json(
          { error: "Admin access required" },
          { status: 403 }
        );
      }
    }

    // 1. NVIDIA client usage stats
    const client = getNVIDIAClient();
    const keyUsage = client.getUsage();
    const activeKeys = client.getActiveKeysCount();

    // 2. Cache stats from Supabase
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayISO = today.toISOString();

    const [totalCache, todayCache, chatCache, predictCache] =
      await Promise.all([
        supabaseAdmin
          .from("ai_cache")
          .select("id", { count: "exact", head: true }),
        supabaseAdmin
          .from("ai_cache")
          .select("id", { count: "exact", head: true })
          .gte("created_at", todayISO),
        supabaseAdmin
          .from("ai_cache")
          .select("id", { count: "exact", head: true })
          .like("model_used", "chat:%")
          .gte("created_at", todayISO),
        supabaseAdmin
          .from("ai_cache")
          .select("id", { count: "exact", head: true })
          .like("model_used", "predict:%")
          .gte("created_at", todayISO),
      ]);

    // 3. Per-model cache breakdown
    const { data: cacheByModel } = await supabaseAdmin
      .from("ai_cache")
      .select("model_used")
      .gte("created_at", todayISO);

    const modelCounts: Record<string, number> = {};
    if (cacheByModel) {
      for (const entry of cacheByModel) {
        const model = entry.model_used || "unknown";
        // Strip user ID prefix from chat entries
        const cleanModel = model.startsWith("chat:")
          ? "chat"
          : model.startsWith("predict:")
          ? "predict"
          : model;
        modelCounts[cleanModel] = (modelCounts[cleanModel] || 0) + 1;
      }
    }

    // 4. Recent cache entries (last 20)
    const { data: recentCache } = await supabaseAdmin
      .from("ai_cache")
      .select("cache_key, model_used, created_at")
      .order("created_at", { ascending: false })
      .limit(20);

    // 5. Prediction stats
    const [totalPredictions, todayPredictions, correctPredictions, wrongPredictions] =
      await Promise.all([
        supabaseAdmin
          .from("predictions")
          .select("id", { count: "exact", head: true }),
        supabaseAdmin
          .from("predictions")
          .select("id", { count: "exact", head: true })
          .gte("created_at", todayISO),
        supabaseAdmin
          .from("predictions")
          .select("id", { count: "exact", head: true })
          .eq("result", "correct"),
        supabaseAdmin
          .from("predictions")
          .select("id", { count: "exact", head: true })
          .eq("result", "wrong"),
      ]);

    // 6. Model performance records
    const { data: modelPerf } = await supabaseAdmin
      .from("model_performance")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(10);

    // 7. 7-day cache trend
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    sevenDaysAgo.setHours(0, 0, 0, 0);

    const { data: weeklyCache } = await supabaseAdmin
      .from("ai_cache")
      .select("created_at, model_used")
      .gte("created_at", sevenDaysAgo.toISOString())
      .order("created_at", { ascending: true });

    // Aggregate by day
    const dailyTrend: Record<string, { total: number; chat: number; predict: number }> = {};
    if (weeklyCache) {
      for (const entry of weeklyCache) {
        const day = entry.created_at.substring(0, 10);
        if (!dailyTrend[day]) {
          dailyTrend[day] = { total: 0, chat: 0, predict: 0 };
        }
        dailyTrend[day].total++;
        const model = entry.model_used || "";
        if (model.startsWith("chat:")) dailyTrend[day].chat++;
        else if (model.startsWith("predict:")) dailyTrend[day].predict++;
      }
    }

    // 8. Recommendation stats
    const [totalRecs, recommended, topEdge] = await Promise.all([
      supabaseAdmin
        .from("recommendations")
        .select("id", { count: "exact", head: true }),
      supabaseAdmin
        .from("recommendations")
        .select("id", { count: "exact", head: true })
        .eq("is_recommended", true),
      supabaseAdmin
        .from("recommendations")
        .select("edge, market, selection")
        .eq("is_recommended", true)
        .order("edge", { ascending: false })
        .limit(5),
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
        todayPredictCalls: predictCache.count || 0,
        hitRate:
          todayCache.count && todayPredictions.count
            ? Math.round(
                ((todayCache.count - (chatCache.count || 0)) /
                  Math.max(todayCache.count, 1)) *
                  100
              )
            : 0,
        byModel: modelCounts,
        recentEntries: recentCache || [],
      },
      predictions: {
        total: totalPredictions.count || 0,
        today: todayPredictions.count || 0,
        correct: correctPredictions.count || 0,
        wrong: wrongPredictions.count || 0,
        accuracy:
          correctPredictions.count && wrongPredictions.count
            ? Math.round(
                (correctPredictions.count /
                  (correctPredictions.count + wrongPredictions.count)) *
                  100
              )
            : 0,
        modelPerformance: modelPerf || [],
      },
      recommendations: {
        total: totalRecs.count || 0,
        recommended: recommended.count || 0,
        topEdge: topEdge || [],
      },
      trend: dailyTrend,
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
