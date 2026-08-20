"use client";

import React, { useState, useEffect } from "react";
import { useAuth } from "@/providers/AuthProvider";
import { createClient } from "@/lib/supabase/client";
import { useRouter, useSearchParams } from "next/navigation";
import { PageHeader, Card, CardHeader, Button, Badge } from "@/components/ui";

export default function SettingsPage() {
  const { user, profile, refreshProfile, signOut } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [portalLoading, setPortalLoading] = useState(false);

  // Profile form
  const [fullName, setFullName] = useState("");

  // Notification prefs (stored in localStorage for now)
  const [notifyNewPicks, setNotifyNewPicks] = useState(true);
  const [notifyResults, setNotifyResults] = useState(true);
  const [notifyRollover, setNotifyRollover] = useState(true);
  const [notifyAccumulator, setNotifyAccumulator] = useState(false);

  useEffect(() => {
    if (profile) {
      setFullName(profile.display_name || "");
    }
    // Load notification prefs
    if (typeof window !== "undefined") {
      setNotifyNewPicks(localStorage.getItem("notify_new_picks") !== "false");
      setNotifyResults(localStorage.getItem("notify_results") !== "false");
      setNotifyRollover(localStorage.getItem("notify_rollover") !== "false");
      setNotifyAccumulator(localStorage.getItem("notify_accumulator") === "true");
    }
  }, [profile]);

  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setSaving(true);

    const supabase = createClient();
    const { error } = await supabase
      .from("profiles")
      .update({
        display_name: fullName || null,
      })
      .eq("id", user.id);

    if (!error) {
      await refreshProfile();
      setMsg("Profile updated!");
      setTimeout(() => setMsg(""), 2000);
    }

    setSaving(false);
  };

  const saveNotifications = () => {
    if (typeof window !== "undefined") {
      localStorage.setItem("notify_new_picks", String(notifyNewPicks));
      localStorage.setItem("notify_results", String(notifyResults));
      localStorage.setItem("notify_rollover", String(notifyRollover));
      localStorage.setItem("notify_accumulator", String(notifyAccumulator));
      setMsg("Notification preferences saved!");
      setTimeout(() => setMsg(""), 2000);
    }
  };

  const handleSignOut = async () => {
    await signOut();
    router.push("/login");
  };

  return (
    <div className="max-w-[640px]">
      <PageHeader
        title="Settings"
        description="Manage your profile, preferences, and subscription."
      />

      {msg && (
        <div className="bg-green-50 border border-green-200 rounded-[10px] p-[12px] text-[13px] text-green-600 mb-[16px] flex items-center gap-[8px]">
          <i className="ri-check-line text-[14px]" />
          {msg}
        </div>
      )}

      {/* Upgrade success banner */}
      {searchParams.get("upgraded") && (
        <div className="bg-green-50 border border-green-200 rounded-[10px] p-[12px] text-[13px] text-green-600 mb-[16px] flex items-center gap-[8px]">
          <i className="ri-check-line text-[14px]" />
          Welcome to ODDLY {searchParams.get("upgraded")}! Your subscription is now active.
        </div>
      )}

      {/* Profile Section */}
      <Card className="mb-[16px]">
        <CardHeader title="Profile" icon="ri-user-settings-line" />
        <form onSubmit={saveProfile} className="space-y-[12px]">
          <div>
            <label className="block text-[12px] font-medium text-gray-500 mb-[4px]">
              Email
            </label>
            <input
              type="email"
              value={user?.email || ""}
              disabled
              className="w-full h-[38px] rounded-[8px] border border-gray-200 bg-gray-50 px-[12px] text-[13px] text-gray-400 cursor-not-allowed"
            />
          </div>
          <div>
            <label className="block text-[12px] font-medium text-gray-500 mb-[4px]">
              Full Name
            </label>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Your name"
              className="w-full h-[38px] rounded-[8px] border border-gray-200 bg-white px-[12px] text-[13px] text-[#0A0F1C] placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#1B2A4A]/20 transition-all"
            />
          </div>

          <div className="flex justify-end">
            <Button type="submit" loading={saving} size="sm">
              Save Profile
            </Button>
          </div>
        </form>
      </Card>

      {/* Subscription */}
      <Card className="mb-[16px]">
        <CardHeader title="Subscription" icon="ri-vip-crown-line" />
        <div className="p-[14px] bg-gray-50 rounded-[10px]">
          <div className="flex items-center justify-between mb-[10px]">
            <div>
              <div className="flex items-center gap-[8px]">
                <span className="text-[13px] font-semibold text-[#0A0F1C] capitalize">
                  {profile?.subscription_tier || "free"} Plan
                </span>
                <Badge
                  variant={
                    profile?.subscription_tier === "free"
                      ? "default"
                      : profile?.subscription_tier === "premium"
                      ? "info"
                      : "accent"
                  }
                  size="sm"
                >
                  {profile?.subscription_tier || "free"}
                </Badge>
              </div>
              <span className="text-[11px] text-gray-400">
                {profile?.subscription_tier === "free"
                  ? "3 AI questions/day · 10 accumulator legs"
                  : profile?.subscription_tier === "premium"
                  ? "Unlimited AI · Unlimited accumulators"
                  : "Everything + Rollover + Priority alerts"}
              </span>
            </div>
            {profile?.subscription_tier === "free" ? (
              <Button
                onClick={() => router.push("/pricing")}
                size="sm"
                variant="primary"
              >
                Upgrade
              </Button>
            ) : (
              <Button
                onClick={async () => {
                  setPortalLoading(true);
                  try {
                    const supabase = createClient();
                    const { data: { session } } = await supabase.auth.getSession();
                    if (!session) return;
                    const res = await fetch("/api/v1/stripe/portal", {
                      method: "POST",
                      headers: {
                        Authorization: `Bearer ${session.access_token}`,
                      },
                    });
                    const data = await res.json();
                    if (data.portalUrl) {
                      window.location.href = data.portalUrl;
                    }
                  } catch {
                    // ignore
                  } finally {
                    setPortalLoading(false);
                  }
                }}
                loading={portalLoading}
                size="sm"
                variant="secondary"
              >
                Manage Billing
              </Button>
            )}
          </div>

          {profile?.subscription_tier !== "free" && profile?.subscription_expires_at && (
            <div className="text-[11px] text-gray-400">
              Renews: {new Date(profile.subscription_expires_at).toLocaleDateString("en-NG", {
                year: "numeric",
                month: "long",
                day: "numeric",
              })}
            </div>
          )}
        </div>
      </Card>

      {/* Notifications */}
      <Card className="mb-[16px]">
        <CardHeader title="Notifications" icon="ri-notification-3-line" />
        <div className="space-y-[10px]">
          {[
            {
              label: "New value bets",
              desc: "When the model finds a new edge",
              checked: notifyNewPicks,
              onChange: setNotifyNewPicks,
            },
            {
              label: "Bet results",
              desc: "When a tracked bet is settled",
              checked: notifyResults,
              onChange: setNotifyResults,
            },
            {
              label: "Rollover picks",
              desc: "Daily Crown Jewel pick for your chain",
              checked: notifyRollover,
              onChange: setNotifyRollover,
            },
            {
              label: "Accumulator results",
              desc: "When your accumulator is settled",
              checked: notifyAccumulator,
              onChange: setNotifyAccumulator,
            },
          ].map((item) => (
            <div
              key={item.label}
              className="flex items-center justify-between p-[12px] bg-gray-50 rounded-[8px]"
            >
              <div>
                <span className="block text-[13px] font-medium text-[#0A0F1C]">
                  {item.label}
                </span>
                <span className="text-[11px] text-gray-400">{item.desc}</span>
              </div>
              <button
                onClick={() => item.onChange(!item.checked)}
                className={`w-[36px] h-[20px] rounded-full transition-all duration-200 ${
                  item.checked ? "bg-[#1B2A4A]" : "bg-gray-200"
                }`}
              >
                <span
                  className={`block w-[16px] h-[16px] bg-white rounded-full transition-all duration-200 mt-[2px] ${
                    item.checked ? "translate-x-[18px]" : "translate-x-[2px]"
                  }`}
                />
              </button>
            </div>
          ))}
        </div>
        <div className="flex justify-end mt-[12px]">
          <Button onClick={saveNotifications} size="sm">
            Save Preferences
          </Button>
        </div>
      </Card>

      {/* Account */}
      <Card className="border-red-100">
        <CardHeader title="Account" icon="ri-shield-keyhole-line" />
        <p className="text-[13px] text-gray-500 mb-[12px]">
          Sign out of your account on this device.
        </p>
        <Button onClick={handleSignOut} variant="danger" size="sm">
          Sign Out
        </Button>
      </Card>
    </div>
  );
}
