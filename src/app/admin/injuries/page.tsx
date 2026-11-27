"use client";

import { useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

interface InjurySummary {
  affected_teams: number;
  total_injured: number;
  total_suspended: number;
  total_doubtful: number;
  total_out: number;
  last_successful_collection: string | null;
  last_failed_collection: string | null;
  snapshots_last_24h: number;
}

interface TeamInjury {
  team_name: string;
  total_injuries: number;
  injured_count: number;
  suspended_count: number;
  doubtful_count: number;
  impact_injuries: number;
  muscle_injuries: number;
  injury_impact_score: number;
  last_updated: string;
}

interface FixtureInjury {
  fixture_id: string;
  kickoff_time: string;
  home_team_name: string;
  away_team_name: string;
  league_name: string;
  home_unavailable: number;
  away_unavailable: number;
  home_availability: number;
  away_availability: number;
  home_injury_impact: number;
  away_injury_impact: number;
}

interface DataFreshness {
  team_name: string;
  last_updated: string;
  hours_since_update: number;
  freshness_status: string;
}

interface CollectionLog {
  id: string;
  source: string;
  started_at: string;
  completed_at: string | null;
  status: string;
  records_found: number;
  records_inserted: number;
  records_updated: number;
  records_rejected: number;
  error_message: string | null;
}

export default function InjuriesPage() {
  const [summary, setSummary] = useState<InjurySummary | null>(null);
  const [teamInjuries, setTeamInjuries] = useState<TeamInjury[]>([]);
  const [fixtureInjuries, setFixtureInjuries] = useState<FixtureInjury[]>([]);
  const [dataFreshness, setDataFreshness] = useState<DataFreshness[]>([]);
  const [collectionLogs, setCollectionLogs] = useState<CollectionLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"summary" | "fixtures" | "teams" | "quality">("summary");
  const [selectedTeam, setSelectedTeam] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    setError(null);

    try {
      // Load summary
      const { data: summaryData, error: summaryError } = await supabase
        .from("injury_dashboard_summary" as any)
        .select("*")
        .single();

      if (summaryError) throw summaryError;
      if (summaryData) {
        setSummary(summaryData);
      }

      // Load team injuries
      const { data: teamData, error: teamError } = await supabase
        .from("team_injury_summary_v2" as any)
        .select("*")
        .order("injury_impact_score", { ascending: false });

      if (teamError) throw teamError;
      if (teamData) {
        setTeamInjuries(teamData);
      }

      // Load fixture injuries
      const { data: fixtureData, error: fixtureError } = await supabase
        .from("fixture_injury_overview" as any)
        .select("*")
        .order("kickoff_time", { ascending: true })
        .limit(20);

      if (fixtureError) throw fixtureError;
      if (fixtureData) {
        setFixtureInjuries(fixtureData);
      }

      // Load data freshness
      const { data: freshnessData } = await supabase
        .rpc("check_injury_data_freshness");
      
      if (freshnessData) {
        setDataFreshness(freshnessData);
      }

      // Load collection logs
      const { data: logData, error: logError } = await supabase
        .from("injury_collection_log" as any)
        .select("*")
        .order("created_at", { ascending: false })
        .limit(10);

      if (logError) throw logError;
      if (logData) {
        setCollectionLogs(logData);
      }
    } catch (err: any) {
      console.error("Error loading injury data:", err);
      setError(err?.message || "Failed to load injury data");
    } finally {
      setLoading(false);
    }
  }

  function formatDate(dateString: string | null) {
    if (!dateString) return "N/A";
    return new Date(dateString).toLocaleString();
  }

  function formatHours(hours: number) {
    if (hours < 1) return "< 1 hour";
    if (hours < 24) return `${Math.round(hours)} hours`;
    return `${Math.round(hours / 24)} days`;
  }

  function getFreshnessColor(status: string) {
    switch (status) {
      case "fresh": return "text-green-600 bg-green-50";
      case "stale": return "text-yellow-600 bg-yellow-50";
      case "very_stale": return "text-orange-600 bg-orange-50";
      case "missing": return "text-red-600 bg-red-50";
      default: return "text-gray-600 bg-gray-50";
    }
  }

  function getStatusColor(status: string) {
    switch (status) {
      case "success": return "text-green-600 bg-green-50";
      case "failed": return "text-red-600 bg-red-50";
      case "partial": return "text-yellow-600 bg-yellow-50";
      case "running": return "text-blue-600 bg-blue-50";
      default: return "text-gray-600 bg-gray-50";
    }
  }

  if (loading) {
    return (
      <div>
        <div className="animate-pulse">
          <div className="h-8 bg-gray-200 rounded w-1/4 mb-8"></div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-32 bg-gray-200 rounded"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8 flex items-start justify-between gap-[12px]">
          <div>
            <h1 className="font-display text-[22px] md:text-[26px] font-bold text-[#0A0F1C] mb-[4px]">
              Injury Intelligence
            </h1>
            <p className="text-[13px] text-gray-500">
              Real-time injury tracking, feature engineering, and data quality monitoring.
            </p>
          </div>
          <button
            onClick={loadData}
            aria-label="Refresh injury data"
            className="flex items-center gap-[6px] px-[12px] py-[8px] rounded-[10px] border border-gray-200 text-[12px] font-semibold text-[#1B2A4A] hover:bg-gray-50 transition-colors flex-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B2A4A]/30"
          >
            <i className="ri-refresh-line" /> Refresh
          </button>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-[14px] p-[16px] mb-[20px] flex items-center gap-[8px]">
            <i className="ri-error-warning-line text-red-500" />
            <span className="text-[13px] font-medium text-red-700">{error}</span>
          </div>
        )}

        {/* Summary Cards */}
        {summary && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
            <div className="bg-white rounded-lg shadow p-6">
              <div className="text-sm font-medium text-gray-500 mb-2">Affected Teams</div>
              <div className="text-3xl font-bold text-gray-900">{summary.affected_teams}</div>
            </div>
            <div className="bg-white rounded-lg shadow p-6">
              <div className="text-sm font-medium text-gray-500 mb-2">Total Injured</div>
              <div className="text-3xl font-bold text-red-600">{summary.total_injured}</div>
            </div>
            <div className="bg-white rounded-lg shadow p-6">
              <div className="text-sm font-medium text-gray-500 mb-2">Suspended</div>
              <div className="text-3xl font-bold text-orange-600">{summary.total_suspended}</div>
            </div>
            <div className="bg-white rounded-lg shadow p-6">
              <div className="text-sm font-medium text-gray-500 mb-2">Doubtful</div>
              <div className="text-3xl font-bold text-yellow-600">{summary.total_doubtful}</div>
            </div>
          </div>
        )}

        {/* Collection Status */}
        {summary && (
          <div className="bg-white rounded-lg shadow p-6 mb-8">
            <h2 className="text-lg font-semibold mb-4">Collection Status</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div>
                <div className="text-sm text-gray-500">Last Successful Collection</div>
                <div className="font-medium">{formatDate(summary.last_successful_collection)}</div>
              </div>
              <div>
                <div className="text-sm text-gray-500">Last Failed Collection</div>
                <div className="font-medium">{formatDate(summary.last_failed_collection)}</div>
              </div>
              <div>
                <div className="text-sm text-gray-500">Snapshots (24h)</div>
                <div className="font-medium">{summary.snapshots_last_24h}</div>
              </div>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="bg-white rounded-lg shadow mb-8">
          <div className="border-b border-gray-200">
            <nav className="flex -mb-px">
              {[
                { id: "summary", label: "Team Summary" },
                { id: "fixtures", label: "Fixture View" },
                { id: "teams", label: "Team Detail" },
                { id: "quality", label: "Data Quality" },
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as any)}
                  aria-pressed={activeTab === tab.id}
                  className={`px-6 py-3 text-sm font-medium border-b-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B2A4A]/30 ${
                    activeTab === tab.id
                      ? "border-blue-500 text-blue-600"
                      : "border-transparent text-gray-500 hover:text-gray-700"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </nav>
          </div>

          <div className="p-6">
            {/* Team Summary Tab */}
            {activeTab === "summary" && (
              <div>
                <h3 className="text-lg font-semibold mb-4">Teams with Active Absences</h3>
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead>
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Team</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Injured</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Suspended</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Doubtful</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Impact Score</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Last Updated</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {teamInjuries.length === 0 && (
                        <tr>
                          <td colSpan={6} className="px-4 py-8 text-center text-sm text-gray-400">
                            No teams with active absences in the last 30 days.
                          </td>
                        </tr>
                      )}
                      {teamInjuries.map((team) => (
                        <tr key={team.team_name} className="hover:bg-gray-50">
                          <td className="px-4 py-3 font-medium">{team.team_name}</td>
                          <td className="px-4 py-3 text-red-600">{team.injured_count}</td>
                          <td className="px-4 py-3 text-orange-600">{team.suspended_count}</td>
                          <td className="px-4 py-3 text-yellow-600">{team.doubtful_count}</td>
                          <td className="px-4 py-3">
                            <span className={`px-2 py-1 rounded text-sm ${
                              team.injury_impact_score > 5 ? "bg-red-100 text-red-800" :
                              team.injury_impact_score > 2 ? "bg-yellow-100 text-yellow-800" :
                              "bg-green-100 text-green-800"
                            }`}>
                              {team.injury_impact_score.toFixed(1)}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-500">{formatDate(team.last_updated)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Fixture View Tab */}
            {activeTab === "fixtures" && (
              <div>
                <h3 className="text-lg font-semibold mb-4">Upcoming Fixtures - Injury Impact</h3>
                {fixtureInjuries.length === 0 ? (
                  <div className="text-center py-[32px] text-gray-400 text-[13px]">
                    No upcoming scheduled fixtures found.
                  </div>
                ) : (
                <div className="space-y-4">
                  {fixtureInjuries.map((fixture) => (
                    <div key={fixture.fixture_id} className="border rounded-lg p-4">
                      <div className="flex justify-between items-start mb-4">
                        <div>
                          <div className="text-sm text-gray-500">{fixture.league_name}</div>
                          <div className="text-lg font-semibold">
                            {fixture.home_team_name} vs {fixture.away_team_name}
                          </div>
                          <div className="text-sm text-gray-500">{formatDate(fixture.kickoff_time)}</div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm text-gray-500">Injury Difference</div>
                          <div className={`text-lg font-bold ${
                            fixture.home_injury_impact > fixture.away_injury_impact ? "text-red-600" :
                            fixture.home_injury_impact < fixture.away_injury_impact ? "text-green-600" :
                            "text-gray-600"
                          }`}>
                            {(fixture.home_injury_impact - fixture.away_injury_impact).toFixed(1)}
                          </div>
                        </div>
                      </div>
                      
                      <div className="grid grid-cols-2 gap-4">
                        <div className="bg-blue-50 rounded p-3">
                          <div className="text-sm font-medium text-blue-800 mb-2">{fixture.home_team_name}</div>
                          <div className="grid grid-cols-2 gap-2 text-sm">
                            <div>
                              <span className="text-gray-500">Unavailable:</span>
                              <span className="ml-2 font-medium">{fixture.home_unavailable}</span>
                            </div>
                            <div>
                              <span className="text-gray-500">Availability:</span>
                              <span className="ml-2 font-medium">{fixture.home_availability.toFixed(0)}%</span>
                            </div>
                          </div>
                        </div>
                        
                        <div className="bg-red-50 rounded p-3">
                          <div className="text-sm font-medium text-red-800 mb-2">{fixture.away_team_name}</div>
                          <div className="grid grid-cols-2 gap-2 text-sm">
                            <div>
                              <span className="text-gray-500">Unavailable:</span>
                              <span className="ml-2 font-medium">{fixture.away_unavailable}</span>
                            </div>
                            <div>
                              <span className="text-gray-500">Availability:</span>
                              <span className="ml-2 font-medium">{fixture.away_availability.toFixed(0)}%</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                )}
              </div>
            )}

            {/* Team Detail Tab */}
            {activeTab === "teams" && (
              <div>
                <h3 className="text-lg font-semibold mb-4">Team Detail View</h3>
                <div className="mb-4">
                  <label htmlFor="injury-team-select" className="sr-only">
                    Select a team
                  </label>
                  <select
                    id="injury-team-select"
                    value={selectedTeam || ""}
                    onChange={(e) => setSelectedTeam(e.target.value || null)}
                    className="border rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-[#1B2A4A]/30"
                  >
                    <option value="">Select a team...</option>
                    {teamInjuries.length === 0 && (
                      <option value="" disabled>No teams with absences</option>
                    )}
                    {teamInjuries.map((team) => (
                      <option key={team.team_name} value={team.team_name}>
                        {team.team_name} ({team.total_injuries} absences)
                      </option>
                    ))}
                  </select>
                </div>
                
                {selectedTeam && (
                  <div className="border rounded-lg p-4">
                    <h4 className="font-semibold mb-4">{selectedTeam}</h4>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div className="bg-red-50 rounded p-3">
                        <div className="text-sm text-gray-500">Injured</div>
                        <div className="text-2xl font-bold text-red-600">
                          {teamInjuries.find(t => t.team_name === selectedTeam)?.injured_count || 0}
                        </div>
                      </div>
                      <div className="bg-orange-50 rounded p-3">
                        <div className="text-sm text-gray-500">Suspended</div>
                        <div className="text-2xl font-bold text-orange-600">
                          {teamInjuries.find(t => t.team_name === selectedTeam)?.suspended_count || 0}
                        </div>
                      </div>
                      <div className="bg-yellow-50 rounded p-3">
                        <div className="text-sm text-gray-500">Doubtful</div>
                        <div className="text-2xl font-bold text-yellow-600">
                          {teamInjuries.find(t => t.team_name === selectedTeam)?.doubtful_count || 0}
                        </div>
                      </div>
                      <div className="bg-purple-50 rounded p-3">
                        <div className="text-sm text-gray-500">Impact Score</div>
                        <div className="text-2xl font-bold text-purple-600">
                          {teamInjuries.find(t => t.team_name === selectedTeam)?.injury_impact_score != null
                            ? teamInjuries.find(t => t.team_name === selectedTeam)!.injury_impact_score.toFixed(1)
                            : "0.0"}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Data Quality Tab */}
            {activeTab === "quality" && (
              <div>
                <h3 className="text-lg font-semibold mb-4">Data Quality Monitoring</h3>
                
                {/* Data Freshness */}
                <div className="mb-8">
                  <h4 className="font-medium mb-3">Data Freshness by Team</h4>
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead>
                        <tr>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Team</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Last Updated</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Hours Since</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200">
                        {dataFreshness.length === 0 && (
                          <tr>
                            <td colSpan={4} className="px-4 py-8 text-center text-sm text-gray-400">
                              No freshness data available.
                            </td>
                          </tr>
                        )}
                        {dataFreshness.slice(0, 20).map((item) => (
                          <tr key={item.team_name} className="hover:bg-gray-50">
                            <td className="px-4 py-3 font-medium">{item.team_name}</td>
                            <td className="px-4 py-3 text-sm">{formatDate(item.last_updated)}</td>
                            <td className="px-4 py-3 text-sm">{formatHours(item.hours_since_update)}</td>
                            <td className="px-4 py-3">
                              <span className={`px-2 py-1 rounded text-xs font-medium ${getFreshnessColor(item.freshness_status)}`}>
                                {item.freshness_status}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Collection Logs */}
                <div>
                  <h4 className="font-medium mb-3">Recent Collection Logs</h4>
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead>
                        <tr>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Source</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Started</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Found</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Inserted</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Updated</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Rejected</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Error</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200">
                        {collectionLogs.length === 0 && (
                          <tr>
                            <td colSpan={8} className="px-4 py-8 text-center text-sm text-gray-400">
                              No collection runs recorded yet.
                            </td>
                          </tr>
                        )}
                        {collectionLogs.map((log) => (
                          <tr key={log.id} className="hover:bg-gray-50">
                            <td className="px-4 py-3 font-medium">{log.source}</td>
                            <td className="px-4 py-3 text-sm">{formatDate(log.started_at)}</td>
                            <td className="px-4 py-3">
                              <span className={`px-2 py-1 rounded text-xs font-medium ${getStatusColor(log.status)}`}>
                                {log.status}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-sm">{log.records_found}</td>
                            <td className="px-4 py-3 text-sm text-green-600">{log.records_inserted}</td>
                            <td className="px-4 py-3 text-sm text-blue-600">{log.records_updated}</td>
                            <td className="px-4 py-3 text-sm text-red-600">{log.records_rejected}</td>
                            <td className="px-4 py-3 text-sm text-gray-500 max-w-xs truncate">{log.error_message}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
