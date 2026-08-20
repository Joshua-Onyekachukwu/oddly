"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/providers/AuthProvider";
import { PageHeader, Button, Card, CardHeader } from "@/components/ui";

/**
 * Notification type definitions with metadata for the preferences UI.
 */
const NOTIFICATION_TYPES = [
  {
    key: "new_picks",
    label: "New Value Bets",
    description: "When the AI detects a new value bet opportunity",
    icon: "ri-percent-line",
    color: "text-green-600",
    bg: "bg-green-50",
    category: "Picks & Predictions",
  },
  {
    key: "crown_jewel",
    label: "Crown Jewel Selection",
    description: "When the top pick of the day is selected",
    icon: "ri-vip-crown-line",
    color: "text-amber-600",
    bg: "bg-amber-50",
    category: "Picks & Predictions",
  },
  {
    key: "match_started",
    label: "Match Started",
    description: "When a tracked match kicks off",
    icon: "ri-football-line",
    color: "text-blue-600",
    bg: "bg-blue-50",
    category: "Live Updates",
  },
  {
    key: "result_settled",
    label: "Bet Results",
    description: "When one of your bets is settled (won or lost)",
    icon: "ri-check-double-line",
    color: "text-green-600",
    bg: "bg-green-50",
    category: "Live Updates",
  },
  {
    key: "chain_milestone",
    label: "Rollover Milestones",
    description: "When you hit a rollover chain milestone",
    icon: "ri-fire-line",
    color: "text-orange-600",
    bg: "bg-orange-50",
    category: "Challenges",
  },
  {
    key: "chain_broken",
    label: "Chain Broken Alerts",
    description: "When your rollover chain is broken",
    icon: "ri-close-circle-line",
    color: "text-red-600",
    bg: "bg-red-50",
    category: "Challenges",
  },
  {
    key: "rollover_pick",
    label: "Rollover Daily Picks",
    description: "Daily pick suggestions for your active rollover chain",
    icon: "ri-magic-line",
    color: "text-purple-600",
    bg: "bg-purple-50",
    category: "Challenges",
  },
  {
    key: "accumulator_settled",
    label: "Accumulator Results",
    description: "When one of your accumulators is settled",
    icon: "ri-stack-line",
    color: "text-indigo-600",
    bg: "bg-indigo-50",
    category: "Challenges",
  },
  {
    key: "model_alert",
    label: "Model Alerts",
    description: "When the prediction model detects anomalies",
    icon: "ri-robot-2-line",
    color: "text-gray-600",
    bg: "bg-gray-100",
    category: "System",
  },
  {
    key: "announcement",
    label: "Announcements",
    description: "Product updates and important notices",
    icon: "ri-megaphone-line",
    color: "text-blue-600",
    bg: "bg-blue-50",
    category: "System",
  },
  {
    key: "drawdown_warning",
    label: "Drawdown Warnings",
    description: "When your bankroll hits risk thresholds",
    icon: "ri-alert-line",
    color: "text-red-600",
    bg: "bg-red-50",
    category: "System",
  },
] as const;

type NotificationPrefs = Record<string, boolean>;

function Toggle({
  enabled,
  onChange,
  disabled,
}: {
  enabled: boolean;
  onChange: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onChange}
      disabled={disabled}
      className={`
        relative inline-flex h-[22px] w-[40px] flex-none cursor-pointer rounded-full
        transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2
        focus:ring-[#1B2A4A]/20 focus:ring-offset-2
        ${enabled ? "bg-[#1B2A4A]" : "bg-gray-200"}
        ${disabled ? "opacity-50 cursor-not-allowed" : ""}
      `}
      role="switch"
      aria-checked={enabled}
    >
      <span
        className={`
          pointer-events-none inline-block h-[18px] w-[18px] rounded-full bg-white shadow-sm
          transform transition duration-200 ease-in-out mt-[2px]
          ${enabled ? "translate-x-[20px]" : "translate-x-[2px]"}
        `}
      />
    </button>
  );
}

