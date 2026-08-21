import React from "react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "success";
type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: string;
  iconPosition?: "left" | "right";
}

const variantStyles: Record<ButtonVariant, string> = {
  primary: "bg-[#1B2A4A] text-white hover:bg-[#243B53] active:bg-[#102A43]",
  secondary: "bg-gray-100 text-gray-700 hover:bg-gray-200 active:bg-gray-300",
  ghost: "bg-transparent text-gray-600 hover:bg-gray-50 active:bg-gray-100",
  danger: "bg-red-50 text-red-600 hover:bg-red-100 active:bg-red-200",
  success: "bg-green-50 text-green-600 hover:bg-green-100 active:bg-green-200",
};

const sizeStyles: Record<ButtonSize, string> = {
  sm: "h-[32px] px-[12px] text-[12px] rounded-[8px] gap-[6px]",
  md: "h-[36px] px-[16px] text-[13px] rounded-[10px] gap-[8px]",
  lg: "h-[44px] px-[20px] text-[14px] rounded-[12px] gap-[8px]",
};

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  icon,
  iconPosition = "left",
  children,
  className = "",
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      className={`
        inline-flex items-center justify-center font-semibold
        transition-all duration-200
        active:scale-[0.98]
        disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100
        ${variantStyles[variant]}
        ${sizeStyles[size]}
        ${className}
      `}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <div className="w-[14px] h-[14px] border-2 border-current/30 border-t-current rounded-full animate-spin" />
      ) : (
        <>
          {icon && iconPosition === "left" && <i className={`${icon} text-[14px]`} />}
          {children}
          {icon && iconPosition === "right" && <i className={`${icon} text-[14px]`} />}
        </>
      )}
    </button>
  );
}
