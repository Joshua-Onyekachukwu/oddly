import Link from "next/link";

export default function DashboardNotFound() {
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="text-center">
        <div className="font-display text-[60px] font-bold text-[#0A0F1C]/[0.04] leading-none mb-[-12px]">
          404
        </div>
        <h2 className="font-display text-[20px] font-bold text-[#0A0F1C] mb-[4px]">
          Page not found
        </h2>
        <p className="text-[13px] text-gray-400 mb-[20px]">
          This dashboard page doesn&apos;t exist.
        </p>
        <Link
          href="/matches"
          className="inline-flex items-center gap-[6px] font-display font-semibold text-[13px] rounded-full bg-[#0A0F1C] text-white py-[10px] px-[20px] transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] hover:opacity-90 active:scale-[0.97]"
        >
          <i className="ri-arrow-left-line text-[14px]"></i>
          Back to matches
        </Link>
      </div>
    </div>
  );
}
