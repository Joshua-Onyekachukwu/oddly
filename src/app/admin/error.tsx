"use client";

import React from "react";

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="text-center max-w-[400px] px-[16px]">
        <div className="inline-flex items-center justify-center w-[64px] h-[64px] rounded-[16px] bg-[#EF4444]/10 mb-[24px]">
          <i className="ri-error-warning-line text-[28px] text-[#EF4444]"></i>
        </div>
        <h2 className="font-display text-[20px] font-bold text-[#0A0F1C] mb-[8px]">
          Admin Panel Error
        </h2>
        <p className="text-[14px] text-gray-500 mb-[24px]">
          {error.message || "An unexpected error occurred in the admin panel."}
        </p>
        <div className="flex gap-[8px] justify-center">
          <button
            onClick={reset}
            className="h-[40px] px-[20px] rounded-[12px] bg-[#1B2A4A] text-white text-[14px] font-semibold transition-all hover:bg-[#243B53] active:scale-[0.98]"
          >
            Try again
          </button>
          <a
            href="/admin"
            className="h-[40px] px-[20px] rounded-[12px] border border-gray-200 text-[14px] font-semibold text-gray-600 transition-all hover:bg-gray-50 active:scale-[0.98] inline-flex items-center"
          >
            Back to admin
          </a>
        </div>
      </div>
    </div>
  );
}
