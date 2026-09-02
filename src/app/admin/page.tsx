"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { StatCard, Card, CardHeader, Badge, EmptyState, ErrorBoundary } from "@/components/ui";

interface AdminStats {
  totalUsers: number;
  totalFixtures: number;
  totalPredictions: number;
  totalBets: number;
  activeChains: number;
  pendingBets: number;
}

interface RecentActivity {
  id: string;
  action: string;
  target_type: string;
  details: any;
  created_at: string;
  profiles?: { display_name: string | null } | null;
}

const QUICK_LINKS = [
  { label: "Pipeline", href: "/admin/pipeline", icon: "ri-plug-line", desc: "Data sync & API usage" },
  { label: "Cron Jobs", href: "/admin/crons", icon: "ri-timer-line", desc: "Execution status & alerts" },
  { label: "One Game Pick", href: "/admin/picks", icon: "ri-crosshair-2-line", desc: "Today's pick + CLV" },
  { label: "AI Monitor", href: "/admin/ai-monitor", icon: "ri-robot-2-line", desc: "NVIDIA API & model stats" },
  { label: "Model Health", href: "/admin/model-health", icon: "ri-heart-pulse-line", desc: "Accuracy & calibration" },
  { label: "Draw Analysis", href: "/admin/draw-analysis", icon: "ri-equalizer-line", desc: "Draw model performance" },
  { label: "RLS Audit", href: "/admin/rls", icon: "ri-shield-keyhole-line", desc: "Table security status" },
  { label: "Users", href: "/admin/users", icon: "ri-user-settings-line", desc: "Roles & subscriptions" },
  { label: "Security", href: "/admin/security", icon: "ri-shield-check-line", desc: "Auth, RLS & rate limits" },
];

export default function AdminDashboardPage() {
  const [stats, setStats] = useState<AdminStats>({
    totalUsers: 0,
    totalFixtures: 0,
    totalPredictions: 0,
    totalBets: 0,
    activeChains: 0,
    pendingBets: 0,
  });
  const [activities, setActivities] = useState<RecentActivity[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchStats = useCallback(async () => {
    const supabase = createClient();

    const [users, fixtures, predictions, bets, chains, activeBets] = await Promise.all([
      supabase.from("profiles").select("id", { count: "exact", head: true }),
      supabase.from("fixtures").select("id", { count: "exact", head: true }),
      supabase.from("predictions").select("id", { count: "exact", head: true }),
      supabase.from("user_bets").select("id", { count: "exact", head: true }),
      supabase.from("rollover_chains").select("id", { count: "exact", head: true }).eq("status", "active"),
      supabase.from("user_bets").select("id", { count: "exact", head: true }).eq("status", "pending"),
    ]);

    setStats({
      totalUsers: users.count || 0,
      totalFixtures: fixtures.count || 0,
      totalPredictions: predictions.count || 0,
      totalBets: bets.count || 0,
      activeChains: chains.count || 0,
      pendingBets: activeBets.count || 0,
    });

    const { data: recent } = await supabase
      .from("admin_activity_log")
      .select("*, profiles(display_name)")
      .order("created_at", { ascending: false })
      .limit(10);

    if (recent) setActivities(recent as any);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  return (
    <ErrorBoundary>
      <div>
        {/* Page header */}
      <div className="mb-[24px]">
        <h1 className="font-display text-[22px] md:text-[26px] font-bold text-[#0A0F1C] mb-[4px]">
          Admin Dashboard
        </h1>
        <p className="text-[13px] text-gray-500">
          System overview, user activity, and model health at a glance.
        </p>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-[12px] mb-[24px]">
        <StatCard
          label="Users"
          value={loading ? "—" : stats.totalUsers.toLocaleString()}
          icon="ri-user-line"
          color="bg-[#1B2A4A]/5 text-[#1B2A4A]"
        />
        <StatCard
          label="Fixtures"
          value={loading ? "—" : stats.totalFixtures.toLocaleString()}
          icon="ri-calendar-line"
          color="bg-[#BFFF00]/10 text-[#1B2A4A]"
        />
        <StatCard
          label="Predictions"
          value={loading ? "—" : stats.totalPredictions.toLocaleString()}
          icon="ri-brain-line"
          color="bg-purple-50 text-purple-600"
        />
        <StatCard
          label="Total Bets"
          value={loading ? "—" : stats.totalBets.toLocaleString()}
          icon="ri-bookmark-line"
          color="bg-amber-50 text-amber-600"
        />
        <StatCard
          label="Active Chains"
          value={loading ? "—" : stats.activeChains.toLocaleString()}
          icon="ri-fire-line"
          color="bg-orange-50 text-orange-600"
        />
        <StatCard
          label="Pending Bets"
          value={loading ? "—" : stats.pendingBets.toLocaleString()}
          icon="ri-time-line"
          color="bg-green-50 text-green-600"
        />
      </div>

      {/* Quick links */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-[12px] mb-[24px]">
        {QUICK_LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="p-[14px] bg-white rounded-[14px] border border-gray-100 hover:border-gray-200 hover:shadow-[0_4px_20px_rgba(0,0,0,0.04)] transition-all group cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] focus-visible:ring-inset"
          >
            <i className={`${link.icon} text-[18px] text-gray-400 group-hover:text-[#1B2A4A] transition-colors mb-[6px] block`} />
            <span className="text-[12px] font-semibold text-[#0A0F1C] block">{link.label}</span>
            <span className="text-[10px] text-gray-400 block mt-[2px]">{link.desc}</span>
          </Link>
        ))}
      </div>

      {/* Recent Activity */}
      <Card>
        <CardHeader
          title="Recent Activity"
          action={
            <button
              onClick={fetchStats}
              className="text-[11px] text-gray-400 hover:text-[#1B2A4A] transition-colors flex items-center gap-[4px]"
            >
              <i className="ri-refresh-line" />
              Refresh
            </button>
          }
        />
        {loading ? (
          <div className="space-y-[6px]">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-[40px] bg-gray-50 rounded-[8px] animate-pulse" />
            ))}
          </div>
        ) : activities.length === 0 ? (
          <EmptyState
            icon="ri-time-line"
            title="No recent activity"
            description="Activity will appear here as admins perform actions."
          />
        ) : (
          <div className="space-y-[4px]">
            {activities.map((act) => (
              <div
                key={act.id}
                className="flex items-center justify-between p-[10px] bg-gray-50 rounded-[8px] hover:bg-gray-100/50 transition-colors"
              >
                <div className="flex items-center gap-[10px] min-w-0">
                  <span className="text-[10px] text-gray-400 font-mono-data flex-none">
                    {new Date(act.created_at).toLocaleTimeString("en-US", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                  <span className="text-[12px] font-medium text-[#0A0F1C] truncate">
                    {act.action}
                  </span>
                  {act.target_type && (
                    <Badge variant="default" size="sm">{act.target_type}</Badge>
                  )}
                </div>
                <span className="text-[11px] text-gray-400 flex-none ml-[8px]">
                  {act.profiles?.display_name || "System"}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
    </ErrorBoundary>
  );
}
