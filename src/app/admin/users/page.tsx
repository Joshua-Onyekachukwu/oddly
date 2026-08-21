"use client";

import React, { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { PageHeader, Card, Badge, StatCard, EmptyState } from "@/components/ui";

interface UserProfile {
  id: string;
  display_name: string | null;
  role: string;
  subscription_tier: string;
  bankroll: number;
  subscription_expires_at: string | null;
  notification_preferences: any;
  created_at: string;
  updated_at: string;
  [key: string]: any;
}

interface UserStats {
  total: number;
  admins: number;
  premium: number;
  elite: number;
  free: number;
}

const TIER_BADGE: Record<string, { variant: string; label: string }> = {
  free: { variant: "default", label: "Free" },
  premium: { variant: "info", label: "Premium" },
  elite: { variant: "warning", label: "Elite" },
};

export default function AdminUsersPage() {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [stats, setStats] = useState<UserStats>({ total: 0, admins: 0, premium: 0, elite: 0, free: 0 });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | "user" | "admin">("all");
  const [tierFilter, setTierFilter] = useState<"all" | "free" | "premium" | "elite">("all");
  const [updating, setUpdating] = useState<string | null>(null);
  const [selectedUser, setSelectedUser] = useState<UserProfile | null>(null);

  const fetchUsers = useCallback(async () => {
    const supabase = createClient();
    let query = supabase
      .from("profiles")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);

    if (roleFilter !== "all") query = query.eq("role", roleFilter);
    if (tierFilter !== "all") query = query.eq("subscription_tier", tierFilter);

    const { data, error } = await query;
    if (!error && data) setUsers(data);

    // Fetch stats
    const [total, admins, premium, elite, freeU] = await Promise.all([
      supabase.from("profiles").select("id", { count: "exact", head: true }),
      supabase.from("profiles").select("id", { count: "exact", head: true }).eq("role", "admin"),
      supabase.from("profiles").select("id", { count: "exact", head: true }).eq("subscription_tier", "premium"),
      supabase.from("profiles").select("id", { count: "exact", head: true }).eq("subscription_tier", "elite"),
      supabase.from("profiles").select("id", { count: "exact", head: true }).eq("subscription_tier", "free"),
    ]);

    setStats({
      total: total.count || 0,
      admins: admins.count || 0,
      premium: premium.count || 0,
      elite: elite.count || 0,
      free: freeU.count || 0,
    });

    setLoading(false);
  }, [roleFilter, tierFilter]);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const updateRole = async (userId: string, newRole: string) => {
    setUpdating(userId);
    const supabase = createClient();
    await supabase.from("profiles").update({ role: newRole as any }).eq("id", userId);
    await fetchUsers();
    setUpdating(null);
  };

  const updateTier = async (userId: string, newTier: string) => {
    setUpdating(userId);
    const supabase = createClient();
    await supabase.from("profiles").update({ subscription_tier: newTier as any }).eq("id", userId);
    await fetchUsers();
    setUpdating(null);
  };

  const filtered = users.filter((u) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      (u.display_name || "").toLowerCase().includes(s) ||
      u.id.toLowerCase().includes(s)
    );
  });

  const formatDate = (d: string) => new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const formatTime = (d: string) => new Date(d).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });

  return (
    <div>
      <PageHeader
        title="User Management"
        description="Manage user roles, subscriptions, and access."
      />

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-[12px] mb-[20px]">
        <StatCard label="Total Users" value={loading ? "—" : String(stats.total)} icon="ri-user-line" color="bg-[#1B2A4A]/5 text-[#1B2A4A]" />
        <StatCard label="Admins" value={loading ? "—" : String(stats.admins)} icon="ri-shield-user-line" color="bg-red-50 text-red-600" />
        <StatCard label="Elite" value={loading ? "—" : String(stats.elite)} icon="ri-vip-crown-line" color="bg-amber-50 text-amber-600" />
        <StatCard label="Premium" value={loading ? "—" : String(stats.premium)} icon="ri-star-line" color="bg-purple-50 text-purple-600" />
        <StatCard label="Free" value={loading ? "—" : String(stats.free)} icon="ri-user-heart-line" color="bg-green-50 text-green-600" />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-[8px] mb-[16px]">
        <div className="relative flex-1 min-w-[200px] max-w-[320px]">
          <i className="ri-search-line absolute left-[12px] top-1/2 -translate-y-1/2 text-[14px] text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or ID..."
            className="w-full h-[38px] rounded-[10px] border border-gray-200 bg-white pl-[36px] pr-[12px] text-[13px] focus:outline-none focus:ring-2 focus:ring-[#1B2A4A]/20 transition-all"
          />
        </div>
        <div className="flex gap-[4px] bg-gray-100 rounded-[10px] p-[4px]">
          {(["all", "user", "admin"] as const).map((r) => (
            <button
              key={r}
              onClick={() => setRoleFilter(r)}
              className={`px-[12px] py-[6px] rounded-[8px] text-[12px] font-semibold transition-all ${
                roleFilter === r
                  ? "bg-white text-[#0A0F1C] shadow-[0_1px_4px_rgba(0,0,0,0.06)]"
                  : "text-gray-400 hover:text-gray-600"
              }`}
            >
              {r.charAt(0).toUpperCase() + r.slice(1)}
            </button>
          ))}
        </div>
        <div className="flex gap-[4px] bg-gray-100 rounded-[10px] p-[4px]">
          {(["all", "free", "premium", "elite"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTierFilter(t)}
              className={`px-[12px] py-[6px] rounded-[8px] text-[12px] font-semibold transition-all ${
                tierFilter === t
                  ? "bg-white text-[#0A0F1C] shadow-[0_1px_4px_rgba(0,0,0,0.06)]"
                  : "text-gray-400 hover:text-gray-600"
              }`}
            >
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Users table */}
      {loading ? (
        <div className="space-y-[6px]">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-[52px] bg-white rounded-[10px] animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon="ri-user-line"
          title="No users found"
          description={search ? "Try a different search term." : "No users have signed up yet."}
        />
      ) : (
        <Card padding="none" className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider px-[16px] py-[10px]">User</th>
                  <th className="text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider px-[16px] py-[10px]">Role</th>
                  <th className="text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider px-[16px] py-[10px]">Plan</th>
                  <th className="text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider px-[16px] py-[10px]">Bankroll</th>
                  <th className="text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider px-[16px] py-[10px]">Joined</th>
                  <th className="text-right text-[10px] font-semibold text-gray-400 uppercase tracking-wider px-[16px] py-[10px]">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((user) => (
                  <tr
                    key={user.id}
                    className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50 transition-colors cursor-pointer"
                    onClick={() => setSelectedUser(user)}
                  >
                    <td className="px-[16px] py-[12px]">
                      <div className="flex items-center gap-[10px]">
                        <div className={`w-[32px] h-[32px] rounded-full flex items-center justify-center flex-none ${
                          user.role === "admin" ? "bg-red-50" : "bg-[#1B2A4A]/5"
                        }`}>
                          <span className={`text-[12px] font-bold ${user.role === "admin" ? "text-red-600" : "text-[#1B2A4A]"}`}>
                            {(user.display_name || "U").charAt(0).toUpperCase()}
                          </span>
                        </div>
                        <div className="min-w-0">
                          <span className="text-[13px] font-medium text-[#0A0F1C] block truncate">
                            {user.display_name || "Unnamed"}
                          </span>
                          <span className="text-[10px] text-gray-400 font-mono-data">
                            {user.id.slice(0, 8)}...
                          </span>
                        </div>
                      </div>
                    </td>
                    <td className="px-[16px] py-[12px]" onClick={(e) => e.stopPropagation()}>
                      <select
                        value={user.role}
                        onChange={(e) => updateRole(user.id, e.target.value as "user" | "admin")}
                        disabled={updating === user.id}
                        className={`text-[11px] font-semibold px-[8px] py-[4px] rounded-full border bg-white focus:outline-none cursor-pointer ${
                          user.role === "admin" ? "border-red-200 text-red-600" : "border-gray-200"
                        }`}
                      >
                        <option value="user">User</option>
                        <option value="admin">Admin</option>
                      </select>
                    </td>
                    <td className="px-[16px] py-[12px]" onClick={(e) => e.stopPropagation()}>
                      <select
                        value={user.subscription_tier}
                        onChange={(e) => updateTier(user.id, e.target.value as "free" | "premium" | "elite")}
                        disabled={updating === user.id}
                        className="text-[11px] font-semibold px-[8px] py-[4px] rounded-full border border-gray-200 bg-white focus:outline-none cursor-pointer"
                      >
                        <option value="free">Free</option>
                        <option value="premium">Premium</option>
                        <option value="elite">Elite</option>
                      </select>
                    </td>
                    <td className="px-[16px] py-[12px]">
                      <span className="text-[13px] font-mono-data text-[#0A0F1C]">
                        ${(user.bankroll || 0).toFixed(2)}
                      </span>
                    </td>
                    <td className="px-[16px] py-[12px]">
                      <span className="text-[12px] text-gray-400">
                        {formatDate(user.created_at)}
                      </span>
                    </td>
                    <td className="px-[16px] py-[12px] text-right" onClick={(e) => e.stopPropagation()}>
                      {updating === user.id ? (
                        <div className="w-[16px] h-[16px] border-2 border-gray-200 border-t-[#1B2A4A] rounded-full animate-spin inline-block" />
                      ) : (
                        <button
                          onClick={() => setSelectedUser(user)}
                          className="text-[11px] text-gray-400 hover:text-[#1B2A4A] transition-colors"
                        >
                          <i className="ri-eye-line" /> View
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-[16px] py-[10px] border-t border-gray-100 text-[11px] text-gray-400">
            Showing {filtered.length} of {users.length} users
          </div>
        </Card>
      )}

      {/* User Detail Drawer */}
      {selectedUser && (
        <div className="fixed inset-0 z-50 flex justify-end" onClick={() => setSelectedUser(null)}>
          <div className="absolute inset-0 bg-black/20 backdrop-blur-[2px]" />
          <div
            className="relative w-full max-w-[420px] bg-white shadow-2xl overflow-y-auto animate-in slide-in-from-right"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="sticky top-0 bg-white border-b border-gray-100 px-[24px] py-[16px] flex items-center justify-between z-10">
              <div className="flex items-center gap-[12px]">
                <div className={`w-[40px] h-[40px] rounded-full flex items-center justify-center ${
                  selectedUser.role === "admin" ? "bg-red-50" : "bg-[#1B2A4A]/5"
                }`}>
                  <span className={`text-[16px] font-bold ${selectedUser.role === "admin" ? "text-red-600" : "text-[#1B2A4A]"}`}>
                    {(selectedUser.display_name || "U").charAt(0).toUpperCase()}
                  </span>
                </div>
                <div>
                  <h3 className="text-[15px] font-semibold text-[#0A0F1C]">
                    {selectedUser.display_name || "Unnamed User"}
                  </h3>
                  <p className="text-[11px] text-gray-400 font-mono-data">{selectedUser.id}</p>
                </div>
              </div>
              <button
                onClick={() => setSelectedUser(null)}
                className="w-[32px] h-[32px] rounded-full bg-gray-100 flex items-center justify-center hover:bg-gray-200 transition-colors"
              >
                <i className="ri-close-line text-[16px] text-gray-500" />
              </button>
            </div>

            {/* Details */}
            <div className="px-[24px] py-[20px] space-y-[20px]">
              {/* Role & Plan */}
              <div>
                <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider block mb-[8px]">
                  Account Details
                </label>
                <div className="grid grid-cols-2 gap-[8px]">
                  <div className="bg-gray-50 rounded-[10px] p-[12px]">
                    <span className="text-[10px] text-gray-400 block mb-[4px]">Role</span>
                    <select
                      value={selectedUser.role}
                      onChange={async (e) => {
                        const val = e.target.value as "user" | "admin";
                        setSelectedUser({ ...selectedUser, role: val });
                        await updateRole(selectedUser.id, val);
                      }}
                      className="text-[13px] font-semibold bg-transparent border-none focus:outline-none cursor-pointer"
                    >
                      <option value="user">User</option>
                      <option value="admin">Admin</option>
                    </select>
                  </div>
                  <div className="bg-gray-50 rounded-[10px] p-[12px]">
                    <span className="text-[10px] text-gray-400 block mb-[4px]">Plan</span>
                    <select
                      value={selectedUser.subscription_tier}
                      onChange={async (e) => {
                        const val = e.target.value as "free" | "premium" | "elite";
                        setSelectedUser({ ...selectedUser, subscription_tier: val });
                        await updateTier(selectedUser.id, val);
                      }}
                      className="text-[13px] font-semibold bg-transparent border-none focus:outline-none cursor-pointer"
                    >
                      <option value="free">Free</option>
                      <option value="premium">Premium</option>
                      <option value="elite">Elite</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Bankroll */}
              <div>
                <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider block mb-[8px]">
                  Bankroll
                </label>
                <div className="bg-gray-50 rounded-[10px] p-[12px]">
                  <span className="text-[20px] font-bold text-[#0A0F1C] font-mono-data">
                    ${(selectedUser.bankroll || 0).toFixed(2)}
                  </span>
                </div>
              </div>

              {/* Dates */}
              <div>
                <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider block mb-[8px]">
                  Activity
                </label>
                <div className="space-y-[6px]">
                  <div className="flex justify-between items-center py-[8px] border-b border-gray-50">
                    <span className="text-[12px] text-gray-500">Joined</span>
                    <span className="text-[12px] font-medium text-[#0A0F1C]">
                      {formatDate(selectedUser.created_at)} at {formatTime(selectedUser.created_at)}
                    </span>
                  </div>
                  <div className="flex justify-between items-center py-[8px] border-b border-gray-50">
                    <span className="text-[12px] text-gray-500">Last Updated</span>
                    <span className="text-[12px] font-medium text-[#0A0F1C]">
                      {formatDate(selectedUser.updated_at)} at {formatTime(selectedUser.updated_at)}
                    </span>
                  </div>
                  {selectedUser.subscription_expires_at && (
                    <div className="flex justify-between items-center py-[8px]">
                      <span className="text-[12px] text-gray-500">Subscription Expires</span>
                      <span className="text-[12px] font-medium text-[#0A0F1C]">
                        {formatDate(selectedUser.subscription_expires_at)}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Notification Preferences */}
              {selectedUser.notification_preferences && (
                <div>
                  <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider block mb-[8px]">
                    Notification Preferences
                  </label>
                  <div className="bg-gray-50 rounded-[10px] p-[12px] space-y-[6px]">
                    {Object.entries(selectedUser.notification_preferences).map(([key, val]) => (
                      <div key={key} className="flex justify-between items-center">
                        <span className="text-[11px] text-gray-500 capitalize">
                          {key.replace(/_/g, " ")}
                        </span>
                        <span className={`text-[11px] font-semibold ${val ? "text-green-600" : "text-gray-300"}`}>
                          {val ? "On" : "Off"}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
