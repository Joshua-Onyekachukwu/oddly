"use client";

import React, { useState, useEffect } from "react";

/* ─── Types ──────────────────────────────────────────────── */

interface RouteAuthStatus {
  path: string;
  method: string;
  hasAuth: boolean;
  authType: string;
  rateLimited: boolean;
}

interface SecurityData {
  summary: {
    overallScore: number;
    authScore: number;
    rlsScore: number;
    totalRoutes: number;
    authedRoutes: number;
    unauthedCount: number;
    rateLimitedRoutes: number;
    totalTables: number;
    tablesWithRLS: number;
    tablesWithoutRLS: number;
  };
  authCoverage: RouteAuthStatus[];
  unauthedRoutes: RouteAuthStatus[];
  rlsPolicies: Array<{ table_name: string; rls_enabled: boolean; policy_count: number }>;
  tablesWithoutRLS: string[];
  timestamp: string;
}

/* ─── Helpers ────────────────────────────────────────────── */

function ScoreRing({ score, label, color }: { score: number; label: string; color: string }) {
  const circumference = 2 * Math.PI * 36;
  const offset = circumference - (score / 100) * circumference;
  return (
    <div className="flex flex-col items-center gap-2">
      <svg width="88" height="88" viewBox="0 0 88 88">
        <circle cx="44" cy="44" r="36" fill="none" stroke="#e5e7eb" strokeWidth="6" />
        <circle
          cx="44" cy="44" r="36" fill="none"
          stroke={color} strokeWidth="6" strokeLinecap="round"
          strokeDasharray={circumference} strokeDashoffset={offset}
          transform="rotate(-90 44 44)" className="transition-all duration-1000"
        />
        <text x="44" y="44" textAnchor="middle" dominantBaseline="central"
          className="text-[20px] font-bold font-mono" fill={color}>
          {score}
        </text>
      </svg>
      <span className="text-[11px] text-gray-500 font-medium">{label}</span>
    </div>
  );
}

