import React from "react";
import Link from "next/link";

interface LegalPageProps {
  title: string;
  subtitle?: string;
  lastUpdated: string;
  children: React.ReactNode;
}

/**
 * Shared shell for legal / policy pages.
 * Renders a centered header (title, subtitle, last-updated date) followed by
 * prose-width content on the dark marketing theme.
 */
export default function LegalPage({
  title,
  subtitle,
  lastUpdated,
  children,
}: LegalPageProps) {
  return (
    <div className="bg-[#0A0F1C] min-h-screen">
      <div className="container sm:max-w-[540px] md:max-w-[720px] lg:max-w-[960px] xl:max-w-[1200px] mx-auto px-[16px]">
        {/* Header */}
        <div className="pt-[140px] md:pt-[160px] pb-[48px] text-center">
          <span className="inline-flex items-center gap-[6px] text-[10px] font-semibold uppercase tracking-[0.2em] text-[#BFFF00] bg-[#BFFF00]/10 border border-[#BFFF00]/20 px-[12px] py-[6px] rounded-full mb-[24px]">
            <span className="w-[4px] h-[4px] rounded-full bg-[#BFFF00] animate-pulse"></span>
            Legal
          </span>
          <h1 className="font-display font-bold text-[36px] md:text-[48px] tracking-[-0.02em] text-white leading-[1.1] mb-[16px]">
            {title}
          </h1>
          {subtitle && (
            <p className="text-[16px] md:text-[18px] text-white/50 !leading-[1.7] max-w-[640px] mx-auto !mb-0">
              {subtitle}
            </p>
          )}
          <p className="text-[12px] font-mono-data text-white/30 mt-[20px] !mb-0">
            Last updated: {lastUpdated}
          </p>
        </div>

        {/* Content */}
        <div className="pb-[100px]">
          <article className="max-w-[760px] mx-auto bg-white/[0.02] border border-white/[0.06] rounded-[24px] px-[24px] py-[40px] md:px-[48px] md:py-[56px]">
            <div className="legal-prose">{children}</div>
          </article>

          {/* Cross-links */}
          <div className="max-w-[760px] mx-auto mt-[32px] text-center">
            <p className="text-[13px] text-white/30 !mb-0">
              Questions? Contact us at{" "}
              <a
                href="mailto:legal@oddly.ng"
                className="text-[#BFFF00] hover:underline"
              >
                legal@oddly.ng
              </a>
              {" · "}
              <Link href="/terms" className="text-white/50 hover:text-white transition-colors">
                Terms
              </Link>
              {" · "}
              <Link href="/privacy" className="text-white/50 hover:text-white transition-colors">
                Privacy
              </Link>
              {" · "}
              <Link href="/responsible-gambling" className="text-white/50 hover:text-white transition-colors">
                Responsible Gambling
              </Link>
              {" · "}
              <Link href="/cookies" className="text-white/50 hover:text-white transition-colors">
                Cookies
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
