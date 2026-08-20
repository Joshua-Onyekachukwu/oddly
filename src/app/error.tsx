"use client";

import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#FAFBFC] px-[16px]">
      <div className="max-w-[400px] text-center">
        <div className="inline-flex items-center justify-center w-[64px] h-[64px] rounded-[16px] bg-red-50 mb-[24px]">
          <i className="ri-error-warning-line text-[28px] text-red-500"></i>
        </div>
        <h2 className="font-display text-[24px] font-bold text-[#0A0F1C] mb-[8px]">
          Something went wrong
        </h2>
        <p className="text-[14px] text-gray-500 mb-[24px]">
          An unexpected error occurred. Please try again.
        </p>
        <button
          onClick={reset}
          className="font-display font-semibold text-[14px] rounded-full bg-[#0A0F1C] text-white py-[12px] px-[24px] transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] hover:opacity-90 active:scale-[0.97]"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
