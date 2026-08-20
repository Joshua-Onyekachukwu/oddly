import React from "react";

interface EmptyStateProps {
  icon: string;
  title: string;
  description: string;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className = "",
}: EmptyStateProps) {
  return (
    <div className={`text-center py-[48px] bg-white rounded-[12px] border border-gray-100 ${className}`}>
      <div className="inline-flex items-center justify-center w-[48px] h-[48px] rounded-[12px] bg-gray-50 mb-[12px]">
        <i className={`${icon} text-[22px] text-gray-300`} />
      </div>
      <h3 className="text-[15px] font-semibold text-[#0A0F1C] mb-[4px]">
        {title}
      </h3>
      <p className="text-[13px] text-gray-400 max-w-[300px] mx-auto">
        {description}
      </p>
      {action && <div className="mt-[16px]">{action}</div>}
    </div>
  );
}
