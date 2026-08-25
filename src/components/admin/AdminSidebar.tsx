"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/providers/AuthProvider";

interface AdminSidebarProps {
  toggleActive: () => void;
  isOpen?: boolean;
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
      { label: "One Game Pick", href: "/admin/picks", icon: "ri-crosshair-2-line" },
      { label: "AI Monitor", href: "/admin/ai-monitor", icon: "ri-robot-2-line" },
      { label: "Model Health", href: "/admin/model-health", icon: "ri-heart-pulse-line" },
      { label: "Accuracy Analysis", href: "/admin/accuracy", icon: "ri-line-chart-line" },
      { label: "Referee Intelligence", href: "/admin/referees", icon: "ri-user-star-line" },
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
      { label: "Security", href: "/admin/security", icon: "ri-shield-check-line" },
      { label: "System Health", href: "/admin/system-health", icon: "ri-heart-pulse-line" },
      { label: "Database Health", href: "/admin/db-health", icon: "ri-database-2-line" },
      { label: "Convex Health", href: "/admin/convex-health", icon: "ri-cloud-line" },
      { label: "Settings", href: "/admin/settings", icon: "ri-settings-3-line" },
    ],
  },
];

const AdminSidebar: React.FC<AdminSidebarProps> = ({ toggleActive, isOpen }) => {
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
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-[6] xl:hidden transition-opacity duration-300"
          onClick={toggleActive}
        />
      )}

      {/* Sidebar */}
      <aside className={`fixed top-0 left-0 h-screen w-[260px] bg-[#0A0F1C] border-r border-white/5 z-[7] flex flex-col transition-transform duration-300 xl:translate-x-0 ${isOpen ? "translate-x-0" : "-translate-x-full"}`}>
        {/* Logo + Admin badge */}
        <div className="h-[60px] flex items-center justify-between px-[20px] border-b border-white/5 flex-none">
          <Link href="/admin" className="flex items-center gap-[8px]">
            <span className="text-[22px] font-display font-bold tracking-tight text-white">
              ODD
            </span>
            <span className="text-[22px] font-display font-bold tracking-tight text-[#BFFF00]">
              LY
            </span>
            <span className="text-[9px] font-bold px-[6px] py-[2px] rounded-full bg-white/10 text-white/80 uppercase tracking-wider">
              Admin
            </span>
          </Link>
          <button
            type="button"
            onClick={toggleActive}
            className="w-[32px] h-[32px] rounded-[8px] flex items-center justify-center text-white/40 hover:text-white/70 hover:bg-white/5 transition-colors xl:hidden"
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
                className="w-full flex items-center justify-between px-[8px] py-[6px] text-[10px] font-semibold text-white/30 uppercase tracking-wider hover:text-white/50 transition-colors"
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
                              ? "bg-[#BFFF00]/10 text-[#BFFF00]"
                              : "text-white/50 hover:bg-white/5 hover:text-white/80"
                          }
                        `}
                      >
                        <i
                          className={`${item.icon} text-[16px] ${
                            active ? "text-[#BFFF00]" : "text-white/30"
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
        <div className="border-t border-white/5 p-[12px] flex-none">
          {/* Back to app link */}
          <Link
            href="/matches"
            className="flex items-center gap-[10px] px-[10px] py-[8px] rounded-[8px] text-[13px] font-medium text-white/40 hover:bg-white/5 hover:text-white/70 transition-all mb-[8px]"
          >
            <i className="ri-arrow-left-line text-[16px] text-white/30" />
            <span>Back to App</span>
          </Link>

          {/* User info */}
          <div className="flex items-center gap-[10px] px-[8px] py-[8px] rounded-[8px] bg-white/5">
            <div className="w-[32px] h-[32px] rounded-full bg-[#BFFF00]/20 flex items-center justify-center flex-none">
              <span className="text-[12px] font-bold text-[#BFFF00]">
                {profile?.display_name?.[0] || profile?.email?.[0]?.toUpperCase() || "A"}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[12px] font-semibold text-white/80 truncate">
                {profile?.display_name || "Admin"}
              </div>
              <div className="text-[10px] text-white/30 truncate">
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
