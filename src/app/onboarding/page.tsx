"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/providers/AuthProvider";
import { Button } from "@/components/ui";

// ─── Types ───────────────────────────────────────────────────────────────

interface TeamOption {
  id: string;
  name: string;
  logo: string | null;
  country: string | null;
}

interface LeagueOption {
  id: string;
  name: string;
  country: string | null;
  logo: string | null;
}

interface SelectedItem {
  id: string;
  name: string;
  logo: string | null;
}

const STEPS = ["Your teams", "Your leagues", "Notifications"];

const NOTIF_OPTIONS = [
  { key: "new_picks", label: "New picks", desc: "When the model finds a strong selection" },
  { key: "result_settled", label: "Results", desc: "When a prediction is settled" },
  { key: "rollover_pick", label: "Rollover", desc: "Your daily rollover suggestion" },
];

// ─── Small components ────────────────────────────────────────────────────

function OptionChip({
  name,
  logo,
  selected,
  onToggle,
}: {
  name: string;
  logo?: string | null;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={selected}
      className={`flex items-center gap-[8px] px-[12px] py-[8px] rounded-[10px] border text-[13px] font-medium transition-all duration-150 ${
        selected
          ? "border-[#1B2A4A] bg-[#1B2A4A]/5 text-[#1B2A4A]"
          : "border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50"
      }`}
    >
      {logo ? (
        <img src={logo} alt="" className="w-[18px] h-[18px] object-contain flex-none" />
      ) : (
        <span className="w-[18px] h-[18px] rounded-full bg-gray-100 flex items-center justify-center text-[9px] font-bold text-gray-400 flex-none">
          {name.charAt(0)}
        </span>
      )}
      <span className="truncate max-w-[160px]">{name}</span>
      {selected && <i className="ri-check-line text-[14px] text-[#1B2A4A] flex-none" />}
    </button>
  );
}

function ToggleSwitch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`w-[36px] h-[20px] rounded-full transition-all duration-200 flex-none cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B2A4A]/30 focus-visible:ring-offset-2 ${
        checked ? "bg-[#1B2A4A]" : "bg-gray-200"
      }`}
    >
      <span
        className={`block w-[16px] h-[16px] bg-white rounded-full transition-all duration-200 mt-[2px] ${
          checked ? "translate-x-[18px]" : "translate-x-[2px]"
        }`}
      />
    </button>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────

