import Link from "next/link";

export default function DashboardNotFound() {
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="text-center max-w-[400px] px-[16px]">
        <div className="inline-flex items-center justify-center w-[64px] h-[64px] rounded-[16px] bg-gray-100 mb-[24px]">
          <i className="ri-question-line text-[28px] text-gray-400"></i>
        </div>
        <h2 className="font-display text-[20px] font-bold text-[#0A0F1C] mb-[8px]">
          Page not found
        </h2>
        <p className="text-[14px] text-gray-500 mb-[24px]">
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
        </p>
        <Link
          href="/matches"
          className="inline-flex items-center h-[40px] px-[20px] rounded-[12px] bg-[#1B2A4A] text-white text-[14px] font-semibold transition-all hover:bg-[#243B53] active:scale-[0.98]"
        >
          Go to matches
        </Link>
      </div>
    </div>
  );
}
