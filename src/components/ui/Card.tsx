import React from "react";

interface CardProps {
  children: React.ReactNode;
  className?: string;
  padding?: "none" | "sm" | "md" | "lg";
  hover?: boolean;
}

export function Card({ children, className = "", padding = "md", hover = false }: CardProps) {
  const paddingMap = {
    none: "",
    sm: "p-[14px]",
    md: "p-[20px]",
    lg: "p-[24px]",
  };

  return (
    <div
      className={`
        bg-white rounded-[14px] border border-gray-100
        ${paddingMap[padding]}
        ${    hover ? "transition-shadow duration-200 ease-out hover:border-gray-200 hover:shadow-[0_2px_12px_rgba(0,0,0,0.04)]" : ""}
        ${className}
      `}
    >
      {children}
    </div>
  );
}

interface CardHeaderProps {
  title: string;
  description?: string;
  action?: React.ReactNode;
  icon?: string;
}

export function CardHeader({ title, description, action, icon }: CardHeaderProps) {
  return (
    <div className="flex items-start justify-between mb-[16px]">
      <div className="flex items-center gap-[10px]">
        {icon && (
          <div className="w-[32px] h-[32px] rounded-[8px] bg-gray-50 flex items-center justify-center flex-none">
            <i className={`${icon} text-[16px] text-gray-500`} />
          </div>
        )}
        <div>
          <h3 className="text-[14px] font-semibold text-[#0A0F1C]">{title}</h3>
          {description && (
            <p className="text-[12px] text-gray-400 mt-[2px]">{description}</p>
          )}
        </div>
      </div>
      {action && <div>{action}</div>}
    </div>
  );
}
