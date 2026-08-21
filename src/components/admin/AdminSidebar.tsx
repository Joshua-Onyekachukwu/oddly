"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/providers/AuthProvider";

interface AdminSidebarProps {
  toggleActive: () => void;
}

interface NavItem {
  label: string;
  href: string;
  icon: string;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const ADMIN_NAV_GROUPS: NavGroup[] = [
  {
    label: "Overview",
    items: [
      { label: "Dashboard", href: "/admin", icon: "ri-dashboard-line" },
    ],
  },
  {
    label: "Data",
    items: [
      { label: "Pipeline", href: "/admin/pipeline", icon: "ri-plug-line" },
      { label: "AI Monitor", href: "/admin/ai-monitor", icon: "ri-robot-2-line" },
      { label: "Model Health", href: "/admin/model-health", icon: "ri-heart-pulse-line" },
      { label: "Scoring Config", href: "/admin/scoring", icon: "ri-settings-5-line" },
    ],
  },
  {
    label: "Users",
    items: [
      { label: "User Management", href: "/admin/users", icon: "ri-user-settings-line" },
      { label: "Announcements", href: "/admin/announcements", icon: "ri-megaphone-line" },
    ],
  },
  {
    label: "System",
    items: [
      { label: "Settings", href: "/admin/settings", icon: "ri-settings-3-line" },
    ],
  },
];

const AdminSidebar: React.FC<AdminSidebarProps> = ({ toggleActive }) => {
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
    if (href === "/admin") return pathname === "/admin";
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
        {/* Logo + Admin badge */}
        <div className="h-[60px] flex items-center justify-between px-[20px] border-b border-gray-100 flex-none">
          <Link href="/admin" className="flex items-center gap-[8px]">
            <span className="text-[22px] font-display font-bold tracking-tight text-[#0A0F1C]">
              ODD
            </span>
            <span className="text-[22px] font-display font-bold tracking-tight text-[#D97706]">
              LY
            </span>
            <span className="text-[9px] font-bold px-[6px] py-[2px] rounded-full bg-[#1B2A4A] text-white uppercase tracking-wider">
              Admin
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
          {ADMIN_NAV_GROUPS.map((group, groupIdx) => (
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
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </nav>

        {/* Bottom section — back to app + user info */}
        <div className="border-t border-gray-100 p-[12px] flex-none">
          {/* Back to app link */}
          <Link
            href="/matches"
            className="flex items-center gap-[10px] px-[10px] py-[8px] rounded-[8px] text-[13px] font-medium text-gray-500 hover:bg-gray-50 hover:text-[#0A0F1C] transition-all mb-[8px]"
          >
            <i className="ri-arrow-left-line text-[16px] text-gray-400" />
            <span>Back to App</span>
          </Link>

          {/* User info */}
          <div className="flex items-center gap-[10px] px-[8px] py-[8px] rounded-[8px] bg-gray-50">
            <div className="w-[32px] h-[32px] rounded-full bg-[#1B2A4A] flex items-center justify-center flex-none">
              <span className="text-[12px] font-bold text-white">
                {profile?.display_name?.[0] || profile?.email?.[0]?.toUpperCase() || "A"}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[12px] font-semibold text-[#0A0F1C] truncate">
                {profile?.display_name || "Admin"}
              </div>
              <div className="text-[10px] text-gray-400 truncate">
                Administrator
              </div>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
};

export default AdminSidebar;
