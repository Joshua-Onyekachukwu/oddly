"use client";

import React from "react";

export default function AdminPipelinePage() {
  const stages = [
    { name: "Odds Fetch", status: "idle", icon: "ri-bar-chart-box-line", desc: "Pulls live odds from API providers" },
    { name: "Fixture Sync", status: "idle", icon: "ri-calendar-check-line", desc: "Syncs fixtures from football data sources" },
    { name: "Prediction Engine", status: "idle", icon: "ri-brain-line", desc: "Generates model predictions for upcoming matches" },
    { name: "Value Detection", status: "idle", icon: "ri-search-eye-line", desc: "Scans for edges between model probability and market odds" },
    { name: "Accumulator Scoring", status: "idle", icon: "ri-calculator-line", desc: "Evaluates accumulator combinations" },
    { name: "Bet Settlement", status: "idle", icon: "ri-check-double-line", desc: "Settles completed bets and updates P&L" },
    { name: "Notification Dispatch", status: "idle", icon: "ri-notification-3-line", desc: "Sends alerts for value bets, results, and milestones" },
  ];

  return (
    <div>
      <div className="mb-[24px]">
        <h1 className="font-display text-[24px] md:text-[28px] font-bold text-[#0A0F1C] mb-[4px]">
          Data Pipeline
        </h1>
        <p className="text-[14px] text-gray-500">
          Monitor data flow from odds ingestion to prediction delivery.
        </p>
      </div>

      <div className="space-y-[8px]">
        {stages.map((stage, i) => (
          <div
            key={stage.name}
            className="bg-white rounded-[14px] p-[16px] border border-gray-100 shadow-[0_1px_6px_rgba(0,0,0,0.02)] flex items-center gap-[16px]"
          >
            <span className="text-[11px] font-mono-data text-gray-300 w-[24px] text-right">
              {String(i + 1).padStart(2, "0")}
            </span>
            <div className="w-[36px] h-[36px] bg-gray-50 rounded-[10px] flex items-center justify-center flex-none">
              <i className={`${stage.icon} text-[16px] text-gray-400`}></i>
            </div>
            <div className="flex-1 min-w-0">
              <span className="text-[13px] font-semibold text-[#0A0F1C] block">{stage.name}</span>
              <span className="text-[11px] text-gray-400">{stage.desc}</span>
            </div>
            <span className="text-[10px] font-semibold text-gray-400 bg-gray-50 px-[8px] py-[3px] rounded-full uppercase">
              {stage.status}
            </span>
          </div>
        ))}
      </div>

      <div className="mt-[24px] text-center py-[32px] bg-white rounded-[16px] border border-gray-100">
        <p className="text-[13px] text-gray-400">
          Pipeline automation will be configured via cron jobs once deployed.
        </p>
      </div>
    </div>
  );
}
