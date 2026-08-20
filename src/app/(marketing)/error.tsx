"use client";

export default function MarketingError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="min-h-[60vh] flex items-center justify-center px-[16px]">
      <div className="text-center max-w-[400px]">
        <div className="inline-flex items-center justify-center w-[56px] h-[56px] rounded-[14px] bg-red-50 mb-[16px]">
          <i className="ri-error-warning-line text-[24px] text-red-500"></i>
        </div>
        <h2 className="font-display text-[18px] font-bold text-[#0A0F1C] mb-[8px]">
          Something went wrong
        </h2>
        <p className="text-[14px] text-gray-500 mb-[24px]">
          {error.message || "An unexpected error occurred."}
        </p>
        <button
          onClick={reset}
          className="h-[40px] px-[20px] rounded-[10px] bg-[#1B2A4A] text-white text-[14px] font-semibold transition-all hover:bg-[#243B53] active:scale-[0.98]"
        >
          Try Again
        </button>
      </div>
    </div>
  );
}
