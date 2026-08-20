/**
 * ODDLY Notification Service
 *
 * Creates and manages notifications for users:
 * - Value bet detected
 * - Crown Jewel selected
 * - Match started / live
 * - Rollover reminder
 * - Accumulator settled
 * - Announcements
 */

import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

const supabaseAdmin = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

type NotificationType =
  | "new_picks"
  | "rollover_pick"
  | "result_settled"
  | "chain_milestone"
  | "chain_broken"
  | "accumulator_settled"
  | "model_alert"
  | "announcement"
  | "drawdown_warning";

interface CreateNotificationOpts {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

/**
 * Create a notification for a single user.
 */
export async function createNotification(opts: CreateNotificationOpts): Promise<void> {
  // Check user's notification preferences before creating
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("notification_preferences")
    .eq("id", opts.userId)
    .single();

  const prefs = (profile?.notification_preferences as Record<string, boolean>) || {};
  const prefKey = getPreferenceKey(opts.type, opts.title);

  // Skip if user has disabled this notification type
  if (prefs[prefKey] === false) {
    return;
  }

  const { error } = await supabaseAdmin.from("notifications").insert({
    user_id: opts.userId,
    type: opts.type,
    title: opts.title,
    body: opts.body,
    data: (opts.data || {}) as any,
  });

  if (error) {
    console.error("Failed to create notification:", error);
  }
}

/**
 * Create a notification for all users (or users of a specific tier).
 */
/**
 * Map notification service types to preference keys.
 * Some service types map to different preference keys (e.g. new_picks -> crown_jewel for Crown Jewel).
 */
function getPreferenceKey(type: string, title: string): string {
  if (type === "new_picks" && title.includes("Crown Jewel")) return "crown_jewel";
  if (type === "new_picks" && title.includes("Match Started")) return "match_started";
  return type;
}

export async function broadcastNotification(
  opts: Omit<CreateNotificationOpts, "userId"> & { tier?: string }
): Promise<number> {
  // Get target users with their notification preferences
  let query = supabaseAdmin.from("profiles").select("id, notification_preferences");

  if (opts.tier && opts.tier !== "all") {
    query = query.eq("subscription_tier", opts.tier as "free" | "premium" | "elite");
  }

  const { data: users, error: userError } = await query;

  if (userError || !users?.length) {
    console.error("Failed to fetch users for broadcast:", userError);
    return 0;
  }

  // Filter users based on their notification preferences
  const prefKey = getPreferenceKey(opts.type, opts.title);
  const eligibleUsers = users.filter((u) => {
    const prefs = (u.notification_preferences as Record<string, boolean>) || {};
    // Default to true if preference not set (opt-in by default)
    return prefs[prefKey] !== false;
  });

  if (!eligibleUsers.length) {
    return 0;
  }

  // Create notifications in batch
  const notifications = eligibleUsers.map((u) => ({
    user_id: u.id,
    type: opts.type,
    title: opts.title,
    body: opts.body,
    data: (opts.data || {}) as any,
  }));

  const { error } = await supabaseAdmin.from("notifications").insert(notifications as any);

  if (error) {
    console.error("Failed to broadcast notifications:", error);
    return 0;
  }

  return eligibleUsers.length;
}

/**
 * Get notifications for a user with pagination.
 */
export async function getUserNotifications(
  userId: string,
  options: { limit?: number; unreadOnly?: boolean; offset?: number } = {}
): Promise<{
  notifications: Array<{
    id: string;
    type: string;
    title: string;
    body: string;
    data: Record<string, unknown> | null;
    is_read: boolean;
    created_at: string;
  }>;
  unreadCount: number;
  total: number;
}> {
  const { limit = 20, unreadOnly = false, offset = 0 } = options;

  let query = supabaseAdmin
    .from("notifications")
    .select("*", { count: "exact" })
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (unreadOnly) {
    query = query.eq("is_read", false);
  }

  query = query.range(offset, offset + limit - 1);

  const { data, count, error } = await query;

  if (error) {
    console.error("Failed to fetch notifications:", error);
    return { notifications: [], unreadCount: 0, total: 0 };
  }

  // Get unread count
  const { count: unreadCount } = await supabaseAdmin
    .from("notifications")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("is_read", false);

  return {
    notifications: (data || []).map((n) => ({
      id: n.id,
      type: n.type,
      title: n.title,
      body: n.body,
      data: n.data as Record<string, unknown> | null,
      is_read: n.is_read,
      created_at: n.created_at,
    })),
    unreadCount: unreadCount || 0,
    total: count || 0,
  };
}

/**
 * Mark a notification as read.
 */
export async function markAsRead(notificationId: string, userId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from("notifications")
    .update({ is_read: true })
    .eq("id", notificationId)
    .eq("user_id", userId);

  if (error) {
    console.error("Failed to mark notification as read:", error);
  }
}

/**
 * Mark all notifications as read for a user.
 */
export async function markAllAsRead(userId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from("notifications")
    .update({ is_read: true })
    .eq("user_id", userId)
    .eq("is_read", false);

  if (error) {
    console.error("Failed to mark all notifications as read:", error);
  }
}

/**
 * Delete old notifications (older than N days).
 */
export async function cleanupOldNotifications(daysOld: number = 30): Promise<number> {
  const cutoff = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000).toISOString();

