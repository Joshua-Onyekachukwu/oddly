"use client";

import React from "react";
import { PageHeader, Card, CardHeader, Badge } from "@/components/ui";

const API_PROVIDERS = [
  { name: "The Odds API", env: "THE_ODDS_API_KEY", desc: "Live odds from 100+ bookmakers" },
  { name: "API-Football", env: "API_FOOTBALL_KEY", desc: "Fixture data and live scores" },
  { name: "Football-Data.org", env: "FOOTBALL_DATA_API_KEY", desc: "Standings and match statistics" },
  { name: "NVIDIA NIM", env: "NVIDIA_KEY_*", desc: "AI inference for prediction models (key pool)" },
];

const SYSTEM_INFO = [
  { label: "Environment", value: "Production" },
  { label: "Database", value: "Supabase PostgreSQL" },
  { label: "Auth Provider", value: "Supabase Auth" },
  { label: "Framework", value: "Next.js 15.5 (App Router)" },
  { label: "AI Engine", value: "Ensemble engine" },
  { label: "Schema Version", value: "3.0" },
];

export default function AdminSettingsPage() {
  return (
    <div>
      <PageHeader
        title="System Settings"
        description="API integrations and system configuration. Secrets are managed via environment variables."
      />

      {/* API Providers */}
      <Card className="mb-[16px]">
        <CardHeader
          title="API Providers"
          description="Each integration reads its credentials from the listed environment variable at runtime."
        />
        <div className="space-y-[6px]">
          {API_PROVIDERS.map((provider) => (
            <div
              key={provider.name}
              className="flex items-center justify-between p-[12px] bg-gray-50 rounded-[8px]"
            >
              <div>
                <span className="text-[13px] font-medium text-[#0A0F1C] block">{provider.name}</span>
                <span className="text-[11px] text-gray-400">{provider.desc}</span>
              </div>
              <code className="text-[10px] font-mono bg-white border border-gray-200 text-gray-500 px-[8px] py-[4px] rounded-[6px]">
                {provider.env}
              </code>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-gray-400 mt-[10px]">
          Key values are never exposed to the browser. Rotate secrets in your deployment environment.
        </p>
      </Card>

      {/* System Info */}
      <Card className="mb-[16px]">
        <CardHeader title="System Information" />
        <div className="grid grid-cols-2 md:grid-cols-3 gap-[8px]">
          {SYSTEM_INFO.map((item) => (
            <div key={item.label} className="p-[10px] bg-gray-50 rounded-[8px]">
              <span className="block text-[10px] text-gray-400 mb-[2px]">{item.label}</span>
              <span className="text-[12px] font-medium text-[#0A0F1C]">{item.value}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
