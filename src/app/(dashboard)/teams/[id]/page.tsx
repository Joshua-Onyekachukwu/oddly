"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PageHeader, EmptyState } from "@/components/ui";
import { FavouriteButton } from "@/components/favourites/FavouriteButton";
import { normalizeTeamName } from "@/lib/football/team-normalizer";
import type { FormResult } from "@/lib/football/standings";

interface Team {
  id: string;
  canonical_name: string;
  country: string | null;
  logo: string | null;
  league_id: string | null;
  leagues?: { id: string; name: string; country: string | null; logo: string | null } | null;
}

interface FixtureRow {
  id: string;
  kickoff_time: string;
  status: string;
  home_score: number | null;
  away_score: number | null;
  home_team_id: string | null;
  away_team_id: string | null;
  home_team?: { canonical_name: string; logo: string | null } | null;
  away_team?: { canonical_name: string; logo: string | null } | null;
}

interface FeatureProfile {
  team_name: string;
  league: string | null;
  attack_rating: number | null;
  defense_rating: number | null;
  goals_for_per_game: number | null;
  goals_against_per_game: number | null;
  win_rate: number | null;
  home_win_rate: number | null;
  away_win_rate: number | null;
  avg_xg: number | null;
  avg_xga: number | null;
  xg_last5: number | null;
  home_xg: number | null;
  away_xg: number | null;
  home_xga: number | null;
  away_xga: number | null;
  avg_ppda: number | null;
  avg_shots: number | null;
  avg_big_chances: number | null;
  npxg_ratio: number | null;
  xg_source: string | null;
  data_season: string | null;
  last_updated: string | null;
  recent_form: string | null;
}

interface InjuryRow {
  player_name: string | null;
  status: string;
  injury_type: string | null;
  expected_return: string | null;
  player_importance: number | null;
  matches_missed: number | null;
  fetched_at: string | null;
}

const FIXTURE_COLS =
  "id, kickoff_time, status, home_score, away_score, home_team_id, away_team_id, " +
  "home_team:teams!fixtures_home_team_id_fkey(canonical_name, logo), " +
  "away_team:teams!fixtures_away_team_id_fkey(canonical_name, logo)";

function FormBadge({ result }: { result: FormResult }) {
  const cls =
    result === "W"
      ? "bg-emerald-50 text-emerald-600"
      : result === "D"
        ? "bg-gray-100 text-gray-500"
        : "bg-red-50 text-red-500";
  return (
    <span className={`inline-flex items-center justify-center w-[20px] h-[20px] rounded-[4px] text-[10px] font-bold ${cls}`}>
      {result}
    </span>
  );
}

function StatusPill({ status }: { status: string }) {
  const s = (status || "").toLowerCase();
  const cls = s.includes("injur") || s.includes("out") || s.includes("suspend")
    ? "bg-red-50 text-red-600"
    : s.includes("doubt") || s.includes("question")
      ? "bg-amber-50 text-amber-600"
      : "bg-emerald-50 text-emerald-600";
  return (
    <span className={`text-[9px] font-bold uppercase tracking-wide px-[6px] py-[2px] rounded-full ${cls}`}>
      {status}
    </span>
  );
}

