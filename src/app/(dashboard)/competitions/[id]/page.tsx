"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PageHeader, EmptyState } from "@/components/ui";
import { computeStandings, hasStandingsCoverage, type StandingRow, type FormResult } from "@/lib/football/standings";

interface League {
  id: string;
  name: string;
  country: string | null;
  logo: string | null;
  country_flag: string | null;
  is_active: boolean;
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

interface LeagueParams {
  league_name: string;
  overall_accuracy: number | null;
  home_win_accuracy: number | null;
  draw_accuracy: number | null;
  away_win_accuracy: number | null;
  avg_goals: number | null;
  home_win_pct: number | null;
  draw_pct: number | null;
  avg_yellow: number | null;
  avg_corners: number | null;
  home_advantage: number | null;
  goal_expectancy: number | null;
  data_points: number | null;
  last_trained: string | null;
}

interface ModelPerf {
  total_predictions: number;
  correct_predictions: number;
  brier_score: number | null;
  market: string | null;
  period_start: string | null;
  period_end: string | null;
}

const PAGE = 1000;
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
    <span className={`inline-flex items-center justify-center w-[18px] h-[18px] rounded-[4px] text-[9px] font-bold ${cls}`}>
      {result}
    </span>
  );
}

function FixtureLine({ f }: { f: FixtureRow }) {
  const home = f.home_team?.canonical_name || "TBD";
  const away = f.away_team?.canonical_name || "TBD";
  const finished = f.status === "finished";
  return (
    <Link
      href={`/matches/${f.id}`}
      className="flex items-center gap-[8px] px-[12px] py-[8px] rounded-[8px] hover:bg-gray-50 transition-colors"
    >
      <span className="w-[86px] flex-none text-[10px] text-gray-400 font-mono-data">
        {new Date(f.kickoff_time).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
      </span>
      <span className="flex-1 min-w-0 flex items-center gap-[6px]">
        {f.home_team?.logo && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={f.home_team.logo} alt="" className="w-[16px] h-[16px] object-contain flex-none" />
        )}
        <span className="text-[12px] font-medium text-[#0A0F1C] truncate">{home}</span>
      </span>
      <span className="flex-none text-[12px] font-mono-data font-bold text-[#0A0F1C] w-[44px] text-center">
        {finished && f.home_score != null && f.away_score != null
          ? `${f.home_score} – ${f.away_score}`
          : "vs"}
      </span>
      <span className="flex-1 min-w-0 flex items-center justify-end gap-[6px]">
        <span className="text-[12px] font-medium text-[#0A0F1C] truncate">{away}</span>
        {f.away_team?.logo && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={f.away_team.logo} alt="" className="w-[16px] h-[16px] object-contain flex-none" />
        )}
      </span>
    </Link>
  );
}

