import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { checkRateLimit, addRateLimitHeaders } from "@/lib/api/utils";

export const dynamic = "force-dynamic";

export async function GET() {
  // Rate limit: 60 requests per minute
  const rl = checkRateLimit("stats", 60, 60000);

  if (!rl.allowed) {
    const response = NextResponse.json(
      { error: "Rate limit exceeded" },
      { status: 429 }
    );
    addRateLimitHeaders(response, 0, rl.resetAt);
    return response;
  }

  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL || "",
      process.env.SUPABASE_SERVICE_ROLE_KEY || ""
    );

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const [{ count: fixturesToday }, { count: totalLeagues }, { count: totalPredictions }] =
      await Promise.all([
        supabase
          .from("fixtures")
          .select("id", { count: "exact", head: true })
          .gte("kickoff_time", todayStart.toISOString())
          .lte("kickoff_time", todayEnd.toISOString()),
        supabase
          .from("leagues")
          .select("id", { count: "exact", head: true })
          .eq("is_active", true),
        supabase
          .from("predictions")
          .select("id", { count: "exact", head: true }),
      ]);

    const response = NextResponse.json({
      fixturesToday: fixturesToday || 0,
      totalLeagues: totalLeagues || 0,
      totalPredictions: totalPredictions || 0,
      timestamp: new Date().toISOString(),
    });

    // Add Cache-Control headers: cache for 5 minutes, serve stale for 10 minutes while revalidating
    response.headers.set(
      "Cache-Control",
      "public, s-maxage=300, stale-while-revalidate=600"
    );

    // Add rate limit headers
    addRateLimitHeaders(response, rl.remaining, rl.resetAt);

    return response;
  } catch (error) {
    return NextResponse.json({ error: "Failed to fetch stats" }, { status: 500 });
  }
}
