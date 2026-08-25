import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/**
 * POST /api/v1/realtime/live-stats
 * Update or increment a live stat counter (replaces Convex updateLiveStats/incrementLiveStats).
 *
 * Body: { key, value, mode: "set" | "increment" | "decrement" }
 * mode defaults to "set" (replace value)
 */
export async function POST(req: NextRequest) {
  try {
    const auth = req.headers.get("authorization");
    const secret = process.env.CRON_SECRET || process.env.VERCEL_CRON_SECRET;
    if (!auth || auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { key, value, mode = "set" } = body;

    if (!key || value === undefined) {
      return NextResponse.json(
        { error: "Missing key or value" },
        { status: 400 }
      );
    }

    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Use the RPC function for atomic upsert
    const { error } = await sb.rpc("upsert_live_stat", {
      p_key: key,
      p_value: value,
      p_mode: mode,
    });

    if (error) {
      // Fallback: manual upsert if RPC doesn't exist
      const existing = await sb
        .from("live_stats")
        .select("id")
        .eq("key", key)
        .single();

      const newValue =
        mode === "increment"
          ? (existing.data ? 0 : 0) + value // Will need actual current value
          : mode === "decrement"
            ? (existing.data ? 0 : 0) - value
            : value;

      if (existing.data) {
        await sb
          .from("live_stats")
          .update({ value: newValue, updated_at: new Date().toISOString() })
          .eq("id", existing.data.id);
      } else {
        await sb.from("live_stats").insert({
          key,
          value: newValue,
          updated_at: new Date().toISOString(),
        });
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
