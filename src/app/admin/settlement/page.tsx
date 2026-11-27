"use client";

import React, { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { PageHeader, Card, CardHeader, Badge, StatCard, EmptyState } from "@/components/ui";

interface SettlementEvent {
  id: string;
  fixture_id: string | null;
  prediction_id: string | null;
  market: string | null;
  selection: string | null;
  previous_result: string | null;
  new_result: string;
  settled_at: string;
  source: string;
  notes: string | null;
}

export default function AdminSettlementPage() {
  const [events, setEvents] = useState<SettlementEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchEvents = useCallback(async () => {
    setError(null);
    const supabase = createClient();
    const { data, error: fetchError } = await supabase
      .from("settlement_events")
      .select("id, fixture_id, prediction_id, market, selection, previous_result, new_result, settled_at, source, notes")
      .order("settled_at", { ascending: false })
      .limit(200);

    if (fetchError) {
      setError(fetchError.message);
    } else {
      setEvents((data as SettlementEvent[]) || []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  const corrections = events.filter(
    (e) => e.previous_result && e.previous_result !== e.new_result
  );
  const correct = events.filter((e) => e.new_result === "correct").length;
  const wrong = events.filter((e) => e.new_result === "wrong").length;
  const voided = events.filter((e) => e.new_result === "void" || e.new_result === "cancelled").length;

  const bySource = events.reduce<Record<string, number>>((acc, e) => {
    acc[e.source || "unknown"] = (acc[e.source || "unknown"] || 0) + 1;
    return acc;
  }, {});

  const byMarket = events.reduce<Record<string, { total: number; correct: number }>>((acc, e) => {
    const m = e.market || "unknown";
    if (!acc[m]) acc[m] = { total: 0, correct: 0 };
    acc[m].total += 1;
    if (e.new_result === "correct") acc[m].correct += 1;
    return acc;
  }, {});

  const resultVariant = (r: string) =>
    r === "correct" ? "success" : r === "wrong" ? "danger" : "default";

  return (
    <div>
      <PageHeader
        title="Settlement Audit"
        description="Append-only settlement_events trail — every prediction settlement and correction."
        action={
          <button
            onClick={fetchEvents}
            className="px-[12px] py-[7px] rounded-[8px] text-[12px] font-semibold bg-gray-100 text-gray-600 hover:bg-gray-200 transition-all flex items-center gap-[6px]"
          >
            <i className="ri-refresh-line" /> Refresh
          </button>
        }
      />

      {error && (
        <div className="mb-[16px] flex items-center justify-between gap-[8px] bg-amber-50 border border-amber-200 rounded-[10px] p-[12px] text-[12px] text-amber-700">
          <span className="flex items-center gap-[6px]"><i className="ri-alert-line" /> {error}</span>
          <button onClick={fetchEvents} className="text-[11px] font-semibold underline hover:no-underline">Retry</button>
        </div>
      )}

      {loading ? (
        <div className="space-y-[12px]">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-[100px] bg-white rounded-[14px] animate-pulse" />
          ))}
        </div>
      ) : events.length === 0 ? (
        <EmptyState
          icon="ri-checkbox-circle-line"
          title="No settlement events"
          description="Settlement audit rows are written by the settle cron and prediction tracking."
        />
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-[12px] mb-[24px]">
            <StatCard label="Events (last 200)" value={events.length.toLocaleString()} icon="ri-file-list-3-line" color="bg-blue-50 text-blue-600" />
            <StatCard label="Correct" value={correct.toLocaleString()} icon="ri-check-line" color="bg-green-50 text-green-600" />
            <StatCard label="Wrong" value={wrong.toLocaleString()} icon="ri-close-line" color="bg-red-50 text-red-500" />
            <StatCard
              label="Corrections"
              value={corrections.length.toLocaleString()}
              icon="ri-exchange-line"
              color={corrections.length > 0 ? "bg-amber-50 text-amber-600" : "bg-gray-50 text-gray-600"}
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-[16px] mb-[24px]">
            {/* Market breakdown */}
            <Card>
              <CardHeader title="Accuracy by Market" description="From settlement_events.new_result" />
              <div className="p-[16px] space-y-[8px]">
                {Object.entries(byMarket)
                  .sort((a, b) => b[1].total - a[1].total)
                  .map(([market, s]) => {
                    const acc = s.total > 0 ? (s.correct / s.total) * 100 : 0;
                    return (
                      <div key={market} className="flex items-center gap-[10px]">
                        <span className="text-[12px] font-semibold text-[#0A0F1C] capitalize w-[110px] flex-none truncate">
                          {market.replace(/_/g, " ")}
                        </span>
                        <div className="flex-1 h-[6px] bg-gray-100 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${acc >= 60 ? "bg-green-500" : acc >= 45 ? "bg-amber-500" : "bg-red-500"}`}
                            style={{ width: `${Math.min(acc, 100)}%` }}
                          />
                        </div>
                        <span className="text-[11px] font-mono text-gray-500 w-[80px] text-right flex-none">
                          {s.correct}/{s.total} · {acc.toFixed(0)}%
                        </span>
                      </div>
                    );
                  })}
              </div>
            </Card>

            {/* Source breakdown */}
            <Card>
              <CardHeader title="Events by Source" description="Which pipeline wrote the settlement" />
              <div className="p-[16px]">
                <div className="flex flex-wrap gap-[8px]">
                  {Object.entries(bySource)
                    .sort((a, b) => b[1] - a[1])
                    .map(([source, count]) => (
                      <span key={source} className="text-[11px] px-[10px] py-[5px] rounded-full bg-gray-100 text-gray-600 font-medium">
                        {source}: <span className="font-bold font-mono">{count}</span>
                      </span>
                    ))}
                </div>
                {voided > 0 && (
                  <p className="text-[11px] text-gray-400 mt-[12px]">
                    {voided} event{voided !== 1 ? "s" : ""} voided/cancelled.
                  </p>
                )}
              </div>
            </Card>
          </div>

          {/* Corrections highlight */}
          {corrections.length > 0 && (
            <Card className="mb-[24px]">
              <CardHeader title="Recent Corrections" description="Settlements where the result changed after initial settlement" />
              <div className="divide-y divide-gray-50">
                {corrections.slice(0, 10).map((e) => (
                  <div key={e.id} className="px-[16px] py-[10px] flex items-center justify-between gap-[12px]">
                    <div className="min-w-0">
                      <span className="text-[12px] font-semibold text-[#0A0F1C] capitalize">
                        {(e.market || "unknown").replace(/_/g, " ")}
                        {e.selection ? ` · ${e.selection}` : ""}
                      </span>
                      <span className="block text-[10px] text-gray-400 font-mono truncate">
                        fixture {e.fixture_id?.slice(0, 8)}… · {e.source}
                      </span>
                    </div>
                    <div className="flex items-center gap-[6px] flex-none">
                      <Badge variant="danger" size="sm">{e.previous_result}</Badge>
                      <i className="ri-arrow-right-line text-[12px] text-gray-400" />
                      <Badge variant={resultVariant(e.new_result)} size="sm">{e.new_result}</Badge>
                      <span className="text-[10px] text-gray-400 ml-[6px]">
                        {new Date(e.settled_at).toLocaleString()}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Full event feed */}
          <Card>
            <CardHeader title="Settlement Events" description="Latest 200 events, newest first" />
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="border-b border-gray-100 text-left">
                    <th className="px-[16px] py-[8px] text-[10px] font-semibold text-gray-400 uppercase">Settled At</th>
                    <th className="px-[8px] py-[8px] text-[10px] font-semibold text-gray-400 uppercase">Market</th>
                    <th className="px-[8px] py-[8px] text-[10px] font-semibold text-gray-400 uppercase">Selection</th>
                    <th className="px-[8px] py-[8px] text-[10px] font-semibold text-gray-400 uppercase">Result</th>
                    <th className="px-[8px] py-[8px] text-[10px] font-semibold text-gray-400 uppercase">Source</th>
                    <th className="px-[16px] py-[8px] text-[10px] font-semibold text-gray-400 uppercase">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((e) => (
                    <tr key={e.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50">
                      <td className="px-[16px] py-[8px] font-mono text-[11px] text-gray-500 whitespace-nowrap">
                        {new Date(e.settled_at).toLocaleString()}
                      </td>
                      <td className="px-[8px] py-[8px] font-semibold text-[#0A0F1C] capitalize">
                        {(e.market || "—").replace(/_/g, " ")}
                      </td>
                      <td className="px-[8px] py-[8px] text-gray-600">{e.selection || "—"}</td>
                      <td className="px-[8px] py-[8px]">
                        <div className="flex items-center gap-[4px]">
                          {e.previous_result && e.previous_result !== e.new_result && (
                            <>
                              <Badge variant="danger" size="sm">{e.previous_result}</Badge>
                              <i className="ri-arrow-right-line text-[10px] text-gray-300" />
                            </>
                          )}
                          <Badge variant={resultVariant(e.new_result)} size="sm">{e.new_result}</Badge>
                        </div>
                      </td>
                      <td className="px-[8px] py-[8px] text-[11px] text-gray-500">{e.source}</td>
                      <td className="px-[16px] py-[8px] text-[11px] text-gray-400 max-w-[220px] truncate">{e.notes || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