export default function NotificationPreferencesPage() {
  const { session } = useAuth();
  const [prefs, setPrefs] = useState<NotificationPrefs>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPreferences = useCallback(async () => {
    if (!session?.access_token) return;

    try {
      const res = await fetch("/api/v1/notifications/preferences", {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const data = await res.json();

      if (data.success) {
        setPrefs(data.data);
      }
    } catch (err) {
      console.error("Failed to fetch preferences:", err);
      setError("Failed to load preferences");
    } finally {
      setLoading(false);
    }
  }, [session?.access_token]);

  useEffect(() => {
    fetchPreferences();
  }, [fetchPreferences]);

  async function togglePreference(key: string) {
    const newValue = !prefs[key];
    const updatedPrefs = { ...prefs, [key]: newValue };

    // Optimistic update
    setPrefs(updatedPrefs);
    setSaved(false);
    setError(null);

    if (!session?.access_token) return;

    setSaving(true);
    try {
      const res = await fetch("/api/v1/notifications/preferences", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ preferences: { [key]: newValue } }),
      });

      const data = await res.json();
      if (!data.success) {
        // Revert on error
        setPrefs((prev) => ({ ...prev, [key]: !newValue }));
        setError("Failed to save preference");
      } else {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
    } catch {
      setPrefs((prev) => ({ ...prev, [key]: !newValue }));
      setError("Failed to save preference");
    } finally {
      setSaving(false);
    }
  }

  async function setAll(enabled: boolean) {
    const allPrefs: NotificationPrefs = {};
    NOTIFICATION_TYPES.forEach((t) => {
      allPrefs[t.key] = enabled;
    });

    setPrefs(allPrefs);
    setSaved(false);
    setError(null);

    if (!session?.access_token) return;

    setSaving(true);
    try {
      const res = await fetch("/api/v1/notifications/preferences", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ preferences: allPrefs }),
      });

      const data = await res.json();
      if (data.success) {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      } else {
        setError("Failed to save preferences");
        fetchPreferences(); // Revert
      }
    } catch {
      setError("Failed to save preferences");
      fetchPreferences();
    } finally {
      setSaving(false);
    }
  }

  // Group by category
  const categories = NOTIFICATION_TYPES.reduce(
    (acc, type) => {
      if (!acc[type.category]) acc[type.category] = [];
      acc[type.category].push(type);
      return acc;
    },
    {} as Record<string, typeof NOTIFICATION_TYPES[number][]>
  );

  const allEnabled = NOTIFICATION_TYPES.every((t) => prefs[t.key] === true);
  const allDisabled = NOTIFICATION_TYPES.every((t) => prefs[t.key] === false);

  if (loading) {
    return (
      <div className="max-w-[640px] mx-auto">
        <div className="animate-pulse space-y-[16px]">
          <div className="h-[28px] bg-gray-100 rounded-[8px] w-[200px]" />
          <div className="h-[14px] bg-gray-50 rounded w-[300px]" />
          <div className="mt-[24px] space-y-[8px]">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="bg-white rounded-[10px] p-[16px] border border-gray-100">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-[12px]">
                    <div className="w-[36px] h-[36px] bg-gray-100 rounded-[8px]" />
                    <div className="space-y-[6px]">
                      <div className="h-[13px] bg-gray-100 rounded w-[140px]" />
                      <div className="h-[11px] bg-gray-50 rounded w-[220px]" />
                    </div>
                  </div>
                  <div className="w-[40px] h-[22px] bg-gray-100 rounded-full" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-[640px] mx-auto">
      <PageHeader
        title="Notification Preferences"
        description="Choose which notifications you receive. Changes save automatically."
      />

      {/* Quick actions */}
      <div className="flex items-center gap-[8px] mb-[20px]">
        <Button
          variant={allEnabled ? "primary" : "secondary"}
          size="sm"
          onClick={() => setAll(true)}
          disabled={allEnabled || saving}
          icon="ri-notification-3-line"
        >
          Enable all
        </Button>
        <Button
          variant={allDisabled ? "danger" : "secondary"}
          size="sm"
          onClick={() => setAll(false)}
          disabled={allDisabled || saving}
          icon="ri-notification-off-line"
        >
          Disable all
        </Button>

        {saved && (
          <span className="text-[11px] text-green-600 font-medium flex items-center gap-[4px] ml-[8px]">
            <i className="ri-check-line" />
            Saved
          </span>
        )}
        {error && (
          <span className="text-[11px] text-red-500 font-medium flex items-center gap-[4px] ml-[8px]">
            <i className="ri-error-warning-line" />
            {error}
          </span>
        )}
      </div>

      {/* Preference groups */}
      <div className="space-y-[20px]">
        {Object.entries(categories).map(([category, types]) => {
          const categoryAllOn = types.every((t) => prefs[t.key] === true);
          const categoryAllOff = types.every((t) => prefs[t.key] === false);

          return (
            <div key={category}>
              <div className="flex items-center justify-between mb-[8px]">
                <h3 className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                  {category}
                </h3>
                <div className="flex items-center gap-[6px]">
                  <button
                    onClick={() => {
                      const update: NotificationPrefs = {};
                      types.forEach((t) => (update[t.key] = true));
                      // Batch update
                      types.forEach((t) => togglePreference(t.key));
                    }}
                    disabled={categoryAllOn || saving}
                    className="text-[10px] text-gray-400 hover:text-[#1B2A4A] transition-colors disabled:opacity-30"
                  >
                    All on
                  </button>
                  <span className="text-gray-200">·</span>
                  <button
                    onClick={() => {
                      types.forEach((t) => {
                        if (prefs[t.key]) togglePreference(t.key);
                      });
                    }}
                    disabled={categoryAllOff || saving}
                    className="text-[10px] text-gray-400 hover:text-red-500 transition-colors disabled:opacity-30"
                  >
                    All off
                  </button>
                </div>
              </div>

              <Card padding="none" className="overflow-hidden">
                {types.map((type, idx) => (
                  <div
                    key={type.key}
                    className={`
                      flex items-center justify-between p-[14px] px-[16px]
                      ${idx < types.length - 1 ? "border-b border-gray-50" : ""}
                    `}
                  >
                    <div className="flex items-center gap-[12px] flex-1 min-w-0">
                      <div
                        className={`w-[36px] h-[36px] ${type.bg} rounded-[8px] flex items-center justify-center flex-none`}
                      >
                        <i className={`${type.icon} text-[16px] ${type.color}`} />
                      </div>
                      <div className="min-w-0">
                        <h4 className="text-[13px] font-semibold text-[#0A0F1C] leading-[1.3]">
                          {type.label}
                        </h4>
                        <p className="text-[11px] text-gray-400 mt-[1px] leading-[1.4]">
                          {type.description}
                        </p>
                      </div>
                    </div>
                    <Toggle
                      enabled={prefs[type.key] ?? true}
                      onChange={() => togglePreference(type.key)}
                      disabled={saving}
                    />
                  </div>
                ))}
              </Card>
            </div>
          );
        })}
      </div>

      {/* Info note */}
      <div className="mt-[24px] p-[14px] bg-gray-50 rounded-[10px] border border-gray-100">
        <div className="flex items-start gap-[10px]">
          <i className="ri-information-line text-[16px] text-gray-400 mt-[1px]" />
          <div>
            <p className="text-[12px] text-gray-500 leading-[1.5]">
              <strong className="text-gray-600">About notifications:</strong> ODDLY sends
              notifications to keep you informed about value bets, match updates, and your
              challenge progress. You can disable any category without affecting your
              predictions or data.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