function Badge({ variant, children }: { variant: "success" | "warning" | "danger" | "neutral"; children: React.ReactNode }) {
  const colors = {
    success: "bg-green-50 text-green-700 border-green-200",
    warning: "bg-amber-50 text-amber-700 border-amber-200",
    danger: "bg-red-50 text-red-700 border-red-200",
    neutral: "bg-gray-50 text-gray-600 border-gray-200",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border ${colors[variant]}`}>
      {children}
    </span>
  );
}

/* ─── Page ───────────────────────────────────────────────── */

export default function SecurityPage() {
  const [data, setData] = useState<SecurityData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchSecurity() {
      try {
        const res = await fetch("/api/v1/admin/security");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        setData(json);
      } catch (e: any) {
        setError(e.message);
      }
      setLoading(false);
    }
    fetchSecurity();
    const interval = setInterval(fetchSecurity, 30000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="p-8 max-w-7xl mx-auto">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-100 rounded w-48" />
          <div className="h-32 bg-gray-100 rounded" />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-8 max-w-7xl mx-auto">
        <div className="bg-red-50 border border-red-200 rounded-xl p-6">
          <h2 className="text-red-800 font-semibold">Security Audit Failed</h2>
          <p className="text-red-600 text-sm mt-1">{error || "No data"}</p>
        </div>
      </div>
    );
  }

  const { summary, authCoverage, unauthedRoutes, rlsPolicies, tablesWithoutRLS } = data;

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-display text-[22px] md:text-[26px] font-bold text-[#0A0F1C]">
            Security Dashboard
          </h1>
          <p className="text-[13px] text-gray-500 mt-1">
            Auth coverage, rate limiting, and RLS policy status
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className={`w-2.5 h-2.5 rounded-full ${summary.overallScore >= 90 ? "bg-green-500" : summary.overallScore >= 70 ? "bg-amber-500" : "bg-red-500"}`} />
          <span className="text-[12px] text-gray-400">
            Score: {summary.overallScore}/100
          </span>
        </div>
      </div>

      {/* Score Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-gray-100 p-5 text-center">
          <ScoreRing score={summary.overallScore} label="Overall" color={summary.overallScore >= 90 ? "#22c55e" : summary.overallScore >= 70 ? "#D97706" : "#EF4444"} />
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-5 text-center">
          <ScoreRing score={summary.authScore} label="Auth Coverage" color={summary.authScore >= 90 ? "#22c55e" : "#D97706"} />
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-5 text-center">
          <ScoreRing score={summary.rlsScore} label="RLS Coverage" color={summary.rlsScore >= 90 ? "#22c55e" : "#D97706"} />
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-5 flex flex-col items-center justify-center gap-3">
          <div className="text-[28px] font-bold font-mono text-[#0A0F1C]">{summary.rateLimitedRoutes}</div>
          <span className="text-[11px] text-gray-400">Rate-Limited Endpoints</span>
        </div>
      </div>

      {/* Alerts */}
      {summary.unauthedCount > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <i className="ri-error-warning-line text-red-500" />
            <span className="text-[13px] font-semibold text-red-800">
              {summary.unauthedCount} endpoint{summary.unauthedCount > 1 ? "s" : ""} without auth
            </span>
          </div>
          {unauthedRoutes.map((r, i) => (
            <div key={i} className="text-[12px] text-red-600 font-mono ml-6">
              {r.method} {r.path}
            </div>
          ))}
        </div>
      )}

      {tablesWithoutRLS.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <i className="ri-shield-line text-amber-500" />
            <span className="text-[13px] font-semibold text-amber-800">
              {tablesWithoutRLS.length} table{tablesWithoutRLS.length > 1 ? "s" : ""} without RLS
            </span>
          </div>
          <div className="flex flex-wrap gap-2 ml-6">
            {tablesWithoutRLS.map((t, i) => (
              <Badge key={i} variant="warning">{t}</Badge>
            ))}
          </div>
        </div>
      )}

      {/* Auth Coverage Table */}
      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="text-[14px] font-semibold text-[#0A0F1C]">API Auth Coverage</h2>
          <p className="text-[11px] text-gray-400 mt-0.5">
            {summary.authedRoutes}/{summary.totalRoutes} endpoints authenticated
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-gray-50">
                <th className="text-left px-5 py-2.5 text-gray-400 font-medium">Route</th>
                <th className="text-left px-3 py-2.5 text-gray-400 font-medium">Method</th>
                <th className="text-left px-3 py-2.5 text-gray-400 font-medium">Auth</th>
                <th className="text-left px-3 py-2.5 text-gray-400 font-medium">Rate Limited</th>
              </tr>
            </thead>
            <tbody>
              {authCoverage.map((route, i) => (
                <tr key={i} className="border-b border-gray-50 last:border-0 hover:bg-gray-50">
                  <td className="px-5 py-2.5 font-mono text-[#0A0F1C]">{route.path}</td>
                  <td className="px-3 py-2.5">
                    <Badge variant={route.method === "POST" ? "warning" : "neutral"}>{route.method}</Badge>
                  </td>
                  <td className="px-3 py-2.5">
                    {route.hasAuth ? (
                      <Badge variant="success">{route.authType}</Badge>
                    ) : (
                      <Badge variant="danger">NONE</Badge>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    {route.rateLimited ? (
                      <i className="ri-check-line text-green-500" />
                    ) : (
                      <i className="ri-close-line text-gray-300" />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* RLS Status */}
      {rlsPolicies.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="text-[14px] font-semibold text-[#0A0F1C]">RLS Policy Status</h2>
            <p className="text-[11px] text-gray-400 mt-0.5">
              {summary.tablesWithRLS}/{summary.totalTables} tables with RLS enabled
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-gray-50">
                  <th className="text-left px-5 py-2.5 text-gray-400 font-medium">Table</th>
                  <th className="text-left px-3 py-2.5 text-gray-400 font-medium">RLS</th>
                  <th className="text-left px-3 py-2.5 text-gray-400 font-medium">Policies</th>
                </tr>
              </thead>
              <tbody>
                {rlsPolicies.map((table, i) => (
                  <tr key={i} className="border-b border-gray-50 last:border-0 hover:bg-gray-50">
                    <td className="px-5 py-2.5 font-mono text-[#0A0F1C]">{table.table_name}</td>
                    <td className="px-3 py-2.5">
                      {table.rls_enabled ? (
                        <Badge variant="success">Enabled</Badge>
                      ) : (
                        <Badge variant="danger">Disabled</Badge>
                      )}
                    </td>
                    <td className="px-3 py-2.5 font-mono">{table.policy_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="text-center text-[11px] text-gray-300">
        Last scan: {new Date(data.timestamp).toLocaleString()}
      </div>
    </div>
  );
}
