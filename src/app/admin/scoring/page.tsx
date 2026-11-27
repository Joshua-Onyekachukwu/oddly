"use client";

import React, { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { PageHeader, Card, CardHeader, EmptyState } from "@/components/ui";

interface ScoringConfig {
  id: string;
  config_key: string;
  config_value: any;
  updated_at: string;
}

export default function AdminScoringPage() {
  const [configs, setConfigs] = useState<ScoringConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const fetchConfigs = useCallback(async () => {
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { data, error: queryError } = await supabase
      .from("scoring_config")
      .select("*")
      .order("config_key");

    if (queryError) {
      setError(queryError.message);
    } else if (data) {
      setConfigs(data);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchConfigs();
  }, [fetchConfigs]);

  return (
    <div>
      <PageHeader
        title="Scoring Configuration"
        description="Adjust opportunity score weights, thresholds, and confidence tiers."
        action={
          <button
            onClick={fetchConfigs}
            aria-label="Refresh scoring configuration"
            className="flex items-center gap-[6px] px-[12px] py-[8px] rounded-[10px] border border-gray-200 text-[12px] font-semibold text-[#1B2A4A] hover:bg-gray-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B2A4A]/30"
          >
            <i className="ri-refresh-line" /> Refresh
          </button>
        }
      />

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-[14px] p-[16px] mb-[16px] flex items-center justify-between gap-[12px]">
          <div className="flex items-center gap-[8px]">
            <i className="ri-error-warning-line text-red-500" />
            <span className="text-[13px] font-medium text-red-700">{error}</span>
          </div>
          <button
            onClick={fetchConfigs}
            className="text-[12px] font-semibold text-red-600 hover:text-red-700 underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 rounded-[4px] px-[4px]"
          >
            Retry
          </button>
        </div>
      )}

      {loading ? (
        <div className="space-y-[6px]">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-[64px] bg-white rounded-[10px] animate-pulse" />
          ))}
        </div>
      ) : configs.length === 0 ? (
        <EmptyState
          icon="ri-settings-5-line"
          title="No scoring configuration found"
          description="Scoring configs will appear here once initialized."
        />
      ) : (
        <div className="space-y-[6px]">
          {configs.map((config) => {
            const isExpanded = expandedKey === config.config_key;
            const value = config.config_value;

            return (
              <Card key={config.config_key} padding="none" className="overflow-hidden">
                <button
                  onClick={() => setExpandedKey(isExpanded ? null : config.config_key)}
                  aria-expanded={isExpanded}
                  aria-label={`${isExpanded ? "Collapse" : "Expand"} ${config.config_key}`}
                  className="w-full flex items-center justify-between p-[16px] text-left hover:bg-gray-50/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#1B2A4A]/30"
                >
                  <div>
                    <span className="text-[13px] font-semibold text-[#0A0F1C] block">
                      {config.config_key.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase())}
                    </span>
                    <span className="text-[11px] text-gray-400">
                      Last updated: {new Date(config.updated_at).toLocaleString()}
                    </span>
                  </div>
                  <i
                    className={`ri-arrow-down-s-line text-[18px] text-gray-400 transition-transform duration-200 ${
                      isExpanded ? "rotate-180" : ""
                    }`}
                  />
                </button>

                {isExpanded && (
                  <div className="px-[16px] pb-[16px] border-t border-gray-50 pt-[12px]">
                    {typeof value === "object" ? (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-[6px]">
                        {Object.entries(value).map(([k, v]) => (
                          <div
                            key={k}
                            className="flex items-center justify-between p-[10px] bg-gray-50 rounded-[8px]"
                          >
                            <span className="text-[12px] text-gray-500">
                              {k.replace(/_/g, " ")}
                            </span>
                            <span className="text-[13px] font-mono-data font-medium text-[#0A0F1C]">
                              {typeof v === "number" ? v : String(v)}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="p-[10px] bg-gray-50 rounded-[8px]">
                        <span className="text-[13px] font-mono-data text-[#0A0F1C]">
                          {String(value)}
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
