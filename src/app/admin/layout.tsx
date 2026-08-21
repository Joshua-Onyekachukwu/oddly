"use client";

import React, { useState } from "react";
import { useAuth } from "@/providers/AuthProvider";
import { useRouter } from "next/navigation";
import AdminSidebar from "@/components/admin/AdminSidebar";
import NotificationBell from "@/components/notifications/NotificationBell";

export const metadata = {
  title: {
    template: "%s | ODDLY Admin",
    default: "ODDLY Admin Dashboard",
  },
  description: "ODDLY Admin Dashboard — system health, model performance, and user activity.",
};

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { session, loading: authLoading } = useAuth();
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Redirect to login if not authenticated
  React.useEffect(() => {
    if (!authLoading && !session) {
      router.push("/login?redirect=/admin");
    }
  }, [session, authLoading, router]);

  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#F8F9FC] flex items-center justify-center">
        <div className="flex flex-col items-center gap-[12px]">
          <div className="w-[32px] h-[32px] border-2 border-gray-200 border-t-[#1B2A4A] rounded-full animate-spin" />
          <span className="text-[13px] text-gray-400">Loading admin...</span>
        </div>
      </div>
    );
  }

  if (!session) return null;

  return (
    <div className="min-h-screen bg-[#F8F9FC]">
      <AdminSidebar toggleActive={() => setSidebarOpen(!sidebarOpen)} />

      {/* Main content area */}
      <div className="xl:ml-[260px] min-h-screen flex flex-col">
        {/* Header */}
        <header className="h-[56px] bg-white/80 backdrop-blur-sm border-b border-gray-100 flex items-center justify-between px-[20px] sticky top-0 z-[5] flex-none">
          {/* Mobile menu button */}
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="w-[36px] h-[36px] rounded-[8px] flex items-center justify-center text-gray-500 hover:bg-gray-50 transition-colors xl:hidden"
          >
            <i className="ri-menu-line text-[20px]" />
          </button>

          {/* Spacer for desktop */}
          <div className="hidden xl:block" />

          {/* Right side */}
          <div className="flex items-center gap-[12px]">
            <NotificationBell />
            <div className="w-[32px] h-[32px] rounded-full bg-[#1B2A4A] flex items-center justify-center">
              <span className="text-[12px] font-bold text-white">A</span>
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 p-[20px] md:p-[24px]">
          {children}
        </main>
      </div>
    </div>
  );
}
