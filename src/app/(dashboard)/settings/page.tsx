"use client";

import React, { useState, useEffect } from "react";
import { useAuth } from "@/providers/AuthProvider";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

export default function SettingsPage() {
  const { user, profile, refreshProfile, signOut } = useAuth();
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  // Profile form
  const [fullName, setFullName] = useState("");
  const [displayName, setDisplayName] = useState("");

  // Notification prefs (stored in localStorage for now)
  const [notifyNewPicks, setNotifyNewPicks] = useState(true);
  const [notifyResults, setNotifyResults] = useState(true);
  const [notifyRollover, setNotifyRollover] = useState(true);
  const [notifyAccumulator, setNotifyAccumulator] = useState(false);

  useEffect(() => {
    if (profile) {
      setFullName(profile.full_name || "");
      setDisplayName(profile.full_name || "");
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
    <div className="max-w-[600px]">
      <div className="mb-[24px]">
        <h1 className="font-display text-[24px] md:text-[28px] font-bold text-[#0A0F1C] mb-[4px]">
          Settings
        </h1>
        <p className="text-[14px] text-gray-500">
          Manage your profile, preferences, and subscription.
        </p>
      </div>

      {msg && (
        <div className="bg-green-50 border border-green-200 rounded-[12px] p-[12px] text-[13px] text-green-600 mb-[16px] flex items-center gap-[8px]">
          <i className="ri-check-line text-[14px]"></i>
          {msg}
        </div>
      )}

      {/* Profile Section */}
      <div className="bg-white rounded-[16px] p-[20px] border border-gray-100 shadow-[0_1px_6px_rgba(0,0,0,0.02)] mb-[16px]">
        <h3 className="font-display text-[15px] font-semibold text-[#0A0F1C] mb-[16px]">
          Profile
        </h3>
        <form onSubmit={saveProfile} className="space-y-[12px]">
          <div>
            <label className="block text-[12px] font-medium text-gray-500 mb-[4px]">
              Email
            </label>
            <input
              type="email"
              value={user?.email || ""}
              disabled
              className="w-full h-[38px] rounded-[10px] border border-gray-200 bg-gray-50 px-[12px] text-[13px] text-gray-400 cursor-not-allowed"
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
              className="w-full h-[38px] rounded-[10px] border border-gray-200 bg-white px-[12px] text-[13px] text-[#0A0F1C] placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#1B2A4A]/20 transition-all"
            />
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={saving}
              className="h-[36px] px-[16px] rounded-[10px] bg-[#1B2A4A] text-white text-[13px] font-semibold transition-all hover:bg-[#243B53] active:scale-[0.98] disabled:opacity-50 flex items-center gap-[6px]"
            >
              {saving ? (
                <div className="w-[14px] h-[14px] border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
              ) : (
                "Save Profile"
              )}
            </button>
          </div>
        </form>
      </div>

      {/* Subscription */}
      <div className="bg-white rounded-[16px] p-[20px] border border-gray-100 shadow-[0_1px_6px_rgba(0,0,0,0.02)] mb-[16px]">
        <h3 className="font-display text-[15px] font-semibold text-[#0A0F1C] mb-[16px]">
          Subscription
        </h3>
        <div className="flex items-center justify-between p-[14px] bg-gray-50 rounded-[12px]">
          <div>
            <span className="block text-[13px] font-semibold text-[#0A0F1C] capitalize">
              {profile?.subscription_tier || "free"} Plan
            </span>
            <span className="text-[11px] text-gray-400">
              {profile?.subscription_tier === "free"
                ? "3 AI questions/day · 10 accumulator legs"
                : profile?.subscription_tier === "premium"
                ? "Unlimited AI · Unlimited accumulators"
                : "Everything + Rollover + Priority alerts"}
            </span>
          </div>
          {profile?.subscription_tier === "free" && (
            <button className="h-[32px] px-[14px] rounded-[8px] bg-[#BFFF00] text-[#1B2A4A] text-[12px] font-semibold transition-all hover:bg-[#a8e600] active:scale-[0.97]">
              Upgrade
            </button>
          )}
        </div>
      </div>

      {/* Notifications */}
      <div className="bg-white rounded-[16px] p-[20px] border border-gray-100 shadow-[0_1px_6px_rgba(0,0,0,0.02)] mb-[16px]">
        <h3 className="font-display text-[15px] font-semibold text-[#0A0F1C] mb-[16px]">
          Notifications
        </h3>
        <div className="space-y-[12px]">
          {[
            {
              label: "New value bets",
              desc: "When the model finds a new edge",
              checked: notifyNewPicks,
              onChange: setNotifyNewPicks,
              key: "new_picks",
            },
            {
              label: "Bet results",
              desc: "When a tracked bet is settled",
              checked: notifyResults,
              onChange: setNotifyResults,
              key: "results",
            },
            {
              label: "Rollover picks",
              desc: "Daily Crown Jewel pick for your chain",
              checked: notifyRollover,
              onChange: setNotifyRollover,
              key: "rollover",
            },
            {
              label: "Accumulator results",
              desc: "When your accumulator is settled",
              checked: notifyAccumulator,
              onChange: setNotifyAccumulator,
              key: "accumulator",
            },
          ].map((item) => (
            <div
              key={item.key}
              className="flex items-center justify-between p-[12px] bg-gray-50 rounded-[10px]"
            >
              <div>
                <span className="block text-[13px] font-medium text-[#0A0F1C]">
                  {item.label}
                </span>
                <span className="text-[11px] text-gray-400">{item.desc}</span>
              </div>
              <button
                onClick={() => item.onChange(!item.checked)}
                className={`w-[40px] h-[22px] rounded-full transition-all duration-300 ${
                  item.checked ? "bg-[#1B2A4A]" : "bg-gray-200"
                }`}
              >
                <span
                  className={`block w-[18px] h-[18px] bg-white rounded-full transition-all duration-300 ${
                    item.checked ? "translate-x-[20px]" : "translate-x-[2px]"
                  }`}
                ></span>
              </button>
            </div>
          ))}
        </div>
        <div className="flex justify-end mt-[12px]">
          <button
            onClick={saveNotifications}
            className="h-[36px] px-[16px] rounded-[10px] bg-[#1B2A4A] text-white text-[13px] font-semibold transition-all hover:bg-[#243B53] active:scale-[0.98]"
          >
            Save Preferences
          </button>
        </div>
      </div>

      {/* Danger Zone */}
      <div className="bg-white rounded-[16px] p-[20px] border border-red-100 shadow-[0_1px_6px_rgba(0,0,0,0.02)]">
        <h3 className="font-display text-[15px] font-semibold text-red-600 mb-[8px]">
          Account
        </h3>
        <p className="text-[13px] text-gray-500 mb-[12px]">
          Sign out of your account on this device.
        </p>
        <button
          onClick={handleSignOut}
          className="h-[36px] px-[16px] rounded-[10px] bg-red-50 text-red-600 text-[13px] font-semibold transition-all hover:bg-red-100 active:scale-[0.98]"
        >
          Sign Out
        </button>
      </div>
    </div>
  );
}