export default function CompetitionDetailPage() {
  const params = useParams<{ id: string }>();
  const leagueId = params?.id;

  const [league, setLeague] = useState<League | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [standings, setStandings] = useState<StandingRow[]>([]);
  const [coverageOk, setCoverageOk] = useState(false);
  const [finishedCount, setFinishedCount] = useState(0);
  const [upcoming, setUpcoming] = useState<FixtureRow[]>([]);
  const [recent, setRecent] = useState<FixtureRow[]>([]);
  const [params_row, setParamsRow] = useState<LeagueParams | null>(null);
  const [modelPerf, setModelPerf] = useState<ModelPerf[]>([]);

  const fetchData = useCallback(async () => {
    if (!leagueId) return;
    setLoading(true);
    setError(null);
    try {
      const supabase = createClient();

      const { data: leagueRow, error: leagueErr } = await supabase
        .from("leagues")
        .select("id, name, country, logo, country_flag, is_active")
        .eq("id", leagueId)
        .maybeSingle();
      if (leagueErr) throw leagueErr;
      if (!leagueRow) {
        setError("This competition could not be found.");
        setLoading(false);
        return;
      }
      const lg = leagueRow as League;
      setLeague(lg);

      // Fetch all fixtures for the league (paginated — PostgREST caps ~1000).
      const all: FixtureRow[] = [];
      let from = 0;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { data, error: fxErr } = await supabase
          .from("fixtures")
          .select(FIXTURE_COLS)
          .eq("league_id", leagueId)
          .order("kickoff_time", { ascending: true })
          .range(from, from + PAGE - 1);
        if (fxErr) throw fxErr;
        const rows = (data || []) as unknown as FixtureRow[];
        all.push(...rows);
        if (rows.length < PAGE) break;
        from += PAGE;
        if (from > 20000) break; // safety valve
      }

      // Standings from finished fixtures (already ascending by kickoff).
      const standingsInput = all.map((f) => ({
        homeTeamId: f.home_team_id,
        awayTeamId: f.away_team_id,
        homeTeamName: f.home_team?.canonical_name,
        awayTeamName: f.away_team?.canonical_name,
        homeScore: f.home_score,
        awayScore: f.away_score,
        status: f.status,
      }));
      const result = computeStandings(standingsInput);
      setFinishedCount(result.matchesCounted);
      setCoverageOk(hasStandingsCoverage(result));
      setStandings(result.rows);

      const now = Date.now();
      const upcomingRows = all
        .filter((f) => ["scheduled", "live", "halftime"].includes(f.status) && new Date(f.kickoff_time).getTime() >= now)
        .slice(0, 12);
      setUpcoming(upcomingRows);

      const recentRows = all
        .filter((f) => f.status === "finished")
        .slice(-10)
        .reverse();
      setRecent(recentRows);

      // League model params — keyed by league name, not id.
      const [{ data: lp }, { data: mp }] = await Promise.all([
        supabase
          .from("league_model_params")
          .select(
            "league_name, overall_accuracy, home_win_accuracy, draw_accuracy, away_win_accuracy, avg_goals, home_win_pct, draw_pct, avg_yellow, avg_corners, home_advantage, goal_expectancy, data_points, last_trained"
          )
          .eq("league_name", lg.name)
          .maybeSingle(),
        supabase
          .from("model_performance")
          .select("total_predictions, correct_predictions, brier_score, market, period_start, period_end")
          .eq("league_id", leagueId)
          .order("period_end", { ascending: false })
          .limit(20),
      ]);

      setParamsRow((lp as LeagueParams) || null);
      setModelPerf((mp as ModelPerf[]) || []);
    } catch (err: any) {
      console.error("Failed to load competition:", err);
      setError("Unable to load this competition. The data service may be temporarily unavailable.");
    } finally {
      setLoading(false);
    }
  }, [leagueId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const perfSummary = useMemo(() => {
    if (modelPerf.length === 0) return null;
    const total = modelPerf.reduce((s, p) => s + (p.total_predictions || 0), 0);
    const correct = modelPerf.reduce((s, p) => s + (p.correct_predictions || 0), 0);
    const briers = modelPerf.filter((p) => p.brier_score != null).map((p) => p.brier_score!);
    const avgBrier = briers.length ? briers.reduce((a, b) => a + b, 0) / briers.length : null;
    return { total, accuracy: total ? (correct / total) * 100 : null, avgBrier };
  }, [modelPerf]);

  if (loading) {
    return (
      <div>
        <PageHeader title="Competition" breadcrumbs={[{ label: "Competitions", href: "/competitions" }]} />
        <div className="space-y-[12px]">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="bg-white rounded-[14px] border border-gray-100 p-[16px] animate-pulse h-[56px]" />
          ))}
        </div>
      </div>
    );
  }

  if (error || !league) {
    return (
      <div>
        <PageHeader title="Competition" breadcrumbs={[{ label: "Competitions", href: "/competitions" }]} />
        <EmptyState
          icon="ri-error-warning-line"
          title="Competition unavailable"
          description={error || "This competition could not be found."}
          action={
            <Link href="/competitions" className="text-[12px] font-semibold text-[#1B2A4A] hover:underline">
              Back to competitions
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title={league.name}
        description={`${league.country || "—"}${league.is_active ? "" : " · inactive"}`}
        breadcrumbs={[{ label: "Competitions", href: "/competitions" }, { label: league.name }]}
        action={
          league.logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={league.logo} alt={league.name} className="w-[44px] h-[44px] object-contain" />
          ) : undefined
        }
      />

      {/* Standings */}
      <section className="bg-white rounded-[14px] border border-gray-100 mb-[20px] overflow-hidden">
        <div className="px-[16px] py-[12px] border-b border-gray-50 flex items-center justify-between">
          <h2 className="text-[13px] font-semibold text-[#0A0F1C]">Standings</h2>
          <span className="text-[10px] text-gray-400">
            derived from {finishedCount} finished fixtures
          </span>
        </div>
        {coverageOk ? (
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-gray-400 border-b border-gray-50">
                  <th className="px-[16px] py-[8px] font-semibold">#</th>
                  <th className="py-[8px] font-semibold">Team</th>
                  <th className="py-[8px] font-semibold text-center">P</th>
                  <th className="py-[8px] font-semibold text-center">W</th>
                  <th className="py-[8px] font-semibold text-center">D</th>
                  <th className="py-[8px] font-semibold text-center">L</th>
                  <th className="py-[8px] font-semibold text-center">GD</th>
                  <th className="py-[8px] font-semibold text-center">Pts</th>
                  <th className="px-[16px] py-[8px] font-semibold text-right">Form</th>
                </tr>
              </thead>
              <tbody>
                {standings.map((row, i) => (
                  <tr key={row.teamKey} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/60">
                    <td className="px-[16px] py-[8px] font-mono-data text-gray-400">{i + 1}</td>
                    <td className="py-[8px]">
                      <Link href={`/teams/${row.teamId || ""}`} className="font-medium text-[#0A0F1C] hover:text-[#1B2A4A]">
                        {row.teamName}
                      </Link>
                    </td>
                    <td className="py-[8px] text-center font-mono-data">{row.played}</td>
                    <td className="py-[8px] text-center font-mono-data">{row.won}</td>
                    <td className="py-[8px] text-center font-mono-data">{row.drawn}</td>
                    <td className="py-[8px] text-center font-mono-data">{row.lost}</td>
                    <td className="py-[8px] text-center font-mono-data">
                      {row.goalDiff > 0 ? `+${row.goalDiff}` : row.goalDiff}
                    </td>
                    <td className="py-[8px] text-center font-mono-data font-bold">{row.points}</td>
                    <td className="px-[16px] py-[8px]">
                      <div className="flex justify-end gap-[3px]">
                        {row.form.map((r, j) => (
                          <FormBadge key={j} result={r} />
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="px-[16px] py-[24px] text-[12px] text-gray-400">
            {finishedCount === 0
              ? "No finished fixtures recorded for this competition yet — standings will appear once results are settled."
              : `Only ${finishedCount} finished fixtures are on record — not enough coverage for a reliable table. Standings will appear as more results are settled.`}
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-[20px]">
        {/* Upcoming fixtures */}
        <section className="bg-white rounded-[14px] border border-gray-100">
          <div className="px-[16px] py-[12px] border-b border-gray-50">
            <h2 className="text-[13px] font-semibold text-[#0A0F1C]">Upcoming fixtures</h2>
          </div>
          {upcoming.length === 0 ? (
            <div className="px-[16px] py-[24px] text-[12px] text-gray-400">No upcoming fixtures scheduled.</div>
          ) : (
            <div className="py-[4px]">
              {upcoming.map((f) => (
                <FixtureLine key={f.id} f={f} />
              ))}
            </div>
          )}
        </section>

        {/* Recent results */}
        <section className="bg-white rounded-[14px] border border-gray-100">
          <div className="px-[16px] py-[12px] border-b border-gray-50">
            <h2 className="text-[13px] font-semibold text-[#0A0F1C]">Recent results</h2>
          </div>
          {recent.length === 0 ? (
            <div className="px-[16px] py-[24px] text-[12px] text-gray-400">No finished fixtures on record.</div>
          ) : (
            <div className="py-[4px]">
              {recent.map((f) => (
                <FixtureLine key={f.id} f={f} />
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Model parameters + performance */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-[20px] mt-[20px]">
        <section className="bg-white rounded-[14px] border border-gray-100">
          <div className="px-[16px] py-[12px] border-b border-gray-50">
            <h2 className="text-[13px] font-semibold text-[#0A0F1C]">Model parameters</h2>
          </div>
          {params_row ? (
            <div className="p-[16px] grid grid-cols-2 sm:grid-cols-3 gap-[12px]">
              {[
                ["Home advantage", params_row.home_advantage != null ? `${params_row.home_advantage}%` : "—"],
                ["Goal expectancy", params_row.goal_expectancy != null ? params_row.goal_expectancy.toFixed(2) : "—"],
                ["Avg goals", params_row.avg_goals != null ? params_row.avg_goals.toFixed(2) : "—"],
                ["Home win %", params_row.home_win_pct != null ? `${params_row.home_win_pct.toFixed(1)}%` : "—"],
                ["Draw %", params_row.draw_pct != null ? `${params_row.draw_pct.toFixed(1)}%` : "—"],
                ["Model accuracy", params_row.overall_accuracy != null ? `${params_row.overall_accuracy.toFixed(1)}%` : "—"],
                ["Avg corners", params_row.avg_corners != null ? params_row.avg_corners.toFixed(1) : "—"],
                ["Avg yellows", params_row.avg_yellow != null ? params_row.avg_yellow.toFixed(1) : "—"],
                ["Data points", params_row.data_points != null ? String(params_row.data_points) : "—"],
              ].map(([label, value]) => (
                <div key={label}>
                  <div className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">{label}</div>
                  <div className="text-[15px] font-mono-data font-bold text-[#0A0F1C]">{value}</div>
                </div>
              ))}
              {params_row.last_trained && (
                <div className="col-span-full text-[10px] text-gray-400">
                  Last trained {new Date(params_row.last_trained).toLocaleDateString()}
                </div>
              )}
            </div>
          ) : (
            <div className="px-[16px] py-[24px] text-[12px] text-gray-400">
              No trained model parameters on record for this league.
            </div>
          )}
        </section>

        <section className="bg-white rounded-[14px] border border-gray-100">
          <div className="px-[16px] py-[12px] border-b border-gray-50">
            <h2 className="text-[13px] font-semibold text-[#0A0F1C]">Prediction performance</h2>
          </div>
          {perfSummary && perfSummary.total > 0 ? (
            <div className="p-[16px]">
              <div className="grid grid-cols-3 gap-[12px] mb-[12px]">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">Predictions</div>
                  <div className="text-[18px] font-mono-data font-bold text-[#0A0F1C]">{perfSummary.total}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">Accuracy</div>
                  <div className="text-[18px] font-mono-data font-bold text-[#0A0F1C]">
                    {perfSummary.accuracy != null ? `${perfSummary.accuracy.toFixed(1)}%` : "—"}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">Avg Brier</div>
                  <div className="text-[18px] font-mono-data font-bold text-[#0A0F1C]">
                    {perfSummary.avgBrier != null ? perfSummary.avgBrier.toFixed(3) : "—"}
                  </div>
                </div>
              </div>
              <div className="space-y-[4px]">
                {modelPerf.slice(0, 6).map((p, i) => (
                  <div key={i} className="flex items-center justify-between text-[11px] text-gray-500">
                    <span className="capitalize">{(p.market || "overall").replace(/_/g, " ")}</span>
                    <span className="font-mono-data">
                      {p.total_predictions} preds
                      {p.correct_predictions != null && p.total_predictions
                        ? ` · ${((p.correct_predictions / p.total_predictions) * 100).toFixed(0)}%`
                        : ""}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="px-[16px] py-[24px] text-[12px] text-gray-400">
              No league-specific prediction performance recorded yet.
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
