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
        bg-white rounded-[12px] p-[16px] border border-gray-100
        ${className}
      `}
    >
      <div className="flex items-center gap-[10px] mb-[8px]">
        {icon && (
          <div className={`w-[28px] h-[28px] rounded-[7px] flex items-center justify-center ${color}`}>
            <i className={`${icon} text-[14px]`} />
          </div>
        )}
        <span className="text-[11px] text-gray-400">{label}</span>
      </div>
      <span className="block text-[20px] font-mono-data font-bold text-[#0A0F1C]">
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
  );
}
