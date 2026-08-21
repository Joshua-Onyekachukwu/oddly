"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/providers/AuthProvider";

interface SidebarMenuProps {
  toggleActive: () => void;
}

interface NavItem {
  label: string;
  href: string;
  icon: string;
  badge?: string;
  badgeColor?: string;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: "Matches",
    items: [
      { label: "Today's Matches", href: "/matches", icon: "ri-football-line" },
      { label: "Upcoming", href: "/matches/upcoming", icon: "ri-calendar-schedule-line" },
      { label: "Results", href: "/matches/results", icon: "ri-trophy-line" },
    ],
  },
  {
    label: "Intelligence",
    items: [
      { label: "Build Accumulator", href: "/accumulator", icon: "ri-stack-line" },
      { label: "My Accumulators", href: "/accumulator/my-accumulators", icon: "ri-folder-3-line" },
      { label: "AI Analyst", href: "/ai-chat", icon: "ri-robot-2-line", badge: "AI", badgeColor: "bg-blue-50 text-blue-600" },
      { label: "Performance", href: "/performance", icon: "ri-line-chart-line" },
    ],
  },
  {
    label: "Challenges",
    items: [
      { label: "Golden Picks", href: "/predictions", icon: "ri-vip-crown-line", badge: "New", badgeColor: "bg-amber-50 text-amber-600" },
      { label: "Rollover", href: "/rollover", icon: "ri-fire-line", badge: "Elite", badgeColor: "bg-amber-50 text-amber-600" },
      { label: "Tracking", href: "/tracking", icon: "ri-bookmark-line" },
    ],
  },
  {
    label: "Account",
    items: [
      { label: "Notifications", href: "/notifications", icon: "ri-notification-3-line" },
      { label: "Preferences", href: "/notifications/preferences", icon: "ri-notification-settings-line" },
      { label: "Settings", href: "/settings", icon: "ri-settings-3-line" },
    ],
  },
];

const SidebarMenu: React.FC<SidebarMenuProps> = ({ toggleActive }) => {
  const pathname = usePathname();
  const { profile } = useAuth();
  const [expandedGroups, setExpandedGroups] = React.useState<Set<number>>(
    new Set([0, 1, 2, 3])
  );

  const toggleGroup = (index: number) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  const isActive = (href: string) => {
    if (href === "/matches") return pathname === "/matches";
    return pathname.startsWith(href);
  };

  return (
    <>
      {/* Mobile overlay */}
      <div
        className="fixed inset-0 bg-black/40 z-[6] xl:hidden transition-opacity duration-300"
        onClick={toggleActive}
      />

      {/* Sidebar */}
      <aside className="fixed top-0 left-0 h-screen w-[260px] bg-white border-r border-gray-100 z-[7] flex flex-col transition-transform duration-300 xl:translate-x-0 -translate-x-full">
        {/* Logo */}
        <div className="h-[60px] flex items-center justify-between px-[20px] border-b border-gray-100 flex-none">
          <Link href="/" className="flex items-center gap-[2px]">
            <span className="text-[22px] font-display font-bold tracking-tight text-[#0A0F1C]">
              ODD
            </span>
            <span className="text-[22px] font-display font-bold tracking-tight text-[#D97706]">
              LY
            </span>
          </Link>
          <button
            type="button"
            onClick={toggleActive}
            className="w-[32px] h-[32px] rounded-[8px] flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-50 transition-colors xl:hidden"
          >
            <i className="ri-close-line text-[18px]" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto py-[12px] px-[12px]">
          {NAV_GROUPS.map((group, groupIdx) => (
            <div key={groupIdx} className="mb-[8px]">
              {/* Group header */}
              <button
                onClick={() => toggleGroup(groupIdx)}
                className="w-full flex items-center justify-between px-[8px] py-[6px] text-[10px] font-semibold text-gray-400 uppercase tracking-wider hover:text-gray-500 transition-colors"
              >
                {group.label}
                <i
                  className={`ri-arrow-down-s-line text-[12px] transition-transform duration-200 ${
                    expandedGroups.has(groupIdx) ? "rotate-0" : "-rotate-90"
                  }`}
                />
              </button>

              {/* Group items */}
              {expandedGroups.has(groupIdx) && (
                <div className="mt-[2px]">
                  {group.items.map((item) => {
                    const active = isActive(item.href);
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={() => {
                          // Close mobile menu on navigation
                          if (window.innerWidth < 1280) {
                            toggleActive();
                          }
                        }}
                        className={`
                          flex items-center gap-[10px] px-[10px] py-[8px] rounded-[8px] text-[13px] font-medium transition-all duration-150
                          ${
                            active
                              ? "bg-[#1B2A4A] text-white"
                              : "text-gray-600 hover:bg-gray-50 hover:text-[#0A0F1C]"
                          }
                        `}
                      >
                        <i
                          className={`${item.icon} text-[16px] ${
                            active ? "text-white" : "text-gray-400"
                          }`}
                        />
                        <span className="flex-1">{item.label}</span>
                        {item.badge && (
                          <span
                            className={`text-[9px] font-bold px-[6px] py-[2px] rounded-full ${
                              active ? "bg-white/20 text-white" : item.badgeColor
                            }`}
                          >
                            {item.badge}
                          </span>
                        )}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </nav>

        {/* Bottom section — user info */}
        <div className="border-t border-gray-100 p-[12px] flex-none">
          <div className="flex items-center gap-[10px] px-[8px] py-[8px] rounded-[8px] bg-gray-50">
            <div className="w-[32px] h-[32px] rounded-full bg-[#1B2A4A] flex items-center justify-center flex-none">
              <span className="text-[12px] font-bold text-white">
                {profile?.display_name?.[0] || profile?.email?.[0]?.toUpperCase() || "U"}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[12px] font-semibold text-[#0A0F1C] truncate">
                {profile?.display_name || "User"}
              </div>
              <div className="text-[10px] text-gray-400 truncate capitalize">
                {profile?.subscription_tier || "free"} plan
              </div>
            </div>
            {profile?.role === "admin" && (
              <Link
                href="/admin"
                className="w-[28px] h-[28px] rounded-[6px] bg-[#1B2A4A] flex items-center justify-center hover:bg-[#243B53] transition-colors"
                title="Admin Dashboard"
              >
                <i className="ri-admin-line text-[12px] text-white" />
              </Link>
            )}
          </div>
        </div>
      </aside>
    </>
  );
};

export default SidebarMenu;
