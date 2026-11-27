"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/providers/AuthProvider";
import { createClient } from "@/lib/supabase/client";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { PageHeader, Card, CardHeader, Button, Badge } from "@/components/ui";

/** Notification preference keys managed on this page (subset of full prefs). */
const NOTIF_KEYS = {
  newPicks: "new_picks",
  results: "result_settled",
  rollover: "rollover_pick",
  accumulator: "accumulator_settled",
} as const;

type NotifPrefs = Record<string, boolean>;

interface FavouriteRow {
  id: string;
  entity_type: "team" | "league" | "player";
  entity_id: string;
  entity_name: string | null;
}

const FAV_TYPE_META: Record<FavouriteRow["entity_type"], { label: string; icon: string }> = {
  team: { label: "Team", icon: "ri-shield-star-line" },
  league: { label: "League", icon: "ri-trophy-line" },
  player: { label: "Player", icon: "ri-user-star-line" },
};

function ToggleSwitch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`w-[36px] h-[20px] rounded-full transition-all duration-200 flex-none
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B2A4A]/30 focus-visible:ring-offset-2
        ${checked ? "bg-[#1B2A4A]" : "bg-gray-200"}
        ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}
      `}
    >
      <span
        className={`block w-[16px] h-[16px] bg-white rounded-full transition-all duration-200 mt-[2px] ${
          checked ? "translate-x-[18px]" : "translate-x-[2px]"
        }`}
      />
    </button>
  );
}

