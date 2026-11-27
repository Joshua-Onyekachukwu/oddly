"use client";

import React, { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { PageHeader, Card, CardHeader, Badge, StatCard, EmptyState } from "@/components/ui";

interface LeagueRow {
  id: string;
  name: string;
  country: string | null;
  is_active: boolean;
  priority: number;
}

interface FixtureRow {
  league_id: string | null;
  status: string | null;
  provider: string | null;
}

interface CronRunRow {
  job_name: string;
  status: string;
  started_at: string;
  completed_at: string | null;
}

interface AppStateRow {
  key: string;
  updated_at: string;
}

const UPCOMING_STATUSES = new Set(["scheduled", "live", "halftime"]);

export default function AdminDataPage() {
  const [leagues, setLeagues] = useState<LeagueRow[]>([]);
  const [fixtures, setFixtures] = useState<FixtureRow[]>([]);
  const [teamsCount, setTeamsCount] = useState<number | null>(null);
  const [externalIds, setExternalIds] = useState<{ provider: string; league_id: string }[]>([]);
  const [cronRuns, setCronRuns] = useState<CronRunRow[]>([]);
  const [appState, setAppState] = useState<AppStateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setError(null);
    const supabase = createClient();
    try {
      const [
        leaguesRes,
        fixturesRes,
        teamsRes,
        extRes,
        cronRes,
        stateRes,
      ] = await Promise.all([
        supabase.from("leagues").select("id, name, country, is_active, priority").order("priority", { ascending: true }),
        supabase.from("fixtures").select("league_id, status, provider"),
        supabase.from("teams").select("id", { count: "exact", head: true }),
        supabase.from("league_external_ids").select("provider, league_id"),
        supabase.from("cron_runs").select("job_name, status, started_at, completed_at").order("started_at", { ascending: false }).limit(300),
        supabase.from("app_state").select("key, updated_at").order("updated_at", { ascending: false }).limit(50),
      ]);

      const failed = [leaguesRes, fixturesRes, teamsRes, extRes, cronRes, stateRes].find((r) => r.error);
      if (failed?.error) {
        setError(`Failed to load data: ${failed.error.message}`);
      } else {
        setLeagues((leaguesRes.data as LeagueRow[]) || []);
        setFixtures((fixturesRes.data as FixtureRow[]) || []);
        setTeamsCount(teamsRes.count ?? 0);
        setExternalIds((extRes.data as { provider: string; league_id: string }[]) || []);
        setCronRuns((cronRes.data as CronRunRow[]) || []);
        setAppState((stateRes.data as AppStateRow[]) || []);
      }
    } catch (e) {
      setError("Failed to load football data overview.");
      console.error(e);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // ── Derived stats ──────────────────────────────────────────
  const statusCounts = fixtures.reduce<Record<string, number>>((acc, f) => {
    const s = f.status || "unknown";
    acc[s] = (acc[s] || 0) + 1;
    return acc;
  }, {});

  const providerCounts = fixtures.reduce<Record<string, number>>((acc, f) => {
    const p = f.provider || "unknown";
    acc[p] = (acc[p] || 0) + 1;
    return acc;
  }, {});

  const perLeague = new Map<string, { upcoming: number; finished: number; total: number }>();
  for (const f of fixtures) {
    if (!f.league_id) continue;
    const c = perLeague.get(f.league_id) || { upcoming: 0, finished: 0, total: 0 };
    c.total += 1;
    if (f.status === "finished") c.finished += 1;
    else if (UPCOMING_STATUSES.has(f.status || "")) c.upcoming += 1;
    perLeague.set(f.league_id, c);
  }

  const externalIdCounts = externalIds.reduce<Record<string, Set<string>>>((acc, e) => {
    if (!acc[e.provider]) acc[e.provider] = new Set();
    acc[e.provider].add(e.league_id);
    return acc;
  }, {});

  // Latest completed run per cron job
  const lastRunByJob = new Map<string, CronRunRow>();
  for (const run of cronRuns) {
    if (!lastRunByJob.has(run.job_name)) lastRunByJob.set(run.job_name, run);
  }

  const fmtTime = (iso: string | null | undefined) => {
    if (!iso) return "—";
    const d = new Date(iso);
    const diffMin = Math.round((Date.now() - d.getTime()) / 60000);
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffMin < 1440) return `${Math.round(diffMin / 60)}h ago`;
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  const statusVariant = (s: string): "success" | "danger" | "info" | "default" =>
    s === "finished" ? "success" : s === "live" || s === "halftime" ? "danger" : s === "scheduled" ? "info" : "default";

  return (
    <div>
      <PageHeader
        title="Football Data"
        description="Overview of leagues, fixtures, teams, providers, and sync activity."
        action={
          <button
            onClick={fetchData}
            className="px-[12px] py-[7px] rounded-[8px] text-[12px] font-semibold bg-gray-100 text-gray-600 hover:bg-gray-200 transition-all flex items-center gap-[6px]"
          >
            <i className="ri-refresh-line" /> Refresh
          </button>
        }
      />

      {error && (
        <div className="mb-[16px] flex items-center justify-between gap-[8px] bg-amber-50 border border-amber-200 rounded-[10px] p-[12px] text-[12px] text-amber-700">
          <span className="flex items-center gap-[6px]"><i className="ri-alert-line" /> {error}</span>
          <button onClick={fetchData} className="text-[11px] font-semibold underline hover:no-underline">Retry</button>
        </div>
      )}

      {loading ? (
        <div className="space-y-[12px]">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-[120px] bg-white rounded-[14px] animate-pulse" />
          ))}
        </div>
      ) : (
        <>
          {/* Top-level stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-[12px] mb-[24px]">
            <StatCard label="Leagues" value={String(leagues.length)} icon="ri-football-line" color="bg-blue-50 text-blue-600" />
            <StatCard label="Active Leagues" value={String(leagues.filter((l) => l.is_active).length)} icon="ri-checkbox-circle-line" color="bg-green-50 text-green-600" />
            <StatCard label="Teams" value={teamsCount === null ? "—" : teamsCount.toLocaleString()} icon="ri-team-line" color="bg-purple-50 text-purple-600" />
            <StatCard label="Fixtures" value={fixtures.length.toLocaleString()} icon="ri-calendar-event-line" color="bg-amber-50 text-amber-600" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-[16px] mb-[24px]">
            {/* Fixture status breakdown */}
            <Card>
              <CardHeader title="Fixtures by Status" description="All fixtures in the database" />
              <div className="p-[16px]">
                {Object.keys(statusCounts).length === 0 ? (
                  <p className="text-[13px] text-gray-400 py-[16px] text-center">No fixtures found.</p>
                ) : (
                  <div className="flex flex-wrap gap-[8px]">
                    {Object.entries(statusCounts)
                      .sort((a, b) => b[1] - a[1])
                      .map(([status, count]) => (
                        <div key={status} className="flex items-center gap-[8px] px-[12px] py-[8px] bg-gray-50 rounded-[10px]">
                          <Badge variant={statusVariant(status)} size="sm">{status}</Badge>
                          <span className="text-[14px] font-bold font-mono text-[#0A0F1C]">{count.toLocaleString()}</span>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            </Card>

            {/* Provider coverage */}
            <Card>
              <CardHeader title="Provider Coverage" description="Fixture counts by data provider" />
              <div className="p-[16px]">
                {Object.keys(providerCounts).length === 0 ? (
                  <p className="text-[13px] text-gray-400 py-[16px] text-center">No provider data.</p>
                ) : (
                  <div className="space-y-[8px]">
                    {Object.entries(providerCounts)
                      .sort((a, b) => b[1] - a[1])
                      .map(([provider, count]) => {
                        const pct = fixtures.length > 0 ? (count / fixtures.length) * 100 : 0;
                        return (
                          <div key={provider} className="flex items-center gap-[10px]">
                            <span className="text-[12px] font-semibold text-[#0A0F1C] w-[90px] flex-none truncate capitalize">{provider}</span>
                            <div className="flex-1 h-[6px] bg-gray-100 rounded-full overflow-hidden">
                              <div className="h-full bg-[#1B2A4A] rounded-full" style={{ width: `${Math.min(pct, 100)}%` }} />
                            </div>
                            <span className="text-[11px] font-mono text-gray-500 w-[90px] text-right flex-none">
                              {count.toLocaleString()} ({pct.toFixed(0)}%)
                            </span>
                          </div>
                        );
                      })}
                  </div>
                )}
                {Object.keys(externalIdCounts).length > 0 && (
                  <div className="mt-[16px] pt-[12px] border-t border-gray-100">
                    <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-[8px]">League ID mappings</p>
                    <div className="flex flex-wrap gap-[6px]">
                      {Object.entries(externalIdCounts).map(([provider, leagueSet]) => (
                        <span key={provider} className="text-[11px] px-[8px] py-[3px] rounded-full bg-gray-100 text-gray-600">
                          {provider}: {leagueSet.size} league{leagueSet.size !== 1 ? "s" : ""}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-[16px] mb-[24px]">
            {/* Leagues table */}
            <Card>
              <CardHeader title="Leagues" description="Fixture coverage per league" />
              <div className="overflow-x-auto">
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="border-b border-gray-100 text-left">
                      <th className="px-[16px] py-[8px] text-[10px] font-semibold text-gray-400 uppercase tracking-wider">League</th>
                      <th className="px-[8px] py-[8px] text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Country</th>
                      <th className="px-[8px] py-[8px] text-[10px] font-semibold text-gray-400 uppercase tracking-wider text-right">Upcoming</th>
                      <th className="px-[8px] py-[8px] text-[10px] font-semibold text-gray-400 uppercase tracking-wider text-right">Finished</th>
                      <th className="px-[16px] py-[8px] text-[10px] font-semibold text-gray-400 uppercase tracking-wider text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leagues.map((l) => {
                      const c = perLeague.get(l.id) || { upcoming: 0, finished: 0, total: 0 };
                      return (
                        <tr key={l.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50">
                          <td className="px-[16px] py-[8px] font-semibold text-[#0A0F1C]">{l.name}</td>
                          <td className="px-[8px] py-[8px] text-gray-500">{l.country || "—"}</td>
                          <td className="px-[8px] py-[8px] text-right font-mono">{c.upcoming}</td>
                          <td className="px-[8px] py-[8px] text-right font-mono">{c.finished}</td>
                          <td className="px-[16px] py-[8px] text-right">
                            <Badge variant={l.is_active ? "success" : "default"} size="sm">
                              {l.is_active ? "active" : "inactive"}
                            </Badge>
                          </td>
                        </tr>
                      );
                    })}
                    {leagues.length === 0 && (
                      <tr><td colSpan={5} className="px-[16px] py-[24px] text-center text-gray-400">No leagues found.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>

            {/* Sync / cron activity */}
            <Card>
              <CardHeader title="Sync Activity" description="Latest cron run per job" />
              <div className="p-[16px]">
                {lastRunByJob.size === 0 ? (
                  <EmptyState icon="ri-timer-line" title="No cron runs recorded" description="Cron job history will appear here once jobs execute." />
                ) : (
                  <div className="space-y-[6px] max-h-[320px] overflow-y-auto">
                    {Array.from(lastRunByJob.entries())
                      .sort((a, b) => (b[1].started_at || "").localeCompare(a[1].started_at || ""))
                      .map(([job, run]) => (
                        <div key={job} className="flex items-center justify-between p-[10px] bg-gray-50 rounded-[8px]">
                          <div className="flex items-center gap-[8px] min-w-0">
                            <Badge
                              variant={run.status === "SUCCESS" ? "success" : run.status === "FAILED" ? "danger" : run.status === "RUNNING" ? "info" : "warning"}
                              size="sm"
                            >
                              {run.status}
                            </Badge>
                            <span className="text-[12px] font-semibold text-[#0A0F1C] truncate">{job}</span>
                          </div>
                          <span className="text-[11px] text-gray-400 flex-none ml-[8px]">{fmtTime(run.completed_at || run.started_at)}</span>
                        </div>
                      ))}
                  </div>
                )}
                {appState.length > 0 && (
                  <div className="mt-[16px] pt-[12px] border-t border-gray-100">
                    <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-[8px]">App state keys</p>
                    <div className="flex flex-wrap gap-[6px]">
                      {appState.slice(0, 12).map((s) => (
                        <span key={s.key} className="text-[10px] px-[8px] py-[3px] rounded-full bg-gray-100 text-gray-500 font-mono">
                          {s.key} · {fmtTime(s.updated_at)}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
