import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_ROLE_KEY || ""
);

export const dynamic = "force-dynamic";

export async function GET() {
  try {
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

    return NextResponse.json({
      fixturesToday: fixturesToday || 0,
      totalLeagues: totalLeagues || 0,
      totalPredictions: totalPredictions || 0,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json({ error: "Failed to fetch stats" }, { status: 500 });
  }
}
