"use client";

import React, { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/providers/AuthProvider";

const publicMenuItems = [
  { label: "Home", href: "/" },
  { label: "Features", href: "/#features" },
  { label: "Pricing", href: "/#pricing" },
  { label: "FAQ", href: "/#faq" },
];

const authMenuItems = [
  { label: "Dashboard", href: "/matches" },
  { label: "Features", href: "/#features" },
  { label: "Pricing", href: "/#pricing" },
];

const Navbar: React.FC = () => {
  const pathname = usePathname();
  const router = useRouter();
  const { user, profile, loading, signOut } = useAuth();
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const navRef = useRef<HTMLElement>(null);
  const profileRef = useRef<HTMLDivElement>(null);

  const isLoggedIn = !!user;
  const menuItems = isLoggedIn ? authMenuItems : publicMenuItems;

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 60);
    };
    document.addEventListener("scroll", handleScroll, { passive: true });
    return () => document.removeEventListener("scroll", handleScroll);
  }, []);

  // Close profile dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
        setProfileOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const handleSignOut = async () => {
    await signOut();
    setProfileOpen(false);
    router.push("/");
  };

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
          <Link href={isLoggedIn ? "/matches" : "/"} className="flex items-center gap-[8px] group">
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
            {loading ? (
              <div className="w-[80px] h-[36px] bg-gray-100 rounded-full animate-pulse" />
            ) : isLoggedIn ? (
              /* Signed in — show profile dropdown */
              <div ref={profileRef} className="relative">
                <button
                  onClick={() => setProfileOpen(!profileOpen)}
                  className="flex items-center gap-[8px] px-[12px] py-[6px] rounded-full hover:bg-[#1B2A4A]/5 transition-colors"
                >
                  <div className="w-[28px] h-[28px] rounded-full bg-[#1B2A4A] flex items-center justify-center">
                    <span className="text-[11px] font-bold text-white">
                      {profile?.display_name?.[0] || user?.email?.[0]?.toUpperCase() || "U"}
                    </span>
                  </div>
                  <span className="text-[13px] font-medium text-[#1B2A4A]">
                    {profile?.display_name || "Account"}
                  </span>
                  <i className={`ri-arrow-down-s-line text-[12px] text-gray-400 transition-transform ${profileOpen ? "rotate-180" : ""}`} />
                </button>

                {/* Dropdown */}
                {profileOpen && (
                  <div className="absolute right-0 top-full mt-[8px] w-[200px] bg-white rounded-[12px] border border-gray-100 shadow-[0_8px_30px_-8px_rgba(0,0,0,0.12)] py-[4px] z-50">
                    <div className="px-[12px] py-[8px] border-b border-gray-50 mb-[4px]">
                      <p className="text-[12px] font-medium text-[#0A0F1C] truncate">{user?.email}</p>
                      <p className="text-[10px] text-gray-400 capitalize">{profile?.subscription_tier || "free"} plan</p>
                    </div>
                    <Link
                      href="/matches"
                      className="flex items-center gap-[8px] px-[12px] py-[8px] text-[13px] text-gray-600 hover:bg-gray-50 transition-colors"
                      onClick={() => setProfileOpen(false)}
                    >
                      <i className="ri-dashboard-line text-[14px] text-gray-400" />
                      Dashboard
                    </Link>
                    <Link
                      href="/settings"
                      className="flex items-center gap-[8px] px-[12px] py-[8px] text-[13px] text-gray-600 hover:bg-gray-50 transition-colors"
                      onClick={() => setProfileOpen(false)}
                    >
                      <i className="ri-settings-3-line text-[14px] text-gray-400" />
                      Settings
                    </Link>
                    {profile?.role === "admin" && (
                      <Link
                        href="/admin"
                        className="flex items-center gap-[8px] px-[12px] py-[8px] text-[13px] text-gray-600 hover:bg-gray-50 transition-colors"
                        onClick={() => setProfileOpen(false)}
                      >
                        <i className="ri-admin-line text-[14px] text-gray-400" />
                        Admin
                      </Link>
                    )}
                    <div className="border-t border-gray-50 mt-[4px] pt-[4px]">
                      <button
                        onClick={handleSignOut}
                        className="flex items-center gap-[8px] px-[12px] py-[8px] text-[13px] text-red-500 hover:bg-red-50 transition-colors w-full text-left"
                      >
                        <i className="ri-logout-box-r-line text-[14px]" />
                        Sign out
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              /* Not signed in — show login/signup */
              <>
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
              </>
            )}
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
              {isLoggedIn ? (
                <button
                  onClick={() => { handleSignOut(); setMobileOpen(false); }}
                  className="inline-flex items-center gap-[8px] font-display font-semibold text-[16px] rounded-full bg-white/10 text-white py-[14px] px-[32px]"
                >
                  Sign out
                  <i className="ri-logout-box-r-line text-[16px]"></i>
                </button>
              ) : (
                <Link
                  href="/signup"
                  className="inline-flex items-center gap-[8px] font-display font-semibold text-[16px] rounded-full bg-[#BFFF00] text-[#1B2A4A] py-[14px] px-[32px]"
                  onClick={() => setMobileOpen(false)}
                >
                  Get Started
                  <i className="ri-arrow-right-up-line text-[16px]"></i>
                </Link>
              )}
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
