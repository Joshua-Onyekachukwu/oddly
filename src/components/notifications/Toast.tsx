"use client";

import React, { useState, useEffect, useCallback } from "react";

interface Toast {
  id: string;
  type: "success" | "error" | "info" | "warning";
  title: string;
  message: string;
}

let toastId = 0;
const listeners: Array<(toast: Toast) => void> = [];

/**
 * Show a toast notification from anywhere in the app.
 */
export function showToast(
  type: Toast["type"],
  title: string,
  message: string
): void {
  const id = String(++toastId);
  const toast = { id, type, title, message };
  listeners.forEach((l) => l(toast));
}

function getToastStyle(type: Toast["type"]) {
  switch (type) {
    case "success":
      return { bg: "bg-white", border: "border-[#22c55e]/20", icon: "ri-check-line", iconColor: "text-[#22c55e]", iconBg: "bg-[#22c55e]/10" };
    case "error":
      return { bg: "bg-white", border: "border-[#EF4444]/20", icon: "ri-close-circle-line", iconColor: "text-[#EF4444]", iconBg: "bg-[#EF4444]/10" };
    case "warning":
      return { bg: "bg-white", border: "border-[#D97706]/20", icon: "ri-alert-line", iconColor: "text-[#D97706]", iconBg: "bg-[#D97706]/10" };
    default:
      return { bg: "bg-white", border: "border-[#2563EB]/20", icon: "ri-information-line", iconColor: "text-[#2563EB]", iconBg: "bg-[#2563EB]/10" };
  }
}

export function ToastContainer() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((toast: Toast) => {
    setToasts((prev) => [...prev, toast]);

    // Auto-remove after 5s
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== toast.id));
    }, 5000);
  }, []);

  useEffect(() => {
    listeners.push(addToast);
    return () => {
      const idx = listeners.indexOf(addToast);
      if (idx >= 0) listeners.splice(idx, 1);
    };
  }, [addToast]);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-[24px] right-[24px] z-[100] space-y-[8px] max-w-[360px]">
      {toasts.map((toast) => {
        const style = getToastStyle(toast.type);
        return (
          <div
            key={toast.id}
            className={`${style.bg} border ${style.border} rounded-[12px] p-[14px] shadow-[0_8px_30px_-8px_rgba(0,0,0,0.12)] flex items-start gap-[12px] animate-[slideInRight_0.3s_ease-out]`}
          >
            <div className={`w-[28px] h-[28px] ${style.iconBg} rounded-full flex items-center justify-center flex-none mt-[2px]`}>
              <i className={`${style.icon} text-[14px] ${style.iconColor}`}></i>
            </div>
            <div className="flex-1 min-w-0">
              <h4 className="text-[13px] font-semibold text-[#0A0F1C] mb-[2px]">
                {toast.title}
              </h4>
              <p className="text-[12px] text-gray-500 leading-[1.4]">
                {toast.message}
              </p>
            </div>
            <button
              onClick={() => setToasts((prev) => prev.filter((t) => t.id !== toast.id))}
              className="text-gray-300 hover:text-gray-500 transition-colors flex-none"
            >
              <i className="ri-close-line text-[14px]"></i>
            </button>
          </div>
        );
      })}
    </div>
  );
}