export default function SettingsPage() {
  const { user, profile, session, refreshProfile, signOut } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ text: string; type: "success" | "error" } | null>(null);
  const [portalLoading, setPortalLoading] = useState(false);

  // Profile form
  const [fullName, setFullName] = useState("");

  // Notification prefs (real prefs API)
  const [notifPrefs, setNotifPrefs] = useState<NotifPrefs>({});
  const [notifLoading, setNotifLoading] = useState(true);
  const [notifSaving, setNotifSaving] = useState(false);
  const [notifError, setNotifError] = useState<string | null>(null);

  // Favourites
  const [favourites, setFavourites] = useState<FavouriteRow[]>([]);
  const [favsLoading, setFavsLoading] = useState(true);
  const [favsError, setFavsError] = useState<string | null>(null);

  const flash = (text: string, type: "success" | "error" = "success") => {
    setMsg({ text, type });
    setTimeout(() => setMsg(null), 3000);
  };

  useEffect(() => {
    if (profile) {
      setFullName(profile.display_name || "");
    }
  }, [profile]);

  const fetchNotifPrefs = useCallback(async () => {
    if (!session?.access_token) return;
    setNotifLoading(true);
    setNotifError(null);
    try {
      const res = await fetch("/api/v1/notifications/preferences", {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const data = await res.json();
      if (data.success) {
        setNotifPrefs(data.data || {});
      } else {
        setNotifError("Could not load notification preferences.");
      }
    } catch {
      setNotifError("Could not load notification preferences.");
    } finally {
      setNotifLoading(false);
    }
  }, [session?.access_token]);

  useEffect(() => {
    fetchNotifPrefs();
  }, [fetchNotifPrefs]);

  const fetchFavourites = useCallback(async () => {
    if (!user) return;
    setFavsLoading(true);
    setFavsError(null);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("user_favourites")
      .select("id, entity_type, entity_id, entity_name")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (error) {
      setFavsError("Could not load favourites.");
      setFavourites([]);
    } else {
      setFavourites((data as FavouriteRow[]) || []);
    }
    setFavsLoading(false);
  }, [user]);

  useEffect(() => {
    fetchFavourites();
  }, [fetchFavourites]);

  const removeFavourite = async (id: string) => {
    const supabase = createClient();
    const { error } = await supabase
      .from("user_favourites")
      .delete()
      .eq("id", id)
      .eq("user_id", user?.id || "");

    if (error) {
      flash("Failed to remove favourite. Please try again.", "error");
      return;
    }
    setFavourites((prev) => prev.filter((f) => f.id !== id));
  };

  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setSaving(true);
    setMsg(null);

    const supabase = createClient();
    const { error } = await supabase
      .from("profiles")
      .update({
        display_name: fullName.trim() || null,
      })
      .eq("id", user.id);

    if (!error) {
      await refreshProfile();
      flash("Profile updated!");
    } else {
      console.error("Failed to update profile:", error);
      flash("Failed to update profile. Please try again.", "error");
    }

    setSaving(false);
  };

  const saveNotifications = async () => {
    if (!session?.access_token) return;
    setNotifSaving(true);
    setNotifError(null);

    const changes: NotifPrefs = {};
    Object.values(NOTIF_KEYS).forEach((key) => {
      changes[key] = notifPrefs[key] ?? true;
    });

    try {
      const res = await fetch("/api/v1/notifications/preferences", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ preferences: changes }),
      });
      const data = await res.json();
      if (data.success) {
        flash("Notification preferences saved!");
      } else {
        setNotifError("Failed to save preferences. Please try again.");
      }
    } catch {
      setNotifError("Failed to save preferences. Please try again.");
    } finally {
      setNotifSaving(false);
    }
  };

  const handleSignOut = async () => {
    await signOut();
    router.push("/login");
  };

  const handleManageBilling = async () => {
    setPortalLoading(true);
    setMsg(null);
    try {
      const res = await fetch("/api/v1/stripe/portal", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session?.access_token || ""}`,
        },
      });
      const data = await res.json();
      if (data.portalUrl) {
        window.location.href = data.portalUrl;
      } else {
        flash(data.error || "Could not open billing portal.", "error");
      }
    } catch {
      flash("Could not open billing portal. Please try again.", "error");
    } finally {
      setPortalLoading(false);
    }
  };

  const upgradedTier = searchParams.get("upgraded");

  const notifItems = [
    {
      key: NOTIF_KEYS.newPicks,
      label: "New value bets",
      desc: "When the model finds a new edge",
    },
    {
      key: NOTIF_KEYS.results,
      label: "Bet results",
      desc: "When a tracked bet is settled",
    },
    {
      key: NOTIF_KEYS.rollover,
      label: "Rollover picks",
      desc: "Daily top pick for your chain",
    },
    {
      key: NOTIF_KEYS.accumulator,
      label: "Accumulator results",
      desc: "When your accumulator is settled",
    },
  ];

  return (
    <div className="max-w-[640px]">
      <PageHeader
        title="Settings"
        description="Manage your profile, preferences, and subscription."
      />

      {msg && (
        <div
          className={`rounded-[10px] p-[12px] text-[13px] mb-[16px] flex items-center gap-[8px] border ${
            msg.type === "success"
              ? "bg-green-50 border-green-200 text-green-600"
              : "bg-red-50 border-red-200 text-red-600"
          }`}
          role="status"
        >
          <i className={msg.type === "success" ? "ri-check-line text-[14px]" : "ri-error-warning-line text-[14px]"} />
          {msg.text}
        </div>
      )}

      {/* Upgrade success banner */}
      {upgradedTier && (
        <div className="bg-green-50 border border-green-200 rounded-[10px] p-[12px] text-[13px] text-green-600 mb-[16px] flex items-center gap-[8px]">
          <i className="ri-check-line text-[14px]" />
          Welcome to ODDLY {upgradedTier.charAt(0).toUpperCase() + upgradedTier.slice(1)}! Your subscription is now active.
        </div>
      )}

      {/* Profile Section */}
      <Card className="mb-[16px]">
        <CardHeader title="Profile" icon="ri-user-settings-line" />
        <form onSubmit={saveProfile} className="space-y-[12px]">
          <div>
            <label htmlFor="settings-email" className="block text-[12px] font-medium text-gray-500 mb-[4px]">
              Email
            </label>
            <input
              id="settings-email"
              type="email"
              value={user?.email || ""}
              disabled
              className="w-full h-[38px] rounded-[8px] border border-gray-200 bg-gray-50 px-[12px] text-[13px] text-gray-400 cursor-not-allowed"
            />
          </div>
          <div>
            <label htmlFor="settings-name" className="block text-[12px] font-medium text-gray-500 mb-[4px]">
              Full Name
            </label>
            <input
              id="settings-name"
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Your name"
              maxLength={80}
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
                onClick={handleManageBilling}
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
        {notifLoading ? (
          <div className="space-y-[10px]">
            {notifItems.map((item) => (
              <div key={item.key} className="flex items-center justify-between p-[12px] bg-gray-50 rounded-[8px] animate-pulse">
                <div className="space-y-[6px]">
                  <div className="h-[12px] w-[120px] bg-gray-100 rounded" />
                  <div className="h-[10px] w-[180px] bg-gray-100 rounded" />
                </div>
                <div className="w-[36px] h-[20px] bg-gray-200 rounded-full" />
              </div>
            ))}
          </div>
        ) : (
          <>
            <div className="space-y-[10px]">
              {notifItems.map((item) => (
                <div
                  key={item.key}
                  className="flex items-center justify-between p-[12px] bg-gray-50 rounded-[8px]"
                >
                  <div>
                    <span className="block text-[13px] font-medium text-[#0A0F1C]">
                      {item.label}
                    </span>
                    <span className="text-[11px] text-gray-400">{item.desc}</span>
                  </div>
                  <ToggleSwitch
                    checked={notifPrefs[item.key] ?? true}
                    onChange={(v) =>
                      setNotifPrefs((prev) => ({ ...prev, [item.key]: v }))
                    }
                    label={item.label}
                    disabled={notifSaving}
                  />
                </div>
              ))}
            </div>
            {notifError && (
              <p className="text-[11px] text-red-500 mt-[10px] flex items-center gap-[4px]" role="alert">
                <i className="ri-error-warning-line" />
                {notifError}
                <button
                  onClick={fetchNotifPrefs}
                  className="underline hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B2A4A]/30 rounded-[2px]"
                >
                  Retry
                </button>
              </p>
            )}
            <div className="flex items-center justify-between mt-[12px]">
              <Link
                href="/notifications/preferences"
                className="text-[11px] text-gray-400 hover:text-[#1B2A4A] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B2A4A]/30 rounded-[4px]"
              >
                Manage all notification preferences →
              </Link>
              <Button onClick={saveNotifications} loading={notifSaving} size="sm">
                Save Preferences
              </Button>
            </div>
          </>
        )}
      </Card>

      {/* Favourites */}
      <Card className="mb-[16px]">
        <CardHeader title="Favourites" icon="ri-heart-3-line" />
        {favsLoading ? (
          <div className="space-y-[8px]">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-[38px] bg-gray-50 rounded-[8px] animate-pulse" />
            ))}
          </div>
        ) : favourites.length === 0 ? (
          <div className="text-center py-[16px]">
            <p className="text-[13px] text-gray-400 mb-[10px]">
              No favourites yet. Tap the heart on any match to follow a team
              or league.
            </p>
            <Link
              href="/onboarding"
              className="text-[12px] font-semibold text-[#1B2A4A] hover:text-[#243B53] transition-colors"
            >
              Set up favourites →
            </Link>
          </div>
        ) : (
          <>
            <div className="space-y-[6px] max-h-[280px] overflow-y-auto pr-[4px]">
              {favourites.map((fav) => {
                const meta = FAV_TYPE_META[fav.entity_type] || FAV_TYPE_META.team;
                const label = fav.entity_name || fav.entity_id;
                return (
                  <div
                    key={fav.id}
                    className="flex items-center justify-between gap-[10px] p-[10px] bg-gray-50 rounded-[8px]"
                  >
                    <div className="flex items-center gap-[10px] min-w-0">
                      <div className="w-[30px] h-[30px] rounded-[8px] bg-white flex items-center justify-center flex-none border border-gray-100">
                        <i className={`${meta.icon} text-[14px] text-gray-500`} />
                      </div>
                      <div className="min-w-0">
                        <span className="block text-[13px] font-medium text-[#0A0F1C] truncate">
                          {label}
                        </span>
                        <span className="block text-[10px] text-gray-400 uppercase tracking-wider">
                          {meta.label}
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeFavourite(fav.id)}
                      aria-label={`Remove ${label} from favourites`}
                      className="w-[28px] h-[28px] rounded-[8px] flex items-center justify-center text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors flex-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B2A4A]/30"
                    >
                      <i className="ri-close-line text-[14px]" />
                    </button>
                  </div>
                );
              })}
            </div>
            {favsError && (
              <p className="text-[11px] text-red-500 mt-[10px] flex items-center gap-[4px]" role="alert">
                <i className="ri-error-warning-line" />
                {favsError}
                <button
                  onClick={fetchFavourites}
                  className="underline hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B2A4A]/30 rounded-[2px]"
                >
                  Retry
                </button>
              </p>
            )}
            <p className="text-[11px] text-gray-400 mt-[10px]">
              Favourite teams and leagues from any match page, or{" "}
              <Link href="/onboarding" className="text-[#1B2A4A] hover:underline">
                re-run setup
              </Link>
              .
            </p>
          </>
        )}
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
