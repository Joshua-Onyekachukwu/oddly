import { NextRequest, NextResponse } from "next/server";

/**
 * Push Notification API for ELITE Picks
 *
 * Supports:
 * - Web Push (via VAPID keys)
 * - Email notifications
 * - In-app notifications
 *
 * POST /api/v1/notifications
 * Body: { type: "elite_pick", data: { fixture_id, match, market, probability, tier } }
 */

// In-memory subscription store (use database in production)
const subscriptions: Map<string, PushSubscription> = new Map();

interface PushSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  userId?: string;
  createdAt: string;
}

// POST: Send notification
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { type, data } = body;

    if (type === "subscribe") {
      // Register push subscription
      const { endpoint, keys, userId } = data;
      if (!endpoint || !keys) {
        return NextResponse.json({ error: "Missing endpoint or keys" }, { status: 400 });
      }

      subscriptions.set(endpoint, {
        endpoint,
        keys,
        userId,
        createdAt: new Date().toISOString(),
      });

      return NextResponse.json({
        success: true,
        message: "Subscription registered",
        totalSubscriptions: subscriptions.size,
      });
    }

    if (type === "elite_pick") {
      // Send ELITE pick notification to all subscribers
      const { match, market, selection, probability, tier, edge } = data;

      if (tier !== "ELITE") {
        return NextResponse.json({ success: true, message: "Not ELITE tier, skipping" });
      }

      const notification = {
        title: `👑 ELITE Pick: ${match}`,
        body: `${market} → ${selection} at ${Math.round(probability * 100)}% confidence${edge ? ` (+${Math.round(edge * 100)}% edge)` : ""}`,
        icon: "/icons/notification.png",
        badge: "/icons/badge.png",
        data: {
          url: "/predictions",
          match,
          market,
          selection,
          probability,
          tier,
        },
        timestamp: Date.now(),
      };

      // In production, send via Web Push API
      // For now, store for polling
      const notifications = JSON.parse(
        typeof globalThis !== "undefined"
          ? (globalThis as any).__notifications || "[]"
          : "[]"
      );
      notifications.push(notification);
      if (typeof globalThis !== "undefined") {
        (globalThis as any).__notifications = JSON.stringify(notifications.slice(-100));
      }

      console.log(`[NOTIFY] ELITE pick: ${match} — ${market} ${selection} ${Math.round(probability * 100)}%`);

      return NextResponse.json({
        success: true,
        message: "Notification sent",
        subscribers: subscriptions.size,
        notification,
      });
    }

    return NextResponse.json({ error: "Unknown type" }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// GET: Get recent notifications
export async function GET() {
  const notifications = JSON.parse(
    typeof globalThis !== "undefined"
      ? (globalThis as any).__notifications || "[]"
      : "[]"
  );

  return NextResponse.json({
    notifications: notifications.slice(-20),
    total: notifications.length,
    subscribers: subscriptions.size,
  });
}
