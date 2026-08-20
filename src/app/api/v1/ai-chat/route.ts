import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { getNVIDIAClient } from "@/lib/nvidia/client";
import { buildChatMessages } from "@/lib/nvidia/prompts";

const supabaseAdmin = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Rate limits per tier
const RATE_LIMITS: Record<string, number> = {
  free: 3,
  premium: -1, // unlimited
  elite: -1, // unlimited
};

/**
 * POST /api/v1/ai-chat
 * 
 * Streaming AI chat endpoint. Sends user message + context to NVIDIA NIM
 * and streams the response back as Server-Sent Events.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { message, history = [] } = body;

    if (!message || typeof message !== "string") {
      return NextResponse.json(
        { error: "Message is required" },
        { status: 400 }
      );
    }

    // Authenticate user
    const authHeader = request.headers.get("authorization");
    let userId: string | null = null;
    let userTier = "free";

    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.slice(7);
      const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);

      if (user && !error) {
        userId = user.id;

        // Get user profile for tier and rate limiting
        const { data: profile } = await supabaseAdmin
          .from("profiles")
          .select("subscription_tier")
          .eq("id", user.id)
          .single();

        if (profile) {
          userTier = profile.subscription_tier || "free";
        }
      }
    }

    // Rate limit check for free tier
    if (userId && RATE_LIMITS[userTier] !== -1) {
      // Count today's questions
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const { count } = await supabaseAdmin
        .from("ai_cache")
        .select("*", { count: "exact", head: true })
        .eq("model_used", `chat:${userId}`)
        .gte("created_at", today.toISOString());

      const limit = RATE_LIMITS[userTier];
      if (count !== null && count >= limit) {
        return NextResponse.json(
          {
            error: `Daily limit reached (${limit} questions/day for ${userTier} tier). Upgrade for unlimited.`,
          },
          { status: 429 }
        );
      }
    }

    // Fetch today's context from Supabase
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const [fixturesResult, predictionsResult, recommendationsResult] =
      await Promise.all([
        supabaseAdmin
          .from("fixtures")
          .select("id, kickoff_time, home_team_id, away_team_id, league_id, status")
          .gte("kickoff_time", todayStart.toISOString())
          .lte("kickoff_time", todayEnd.toISOString())
          .limit(50),

        supabaseAdmin
          .from("predictions")
          .select("id, fixture_id, market, selection, model_probability, confidence_lower, confidence_upper")
          .limit(100),

        supabaseAdmin
          .from("recommendations")
          .select("id, fixture_id, market, selection, bookmaker_odds, edge, opportunity_score, is_recommended")
          .eq("is_recommended", true)
          .order("edge", { ascending: false })
          .limit(10),
      ]);

    // Get Crown Jewel (highest edge recommendation)
    const crownJewel = recommendationsResult.data?.[0] || null;

    // Build context for the AI
    const context = {
      todayStats: {
        totalMatches: fixturesResult.data?.length || 0,
        totalPredictions: predictionsResult.data?.length || 0,
        crownJewel: crownJewel
          ? {
              match: `Fixture ${crownJewel.fixture_id}`,
              market: `${crownJewel.market} — ${crownJewel.selection}`,
              edge: Number(crownJewel.edge) * 100,
            }
          : undefined,
        topValueBets: (recommendationsResult.data || []).slice(0, 5).map((r) => ({
          match: `Fixture ${r.fixture_id}`,
          market: `${r.market} — ${r.selection}`,
          edge: Number(r.edge) * 100,
        })),
      },
      userProfile: {
        tier: userTier,
        questionsRemaining:
          RATE_LIMITS[userTier] === -1
            ? -1
            : RATE_LIMITS[userTier] -
              ((await supabaseAdmin
                .from("ai_cache")
                .select("*", { count: "exact", head: true })
                .eq("model_used", `chat:${userId}`)
                .gte("created_at", todayStart.toISOString())).count || 0),
      },
    };

    // Build messages
    const messages = buildChatMessages(message, history, context);

    // Get NVIDIA client and stream
    const client = getNVIDIAClient();

    // Create a ReadableStream for SSE
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          let fullResponse = "";

          for await (const chunk of client.chatStream(messages, {
            taskId: "chat",
            temperature: 0.7,
            maxTokens: 2048,
          })) {
            fullResponse += chunk;
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ chunk })}\n\n`)
            );
          }

          // Send done signal
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`)
          );
          controller.close();

          // Log to ai_cache for admin monitoring
          if (userId) {
            await supabaseAdmin.from("ai_cache").upsert(
              {
                cache_key: `chat:${userId}:${Date.now()}`,
                response: fullResponse.substring(0, 5000),
                model_used: `chat:${userId}`,
              },
              { onConflict: "cache_key" }
            );
          }
        } catch (error) {
          console.error("Streaming error:", error);
          const errMsg = error instanceof Error ? error.message : "Unknown error";
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ error: errMsg })}\n\n`
            )
          );
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    console.error("AI chat error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
