"use client";

import React, { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const menuItems = [
  { label: "Home", href: "/" },
  { label: "Features", href: "/#features" },
  { label: "Pricing", href: "/#pricing" },
  { label: "FAQ", href: "/#faq" },
];

const Navbar: React.FC = () => {
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const navRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 60);
    };
    document.addEventListener("scroll", handleScroll, { passive: true });
    return () => document.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <>
      {/* Floating Glass Pill Navbar */}
      <div className="fixed top-0 left-0 right-0 z-[999] flex justify-center px-4 pt-4 md:pt-5">
        <nav
          ref={navRef}
          className={`w-full max-w-[920px] flex items-center justify-between h-[56px] md:h-[60px] px-4 md:px-6 rounded-full transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] ${
            scrolled
              ? "bg-white/70 dark:bg-[#0a0e19]/70 backdrop-blur-2xl shadow-[0_0_0_1px_rgba(0,0,0,0.04),0_4px_24px_rgba(0,0,0,0.06)]"
              : "bg-white/40 dark:bg-[#0a0e19]/40 backdrop-blur-xl"
          }`}
        >
          {/* Logo */}
          <Link href="/" className="flex items-center gap-[8px] group">
            <span className="font-display font-bold text-[18px] md:text-[20px] tracking-[-0.02em] text-[#1B2A4A] dark:text-white transition-colors duration-300">
              ODDLY
            </span>
            <span className="hidden sm:inline-flex items-center gap-[4px] text-[9px] font-semibold text-[#BFFF00] bg-[#1B2A4A] px-[6px] py-[2px] rounded-full transition-all duration-300 group-hover:shadow-[0_0_12px_rgba(191,255,0,0.3)]">
              <span className="w-[3px] h-[3px] rounded-full bg-[#BFFF00] animate-pulse"></span>
              AI
            </span>
          </Link>

          {/* Desktop nav */}
          <div className="hidden md:flex items-center gap-[6px]">
            {menuItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`relative text-[13px] font-medium px-[14px] py-[8px] rounded-full transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] ${
                  pathname === item.href
                    ? "text-[#1B2A4A] dark:text-white bg-[#1B2A4A]/5 dark:bg-white/5"
                    : "text-gray-500 dark:text-gray-400 hover:text-[#1B2A4A] dark:hover:text-white hover:bg-[#1B2A4A]/3 dark:hover:bg-white/3"
                }`}
              >
                {item.label}
              </Link>
            ))}
          </div>

          {/* Desktop CTAs */}
          <div className="hidden md:flex items-center gap-[8px]">
            <Link
              href="/login"
              className="text-[13px] font-medium text-gray-500 dark:text-gray-400 hover:text-[#1B2A4A] dark:hover:text-white px-[14px] py-[8px] rounded-full transition-all duration-300"
            >
              Log in
            </Link>
            <Link
              href="/signup"
              className="group inline-flex items-center gap-[6px] font-display font-semibold text-[13px] rounded-full bg-[#1B2A4A] text-white py-[9px] px-[18px] transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] hover:shadow-[0_0_24px_rgba(27,42,74,0.25)] active:scale-[0.97]"
            >
              Get Started
              <span className="w-[20px] h-[20px] rounded-full bg-white/10 flex items-center justify-center transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:translate-x-[2px] group-hover:-translate-y-[1px] group-hover:bg-white/15">
                <i className="ri-arrow-right-up-line text-[12px]"></i>
              </span>
            </Link>
          </div>

          {/* Mobile hamburger */}
          <button
            type="button"
            className="md:hidden relative w-[36px] h-[36px] flex items-center justify-center"
            onClick={() => setMobileOpen(!mobileOpen)}
            aria-label="Toggle menu"
          >
            <span
              className={`absolute w-[18px] h-[1.5px] bg-[#1B2A4A] dark:bg-white rounded-full transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] ${
                mobileOpen ? "rotate-45 translate-y-0" : "translate-y-[-5px]"
              }`}
            ></span>
            <span
              className={`absolute w-[18px] h-[1.5px] bg-[#1B2A4A] dark:bg-white rounded-full transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] ${
                mobileOpen ? "-rotate-45 translate-y-0" : "translate-y-[5px]"
              }`}
            ></span>
          </button>
        </nav>
      </div>

      {/* Mobile overlay */}
      <div
        className={`md:hidden fixed inset-0 z-[998] transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] ${
          mobileOpen
            ? "opacity-100 pointer-events-auto"
            : "opacity-0 pointer-events-none"
        }`}
      >
        <div
          className="absolute inset-0 bg-[#1B2A4A]/90 backdrop-blur-3xl"
          onClick={() => setMobileOpen(false)}
        />
        <div className="relative h-full flex flex-col items-center justify-center">
          <div className="flex flex-col items-center gap-[8px]">
            {menuItems.map((item, i) => (
              <Link
                key={item.href}
                href={item.href}
                className={`font-display text-[28px] font-bold transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] ${
                  mobileOpen
                    ? "opacity-100 translate-y-0"
                    : "opacity-0 translate-y-12"
                } ${
                  pathname === item.href ? "text-[#BFFF00]" : "text-white"
                }`}
                style={{ transitionDelay: mobileOpen ? `${100 + i * 50}ms` : "0ms" }}
                onClick={() => setMobileOpen(false)}
              >
                {item.label}
              </Link>
            ))}
            <div
              className={`mt-[24px] transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] ${
                mobileOpen ? "opacity-100 translate-y-0" : "opacity-0 translate-y-12"
              }`}
              style={{ transitionDelay: mobileOpen ? "350ms" : "0ms" }}
            >
              <Link
                href="/signup"
                className="inline-flex items-center gap-[8px] font-display font-semibold text-[16px] rounded-full bg-[#BFFF00] text-[#1B2A4A] py-[14px] px-[32px]"
                onClick={() => setMobileOpen(false)}
              >
                Get Started
                <i className="ri-arrow-right-up-line text-[16px]"></i>
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* Spacer */}
      <div className="h-[72px] md:h-[80px]"></div>
    </>
  );
};

export default Navbar;
