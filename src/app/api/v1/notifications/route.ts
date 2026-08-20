import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import {
  getUserNotifications,
  markAllAsRead,
  createNotification,
} from "@/lib/notifications";
import { notificationQuerySchema, notificationPostSchema, validateQuery, validateBody } from "@/lib/api/validation";

/**
 * GET /api/v1/notifications
 *
 * Get notifications for the authenticated user.
 * Query params: limit, unreadOnly, offset
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

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);

    const validation = validateQuery(notificationQuerySchema, searchParams);
    if (!validation.success) {
      return NextResponse.json(
        { error: "Invalid query parameters", details: validation.error },
        { status: 400 }
      );
    }

    const { limit, unreadOnly, offset } = validation.data;
    const result = await getUserNotifications(user.id, { limit, unreadOnly, offset });

    return NextResponse.json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error("GET /api/v1/notifications error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/v1/notifications
 *
 * Create a notification (admin only) or mark all as read.
 * Body: { action: "mark_all_read" } or { userId, type, title, body, data }
 */
export async function POST(request: NextRequest) {
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

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const validation = validateBody(notificationPostSchema, body);
    if (!validation.success) {
      return NextResponse.json(
        { error: "Invalid request body", details: validation.error },
        { status: 400 }
      );
    }

    const data = validation.data;

    if (data.action === "mark_all_read") {
      await markAllAsRead(user.id);
      return NextResponse.json({ success: true });
    }

    if (data.action === "mark_read") {
      // Mark single notification as read
      await supabase
        .from("notifications")
        .update({ is_read: true })
        .eq("id", data.id)
        .eq("user_id", user.id);
      return NextResponse.json({ success: true });
    }

    if (data.action === "create") {
      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .single();

      if (profile?.role !== "admin") {
        return NextResponse.json({ error: "Admin access required" }, { status: 403 });
      }

      await createNotification({
        userId: data.userId,
        type: data.type as "new_picks" | "rollover_pick" | "result_settled" | "chain_milestone" | "chain_broken" | "accumulator_settled" | "model_alert" | "announcement" | "drawdown_warning",
        title: data.title,
        body: data.body,
        data: data.data,
      });

      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error) {
    console.error("POST /api/v1/notifications error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
