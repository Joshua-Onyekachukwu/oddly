"use client";

import React, { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";

export default function AdminAIMonitorPage() {
  const [cacheEntries, setCacheEntries] = useState(0);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    const supabase = createClient();
    const { count } = await supabase
      .from("ai_cache")
      .select("cache_key", { count: "exact", head: true });
    setCacheEntries(count || 0);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return (
    <div>
      <div className="mb-[24px]">
        <h1 className="font-display text-[24px] md:text-[28px] font-bold text-[#0A0F1C] mb-[4px]">
          AI Monitor
        </h1>
        <p className="text-[14px] text-gray-500">
          Track AI API usage, cache performance, and response quality.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-[12px] mb-[24px]">
        {[
          { label: "Cache Entries", value: loading ? "—" : cacheEntries.toString() },
          { label: "API Calls Today", value: "—" },
          { label: "Avg Response Time", value: "—" },
          { label: "Cache Hit Rate", value: "—" },
          { label: "Tokens Used", value: "—" },
          { label: "Error Rate", value: "—" },
        ].map((stat) => (
          <div key={stat.label} className="bg-white rounded-[14px] p-[16px] border border-gray-100">
            <span className="block text-[11px] text-gray-400 mb-[4px]">{stat.label}</span>
            <span className="text-[18px] font-mono-data font-bold text-[#0A0F1C]">{stat.value}</span>
          </div>
        ))}
      </div>

      <div className="text-center py-[48px] bg-white rounded-[16px] border border-gray-100">
        <p className="text-[13px] text-gray-400">
          AI monitoring will populate as the system processes requests.
        </p>
      </div>
    </div>
  );
}