export default function OnboardingPage() {
  const { user, profile, loading: authLoading } = useAuth();
  const router = useRouter();
  const supabase = createClient();

  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Step 1 — teams
  const [teamQuery, setTeamQuery] = useState("");
  const [teamResults, setTeamResults] = useState<TeamOption[]>([]);
  const [teamsSearching, setTeamsSearching] = useState(false);
  const [selectedTeams, setSelectedTeams] = useState<SelectedItem[]>([]);

  // Step 2 — leagues
  const [leagueQuery, setLeagueQuery] = useState("");
  const [leagues, setLeagues] = useState<LeagueOption[]>([]);
  const [leaguesLoading, setLeaguesLoading] = useState(false);
  const [selectedLeagues, setSelectedLeagues] = useState<SelectedItem[]>([]);

  // Step 3 — notification prefs
  const [notifPrefs, setNotifPrefs] = useState<Record<string, boolean>>({
    new_picks: true,
    result_settled: true,
    rollover_pick: true,
  });

  // Auth guard — onboarding requires a session.
  useEffect(() => {
    if (!authLoading && !user) {
      router.replace("/login?redirect=/onboarding");
    }
  }, [authLoading, user, router]);

  // Team search (debounced).
  useEffect(() => {
    const q = teamQuery.trim();
    if (q.length < 2) {
      setTeamResults([]);
      return;
    }
    setTeamsSearching(true);
    const t = setTimeout(async () => {
      const { data } = await supabase
        .from("teams")
        .select("id, canonical_name, logo, country")
        .ilike("canonical_name", `%${q}%`)
        .limit(8);
      setTeamResults(
        (data || []).map((t: any) => ({
          id: t.id,
          name: t.canonical_name,
          logo: t.logo || null,
          country: t.country || null,
        }))
      );
      setTeamsSearching(false);
    }, 250);
    return () => clearTimeout(t);
  }, [teamQuery, supabase]);

  // Leagues load once when step 2 is reached.
  useEffect(() => {
    if (step !== 1 || leagues.length > 0 || leaguesLoading) return;
    setLeaguesLoading(true);
    supabase
      .from("leagues")
      .select("id, name, country, logo, is_active")
      .eq("is_active", true)
      .order("name", { ascending: true })
      .limit(100)
      .then(({ data }) => {
        setLeagues(
          (data || []).map((l: any) => ({
            id: l.id,
            name: l.name,
            country: l.country || null,
            logo: l.logo || null,
          }))
        );
        setLeaguesLoading(false);
      });
  }, [step, leagues.length, leaguesLoading, supabase]);

  const toggleTeam = (t: { id: string; name: string; logo: string | null }) => {
    setSelectedTeams((prev) =>
      prev.some((s) => s.id === t.id)
        ? prev.filter((s) => s.id !== t.id)
        : [...prev, { id: t.id, name: t.name, logo: t.logo }]
    );
  };

  const toggleLeague = (l: { id: string; name: string; logo: string | null }) => {
    setSelectedLeagues((prev) =>
      prev.some((s) => s.id === l.id)
        ? prev.filter((s) => s.id !== l.id)
        : [...prev, { id: l.id, name: l.name, logo: l.logo }]
    );
  };

  const markComplete = useCallback(
    async (prefs?: Record<string, boolean>) => {
      if (!user) return;
      const update: Record<string, unknown> = { onboarding_completed: true };
      if (prefs) {
        // Merge with existing notification_preferences.
        const { data: profileRow } = await supabase
          .from("profiles")
          .select("notification_preferences")
          .eq("id", user.id)
          .single();
        update.notification_preferences = {
          ...((profileRow?.notification_preferences as Record<string, boolean>) || {}),
          ...prefs,
        };
      }
      await supabase.from("profiles").update(update as any).eq("id", user.id);
    },
    [user, supabase]
  );

  const handleFinish = async () => {
    if (!user) return;
    setSaving(true);
    setError(null);

    try {
      // Persist favourites — upsert makes re-runs idempotent.
      const rows = [
        ...selectedTeams.map((t) => ({
          user_id: user.id,
          entity_type: "team" as const,
          entity_id: t.id,
          entity_key: t.id.toLowerCase(),
          entity_name: t.name,
        })),
        ...selectedLeagues.map((l) => ({
          user_id: user.id,
          entity_type: "league" as const,
          entity_id: l.id,
          entity_key: l.id.toLowerCase(),
          entity_name: l.name,
        })),
      ];

      if (rows.length > 0) {
        const { error: favError } = await supabase
          .from("user_favourites")
          .upsert(rows, { onConflict: "user_id,entity_type,entity_key", ignoreDuplicates: true });
        if (favError) throw favError;
      }

      await markComplete(notifPrefs);
      router.push("/dashboard");
    } catch (err) {
      console.error("Onboarding save failed:", err);
      setError("Could not save your preferences. Please try again.");
      setSaving(false);
    }
  };

  const handleSkip = async () => {
    setSaving(true);
    try {
      await markComplete();
    } finally {
      router.push("/dashboard");
    }
  };

  if (authLoading || !user) {
    return (
      <div className="min-h-screen bg-[#F8F9FC] flex items-center justify-center">
        <div className="w-[32px] h-[32px] border-2 border-[#1B2A4A]/20 border-t-[#1B2A4A] rounded-full animate-spin" />
      </div>
    );
  }

  const filteredLeagues = leagueQuery.trim()
    ? leagues.filter((l) => l.name.toLowerCase().includes(leagueQuery.trim().toLowerCase()))
    : leagues;

  return (
    <div className="min-h-screen bg-[#F8F9FC] flex items-center justify-center px-[20px] py-[40px]">
      <div className="w-full max-w-[560px]">
        {/* Brand + step indicator */}
        <div className="text-center mb-[24px]">
          <div className="inline-flex items-center justify-center w-[44px] h-[44px] rounded-[12px] bg-[#1B2A4A] mb-[12px]">
            <span className="text-white font-display font-bold text-[18px]">O</span>
          </div>
          <h1 className="font-display text-[22px] font-bold text-[#0A0F1C]">
            Welcome{profile?.display_name ? `, ${profile.display_name.split(" ")[0]}` : ""}!
          </h1>
          <p className="text-[13px] text-gray-400 mt-[4px]">
            Tell us who you follow — it takes 30 seconds.
          </p>
        </div>

        {/* Step pills */}
        <div className="flex items-center justify-center gap-[8px] mb-[20px]">
          {STEPS.map((label, i) => (
            <div key={label} className="flex items-center gap-[8px]">
              <div
                className={`flex items-center gap-[6px] px-[12px] py-[5px] rounded-full text-[11px] font-semibold transition-colors ${
                  i === step
                    ? "bg-[#1B2A4A] text-white"
                    : i < step
                    ? "bg-[#1B2A4A]/10 text-[#1B2A4A]"
                    : "bg-gray-100 text-gray-400"
                }`}
              >
                <span
                  className={`w-[16px] h-[16px] rounded-full flex items-center justify-center text-[9px] ${
                    i <= step ? "bg-white/20" : "bg-gray-200"
                  }`}
                >
                  {i < step ? <i className="ri-check-line" /> : i + 1}
                </span>
                {label}
              </div>
              {i < STEPS.length - 1 && <div className="w-[16px] h-[1px] bg-gray-200" />}
            </div>
          ))}
        </div>

        {/* Card */}
        <div className="bg-white rounded-[16px] border border-gray-100 shadow-[0_2px_12px_rgba(0,0,0,0.03)] p-[24px]">
          {step === 0 && (
            <div>
              <h2 className="text-[16px] font-semibold text-[#0A0F1C] font-display mb-[4px]">
                Which teams do you follow?
              </h2>
              <p className="text-[12px] text-gray-400 mb-[14px]">
                Search and pick up to 10 teams. You can change this anytime.
              </p>
              <input
                type="text"
                value={teamQuery}
                onChange={(e) => setTeamQuery(e.target.value)}
                placeholder="Search teams — e.g. Arsenal, Barcelona..."
                className="w-full h-[40px] rounded-[10px] border border-gray-200 px-[12px] text-[13px] text-[#0A0F1C] placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#1B2A4A]/20 mb-[12px]"
              />
              {teamQuery.trim().length >= 2 && (
                <div className="flex flex-wrap gap-[8px] mb-[12px] max-h-[220px] overflow-y-auto">
                  {teamsSearching && (
                    <span className="text-[12px] text-gray-400 py-[8px]">Searching...</span>
                  )}
                  {!teamsSearching && teamResults.length === 0 && (
                    <span className="text-[12px] text-gray-400 py-[8px]">No teams found.</span>
                  )}
                  {teamResults.map((t) => (
                    <OptionChip
                      key={t.id}
                      name={t.name}
                      logo={t.logo}
                      selected={selectedTeams.some((s) => s.id === t.id)}
                      onToggle={() => toggleTeam(t)}
                    />
                  ))}
                </div>
              )}
              {selectedTeams.length > 0 && (
                <div className="border-t border-gray-50 pt-[12px]">
                  <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                    Selected ({selectedTeams.length})
                  </span>
                  <div className="flex flex-wrap gap-[6px] mt-[8px]">
                    {selectedTeams.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => toggleTeam({ id: t.id, name: t.name, logo: t.logo })}
                        className="inline-flex items-center gap-[4px] px-[8px] py-[4px] rounded-full bg-[#1B2A4A]/8 text-[11px] font-medium text-[#1B2A4A] hover:bg-red-50 hover:text-red-500 transition-colors"
                      >
                        {t.name} <i className="ri-close-line" />
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {step === 1 && (
            <div>
              <h2 className="text-[16px] font-semibold text-[#0A0F1C] font-display mb-[4px]">
                Which leagues interest you?
              </h2>
              <p className="text-[12px] text-gray-400 mb-[14px]">
                Pick the competitions you follow — or skip this step.
              </p>
              <input
                type="text"
                value={leagueQuery}
                onChange={(e) => setLeagueQuery(e.target.value)}
                placeholder="Filter leagues..."
                className="w-full h-[40px] rounded-[10px] border border-gray-200 px-[12px] text-[13px] text-[#0A0F1C] placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#1B2A4A]/20 mb-[12px]"
              />
              <div className="flex flex-wrap gap-[8px] max-h-[260px] overflow-y-auto">
                {leaguesLoading && (
                  <span className="text-[12px] text-gray-400 py-[8px]">Loading leagues...</span>
                )}
                {!leaguesLoading && filteredLeagues.length === 0 && (
                  <span className="text-[12px] text-gray-400 py-[8px]">No leagues found.</span>
                )}
                {filteredLeagues.map((l) => (
                  <OptionChip
                    key={l.id}
                    name={l.name}
                    logo={l.logo}
                    selected={selectedLeagues.some((s) => s.id === l.id)}
                    onToggle={() => toggleLeague(l)}
                  />
                ))}
              </div>
              {selectedLeagues.length > 0 && (
                <div className="border-t border-gray-50 pt-[12px] mt-[12px]">
                  <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                    Selected ({selectedLeagues.length})
                  </span>
                  <div className="flex flex-wrap gap-[6px] mt-[8px]">
                    {selectedLeagues.map((l) => (
                      <button
                        key={l.id}
                        type="button"
                        onClick={() => toggleLeague({ id: l.id, name: l.name, logo: l.logo })}
                        className="inline-flex items-center gap-[4px] px-[8px] py-[4px] rounded-full bg-[#1B2A4A]/8 text-[11px] font-medium text-[#1B2A4A] hover:bg-red-50 hover:text-red-500 transition-colors"
                      >
                        {l.name} <i className="ri-close-line" />
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {step === 2 && (
            <div>
              <h2 className="text-[16px] font-semibold text-[#0A0F1C] font-display mb-[4px]">
                Notifications
              </h2>
              <p className="text-[12px] text-gray-400 mb-[14px]">
                Choose what you want to hear about. You can change these later in{" "}
                <Link href="/settings" className="text-[#1B2A4A] hover:underline">
                  Settings
                </Link>
                .
              </p>
              <div className="space-y-[10px]">
                {NOTIF_OPTIONS.map((opt) => (
                  <div
                    key={opt.key}
                    className="flex items-center justify-between p-[12px] bg-gray-50 rounded-[10px]"
                  >
                    <div>
                      <span className="block text-[13px] font-medium text-[#0A0F1C]">
                        {opt.label}
                      </span>
                      <span className="text-[11px] text-gray-400">{opt.desc}</span>
                    </div>
                    <ToggleSwitch
                      checked={notifPrefs[opt.key] ?? true}
                      onChange={(v) => setNotifPrefs((prev) => ({ ...prev, [opt.key]: v }))}
                      label={opt.label}
                    />
                  </div>
                ))}
              </div>
              <div className="mt-[16px] p-[12px] bg-[#1B2A4A]/5 rounded-[10px] text-[12px] text-gray-600">
                <i className="ri-information-line mr-[6px] text-[#1B2A4A]" />
                You&apos;re following {selectedTeams.length} team
                {selectedTeams.length === 1 ? "" : "s"} and {selectedLeagues.length} league
                {selectedLeagues.length === 1 ? "" : "s"}. Their upcoming matches will
                appear on your dashboard.
              </div>
            </div>
          )}

          {error && (
            <p className="text-[12px] text-red-500 mt-[12px] flex items-center gap-[6px]" role="alert">
              <i className="ri-error-warning-line" /> {error}
            </p>
          )}

          {/* Actions */}
          <div className="flex items-center justify-between mt-[20px]">
            <button
              type="button"
              onClick={handleSkip}
              disabled={saving}
              className="text-[12px] font-medium text-gray-400 hover:text-gray-600 transition-colors disabled:opacity-50"
            >
              Skip for now
            </button>
            <div className="flex items-center gap-[8px]">
              {step > 0 && (
                <Button variant="secondary" size="sm" onClick={() => setStep(step - 1)} disabled={saving}>
                  Back
                </Button>
              )}
              {step < STEPS.length - 1 ? (
                <Button size="sm" onClick={() => setStep(step + 1)}>
                  Continue
                </Button>
              ) : (
                <Button size="sm" onClick={handleFinish} loading={saving}>
                  Finish setup
                </Button>
              )}
            </div>
          </div>
        </div>

        <p className="text-center text-[11px] text-gray-300 mt-[16px]">
          You can update your favourites anytime from Settings or any match page.
        </p>
      </div>
    </div>
  );
}
