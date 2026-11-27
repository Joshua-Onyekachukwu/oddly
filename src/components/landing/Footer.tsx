"use client";

import React from "react";
import Link from "next/link";
import type { LandingStats } from "@/lib/landing-stats";

interface FooterProps {
  stats?: LandingStats;
}

const Footer: React.FC<FooterProps> = ({ stats }) => {
  return (
    <footer className="bg-[#0A0F1C] pt-[80px] md:pt-[100px] pb-[40px]">
      <div className="container sm:max-w-[540px] md:max-w-[720px] lg:max-w-[960px] xl:max-w-[1200px] mx-auto px-[16px]">
        {/* Top section */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-[48px] mb-[60px]">
          {/* Brand */}
          <div className="lg:col-span-1">
            <Link href="/" className="inline-flex items-center gap-[10px] mb-[16px] group">
              <span className="font-display font-bold text-[20px] tracking-[-0.02em] text-white transition-colors duration-300">
                ODDLY
              </span>
            </Link>
            <p className="text-[14px] text-white/30 !leading-[1.75] !mb-0 max-w-[280px]">
              {"AI-powered football prediction platform that helps you find value bets across "}
              {stats?.totalLeagues
                ? `${stats.totalLeagues}+ leagues.`
                : "major football leagues worldwide."}
            </p>
          </div>

          {/* Product */}
          <div>
            <h4 className="font-display text-[11px] font-semibold text-white/50 uppercase tracking-[0.15em] !mb-[20px]">
              Product
            </h4>
            <ul className="space-y-[12px]">
              {[
                { label: "Features", href: "/#features" },
                { label: "Pricing", href: "/#pricing" },
                { label: "Dashboard", href: "/dashboard" },
              ].map((item) => (
                <li key={item.label}>
                  <Link
                    href={item.href}
                    className="text-[14px] text-white/35 hover:text-white transition-colors duration-500 ease-[cubic-bezier(0.32,0.72,0,1)]"
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Resources */}
          <div>
            <h4 className="font-display text-[11px] font-semibold text-white/50 uppercase tracking-[0.15em] !mb-[20px]">
              Resources
            </h4>
            <ul className="space-y-[12px]">
              {[
                { label: "FAQ", href: "/#faq" },
                { label: "Getting Started", href: "/signup" },
              ].map((item) => (
                <li key={item.label}>
                  <Link
                    href={item.href}
                    className="text-[14px] text-white/35 hover:text-white transition-colors duration-500 ease-[cubic-bezier(0.32,0.72,0,1)]"
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Legal */}
          <div>
            <h4 className="font-display text-[11px] font-semibold text-white/50 uppercase tracking-[0.15em] !mb-[20px]">
              Legal
            </h4>
            <ul className="space-y-[12px]">
              {[
                { label: "Terms of Service", href: "/terms" },
                { label: "Privacy Policy", href: "/privacy" },
                { label: "Responsible Gambling", href: "/responsible-gambling" },
                { label: "Cookie Policy", href: "/cookies" },
              ].map((item) => (
                <li key={item.label}>
                  <Link
                    href={item.href}
                    className="text-[14px] text-white/35 hover:text-white transition-colors duration-500 ease-[cubic-bezier(0.32,0.72,0,1)]"
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Divider */}
        <div className="h-[1px] bg-white/[0.04] mb-[32px]"></div>

        {/* Bottom */}
        <div className="flex flex-col md:flex-row items-center justify-between gap-[16px]">
          <p className="text-[12px] text-white/20 !mb-0 font-mono-data">
            &copy; {new Date().getFullYear()} ODDLY
          </p>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
