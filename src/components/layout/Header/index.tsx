"use client";

import React, { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/providers/AuthProvider";
import Notifications from "./Notifications";

interface HeaderProps {
  toggleActive: () => void;
}

// Page titles mapping
const PAGE_TITLES: Record<string, string> = {
  "/matches": "Today's Matches",
  "/matches/upcoming": "Upcoming Matches",
  "/matches/results": "Results",
  "/accumulator": "Accumulator",
  "/ai-chat": "AI Analyst",
  "/performance": "Performance",
  "/rollover": "Rollover Challenge",
  "/tracking": "Bet Tracking",
  "/notifications": "Notifications",
  "/settings": "Settings",
};

const Header: React.FC<HeaderProps> = ({ toggleActive }) => {
  const pathname = usePathname();
  const router = useRouter();
  const { profile, signOut } = useAuth();
  const [showProfile, setShowProfile] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);

  const pageTitle = PAGE_TITLES[pathname] || "Dashboard";

  // Close profile menu on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
        setShowProfile(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSignOut = async () => {
    await signOut();
    router.push("/login");
  };

  return (
    <header className="h-[56px] bg-white border-b border-gray-100 fixed top-0 left-0 right-0 z-[6] xl:left-[260px]">
      <div className="h-full flex items-center justify-between px-[16px] xl:px-[24px]">
        {/* Left — Mobile menu + Page title */}
        <div className="flex items-center gap-[12px]">
          <button
            type="button"
            onClick={toggleActive}
            className="w-[36px] h-[36px] rounded-[8px] flex items-center justify-center text-gray-500 hover:bg-gray-50 hover:text-gray-700 transition-colors xl:hidden"
          >
            <i className="ri-menu-line text-[20px]" />
          </button>
          <div className="xl:hidden">
            <span className="text-[15px] font-display font-semibold text-[#0A0F1C]">
              {pageTitle}
            </span>
          </div>
        </div>

        {/* Right — Actions */}
        <div className="flex items-center gap-[8px]">
          {/* Notifications */}
          <Notifications />

          {/* Profile menu */}
          <div className="relative" ref={profileRef}>
            <button
              onClick={() => setShowProfile(!showProfile)}
              className="flex items-center gap-[8px] px-[8px] py-[6px] rounded-[8px] hover:bg-gray-50 transition-colors"
            >
              <div className="w-[28px] h-[28px] rounded-full bg-[#1B2A4A] flex items-center justify-center">
                <span className="text-[11px] font-bold text-white">
                  {profile?.display_name?.[0] || profile?.email?.[0]?.toUpperCase() || "U"}
                </span>
              </div>
              <div className="hidden md:block text-left">
                <div className="text-[12px] font-medium text-[#0A0F1C] leading-tight">
                  {profile?.display_name || "User"}
                </div>
                <div className="text-[10px] text-gray-400 capitalize">
                  {profile?.subscription_tier || "free"}
                </div>
              </div>
              <i className="ri-arrow-down-s-line text-[14px] text-gray-400 hidden md:block" />
            </button>

            {/* Profile dropdown */}
            {showProfile && (
              <div className="absolute right-0 top-full mt-[4px] w-[200px] bg-white rounded-[10px] border border-gray-100 shadow-[0_4px_24px_rgba(0,0,0,0.08)] py-[4px] z-50">
                <div className="px-[12px] py-[8px] border-b border-gray-100 mb-[4px]">
                  <div className="text-[12px] font-medium text-[#0A0F1C]">
                    {profile?.display_name || "User"}
                  </div>
                  <div className="text-[11px] text-gray-400 truncate">
                    {profile?.email || ""}
                  </div>
                </div>
                <Link
                  href="/settings"
                  onClick={() => setShowProfile(false)}
                  className="flex items-center gap-[8px] px-[12px] py-[8px] text-[13px] text-gray-600 hover:bg-gray-50 transition-colors"
                >
                  <i className="ri-settings-3-line text-[14px] text-gray-400" />
                  Settings
                </Link>
                {profile?.role === "admin" && (
                  <Link
                    href="/admin"
                    onClick={() => setShowProfile(false)}
                    className="flex items-center gap-[8px] px-[12px] py-[8px] text-[13px] text-gray-600 hover:bg-gray-50 transition-colors"
                  >
                    <i className="ri-admin-line text-[14px] text-gray-400" />
                    Admin Dashboard
                  </Link>
                )}
                <div className="border-t border-gray-100 mt-[4px] pt-[4px]">
                  <button
                    onClick={handleSignOut}
                    className="w-full flex items-center gap-[8px] px-[12px] py-[8px] text-[13px] text-red-600 hover:bg-red-50 transition-colors"
                  >
                    <i className="ri-logout-box-r-line text-[14px]" />
                    Sign out
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};

export default Header;
