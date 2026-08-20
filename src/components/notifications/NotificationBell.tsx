"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
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
  return `${days}d ago`;
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

export default function NotificationBell() {
  const { session, user } = useAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [newNotification, setNewNotification] = useState<Notification | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const toastRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // Fetch notifications when opened
  useEffect(() => {
    if (isOpen && session?.access_token) {
      fetchNotifications();
    }
  }, [isOpen, session?.access_token]);

  // Fetch initial unread count
  useEffect(() => {
    if (!session?.access_token) return;
    fetchUnreadCount();
  }, [session?.access_token]);

  // ── Supabase Realtime Subscription ──────────────────────────────────
  useEffect(() => {
    if (!user?.id) return;

    const supabase = createClient();

    // Subscribe to INSERT events on the notifications table for this user
    const channel = supabase
      .channel("user-notifications")
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

          // Add to top of list
          setNotifications((prev) => [newNotif, ...prev].slice(0, 15));

          // Increment unread count
          setUnreadCount((prev) => prev + 1);

          // Show toast notification
          setNewNotification(newNotif);
          setTimeout(() => setNewNotification(null), 5000);
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

          // Update in list
          setNotifications((prev) =>
            prev.map((n) => (n.id === updated.id ? { ...n, ...updated } : n))
          );

          // Recalculate unread count
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

  async function fetchNotifications() {
    if (!session?.access_token) return;
    setLoading(true);

    try {
      const res = await fetch("/api/v1/notifications?limit=15", {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const data = await res.json();

      if (data.success) {
        setNotifications(data.data.notifications);
        setUnreadCount(data.data.unreadCount);
      }
    } catch (error) {
      console.error("Failed to fetch notifications:", error);
    } finally {
      setLoading(false);
    }
  }

  async function fetchUnreadCount() {
    if (!session?.access_token) return;

    try {
      const res = await fetch("/api/v1/notifications?limit=1&unreadOnly=true", {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const data = await res.json();

      if (data.success) {
        setUnreadCount(data.data.unreadCount);
      }
    } catch {
      // Silent fail for polling
    }
  }

  async function markAllRead() {
    if (!session?.access_token) return;

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
    }
  }

  return (
    <>
      <div className="relative" ref={dropdownRef}>
        {/* Bell button */}
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="relative w-[36px] h-[36px] rounded-full flex items-center justify-center text-gray-400 hover:text-[#0A0F1C] hover:bg-gray-100 transition-all duration-300"
        >
          <i className="ri-notification-3-line text-[18px]"></i>
          {unreadCount > 0 && (
            <span className="absolute -top-[2px] -right-[2px] min-w-[16px] h-[16px] bg-[#EF4444] text-white text-[9px] font-bold rounded-full flex items-center justify-center px-[4px] animate-pulse">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </button>

        {/* Realtime indicator */}
        {unreadCount > 0 && (
          <span className="absolute -bottom-[1px] -right-[1px] w-[8px] h-[8px] bg-[#22c55e] rounded-full border-2 border-white"></span>
        )}

        {/* Dropdown */}
        {isOpen && (
          <div className="absolute right-0 top-full mt-[8px] w-[360px] max-h-[480px] bg-white rounded-[14px] border border-gray-100 shadow-[0_8px_30px_-8px_rgba(0,0,0,0.12)] overflow-hidden z-[50]">
            {/* Header */}
            <div className="flex items-center justify-between px-[16px] py-[12px] border-b border-gray-50">
              <div className="flex items-center gap-[8px]">
                <h3 className="font-display text-[14px] font-semibold text-[#0A0F1C]">
                  Notifications
                </h3>
                <span className="w-[6px] h-[6px] bg-[#22c55e] rounded-full animate-pulse" title="Real-time active"></span>
              </div>
              {unreadCount > 0 && (
                <button
                  onClick={markAllRead}
                  className="text-[12px] text-[#1B2A4A] hover:underline font-medium"
                >
                  Mark all read
                </button>
              )}
            </div>

            {/* Notifications list */}
            <div className="overflow-y-auto max-h-[380px]">
              {loading && notifications.length === 0 ? (
                <div className="flex items-center justify-center py-[40px]">
                  <div className="w-[20px] h-[20px] border-2 border-gray-200 border-t-[#1B2A4A] rounded-full animate-spin"></div>
                </div>
              ) : notifications.length === 0 ? (
                <div className="text-center py-[40px]">
                  <div className="w-[40px] h-[40px] bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-[12px]">
                    <i className="ri-notification-off-line text-[18px] text-gray-300"></i>
                  </div>
                  <p className="text-[13px] text-gray-400">No notifications yet</p>
                  <p className="text-[11px] text-gray-300 mt-[4px]">You&apos;ll be notified when value bets are found</p>
                </div>
              ) : (
                notifications.map((n) => {
                  const { icon, color, bg } = getNotificationIcon(n.type);
                  return (
                    <div
                      key={n.id}
                      className={`flex items-start gap-[12px] px-[16px] py-[12px] border-b border-gray-50 last:border-b-0 transition-all hover:bg-gray-50 ${
                        !n.is_read ? "bg-[#BFFF00]/[0.03]" : ""
                      }`}
                    >
                      <div className={`w-[32px] h-[32px] ${bg} rounded-[8px] flex items-center justify-center flex-none mt-[2px]`}>
                        <i className={`${icon} text-[14px] ${color}`}></i>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-[8px]">
                          <h4 className={`text-[13px] font-medium leading-[1.3] ${!n.is_read ? "text-[#0A0F1C]" : "text-gray-600"}`}>
                            {n.title}
                          </h4>
                          {!n.is_read && (
                            <span className="w-[6px] h-[6px] bg-[#22c55e] rounded-full flex-none mt-[5px]"></span>
                          )}
                        </div>
                        <p className="text-[12px] text-gray-400 mt-[2px] line-clamp-2">
                          {n.body}
                        </p>
                        <span className="text-[10px] text-gray-300 mt-[4px] block">
                          {timeAgo(n.created_at)}
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Footer */}
            {notifications.length > 0 && (
              <div className="px-[16px] py-[10px] border-t border-gray-50 text-center">
                <button className="text-[12px] font-medium text-[#1B2A4A] hover:underline">
                  View all notifications
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Toast notification for new real-time alerts */}
      {newNotification && (
        <div
          ref={toastRef}
          className="fixed bottom-[24px] right-[24px] z-[100] max-w-[360px] bg-white rounded-[14px] border border-gray-100 shadow-[0_12px_40px_-8px_rgba(0,0,0,0.2)] p-[16px] animate-slide-up"
          style={{
            animation: "slideUp 0.4s cubic-bezier(0.32, 0.72, 0, 1)",
          }}
        >
          <div className="flex items-start gap-[12px]">
            <div className={`w-[32px] h-[32px] ${getNotificationIcon(newNotification.type).bg} rounded-[8px] flex items-center justify-center flex-none`}>
              <i className={`${getNotificationIcon(newNotification.type).icon} text-[14px] ${getNotificationIcon(newNotification.type).color}`}></i>
            </div>
            <div className="flex-1 min-w-0">
              <h4 className="text-[13px] font-semibold text-[#0A0F1C]">{newNotification.title}</h4>
              <p className="text-[12px] text-gray-400 mt-[2px] line-clamp-2">{newNotification.body}</p>
            </div>
            <button
              onClick={() => setNewNotification(null)}
              className="text-gray-300 hover:text-gray-500 transition-colors"
            >
              <i className="ri-close-line text-[16px]"></i>
            </button>
          </div>
        </div>
      )}

      {/* Inline styles for toast animation */}
      <style jsx>{`
        @keyframes slideUp {
          from {
            opacity: 0;
            transform: translateY(16px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </>
  );
}
