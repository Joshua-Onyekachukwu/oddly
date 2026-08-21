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
  odds: number;
  model_probability: number;
  edge: number;
}

interface SavedAccumulator {
  id: string;
  name: string;
  selections: AccumulatorLeg[];
  combined_odds: number;
  estimated_probability: number;
  strategy: string;
  stake: number;
  status: string;
  potential_return: number | null;
  created_at: string;
}

export default function MyAccumulatorsPage() {
  const { user } = useAuth();
  const [accumulators, setAccumulators] = useState<SavedAccumulator[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);

  const fetchAccumulators = useCallback(async () => {
    if (!user) return;
    const supabase = createClient();
    const { data, error } = await supabase
      .from("accumulators")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (!error && data) {
      setAccumulators(data as any);
    }
    setLoading(false);
  }, [user]);

  useEffect(() => {
    fetchAccumulators();
  }, [fetchAccumulators]);

  const handleDelete = async (id: string) => {
    setDeleting(id);
    const supabase = createClient();
    await supabase.from("accumulators").delete().eq("id", id);
    setAccumulators((prev) => prev.filter((a) => a.id !== id));
    setDeleting(null);
  };

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

      {loading ? (
        <div className="space-y-[6px]">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-[80px] bg-gray-50 rounded-[10px] animate-pulse" />
          ))}
        </div>
      ) : accumulators.length === 0 ? (
        <EmptyState
          icon="ri-stack-line"
          title="No accumulators yet"
          description="Build your first accumulator by combining value bets for higher returns."
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
                            {acc.name}
                          </span>
                          <Badge variant="default" size="sm">
                            {acc.selections.length} legs
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
                            {acc.strategy}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-[12px] text-[11px] text-gray-400">
                          <span className="font-mono-data">
                            @{acc.combined_odds.toFixed(2)}
                          </span>
                          <span>·</span>
                          <span className="font-mono-data">
                            ${(acc.stake * acc.combined_odds).toFixed(2)} potential
                          </span>
                          <span>·</span>
                          <span>${acc.stake} stake</span>
                        </div>
                      </div>
                      <button
                        onClick={() => handleDelete(acc.id)}
                        disabled={deleting === acc.id}
                        className="text-gray-300 hover:text-red-500 transition-colors p-[8px] ml-[12px]"
                        title="Delete accumulator"
                      >
                        <i className="ri-delete-bin-line text-[14px]" />
                      </button>
                    </div>

                    {/* Selections */}
                    <div className="mt-[10px] space-y-[3px]">
                      {acc.selections.map((sel, idx) => (
                        <div
                          key={idx}
                          className="flex items-center gap-[8px] text-[11px] bg-gray-50 rounded-[6px] px-[8px] py-[4px]"
                        >
                          <span className="text-gray-400 font-mono-data w-[16px]">
                            {idx + 1}.
                          </span>
                          <span className="font-medium text-[#0A0F1C] truncate flex-1">
                            {sel.selection}
                          </span>
                          <span className="text-gray-400 font-mono-data">
                            @{sel.odds.toFixed(2)}
                          </span>
                          <span className="text-green-600 font-mono-data font-medium">
                            +{(sel.edge * 100).toFixed(1)}%
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
                            {acc.name}
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
                          {acc.selections.length} legs · @{acc.combined_odds.toFixed(2)} ·{" "}
                          {new Date(acc.created_at).toLocaleDateString()}
                        </span>
                      </div>
                      <button
                        onClick={() => handleDelete(acc.id)}
                        disabled={deleting === acc.id}
                        className="text-gray-300 hover:text-red-500 transition-colors p-[8px]"
                      >
                        <i className="ri-delete-bin-line text-[14px]" />
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
