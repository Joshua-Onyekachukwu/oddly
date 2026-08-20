"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/providers/AuthProvider";
import { createClient } from "@/lib/supabase/client";

interface Notification {
  id: string;
  type: string;
  title: string;
  body: string;
  data: Record<string, unknown> | null;
  is_read: boolean;
  created_at: string;
}

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: days > 365 ? "numeric" : undefined,
  });
}

function getNotificationIcon(type: string): { icon: string; color: string; bg: string } {
  switch (type) {
    case "new_picks":
      return { icon: "ri-percent-line", color: "text-[#22c55e]", bg: "bg-[#22c55e]/10" };
    case "result_settled":
      return { icon: "ri-check-double-line", color: "text-[#2563EB]", bg: "bg-[#2563EB]/10" };
    case "chain_milestone":
      return { icon: "ri-fire-line", color: "text-[#D97706]", bg: "bg-[#D97706]/10" };
    case "chain_broken":
      return { icon: "ri-close-circle-line", color: "text-[#EF4444]", bg: "bg-[#EF4444]/10" };
    case "accumulator_settled":
      return { icon: "ri-stack-line", color: "text-[#8B5CF6]", bg: "bg-[#8B5CF6]/10" };
    case "model_alert":
      return { icon: "ri-robot-2-line", color: "text-[#1B2A4A]", bg: "bg-[#1B2A4A]/10" };
    case "announcement":
      return { icon: "ri-megaphone-line", color: "text-[#D97706]", bg: "bg-[#D97706]/10" };
    case "drawdown_warning":
      return { icon: "ri-alert-line", color: "text-[#EF4444]", bg: "bg-[#EF4444]/10" };
    default:
      return { icon: "ri-notification-3-line", color: "text-gray-500", bg: "bg-gray-100" };
  }
}

function getTypeLabel(type: string): string {
  switch (type) {
    case "new_picks": return "New Picks";
    case "result_settled": return "Result";
    case "chain_milestone": return "Milestone";
    case "chain_broken": return "Chain Broken";
    case "accumulator_settled": return "Accumulator";
    case "model_alert": return "Model Alert";
    case "announcement": return "Announcement";
    case "drawdown_warning": return "Warning";
    default: return type;
  }
}

const FILTER_OPTIONS = [
  { value: "all", label: "All" },
  { value: "unread", label: "Unread" },
  { value: "new_picks", label: "New Picks" },
  { value: "result_settled", label: "Results" },
  { value: "chain_milestone", label: "Milestones" },
  { value: "accumulator_settled", label: "Accumulators" },
  { value: "announcement", label: "Announcements" },
];