  const { count, error } = await supabaseAdmin
    .from("notifications")
    .delete({ count: "exact" })
    .lt("created_at", cutoff);

  if (error) {
    console.error("Failed to cleanup notifications:", error);
    return 0;
  }

  return count || 0;
}

// ============================================
// Event-Specific Notification Builders
// ============================================

/**
 * Notify all premium/elite users about a new Crown Jewel pick.
 */
export async function notifyCrownJewel(
  fixture: { homeTeam: string; awayTeam: string; league: string },
  prediction: { market: string; selection: string; edge: number; confidence: number }
): Promise<number> {
  return broadcastNotification({
    type: "new_picks",
    title: "👑 Crown Jewel Selected",
    body: `${fixture.homeTeam} vs ${fixture.awayTeam} — ${prediction.market} (${prediction.selection}). Edge: +${(prediction.edge * 100).toFixed(1)}%, Confidence: ${(prediction.confidence * 100).toFixed(0)}%`,
    data: {
      fixture: `${fixture.homeTeam} vs ${fixture.awayTeam}`,
      league: fixture.league,
      market: prediction.market,
      selection: prediction.selection,
      edge: prediction.edge,
      confidence: prediction.confidence,
    },
  });
}

/**
 * Notify users about new value bets detected.
 */
export async function notifyValueBets(
  valueBets: Array<{
    fixture: string;
    market: string;
    selection: string;
    edge: number;
    odds: number;
  }>
): Promise<number> {
  if (!valueBets.length) return 0;

  const top = valueBets[0];
  const count = valueBets.length;

  return broadcastNotification({
    type: "new_picks",
    title: `💰 ${count} New Value Bet${count > 1 ? "s" : ""} Detected`,
    body: `Top pick: ${top.fixture} — ${top.market} (${top.selection}) at ${top.odds} odds with +${(top.edge * 100).toFixed(1)}% edge`,
    data: {
      count,
      topBet: top,
      bets: valueBets.slice(0, 5),
    },
  });
}

/**
 * Notify users that a match has started / gone live.
 */
export async function notifyMatchStarted(
  fixture: { homeTeam: string; awayTeam: string; league: string; kickoff: string },
  userIds: string[]
): Promise<number> {
  if (!userIds.length) return 0;

  // Check preferences for each user
  const { data: profiles } = await supabaseAdmin
    .from("profiles")
    .select("id, notification_preferences")
    .in("id", userIds);

  const eligibleUserIds = (profiles || [])
    .filter((p) => {
      const prefs = (p.notification_preferences as Record<string, boolean>) || {};
      return prefs["match_started"] !== false;
    })
    .map((p) => p.id);

  if (!eligibleUserIds.length) return 0;

  const notifications = eligibleUserIds.map((userId) => ({
    user_id: userId,
    type: "new_picks" as const,
    title: `⚽ Match Started`,
    body: `${fixture.homeTeam} vs ${fixture.awayTeam} (${fixture.league}) is now live`,
    data: {
      fixture: `${fixture.homeTeam} vs ${fixture.awayTeam}`,
      league: fixture.league,
      kickoff: fixture.kickoff,
    },
  }));

  const { error } = await supabaseAdmin.from("notifications").insert(notifications);
  if (error) {
    console.error("Failed to notify match started:", error);
    return 0;
  }

  return eligibleUserIds.length;
}

/**
 * Notify users when their bet result is settled.
 */
export async function notifyBetSettled(
  userId: string,
  bet: { market: string; selection: string; status: "won" | "lost"; profit: number; fixture: string }
): Promise<void> {
  const emoji = bet.status === "won" ? "🎉" : "😔";
  const title = bet.status === "won" ? "Bet Won!" : "Bet Lost";

  await createNotification({
    userId,
    type: "result_settled",
    title: `${emoji} ${title}`,
    body: `${bet.fixture} — ${bet.market} (${bet.selection}). ${bet.status === "won" ? `+${bet.profit.toFixed(2)} profit` : "Better luck next time"}`,
    data: {
      fixture: bet.fixture,
      market: bet.market,
      selection: bet.selection,
      status: bet.status,
      profit: bet.profit,
    },
  });
}

/**
 * Notify users about rollover chain milestones.
 */
export async function notifyRolloverMilestone(
  userId: string,
  chain: { day: number; balance: number; targetDays: number }
): Promise<void> {
  const progress = Math.round((chain.day / chain.targetDays) * 100);

  await createNotification({
    userId,
    type: "chain_milestone",
    title: `🔥 Rollover Day ${chain.day} Complete!`,
    body: `Balance: ${chain.balance.toFixed(2)} — ${progress}% to your ${chain.targetDays}-day target`,
    data: {
      day: chain.day,
      balance: chain.balance,
      targetDays: chain.targetDays,
      progress,
    },
  });
}

/**
 * Notify users about system announcements.
 */
export async function notifyAnnouncement(
  announcement: { title: string; body: string; target: string }
): Promise<number> {
  return broadcastNotification({
    type: "announcement",
    title: `📢 ${announcement.title}`,
    body: announcement.body,
    tier: announcement.target,
    data: {
      announcement: announcement.title,
    },
  });
}
