"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/providers/AuthProvider";
import { createClient } from "@/lib/supabase/client";
import { PageHeader, Button, Badge, EmptyState } from "@/components/ui";

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
      return { icon: "ri-percent-line", color: "text-green-600", bg: "bg-green-50" };
    case "result_settled":
      return { icon: "ri-check-double-line", color: "text-blue-600", bg: "bg-blue-50" };
    case "chain_milestone":
      return { icon: "ri-fire-line", color: "text-amber-600", bg: "bg-amber-50" };
    case "chain_broken":
      return { icon: "ri-close-circle-line", color: "text-red-600", bg: "bg-red-50" };
    case "accumulator_settled":
      return { icon: "ri-stack-line", color: "text-purple-600", bg: "bg-purple-50" };
    case "model_alert":
      return { icon: "ri-robot-2-line", color: "text-gray-600", bg: "bg-gray-100" };
    case "announcement":
      return { icon: "ri-megaphone-line", color: "text-amber-600", bg: "bg-amber-50" };
    case "drawdown_warning":
      return { icon: "ri-alert-line", color: "text-red-600", bg: "bg-red-50" };
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

function getBadgeVariant(type: string): "success" | "info" | "warning" | "danger" | "default" {
  switch (type) {
    case "new_picks": return "success";
    case "result_settled": return "info";
    case "chain_milestone": return "warning";
    case "chain_broken": return "danger";
    case "accumulator_settled": return "default";
    case "model_alert": return "default";
    case "announcement": return "warning";
    case "drawdown_warning": return "danger";
    default: return "default";
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

  useEffect(() => {
    setPage(0);
    setNotifications([]);
    setHasMore(true);
    fetchNotifications(0, false);
  }, [fetchNotifications]);

  // Realtime subscription
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
    <div className="max-w-[700px] mx-auto">
      <PageHeader
        title="Notifications"
        description={
          unreadCount > 0 ? `${unreadCount} unread notification${unreadCount > 1 ? "s" : ""}` : "All caught up"
        }
        action={
          unreadCount > 0 ? (
            <Button
              onClick={markAllRead}
              loading={markingRead}
              variant="secondary"
              size="sm"
              icon="ri-check-double-line"
            >
              Mark all read
            </Button>
          ) : undefined
        }
      />

      {/* Filter Tabs */}
      <div className="flex items-center gap-[4px] mb-[16px] overflow-x-auto pb-[4px]">
        {FILTER_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => setFilter(opt.value)}
            className={`
              px-[10px] py-[5px] rounded-full text-[11px] font-semibold whitespace-nowrap transition-all
              ${filter === opt.value
                ? "bg-[#1B2A4A] text-white"
                : "bg-gray-100 text-gray-500 hover:bg-gray-200"
              }
            `}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Notifications List */}
      {loading ? (
        <div className="space-y-[4px]">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="bg-white rounded-[10px] p-[14px] border border-gray-100 animate-pulse">
              <div className="flex items-start gap-[10px]">
                <div className="w-[32px] h-[32px] bg-gray-100 rounded-[8px]" />
                <div className="flex-1 space-y-[6px]">
                  <div className="h-[12px] bg-gray-100 rounded w-[55%]" />
                  <div className="h-[11px] bg-gray-50 rounded w-[75%]" />
                  <div className="h-[10px] bg-gray-50 rounded w-[25%]" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : notifications.length === 0 ? (
        <EmptyState
          icon="ri-notification-off-line"
          title="No notifications"
          description={
            filter === "unread"
              ? "You're all caught up! No unread notifications."
              : "You'll be notified when value bets are found and matches update."
          }
        />
      ) : (
        <div className="space-y-[16px]">
          {groupedNotifications.map((group) => (
            <div key={group.label}>
              <h3 className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-[6px] px-[4px]">
                {group.label}
              </h3>
              <div className="space-y-[3px]">
                {group.items.map((n) => {
                  const { icon, color, bg } = getNotificationIcon(n.type);
                  return (
                    <div
                      key={n.id}
                      onClick={() => !n.is_read && markAsRead(n.id)}
                      className={`
                        bg-white rounded-[10px] p-[12px] border transition-all cursor-pointer hover:shadow-[0_2px_8px_rgba(0,0,0,0.04)]
                        ${!n.is_read ? "border-gray-200" : "border-gray-100"}
                      `}
                    >
                      <div className="flex items-start gap-[10px]">
                        <div className={`w-[32px] h-[32px] ${bg} rounded-[8px] flex items-center justify-center flex-none`}>
                          <i className={`${icon} text-[14px] ${color}`} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-[6px]">
                            <div className="flex items-center gap-[6px]">
                              <h4 className={`text-[12px] font-semibold leading-[1.4] ${!n.is_read ? "text-[#0A0F1C]" : "text-gray-600"}`}>
                                {n.title}
                              </h4>
                              <Badge variant={getBadgeVariant(n.type)} size="sm">
                                {getTypeLabel(n.type)}
                              </Badge>
                            </div>
                            {!n.is_read && (
                              <span className="w-[6px] h-[6px] bg-green-500 rounded-full flex-none mt-[4px]" />
                            )}
                          </div>
                          <p className="text-[12px] text-gray-400 mt-[3px] leading-[1.5]">
                            {n.body}
                          </p>
                          <div className="flex items-center gap-[10px] mt-[6px]">
                            <span className="text-[10px] text-gray-300">
                              {timeAgo(n.created_at)}
                            </span>
                            {n.data && typeof n.data === "object" && "match" in (n.data as Record<string, unknown>) && (
                              <span className="text-[10px] text-gray-300 flex items-center gap-[3px]">
                                <i className="ri-football-line text-[10px]" />
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
            <div className="text-center pt-[4px]">
              <Button
                onClick={loadMore}
                loading={loadingMore}
                variant="ghost"
                size="sm"
              >
                Load more
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
