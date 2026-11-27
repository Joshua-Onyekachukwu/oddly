"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useAuth } from "@/providers/AuthProvider";
import { createClient } from "@/lib/supabase/client";
import { PageHeader, Card, EmptyState, Button, Badge } from "@/components/ui";

interface AccumulatorLeg {
  recommendation_id: string;
  fixture_id: string;
  market: string;
  selection: string;
  match?: string | null;
  league?: string | null;
  kickoff_time?: string | null;
  odds: number;
  model_probability: number;
  edge: number;
}

interface SavedAccumulator {
  id: string;
  name: string | null;
  selections: AccumulatorLeg[];
  combined_odds: number | null;
  estimated_probability: number | null;
  strategy: string | null;
  stake: number | null;
  status: string;
  created_at: string;
}

export default function MyAccumulatorsPage() {
  const { user } = useAuth();
  const [accumulators, setAccumulators] = useState<SavedAccumulator[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState("");
  const [actionError, setActionError] = useState("");

  const fetchAccumulators = useCallback(async () => {
    if (!user) {
      setLoading(false);
      return;
    }
    setFetchError("");
    const supabase = createClient();
    const { data, error } = await supabase
      .from("accumulators")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (error) {
      setFetchError(error.message || "Failed to load accumulators.");
    } else if (data) {
      setAccumulators(data as unknown as SavedAccumulator[]);
    }
    setLoading(false);
  }, [user]);

  useEffect(() => {
    fetchAccumulators();
  }, [fetchAccumulators]);

  const handleDelete = async (id: string) => {
    setDeleting(id);
    setActionError("");
    const supabase = createClient();
    const { error } = await supabase.from("accumulators").delete().eq("id", id);
    if (error) {
      setActionError("Failed to delete accumulator. Please try again.");
    } else {
      setAccumulators((prev) => prev.filter((a) => a.id !== id));
    }
    setDeleting(null);
  };

  const legsOf = (acc: SavedAccumulator): AccumulatorLeg[] =>
    Array.isArray(acc.selections) ? acc.selections : [];

  const activeAccumulators = accumulators.filter((a) => a.status === "pending");
  const settledAccumulators = accumulators.filter((a) => a.status !== "pending");

  return (
    <div>
      <PageHeader
        title="My Accumulators"
        description="View and manage your saved accumulators."
        action={
          <Link href="/accumulator">
            <Button icon="ri-add-line" size="sm">
              Build New
            </Button>
          </Link>
        }
      />

      {fetchError && (
        <div
          className="mb-[16px] p-[12px] bg-red-50 border border-red-100 rounded-[10px] text-[12px] text-red-600 flex items-center gap-[8px]"
          role="alert"
        >
          <i className="ri-error-warning-line" />
          <span className="flex-1">{fetchError}</span>
          <button
            onClick={() => {
              setLoading(true);
              fetchAccumulators();
            }}
            className="font-medium text-red-700 hover:text-red-800 underline underline-offset-2"
          >
            Retry
          </button>
        </div>
      )}
      {actionError && (
        <div
          className="mb-[16px] p-[12px] bg-red-50 border border-red-100 rounded-[10px] text-[12px] text-red-600 flex items-center gap-[8px]"
          role="alert"
        >
          <i className="ri-error-warning-line" />
          {actionError}
        </div>
      )}

      {loading ? (
        <div className="space-y-[6px]">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-[80px] bg-gray-50 rounded-[10px] animate-pulse" />
          ))}
        </div>
      ) : accumulators.length === 0 ? (
        <EmptyState
          icon="ri-stack-line"
          title={fetchError ? "Couldn't load accumulators" : "No accumulators yet"}
          description={
            fetchError
              ? "Something went wrong fetching your accumulators. Try again in a moment."
              : "Build your first accumulator by combining value bets for higher returns."
          }
          action={
            <Link href="/accumulator">
              <Button size="sm">Build Accumulator</Button>
            </Link>
          }
        />
      ) : (
        <>
          {/* Active */}
          {activeAccumulators.length > 0 && (
            <div className="mb-[24px]">
              <h2 className="text-[12px] font-semibold text-gray-400 uppercase tracking-wider mb-[10px]">
                Active ({activeAccumulators.length})
              </h2>
              <div className="space-y-[6px]">
                {activeAccumulators.map((acc) => (
                  <Card key={acc.id} padding="sm">
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-[8px] mb-[2px]">
                          <span className="text-[13px] font-semibold text-[#0A0F1C] truncate">
                            {acc.name ?? "Unnamed accumulator"}
                          </span>
                          <Badge variant="default" size="sm">
                            {legsOf(acc).length} legs
                          </Badge>
                          <Badge
                            variant={
                              acc.strategy === "conservative"
                                ? "success"
                                : acc.strategy === "aggressive"
                                ? "danger"
                                : "default"
                            }
                            size="sm"
                          >
                            {acc.strategy ?? "custom"}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-[12px] text-[11px] text-gray-400">
                          <span className="font-mono-data">
                            @{(acc.combined_odds ?? 0).toFixed(2)}
                          </span>
                          <span>·</span>
                          <span className="font-mono-data">
                            ${((acc.stake ?? 0) * (acc.combined_odds ?? 0)).toFixed(2)} potential
                          </span>
                          <span>·</span>
                          <span>${acc.stake ?? 0} stake</span>
                          <span>·</span>
                          <span>{new Date(acc.created_at).toLocaleDateString()}</span>
                        </div>
                      </div>
                      <button
                        onClick={() => handleDelete(acc.id)}
                        disabled={deleting === acc.id}
                        aria-label={`Delete ${acc.name ?? "unnamed accumulator"}`}
                        className="text-gray-300 hover:text-red-500 transition-colors p-[8px] ml-[12px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/50 rounded disabled:opacity-40"
                      >
                        <i className={`ri-delete-bin-line text-[14px] ${deleting === acc.id ? "animate-pulse" : ""}`} />
                      </button>
                    </div>

                    {/* Selections */}
                    <div className="mt-[10px] space-y-[3px]">
                      {legsOf(acc).map((sel, idx) => (
                        <div
                          key={idx}
                          className="flex items-center gap-[8px] text-[11px] bg-gray-50 rounded-[6px] px-[8px] py-[4px]"
                        >
                          <span className="text-gray-400 font-mono-data w-[16px]">
                            {idx + 1}.
                          </span>
                          <span className="font-medium text-[#0A0F1C] truncate flex-1">
                            {sel.match || sel.selection}
                          </span>
                          <span className="text-gray-400 text-[10px] truncate max-w-[120px] hidden sm:inline">
                            {sel.market}
                          </span>
                          <span className="text-gray-400 font-mono-data">
                            @{(sel.odds ?? 0).toFixed(2)}
                          </span>
                          <span className="text-green-600 font-mono-data font-medium">
                            +{((sel.edge ?? 0) * 100).toFixed(1)}%
                          </span>
                        </div>
                      ))}
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {/* Settled */}
          {settledAccumulators.length > 0 && (
            <div>
              <h2 className="text-[12px] font-semibold text-gray-400 uppercase tracking-wider mb-[10px]">
                Settled ({settledAccumulators.length})
              </h2>
              <div className="space-y-[6px]">
                {settledAccumulators.map((acc) => (
                  <Card key={acc.id} padding="sm">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="flex items-center gap-[8px] mb-[2px]">
                          <span className="text-[13px] font-semibold text-[#0A0F1C]">
                            {acc.name ?? "Unnamed accumulator"}
                          </span>
                          <Badge
                            variant={
                              acc.status === "won"
                                ? "success"
                                : acc.status === "lost"
                                ? "danger"
                                : "default"
                            }
                            size="sm"
                          >
                            {acc.status.toUpperCase()}
                          </Badge>
                        </div>
                        <span className="text-[11px] text-gray-400">
                          {legsOf(acc).length} legs · @{(acc.combined_odds ?? 0).toFixed(2)} ·{" "}
                          {new Date(acc.created_at).toLocaleDateString()}
                        </span>
                      </div>
                      <button
                        onClick={() => handleDelete(acc.id)}
                        disabled={deleting === acc.id}
                        aria-label={`Delete ${acc.name ?? "unnamed accumulator"}`}
                        className="text-gray-300 hover:text-red-500 transition-colors p-[8px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/50 rounded disabled:opacity-40"
                      >
                        <i className={`ri-delete-bin-line text-[14px] ${deleting === acc.id ? "animate-pulse" : ""}`} />
                      </button>
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
