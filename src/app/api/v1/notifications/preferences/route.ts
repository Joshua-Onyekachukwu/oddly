import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Notification preference keys — must match the JSONB structure in profiles.
 */
const VALID_KEYS = [
  "new_picks",
  "crown_jewel",
  "match_started",
  "result_settled",
  "chain_milestone",
  "chain_broken",
  "accumulator_settled",
  "model_alert",
  "announcement",
  "drawdown_warning",
  "rollover_pick",
] as const;

type NotificationPrefKey = (typeof VALID_KEYS)[number];

const DEFAULT_PREFS: Record<NotificationPrefKey, boolean> = {
  new_picks: true,
  crown_jewel: true,
  match_started: true,
  result_settled: true,
  chain_milestone: true,
  chain_broken: true,
  accumulator_settled: true,
  model_alert: true,
  announcement: true,
  drawdown_warning: true,
  rollover_pick: true,
};

/**
 * GET /api/v1/notifications/preferences
 * Returns the user's notification preferences.
 */
export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const token = authHeader.slice(7);
    const supabase = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { global: { headers: { Authorization: `Bearer ${token}` } } }
    );

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: profile, error } = await supabase
      .from("profiles")
      .select("notification_preferences")
      .eq("id", user.id)
      .single();

    if (error) {
      console.error("Failed to fetch notification preferences:", error);
      return NextResponse.json(
        { error: "Failed to fetch preferences" },
        { status: 500 }
      );
    }

    // Merge with defaults so new keys are always present
    const prefs = {
      ...DEFAULT_PREFS,
      ...((profile?.notification_preferences as Record<string, boolean>) || {}),
    };

    return NextResponse.json({ success: true, data: prefs });
  } catch (error) {
    console.error("GET /api/v1/notifications/preferences error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/v1/notifications/preferences
 * Update one or more notification preferences.
 * Body: { preferences: { [key: string]: boolean } }
 */
export async function PATCH(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const token = authHeader.slice(7);
    const supabase = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { global: { headers: { Authorization: `Bearer ${token}` } } }
    );

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { preferences } = body as { preferences?: Record<string, boolean> };

    if (!preferences || typeof preferences !== "object") {
      return NextResponse.json(
        { error: "Missing 'preferences' object in body" },
        { status: 400 }
      );
    }

    // Validate keys
    const invalidKeys = Object.keys(preferences).filter(
      (k) => !VALID_KEYS.includes(k as NotificationPrefKey)
    );
    if (invalidKeys.length > 0) {
      return NextResponse.json(
        { error: `Invalid preference keys: ${invalidKeys.join(", ")}` },
        { status: 400 }
      );
    }

    // Fetch current preferences
    const { data: profile } = await supabase
      .from("profiles")
      .select("notification_preferences")
      .eq("id", user.id)
      .single();

    const currentPrefs = {
      ...DEFAULT_PREFS,
      ...((profile?.notification_preferences as Record<string, boolean>) || {}),
    };

    // Merge
    const updatedPrefs = { ...currentPrefs, ...preferences };

    const { error } = await supabase
      .from("profiles")
      .update({ notification_preferences: updatedPrefs as any })
      .eq("id", user.id);

    if (error) {
      console.error("Failed to update notification preferences:", error);
      return NextResponse.json(
        { error: "Failed to update preferences" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, data: updatedPrefs });
  } catch (error) {
    console.error("PATCH /api/v1/notifications/preferences error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
