"use client";

import React from "react";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="text-center max-w-[400px] px-[16px]">
        <div className="inline-flex items-center justify-center w-[64px] h-[16px] rounded-[16px] bg-[#EF4444]/10 mb-[24px]">
          <i className="ri-error-warning-line text-[28px] text-[#EF4444]"></i>
        </div>
        <h2 className="font-display text-[20px] font-bold text-[#0A0F1C] mb-[8px]">
          Something went wrong
        </h2>
        <p className="text-[14px] text-gray-500 mb-[24px]">
          {error.message || "An unexpected error occurred. Please try again."}
        </p>
        <button
          onClick={reset}
          className="h-[40px] px-[20px] rounded-[12px] bg-[#1B2A4A] text-white text-[14px] font-semibold transition-all hover:bg-[#243B53] active:scale-[0.98]"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
