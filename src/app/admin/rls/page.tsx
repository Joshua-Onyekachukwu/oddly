"use client";

import React, { useState, useEffect, useCallback } from "react";

interface TableRLS {
  table_name: string;
  rls_enabled: boolean;
  force_rls?: boolean;
  policies?: string[];
  status: string;
}

export default function RLSPage() {
  const [tables, setTables] = useState<TableRLS[]>([]);
  const [summary, setSummary] = useState<{ total: number; secure: number; missingRls: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchRLS = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/admin/rls");
      const json = await res.json();
      if (json.error) {
        setError(json.error);
      } else {
        setTables(json.data || []);
        setSummary(json.summary || null);
      }
    } catch (err: any) {
      setError(err.message);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchRLS();
  }, [fetchRLS]);

  const secureCount = tables.filter((t) => t.rls_enabled).length;
  const totalCount = tables.length;

  return (
    <div>
      <div className="mb-[24px] flex items-start justify-between">
        <div>
          <h1 className="font-display text-[22px] md:text-[26px] font-bold text-[#0A0F1C] mb-[4px]">
            Row-Level Security
          </h1>
          <p className="text-[13px] text-gray-500">
            Audit RLS status for every table in the database.
          </p>
        </div>
        <button
          onClick={fetchRLS}
          className="text-[11px] text-gray-400 hover:text-[#1B2A4A] transition-colors flex items-center gap-[4px]"
        >
          <i className="ri-refresh-line" /> Refresh
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-[12px] mb-[24px]">
        <div className="bg-white rounded-[14px] border border-gray-100 p-[16px]">
          <div className="flex items-center gap-[10px] mb-[8px]">
            <div className="w-[32px] h-[32px] rounded-[10px] flex items-center justify-center bg-blue-50 text-blue-600">
              <i className="ri-database-2-line text-[16px]" />
            </div>
            <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Total Tables</span>
          </div>
          <div className="text-[28px] font-bold font-mono tabular-nums text-[#0A0F1C] leading-none">
            {loading ? "—" : totalCount}
          </div>
        </div>
        <div className="bg-white rounded-[14px] border border-gray-100 p-[16px]">
          <div className="flex items-center gap-[10px] mb-[8px]">
            <div className="w-[32px] h-[32px] rounded-[10px] flex items-center justify-center bg-green-50 text-green-600">
              <i className="ri-shield-check-line text-[16px]" />
            </div>
            <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">RLS Enabled</span>
          </div>
          <div className="text-[28px] font-bold font-mono tabular-nums text-green-600 leading-none">
            {loading ? "—" : secureCount}
          </div>
        </div>
        <div className="bg-white rounded-[14px] border border-gray-100 p-[16px]">
          <div className="flex items-center gap-[10px] mb-[8px]">
            <div className="w-[32px] h-[32px] rounded-[10px] flex items-center justify-center bg-red-50 text-red-600">
              <i className="ri-error-warning-line text-[16px]" />
            </div>
            <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Missing RLS</span>
          </div>
          <div className={`text-[28px] font-bold font-mono tabular-nums leading-none ${totalCount - secureCount > 0 ? "text-red-600" : "text-green-600"}`}>
            {loading ? "—" : totalCount - secureCount}
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-[14px] p-[16px] mb-[16px]">
          <div className="flex items-center gap-[8px]">
            <i className="ri-error-warning-line text-red-500" />
            <span className="text-[13px] font-medium text-red-700">{error}</span>
          </div>
        </div>
      )}

      {/* Table List */}
      <div className="bg-white rounded-[14px] border border-gray-100">
        <div className="px-[20px] py-[16px] border-b border-gray-50">
          <h3 className="text-[14px] font-semibold text-[#0A0F1C]">Table Security Status</h3>
          <p className="text-[11px] text-gray-400 mt-[2px]">
            Run <code className="bg-gray-100 px-[4px] py-[1px] rounded text-[10px]">FIX-NOW.sql</code> to enable RLS on all tables
          </p>
        </div>
        <div className="p-[16px]">
          {loading ? (
            <div className="space-y-[6px]">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="h-[40px] bg-gray-100 rounded-[8px] animate-pulse" />
              ))}
            </div>
          ) : tables.length === 0 ? (
            <div className="text-center py-[32px] text-gray-400">
              <p className="text-[13px]">No tables found. Run FIX-NOW.sql first.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left py-[8px] px-[10px] font-medium text-gray-500">Table</th>
                    <th className="text-center py-[8px] px-[10px] font-medium text-gray-500">RLS</th>
                    <th className="text-center py-[8px] px-[10px] font-medium text-gray-500">Force RLS</th>
                    <th className="text-center py-[8px] px-[10px] font-medium text-gray-500">Status</th>
                    <th className="text-left py-[8px] px-[10px] font-medium text-gray-500">Policies</th>
                  </tr>
                </thead>
                <tbody>
                  {tables.map((t) => (
                    <tr key={t.table_name} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50">
                      <td className="py-[8px] px-[10px] font-mono font-semibold text-[#0A0F1C]">{t.table_name}</td>
                      <td className="text-center py-[8px] px-[10px]">
                        {t.rls_enabled ? (
                          <span className="inline-flex items-center gap-[4px] text-green-600">
                            <i className="ri-check-line text-[14px]" />
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-[4px] text-red-600">
                            <i className="ri-close-line text-[14px]" />
                          </span>
                        )}
                      </td>
                      <td className="text-center py-[8px] px-[10px]">
                        {t.force_rls ? (
                          <span className="text-green-600 text-[10px] font-bold">YES</span>
                        ) : (
                          <span className="text-gray-400 text-[10px]">no</span>
                        )}
                      </td>
                      <td className="text-center py-[8px] px-[10px]">
                        <span className={`text-[10px] font-bold px-[8px] py-[3px] rounded-full ${
                          t.status === "SECURE" ? "bg-green-50 text-green-600" :
                          t.status === "MISSING_RLS" ? "bg-red-50 text-red-600" :
                          "bg-amber-50 text-amber-600"
                        }`}>
                          {t.status === "SECURE" ? "SECURE" :
                           t.status === "MISSING_RLS" ? "MISSING RLS" : t.status}
                        </span>
                      </td>
                      <td className="py-[8px] px-[10px] text-gray-400">
                        {t.policies && t.policies.length > 0 ? t.policies.join(", ") : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