export default function NotificationsPage() {
  const { session, user } = useAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [filter, setFilter] = useState("all");
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [unreadCount, setUnreadCount] = useState(0);
  const [markingRead, setMarkingRead] = useState(false);

  const PAGE_SIZE = 20;

  const fetchNotifications = useCallback(
    async (pageNum: number, append: boolean = false) => {
      if (!session?.access_token) return;

      if (append) {
        setLoadingMore(true);
      } else {
        setLoading(true);
      }

      try {
        const params = new URLSearchParams({
          limit: String(PAGE_SIZE),
          offset: String(pageNum * PAGE_SIZE),
        });

        if (filter === "unread") {
          params.set("unreadOnly", "true");
        }

        const res = await fetch(`/api/v1/notifications?${params}`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        const data = await res.json();

        if (data.success) {
          const newNotifs = data.data.notifications || [];
          setNotifications((prev) =>
            append ? [...prev, ...newNotifs] : newNotifs
          );
          setUnreadCount(data.data.unreadCount || 0);
          setHasMore(newNotifs.length === PAGE_SIZE);
        }
      } catch (error) {
        console.error("Failed to fetch notifications:", error);
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [session?.access_token, filter]
  );

  // Reset and fetch when filter changes
  useEffect(() => {
    setPage(0);
    setNotifications([]);
    setHasMore(true);
    fetchNotifications(0, false);
  }, [fetchNotifications]);

  // Realtime subscription for live updates
  useEffect(() => {
    if (!user?.id) return;

    const supabase = createClient();
    const channel = supabase
      .channel("page-notifications")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          const newNotif = payload.new as Notification;
          setNotifications((prev) => [newNotif, ...prev]);
          setUnreadCount((prev) => prev + 1);
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          const updated = payload.new as Notification;
          setNotifications((prev) =>
            prev.map((n) => (n.id === updated.id ? { ...n, ...updated } : n))
          );
          // Recount unread
          setNotifications((prev) => {
            setUnreadCount(prev.filter((n) => !n.is_read).length);
            return prev;
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id]);

  async function markAllRead() {
    if (!session?.access_token) return;
    setMarkingRead(true);

    try {
      await fetch("/api/v1/notifications", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ action: "mark_all_read" }),
      });

      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
      setUnreadCount(0);
    } catch (error) {
      console.error("Failed to mark all read:", error);
    } finally {
      setMarkingRead(false);
    }
  }

  async function markAsRead(id: string) {
    if (!session?.access_token) return;

    try {
      await fetch("/api/v1/notifications", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ action: "mark_read", id }),
      });

      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, is_read: true } : n))
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch {
      // Silent fail
    }
  }

  function loadMore() {
    const nextPage = page + 1;
    setPage(nextPage);
    fetchNotifications(nextPage, true);
  }

  // Group notifications by date
  function groupByDate(notifs: Notification[]) {
    const groups: { label: string; items: Notification[] }[] = [];
    let currentLabel = "";
    let currentGroup: Notification[] = [];

    for (const n of notifs) {
      const date = new Date(n.created_at);
      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);

      let label: string;
      if (date.toDateString() === today.toDateString()) {
        label = "Today";
      } else if (date.toDateString() === yesterday.toDateString()) {
        label = "Yesterday";
      } else {
        label = date.toLocaleDateString("en-US", {
          weekday: "long",
          month: "long",
          day: "numeric",
        });
      }

      if (label !== currentLabel) {
        if (currentGroup.length > 0) {
          groups.push({ label: currentLabel, items: currentGroup });
        }
        currentLabel = label;
        currentGroup = [];
      }
      currentGroup.push(n);
    }

    if (currentGroup.length > 0) {
      groups.push({ label: currentLabel, items: currentGroup });
    }

    return groups;
  }

  const groupedNotifications = groupByDate(notifications);

  return (
    <div className="max-w-[720px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-[24px]">
        <div>
          <h1 className="font-display text-[24px] md:text-[28px] font-bold text-[#0A0F1C] mb-[4px]">
            Notifications
          </h1>
          <p className="text-[14px] text-gray-500">
            {unreadCount > 0 ? `${unreadCount} unread notification${unreadCount > 1 ? "s" : ""}` : "All caught up"}
          </p>
        </div>
        {unreadCount > 0 && (
          <button
            onClick={markAllRead}
            disabled={markingRead}
            className="h-[36px] px-[14px] rounded-[10px] bg-white border border-gray-200 text-[13px] font-semibold text-[#0A0F1C] transition-all hover:bg-gray-50 active:scale-[0.98] disabled:opacity-50 flex items-center gap-[6px]"
          >
            {markingRead ? (
              <div className="w-[14px] h-[14px] border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />
            ) : (
              <i className="ri-check-double-line text-[14px]" />
            )}
            Mark all read
          </button>
        )}
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center gap-[4px] mb-[20px] overflow-x-auto pb-[4px]">
        {FILTER_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => setFilter(opt.value)}
            className={`px-[12px] py-[6px] rounded-full text-[12px] font-semibold whitespace-nowrap transition-all ${
              filter === opt.value
                ? "bg-[#1B2A4A] text-white"
                : "bg-gray-100 text-gray-500 hover:bg-gray-200"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Notifications List */}
      {loading ? (
        <div className="space-y-[4px]">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="bg-white rounded-[14px] p-[16px] border border-gray-100 animate-pulse">
              <div className="flex items-start gap-[12px]">
                <div className="w-[36px] h-[36px] bg-gray-100 rounded-[10px]" />
                <div className="flex-1 space-y-[8px]">
                  <div className="h-[13px] bg-gray-100 rounded w-[60%]" />
                  <div className="h-[12px] bg-gray-50 rounded w-[80%]" />
                  <div className="h-[10px] bg-gray-50 rounded w-[30%]" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : notifications.length === 0 ? (
        <div className="text-center py-[80px]">
          <div className="w-[64px] h-[64px] bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-[16px]">
            <i className="ri-notification-off-line text-[28px] text-gray-300" />
          </div>
          <h3 className="text-[16px] font-semibold text-gray-400 mb-[4px]">
            No notifications
          </h3>
          <p className="text-[13px] text-gray-300 max-w-[280px] mx-auto">
            {filter === "unread"
              ? "You're all caught up! No unread notifications."
              : "You'll be notified when value bets are found and matches update."}
          </p>
        </div>
      ) : (
        <div className="space-y-[20px]">
          {groupedNotifications.map((group) => (
            <div key={group.label}>
              <h3 className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-[8px] px-[4px]">
                {group.label}
              </h3>
              <div className="space-y-[4px]">
                {group.items.map((n) => {
                  const { icon, color, bg } = getNotificationIcon(n.type);
                  return (
                    <div
                      key={n.id}
                      onClick={() => !n.is_read && markAsRead(n.id)}
                      className={`bg-white rounded-[14px] p-[16px] border transition-all cursor-pointer hover:shadow-[0_2px_12px_rgba(0,0,0,0.04)] ${
                        !n.is_read
                          ? "border-[#BFFF00]/20 bg-[#BFFF00]/[0.02]"
                          : "border-gray-100"
                      }`}
                    >
                      <div className="flex items-start gap-[12px]">
                        <div
                          className={`w-[36px] h-[36px] ${bg} rounded-[10px] flex items-center justify-center flex-none`}
                        >
                          <i className={`${icon} text-[16px] ${color}`} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-[8px]">
                            <div className="flex items-center gap-[8px]">
                              <h4
                                className={`text-[13px] font-semibold leading-[1.4] ${
                                  !n.is_read ? "text-[#0A0F1C]" : "text-gray-600"
                                }`}
                              >
                                {n.title}
                              </h4>
                              <span
                                className={`text-[9px] font-semibold px-[6px] py-[2px] rounded-full ${bg} ${color}`}
                              >
                                {getTypeLabel(n.type)}
                              </span>
                            </div>
                            {!n.is_read && (
                              <span className="w-[7px] h-[7px] bg-[#22c55e] rounded-full flex-none mt-[5px]" />
                            )}
                          </div>
                          <p className="text-[13px] text-gray-400 mt-[4px] leading-[1.5]">
                            {n.body}
                          </p>
                          <div className="flex items-center gap-[12px] mt-[8px]">
                            <span className="text-[11px] text-gray-300">
                              {timeAgo(n.created_at)}
                            </span>
                            {n.data && typeof n.data === "object" && "match" in (n.data as Record<string, unknown>) && (
                              <span className="text-[11px] text-gray-300 flex items-center gap-[4px]">
                                <i className="ri-football-line text-[11px]" />
                                {(n.data as Record<string, unknown>).match as string}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          {/* Load More */}
          {hasMore && (
            <div className="text-center pt-[8px]">
              <button
                onClick={loadMore}
                disabled={loadingMore}
                className="h-[36px] px-[16px] rounded-[10px] bg-gray-50 text-[13px] font-semibold text-gray-500 transition-all hover:bg-gray-100 disabled:opacity-50 flex items-center gap-[6px] mx-auto"
              >
                {loadingMore ? (
                  <>
                    <div className="w-[14px] h-[14px] border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />
                    Loading...
                  </>
                ) : (
                  "Load more"
                )}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
