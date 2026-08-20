import Link from "next/link";

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#FAFBFC] px-[16px]">
      <div className="max-w-[400px] text-center">
        <div className="font-display text-[80px] md:text-[120px] font-bold text-[#0A0F1C]/[0.04] leading-none mb-[-20px]">
          404
        </div>
        <h2 className="font-display text-[24px] font-bold text-[#0A0F1C] mb-[8px]">
          Page not found
        </h2>
        <p className="text-[14px] text-gray-500 mb-[24px]">
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
        </p>
        <Link
          href="/"
          className="inline-flex items-center gap-[8px] font-display font-semibold text-[14px] rounded-full bg-[#0A0F1C] text-white py-[12px] px-[24px] transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] hover:opacity-90 active:scale-[0.97]"
        >
          <i className="ri-arrow-left-line text-[16px]"></i>
          Back to home
        </Link>
      </div>
    </div>
  );
}
