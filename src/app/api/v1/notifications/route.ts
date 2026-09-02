import { NextRequest, NextResponse } from "next/server";
import { requireAuth, checkRateLimit, addRateLimitHeaders } from "@/lib/api/utils";
import { z } from "zod";
import { validateBody } from "@/lib/api/validation";

// ── Schemas ────────────────────────────────────────────────────────

const notificationSubscribeSchema = z.object({
  type: z.literal("subscribe"),
  data: z.object({
    endpoint: z.string().url("Invalid subscription endpoint"),
    keys: z.object({
      p256dh: z.string().min(1, "Missing p256dh key"),
      auth: z.string().min(1, "Missing auth key"),
    }),
    userId: z.string().uuid().optional(),
  }),
});

const notificationElitePickSchema = z.object({
  type: z.literal("elite_pick"),
  data: z.object({
    match: z.string().min(1, "Match name required"),
    market: z.string().min(1, "Market required"),
    selection: z.string().min(1, "Selection required"),
    probability: z.number().min(0).max(1, "Probability must be 0-1"),
    tier: z.enum(["ELITE", "PREMIUM", "FREE"]),
    edge: z.number().optional(),
    fixture_id: z.string().uuid().optional(),
  }),
});

const notificationPostSchema = z.discriminatedUnion("type", [
  notificationSubscribeSchema,
  notificationElitePickSchema,
]);

// ── In-memory subscription store ────────────────────────────────────

interface PushSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  userId?: string;
  createdAt: string;
}

const subscriptions: Map<string, PushSubscription> = new Map();

// ── POST ───────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    await requireAuth(request);

    const rl = checkRateLimit("notifications:post", request, 30, 60000);

    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const validation = validateBody(notificationPostSchema, rawBody);
    if (!validation.success) {
      return NextResponse.json(
        { error: "Invalid request", details: validation.error },
        { status: 400 }
      );
    }

    const { type, data } = validation.data;

    if (type === "subscribe") {
      const { endpoint, keys, userId } = data;

      subscriptions.set(endpoint, {
        endpoint,
        keys,
        userId,
        createdAt: new Date().toISOString(),
      });

      const response = NextResponse.json({
        success: true,
        message: "Subscription registered",
        totalSubscriptions: subscriptions.size,
      });
      addRateLimitHeaders(response, rl.remaining, rl.resetAt);
      return response;
    }

    if (type === "elite_pick") {
      const { match, market, selection, probability, tier } = data;

      if (tier !== "ELITE") {
        return NextResponse.json({ success: true, message: "Not ELITE tier, skipping" });
      }

      const notification = {
        title: `👑 ELITE Pick: ${match}`,
        body: `${market} → ${selection} at ${Math.round(probability * 100)}% confidence`,
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

      // Store for polling (in production, use Web Push API)
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

      const response = NextResponse.json({
        success: true,
        message: "Notification sent",
        subscribers: subscriptions.size,
        notification,
      });
      addRateLimitHeaders(response, rl.remaining, rl.resetAt);
      return response;
    }

    return NextResponse.json({ error: "Unknown type" }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ── GET ────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    await requireAuth(request);
  } catch {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const rl = checkRateLimit("notifications:get", request, 60, 60000);

  const notifications = JSON.parse(
    typeof globalThis !== "undefined"
      ? (globalThis as any).__notifications || "[]"
      : "[]"
  );

  const response = NextResponse.json({
    notifications: notifications.slice(-20),
    total: notifications.length,
    subscribers: subscriptions.size,
  });
  addRateLimitHeaders(response, rl.remaining, rl.resetAt);
  return response;
}