export default function TeamDetailPage() {
  const params = useParams<{ id: string }>();
  const teamId = params?.id;

  const [team, setTeam] = useState<Team | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [finished, setFinished] = useState<FixtureRow[]>([]);
  const [upcoming, setUpcoming] = useState<FixtureRow[]>([]);
  const [profile, setProfile] = useState<FeatureProfile | null>(null);
  const [injuries, setInjuries] = useState<InjuryRow[]>([]);
  const [injuriesNote, setInjuriesNote] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!teamId) return;
    setLoading(true);
    setError(null);
    try {
      const supabase = createClient();

      const { data: teamRow, error: teamErr } = await supabase
        .from("teams")
        .select("id, canonical_name, country, logo, league_id, leagues(id, name, country, logo)")
        .eq("id", teamId)
        .maybeSingle();
      if (teamErr) throw teamErr;
      if (!teamRow) {
        setError("This team could not be found.");
        setLoading(false);
        return;
      }
      const t = teamRow as unknown as Team;
      setTeam(t);

      const orFilter = `home_team_id.eq.${teamId},away_team_id.eq.${teamId}`;

      const [finishedRes, upcomingRes] = await Promise.all([
        supabase
          .from("fixtures")
          .select(FIXTURE_COLS)
          .eq("status", "finished")
          .or(orFilter)
          .order("kickoff_time", { ascending: false })
          .limit(80),
        supabase
          .from("fixtures")
          .select(FIXTURE_COLS)
          .in("status", ["scheduled", "live", "halftime"])
          .or(orFilter)
          .order("kickoff_time", { ascending: true })
          .limit(10),
      ]);
      if (finishedRes.error) throw finishedRes.error;
      if (upcomingRes.error) throw upcomingRes.error;

      setFinished((finishedRes.data || []) as unknown as FixtureRow[]);
      setUpcoming((upcomingRes.data || []) as unknown as FixtureRow[]);

      // Feature profile — matched by normalized team name (sources disagree
      // on naming: "Wolverhampton Wanderers" vs "Wolves" etc.).
      const teamKey = normalizeTeamName(t.canonical_name);
      const { data: profiles } = await supabase
        .from("team_feature_profiles")
        .select(
          "team_name, league, attack_rating, defense_rating, goals_for_per_game, goals_against_per_game, win_rate, home_win_rate, away_win_rate, avg_xg, avg_xga, xg_last5, home_xg, away_xg, home_xga, away_xga, avg_ppda, avg_shots, avg_big_chances, npxg_ratio, xg_source, data_season, last_updated, recent_form"
        )
        .limit(5000);
      const match = (profiles || []).find(
        (p: any) => normalizeTeamName(p.team_name || "") === teamKey
      ) as FeatureProfile | undefined;
      setProfile(match || null);

      // Injury data — same normalized-name matching; fall back to ilike if
      // the full scan finds nothing (keeps payload small when it can).
      let injuryRows: InjuryRow[] = [];
      const { data: direct } = await supabase
        .from("player_injury_data")
        .select("player_name, status, injury_type, expected_return, player_importance, matches_missed, fetched_at")
        .ilike("team_name", `%${t.canonical_name}%`)
        .limit(200);
      if (direct && direct.length > 0) {
        injuryRows = direct as InjuryRow[];
      } else {
        const { data: allInj } = await supabase
          .from("player_injury_data")
          .select("team_name, player_name, status, injury_type, expected_return, player_importance, matches_missed, fetched_at")
          .limit(10000);
        injuryRows = ((allInj || []) as any[])
          .filter((r) => normalizeTeamName(r.team_name || "") === teamKey)
          .map(({ team_name, ...rest }: any) => rest) as InjuryRow[];
        if ((allInj || []).length >= 10000) {
          setInjuriesNote("Injury feed may be truncated — very large result set.");
        }
      }
      // Most recent fetch first, then by importance.
      injuryRows.sort((a, b) => {
        const at = a.fetched_at || "";
        const bt = b.fetched_at || "";
        if (at !== bt) return bt.localeCompare(at);
        return (b.player_importance || 0) - (a.player_importance || 0);
      });
      setInjuries(injuryRows.slice(0, 25));
      if (injuryRows.length === 0) setInjuriesNote("No injury records matched this team's name variants.");
    } catch (err: any) {
      console.error("Failed to load team:", err);
      setError("Unable to load this team. The data service may be temporarily unavailable.");
    } finally {
      setLoading(false);
    }
  }, [teamId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // ── Derived stats (honest: only from fixtures actually on record) ──
  const stats = useMemo(() => {
    let gf = 0, ga = 0, w = 0, d = 0, l = 0;
    let homeGF = 0, homeGA = 0, homeP = 0;
    let awayGF = 0, awayGA = 0, awayP = 0;
    const form: FormResult[] = [];

    // `finished` is already kickoff desc → first 5 are the latest results.
    for (const f of finished) {
      if (f.home_score == null || f.away_score == null) continue;
      const isHome = f.home_team_id === teamId;
      const myGF = isHome ? f.home_score : f.away_score;
      const myGA = isHome ? f.away_score : f.home_score;
      gf += myGF;
      ga += myGA;
      if (isHome) { homeGF += myGF; homeGA += myGA; homeP += 1; }
      else { awayGF += myGF; awayGA += myGA; awayP += 1; }
      const res: FormResult = myGF > myGA ? "W" : myGF < myGA ? "L" : "D";
      if (res === "W") w += 1; else if (res === "D") d += 1; else l += 1;
      if (form.length < 5) form.push(res);
    }

    const played = w + d + l;
    return {
      played, w, d, l, gf, ga, gd: gf - ga,
      home: { played: homeP, gf: homeGF, ga: homeGA },
      away: { played: awayP, gf: awayGF, ga: awayGA },
      form,
      /** Fewer than this many finished matches → label as limited sample. */
      limited: played > 0 && played < 10,
      noData: played === 0,
    };
  }, [finished, teamId]);

  const fixtureRow = (f: FixtureRow) => {
    const isHome = f.home_team_id === teamId;
    const opp = isHome ? f.away_team : f.home_team;
    const oppName = opp?.canonical_name || "TBD";
    const finishedFx = f.status === "finished";
    const myGF = isHome ? f.home_score : f.away_score;
    const oppGF = isHome ? f.away_score : f.home_score;
    return (
      <Link
        key={f.id}
        href={`/matches/${f.id}`}
        className="flex items-center gap-[8px] px-[12px] py-[8px] rounded-[8px] hover:bg-gray-50 transition-colors"
      >
        <span className="w-[86px] flex-none text-[10px] text-gray-400 font-mono-data">
          {new Date(f.kickoff_time).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
        </span>
        <span className="flex-1 min-w-0 flex items-center gap-[6px]">
          {isHome && <span className="text-[9px] font-bold text-gray-300 w-[14px]">H</span>}
          {!isHome && <span className="text-[9px] font-bold text-gray-300 w-[14px]">A</span>}
          {opp?.logo && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={opp.logo} alt="" className="w-[16px] h-[16px] object-contain flex-none" />
          )}
          <span className="text-[12px] font-medium text-[#0A0F1C] truncate">
            {isHome ? "vs" : "@"} {oppName}
          </span>
        </span>
        <span className="flex-none text-[12px] font-mono-data font-bold text-[#0A0F1C] w-[44px] text-center">
          {finishedFx && myGF != null && oppGF != null ? `${myGF}–${oppGF}` : "—"}
        </span>
        <span className="w-[90px] flex-none text-right text-[10px] text-gray-400">
          {team?.leagues?.name || ""}
        </span>
      </Link>
    );
  };

  if (loading) {
    return (
      <div>
        <PageHeader title="Team" breadcrumbs={[{ label: "Teams", href: "/teams" }]} />
        <div className="space-y-[12px]">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="bg-white rounded-[14px] border border-gray-100 p-[16px] animate-pulse h-[64px]" />
          ))}
        </div>
      </div>
    );
  }

  if (error || !team) {
    return (
      <div>
        <PageHeader title="Team" breadcrumbs={[{ label: "Teams", href: "/teams" }]} />
        <EmptyState
          icon="ri-error-warning-line"
          title="Team unavailable"
          description={error || "This team could not be found."}
          action={
            <Link href="/teams" className="text-[12px] font-semibold text-[#1B2A4A] hover:underline">
              Back to teams
            </Link>
          }
        />
      </div>
    );
  }

  const num = (v: number | null | undefined, d = 2) =>
    v == null ? "—" : Number(v).toFixed(d);

  return (
    <div>
      <PageHeader
        title={team.canonical_name}
        description={`${team.leagues?.name || team.country || "—"}${team.country ? ` · ${team.country}` : ""}`}
        breadcrumbs={[{ label: "Teams", href: "/teams" }, { label: team.canonical_name }]}
        action={
          <div className="flex items-center gap-[10px]">
            {team.logo && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={team.logo} alt={team.canonical_name} className="w-[44px] h-[44px] object-contain" />
            )}
            <FavouriteButton entityType="team" entityId={team.id} entityName={team.canonical_name} />
          </div>
        }
      />

      {/* Form strip */}
      <section className="bg-white rounded-[14px] border border-gray-100 p-[16px] mb-[20px]">
        <div className="flex flex-wrap items-center gap-x-[24px] gap-y-[10px]">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">Recent form</div>
            <div className="flex gap-[4px] mt-[4px]">
              {stats.form.length === 0 ? (
                <span className="text-[11px] text-gray-300">No finished matches on record</span>
              ) : (
                stats.form.map((r, i) => <FormBadge key={i} result={r} />)
              )}
            </div>
          </div>
          {[
            ["Played", stats.noData ? "—" : String(stats.played)],
            ["W-D-L", stats.noData ? "—" : `${stats.w}-${stats.d}-${stats.l}`],
            ["GF", stats.noData ? "—" : String(stats.gf)],
            ["GA", stats.noData ? "—" : String(stats.ga)],
            ["GD", stats.noData ? "—" : (stats.gd > 0 ? `+${stats.gd}` : String(stats.gd))],
          ].map(([label, value]) => (
            <div key={label}>
              <div className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">{label}</div>
              <div className="text-[18px] font-mono-data font-bold text-[#0A0F1C]">{value}</div>
            </div>
          ))}
          {stats.limited && (
            <span className="ml-auto text-[10px] text-amber-600 bg-amber-50 px-[8px] py-[4px] rounded-full">
              Limited sample ({stats.played} matches)
            </span>
          )}
        </div>
        {stats.noData && (
          <div className="mt-[10px] text-[11px] text-gray-400">
            Insufficient data — no finished fixtures involving this team are on record yet.
          </div>
        )}
        {!stats.noData && finished.length >= 80 && (
          <div className="mt-[10px] text-[10px] text-gray-400">
            Season totals computed from the {finished.length} most recent finished fixtures on record.
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-[20px]">
        {/* Fixtures */}
        <section className="bg-white rounded-[14px] border border-gray-100">
          <div className="px-[16px] py-[12px] border-b border-gray-50">
            <h2 className="text-[13px] font-semibold text-[#0A0F1C]">Fixtures</h2>
          </div>
          {upcoming.length === 0 && finished.length === 0 ? (
            <div className="px-[16px] py-[24px] text-[12px] text-gray-400">No fixtures on record for this team.</div>
          ) : (
            <div className="py-[4px]">
              {upcoming.length > 0 && (
                <div className="px-[12px] pt-[8px] pb-[4px] text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                  Upcoming
                </div>
              )}
              {upcoming.map(fixtureRow)}
              {finished.length > 0 && (
                <div className="px-[12px] pt-[10px] pb-[4px] text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                  Recent results
                </div>
              )}
              {finished.slice(0, 10).map(fixtureRow)}
            </div>
          )}
        </section>

        {/* xG / performance profile */}
        <section className="bg-white rounded-[14px] border border-gray-100">
          <div className="px-[16px] py-[12px] border-b border-gray-50 flex items-center justify-between">
            <h2 className="text-[13px] font-semibold text-[#0A0F1C]">Performance profile</h2>
            {profile?.data_season && (
              <span className="text-[10px] text-gray-400">season {profile.data_season}</span>
            )}
          </div>
          {profile ? (
            <div className="p-[16px]">
              <div className="grid grid-cols-3 gap-[12px]">
                {[
                  ["xG / match", num(profile.avg_xg)],
                  ["xGA / match", num(profile.avg_xga)],
                  ["xG last 5", num(profile.xg_last5)],
                  ["xG home", num(profile.home_xg)],
                  ["xG away", num(profile.away_xg)],
                  ["npxG ratio", num(profile.npxg_ratio)],
                  ["PPDA", num(profile.avg_ppda, 1)],
                  ["Shots / match", num(profile.avg_shots, 1)],
                  ["Big chances / match", num(profile.avg_big_chances, 1)],
                ].map(([label, value]) => (
                  <div key={label}>
                    <div className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">{label}</div>
                    <div className="text-[15px] font-mono-data font-bold text-[#0A0F1C]">{value}</div>
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-[12px] mt-[14px] pt-[12px] border-t border-gray-50">
                {[
                  ["Attack rating", num(profile.attack_rating, 1)],
                  ["Defense rating", num(profile.defense_rating, 1)],
                  ["Win rate", profile.win_rate != null ? `${(profile.win_rate * 100).toFixed(0)}%` : "—"],
                  ["GF / game", num(profile.goals_for_per_game)],
                  ["GA / game", num(profile.goals_against_per_game)],
                ].map(([label, value]) => (
                  <div key={label}>
                    <div className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">{label}</div>
                    <div className="text-[13px] font-mono-data font-semibold text-[#0A0F1C]">{value}</div>
                  </div>
                ))}
              </div>
              {profile.xg_source && (
                <div className="mt-[10px] text-[10px] text-gray-400">
                  xG source: {profile.xg_source}
                  {profile.last_updated ? ` · updated ${new Date(profile.last_updated).toLocaleDateString()}` : ""}
                </div>
              )}
            </div>
          ) : (
            <div className="px-[16px] py-[24px] text-[12px] text-gray-400">
              Insufficient data — no performance profile matched this team name.
            </div>
          )}
        </section>
      </div>

      {/* Home / away splits */}
      <section className="bg-white rounded-[14px] border border-gray-100 p-[16px] mt-[20px]">
        <h2 className="text-[13px] font-semibold text-[#0A0F1C] mb-[12px]">Home / away splits</h2>
        {stats.home.played === 0 && stats.away.played === 0 ? (
          <div className="text-[12px] text-gray-400">Insufficient data — no finished fixtures on record.</div>
        ) : (
          <div className="grid grid-cols-2 gap-[12px]">
            {[
              ["Home", stats.home],
              ["Away", stats.away],
            ].map(([label, s]: any) => (
              <div key={label} className="rounded-[10px] bg-gray-50 p-[12px]">
                <div className="text-[11px] font-semibold text-gray-500 mb-[6px]">{label}</div>
                {s.played === 0 ? (
                  <div className="text-[11px] text-gray-400">No matches on record</div>
                ) : (
                  <div className="flex gap-[16px] text-[12px]">
                    <span className="text-gray-500">{s.played} played</span>
                    <span className="font-mono-data font-semibold text-[#0A0F1C]">
                      {s.gf}–{s.ga}
                    </span>
                    <span className="text-gray-400">
                      {s.gf - s.ga > 0 ? `+${s.gf - s.ga}` : s.gf - s.ga} GD
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Injuries / availability */}
      <section className="bg-white rounded-[14px] border border-gray-100 mt-[20px] overflow-hidden">
        <div className="px-[16px] py-[12px] border-b border-gray-50 flex items-center justify-between">
          <h2 className="text-[13px] font-semibold text-[#0A0F1C]">Injury &amp; availability</h2>
          {injuries.length > 0 && (
            <span className="text-[10px] text-gray-400">{injuries.length} recorded</span>
          )}
        </div>
        {injuries.length === 0 ? (
          <div className="px-[16px] py-[24px] text-[12px] text-gray-400">
            {injuriesNote || "No injury records on file for this team."}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-gray-400 border-b border-gray-50">
                  <th className="px-[16px] py-[8px] font-semibold">Player</th>
                  <th className="py-[8px] font-semibold">Status</th>
                  <th className="py-[8px] font-semibold">Injury</th>
                  <th className="py-[8px] font-semibold text-right">Importance</th>
                  <th className="px-[16px] py-[8px] font-semibold text-right">Return</th>
                </tr>
              </thead>
              <tbody>
                {injuries.map((inj, i) => (
                  <tr key={i} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/60">
                    <td className="px-[16px] py-[8px] font-medium text-[#0A0F1C]">{inj.player_name || "—"}</td>
                    <td className="py-[8px]"><StatusPill status={inj.status} /></td>
                    <td className="py-[8px] text-gray-500">{inj.injury_type || "—"}</td>
                    <td className="py-[8px] text-right font-mono-data text-gray-500">
                      {inj.player_importance != null ? Number(inj.player_importance).toFixed(1) : "—"}
                    </td>
                    <td className="px-[16px] py-[8px] text-right text-gray-500">{inj.expected_return || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {injuriesNote && injuries.length > 0 && (
          <div className="px-[16px] py-[8px] text-[10px] text-gray-400 border-t border-gray-50">{injuriesNote}</div>
        )}
      </section>
    </div>
  );
}
