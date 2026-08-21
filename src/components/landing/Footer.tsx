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
              {"AI-powered football prediction platform that helps you find value bets with 90%+ confidence across "}{stats?.totalLeagues ? `${stats.totalLeagues}+` : "360+"}{" leagues."}
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
                { label: "Dashboard", href: "/matches" },
                { label: "API Docs", href: "#" },
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
                { label: "Blog", href: "#" },
                { label: "Community", href: "#" },
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
                { label: "Terms of Service", href: "#" },
                { label: "Privacy Policy", href: "#" },
                { label: "Cookie Policy", href: "#" },
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
          <div className="flex items-center gap-[8px]">
            {[
              { icon: "ri-twitter-x-line", href: "#" },
              { icon: "ri-instagram-line", href: "#" },
              { icon: "ri-telegram-line", href: "#" },
              { icon: "ri-discord-line", href: "#" },
            ].map((social) => (
              <a
                key={social.icon}
                href={social.href}
                className="w-[32px] h-[32px] rounded-full bg-white/[0.03] hover:bg-white/[0.08] flex items-center justify-center text-white/25 hover:text-white transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)]"
                aria-label={social.icon}
              >
                <i className={`${social.icon} text-[14px]`}></i>
              </a>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
