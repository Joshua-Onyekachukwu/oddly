"use client";

import React, { useState, ReactNode } from "react";
import SidebarMenu from "@/components/layout/SidebarMenu";
import Header from "@/components/layout/Header";

interface LayoutProviderProps {
  children: ReactNode;
}

const LayoutProvider: React.FC<LayoutProviderProps> = ({ children }) => {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const toggleSidebar = () => {
    setSidebarOpen(!sidebarOpen);
  };

  return (
    <div className="min-h-screen bg-[#FAFBFC]">
      {/* Sidebar */}
      <SidebarMenu toggleActive={toggleSidebar} />

      {/* Header */}
      <Header toggleActive={toggleSidebar} />

      {/* Main content */}
      <main className="pt-[56px] xl:pl-[260px] min-h-screen">
        <div className="p-[16px] xl:p-[24px]">
          {children}
        </div>
      </main>
    </div>
  );
};

export default LayoutProvider;
