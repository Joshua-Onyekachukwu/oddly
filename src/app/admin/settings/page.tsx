"use client";

import React from "react";
import { PageHeader, Card, CardHeader, Badge } from "@/components/ui";

const API_PROVIDERS = [
  { name: "The Odds API", status: "configured", desc: "Live odds from 100+ bookmakers" },
  { name: "API-Football", status: "configured", desc: "Fixture data and live scores" },
  { name: "APISports", status: "configured", desc: "Football data and statistics" },
  { name: "NVIDIA NIM", status: "configured", desc: "AI inference for prediction models (10 keys)" },
  { name: "Odds API IO", status: "configured", desc: "Additional odds aggregation" },
];

const SYSTEM_INFO = [
  { label: "Environment", value: "Production" },
  { label: "Database", value: "Supabase PostgreSQL" },
  { label: "Auth Provider", value: "Supabase Auth" },
  { label: "Framework", value: "Next.js 15.5 (App Router)" },
  { label: "AI Engine", value: "NVIDIA NIM (7 models)" },
  { label: "Schema Version", value: "3.0" },
];

export default function AdminSettingsPage() {
  return (
    <div>
      <PageHeader
        title="System Settings"
        description="Manage API keys, environment variables, and system configuration."
      />

      {/* API Providers */}
      <Card className="mb-[16px]">
        <CardHeader title="API Providers" />
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
              <Badge variant="success" size="sm">{provider.status}</Badge>
            </div>
          ))}
        </div>
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

      {/* Danger Zone */}
      <Card className="border-red-100">
        <div className="mb-[12px]">
          <h3 className="text-[14px] font-semibold text-red-600">Danger Zone</h3>
        </div>
        <p className="text-[12px] text-gray-500 mb-[12px]">
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
      </Card>
    </div>
  );
}
