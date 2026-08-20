"use client";

import React, { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";

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
  [key: string]: any;
  created_at: string;
  profiles?: { display_name: string | null } | null;
}

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

    // Recent activity
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

  const statCards = [
    { label: "Total Users", value: stats.totalUsers, icon: "ri-user-line", color: "bg-[#1B2A4A]/5 text-[#1B2A4A]" },
    { label: "Fixtures", value: stats.totalFixtures, icon: "ri-calendar-line", color: "bg-[#BFFF00]/10 text-[#1B2A4A]" },
    { label: "Predictions", value: stats.totalPredictions, icon: "ri-brain-line", color: "bg-purple-50 text-purple-600" },
    { label: "Total Bets", value: stats.totalBets, icon: "ri-bookmark-line", color: "bg-amber-50 text-amber-600" },
    { label: "Active Chains", value: stats.activeChains, icon: "ri-trophy-line", color: "bg-orange-50 text-orange-600" },
    { label: "Pending Bets", value: stats.pendingBets, icon: "ri-time-line", color: "bg-green-50 text-green-600" },
  ];

  return (
    <div>
      <div className="mb-[24px]">
        <h1 className="font-display text-[24px] md:text-[28px] font-bold text-[#0A0F1C] mb-[4px]">
          Admin Dashboard
        </h1>
        <p className="text-[14px] text-gray-500">
          System overview, user activity, and model health.
        </p>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-[12px] mb-[24px]">
        {statCards.map((stat) => (
          <div
            key={stat.label}
            className="bg-white rounded-[14px] p-[16px] border border-gray-100 shadow-[0_1px_6px_rgba(0,0,0,0.02)]"
          >
            <div className="flex items-center gap-[10px] mb-[8px]">
              <span className={`w-[32px] h-[32px] rounded-[8px] flex items-center justify-center ${stat.color}`}>
                <i className={`${stat.icon} text-[16px]`}></i>
              </span>
              <span className="text-[11px] text-gray-400">{stat.label}</span>
            </div>
            <span className="text-[22px] font-mono-data font-bold text-[#0A0F1C]">
              {loading ? "—" : stat.value.toLocaleString()}
            </span>
          </div>
        ))}
      </div>

      {/* Quick links */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-[8px] mb-[24px]">
        {[
          { label: "User Management", href: "/admin/users", icon: "ri-user-settings-line" },
          { label: "Data Pipeline", href: "/admin/pipeline", icon: "ri-plug-line" },
          { label: "Model Health", href: "/admin/model-health", icon: "ri-heart-pulse-line" },
          { label: "Announcements", href: "/admin/announcements", icon: "ri-megaphone-line" },
        ].map((link) => (
          <a
            key={link.href}
            href={link.href}
            className="p-[14px] bg-white rounded-[12px] border border-gray-100 hover:border-gray-200 transition-all group"
          >
            <i className={`${link.icon} text-[18px] text-gray-400 group-hover:text-[#1B2A4A] transition-colors mb-[6px] block`}></i>
            <span className="text-[12px] font-semibold text-[#0A0F1C]">{link.label}</span>
          </a>
        ))}
      </div>

      {/* Recent Activity */}
      <div className="bg-white rounded-[16px] p-[20px] border border-gray-100 shadow-[0_1px_6px_rgba(0,0,0,0.02)]">
        <h3 className="font-display text-[15px] font-semibold text-[#0A0F1C] mb-[16px]">
          Recent Activity
        </h3>
        {loading ? (
          <div className="space-y-[8px]">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-[36px] bg-gray-50 rounded-[8px] animate-pulse"></div>
            ))}
          </div>
        ) : activities.length === 0 ? (
          <p className="text-[13px] text-gray-400 py-[20px] text-center">
            No recent activity logged.
          </p>
        ) : (
          <div className="space-y-[6px]">
            {activities.map((act) => (
              <div key={act.id} className="flex items-center justify-between p-[10px] bg-gray-50 rounded-[10px]">
                <div className="flex items-center gap-[8px]">
                  <span className="text-[11px] text-gray-400 font-mono-data">
                    {new Date(act.created_at).toLocaleTimeString("en-US", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                  <span className="text-[12px] font-medium text-[#0A0F1C]">{act.action}</span>
                  {act.target_type && (
                    <span className="text-[10px] text-gray-400">{act.target_type}</span>
                  )}
                </div>
                <span className="text-[11px] text-gray-400">
                  {act.profiles?.display_name || "System"}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
