"use client";

import React, { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";

export default function AdminSettingsPage() {
  const [apiKeyCount, setApiKeyCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(false);
  }, []);

  return (
    <div>
      <div className="mb-[24px]">
        <h1 className="font-display text-[24px] md:text-[28px] font-bold text-[#0A0F1C] mb-[4px]">
          System Settings
        </h1>
        <p className="text-[14px] text-gray-500">
          Manage API keys, environment variables, and system configuration.
        </p>
      </div>

      {/* API Providers */}
      <div className="bg-white rounded-[16px] p-[20px] border border-gray-100 mb-[16px]">
        <h3 className="font-display text-[15px] font-semibold text-[#0A0F1C] mb-[12px]">
          API Providers
        </h3>
        <div className="space-y-[8px]">
          {[
            { name: "The Odds API", status: "configured", desc: "Live odds from 100+ bookmakers" },
            { name: "API-Football", status: "configured", desc: "Fixture data and live scores" },
            { name: "APISports", status: "configured", desc: "Football data and statistics" },
            { name: "NVIDIA NIM", status: "configured", desc: "AI inference for prediction models" },
            { name: "Odds API", status: "configured", desc: "Additional odds aggregation" },
          ].map((provider) => (
            <div key={provider.name} className="flex items-center justify-between p-[12px] bg-gray-50 rounded-[10px]">
              <div>
                <span className="text-[13px] font-medium text-[#0A0F1C] block">{provider.name}</span>
                <span className="text-[11px] text-gray-400">{provider.desc}</span>
              </div>
              <span className="text-[10px] font-semibold text-green-600 bg-green-50 px-[8px] py-[3px] rounded-full uppercase">
                {provider.status}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* System Info */}
      <div className="bg-white rounded-[16px] p-[20px] border border-gray-100 mb-[16px]">
        <h3 className="font-display text-[15px] font-semibold text-[#0A0F1C] mb-[12px]">
          System Information
        </h3>
        <div className="grid grid-cols-2 gap-[8px]">
          {[
            { label: "Environment", value: "Development" },
            { label: "Database", value: "Supabase PostgreSQL" },
            { label: "Auth Provider", value: "Supabase Auth" },
            { label: "Framework", value: "Next.js 15 (App Router)" },
            { label: "Schema Version", value: "3.0" },
            { label: "Last Migration", value: "2026-08-20" },
          ].map((item) => (
            <div key={item.label} className="p-[10px] bg-gray-50 rounded-[8px]">
              <span className="block text-[10px] text-gray-400 mb-[2px]">{item.label}</span>
              <span className="text-[12px] font-medium text-[#0A0F1C]">{item.value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Danger Zone */}
      <div className="bg-white rounded-[16px] p-[20px] border border-red-100">
        <h3 className="font-display text-[15px] font-semibold text-red-600 mb-[8px]">
          Danger Zone
        </h3>
        <p className="text-[13px] text-gray-500 mb-[12px]">
          Irreversible actions that affect the entire system.
        </p>
        <div className="flex gap-[8px]">
          <button className="h-[32px] px-[12px] rounded-[8px] bg-red-50 text-red-600 text-[12px] font-semibold transition-all hover:bg-red-100">
            Flush AI Cache
          </button>
          <button className="h-[32px] px-[12px] rounded-[8px] bg-red-50 text-red-600 text-[12px] font-semibold transition-all hover:bg-red-100">
            Reset All Predictions
          </button>
        </div>
      </div>
    </div>
  );
}
