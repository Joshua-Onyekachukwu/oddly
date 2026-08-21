"use client";

import React, { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { PageHeader, Card, Badge, EmptyState } from "@/components/ui";

interface UserProfile {
  id: string;
  display_name: string | null;
  role: string;
  subscription_tier: string;
  bankroll: number;
  created_at: string;
}

const TIER_COLORS: Record<string, string> = {
  free: "default",
  premium: "info",
  elite: "warning",
};

const ROLE_COLORS: Record<string, string> = {
  user: "default",
  admin: "danger",
};

export default function AdminUsersPage() {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | "user" | "admin">("all");
  const [updating, setUpdating] = useState<string | null>(null);

  const fetchUsers = useCallback(async () => {
    const supabase = createClient();
    let query = supabase
      .from("profiles")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);

    if (roleFilter !== "all") {
      query = query.eq("role", roleFilter);
    }

    const { data, error } = await query;
    if (!error && data) {
      setUsers(data);
    }
    setLoading(false);
  }, [roleFilter]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const updateRole = async (userId: string, newRole: string) => {
    setUpdating(userId);
    const supabase = createClient();
    await supabase.from("profiles").update({ role: newRole as "user" | "admin" }).eq("id", userId);
    await fetchUsers();
    setUpdating(null);
  };

  const updateTier = async (userId: string, newTier: string) => {
    setUpdating(userId);
    const supabase = createClient();
    await supabase.from("profiles").update({ subscription_tier: newTier as "free" | "premium" | "elite" }).eq("id", userId);
    await fetchUsers();
    setUpdating(null);
  };

  const filtered = users.filter((u) => {
    if (search) {
      const s = search.toLowerCase();
      return (
        (u.display_name || "").toLowerCase().includes(s) ||
        u.id.toLowerCase().includes(s)
      );
    }
    return true;
  });

  return (
    <div>
      <PageHeader
        title="User Management"
        description="Manage user roles, subscriptions, and access."
      />

      {/* Filters */}
      <div className="flex items-center gap-[8px] mb-[16px]">
        <div className="relative flex-1 max-w-[320px]">
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
                  <th className="text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider px-[16px] py-[10px]">
                    User
                  </th>
                  <th className="text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider px-[16px] py-[10px]">
                    Role
                  </th>
                  <th className="text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider px-[16px] py-[10px]">
                    Plan
                  </th>
                  <th className="text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider px-[16px] py-[10px]">
                    Bankroll
                  </th>
                  <th className="text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider px-[16px] py-[10px]">
                    Joined
                  </th>
                  <th className="text-right text-[10px] font-semibold text-gray-400 uppercase tracking-wider px-[16px] py-[10px]">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((user) => (
                  <tr
                    key={user.id}
                    className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50 transition-colors"
                  >
                    <td className="px-[16px] py-[12px]">
                      <div className="flex items-center gap-[10px]">
                        <div className="w-[32px] h-[32px] bg-[#1B2A4A]/5 rounded-full flex items-center justify-center flex-none">
                          <span className="text-[12px] font-bold text-[#1B2A4A]">
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
                    <td className="px-[16px] py-[12px]">
                      <select
                        value={user.role}
                        onChange={(e) => updateRole(user.id, e.target.value)}
                        disabled={updating === user.id}
                        className="text-[11px] font-semibold px-[8px] py-[4px] rounded-full border border-gray-200 bg-white focus:outline-none cursor-pointer"
                      >
                        <option value="user">User</option>
                        <option value="admin">Admin</option>
                      </select>
                    </td>
                    <td className="px-[16px] py-[12px]">
                      <select
                        value={user.subscription_tier}
                        onChange={(e) => updateTier(user.id, e.target.value)}
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
                        {new Date(user.created_at).toLocaleDateString()}
                      </span>
                    </td>
                    <td className="px-[16px] py-[12px] text-right">
                      {updating === user.id && (
                        <div className="w-[16px] h-[16px] border-2 border-gray-200 border-t-[#1B2A4A] rounded-full animate-spin inline-block" />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
