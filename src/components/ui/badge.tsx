import React from "react";

type BadgeVariant = "default" | "success" | "warning" | "danger" | "info" | "accent";
type BadgeSize = "sm" | "md";

interface BadgeProps {
  children: React.ReactNode;
  variant?: BadgeVariant;
  size?: BadgeSize;
  dot?: boolean;
  className?: string;
}

const variantStyles: Record<BadgeVariant, string> = {
  default: "bg-gray-100 text-gray-600",
  success: "bg-green-50 text-green-600",
  warning: "bg-amber-50 text-amber-600",
  danger: "bg-red-50 text-red-600",
  info: "bg-blue-50 text-blue-600",
  accent: "bg-[#BFFF00]/10 text-[#1B2A4A]",
};

const dotColors: Record<BadgeVariant, string> = {
  default: "bg-gray-400",
  success: "bg-green-500",
  warning: "bg-amber-500",
  danger: "bg-red-500",
  info: "bg-blue-500",
  accent: "bg-[#BFFF00]",
};

const sizeStyles: Record<BadgeSize, string> = {
  sm: "text-[10px] px-[6px] py-[2px]",
  md: "text-[11px] px-[8px] py-[3px]",
};

export function Badge({
  children,
  variant = "default",
  size = "md",
  dot = false,
  className = "",
}: BadgeProps) {
  return (
    <span
      className={`
        inline-flex items-center gap-[4px] font-semibold rounded-full
        ${variantStyles[variant]}
        ${sizeStyles[size]}
        ${className}
      `}
    >
      {dot && (
        <span className={`w-[4px] h-[4px] rounded-full ${dotColors[variant]}`} />
      )}
      {children}
    </span>
  );
}
