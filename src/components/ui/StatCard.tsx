import React from "react";

interface StatCardProps {
  label: string;
  value: string;
  icon?: string;
  change?: number;
  changeLabel?: string;
  color?: string;
  className?: string;
}

export function StatCard({
  label,
  value,
  icon,
  change,
  changeLabel,
  color = "bg-gray-50 text-gray-600",
  className = "",
}: StatCardProps) {
  return (
    <div
      className={`
        relative overflow-hidden bg-white rounded-[14px] p-[16px] border border-gray-100
        hover:border-gray-200 hover:shadow-[0_2px_12px_rgba(0,0,0,0.03)] transition-all duration-200
        group ${className}
      `}
    >
      <div className={`absolute top-0 right-0 w-[60px] h-[60px] bg-gradient-to-br ${color} opacity-[0.06] rounded-bl-[30px] group-hover:opacity-[0.1] transition-opacity`} />
      <div className="relative">
        <div className="flex items-center gap-[8px] mb-[6px]">
          {icon && (
            <div className={`w-[28px] h-[28px] rounded-[7px] flex items-center justify-center ${color}`}>
              <i className={`${icon} text-[14px]`} />
            </div>
          )}
          <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">{label}</span>
        </div>
        <span className="block text-[24px] font-mono-data font-bold text-[#0A0F1C] tabular-nums">
          {value}
        </span>
      {change !== undefined && (
            <div className="flex items-center gap-[4px] mt-[4px]">
              <span
                className={`text-[11px] font-medium ${
                  change >= 0 ? "text-green-600" : "text-red-500"
                }`}
              >
                {change >= 0 ? "+" : ""}
                {change}%
              </span>
              {changeLabel && (
                <span className="text-[10px] text-gray-400">{changeLabel}</span>
              )}
            </div>
          )}
        </div>
    </div>
  );
}
