import React from "react";

interface PageHeaderProps {
  title: string;
  description?: string;
  action?: React.ReactNode;
  breadcrumbs?: Array<{ label: string; href?: string }>;
  className?: string;
}

export function PageHeader({
  title,
  description,
  action,
  breadcrumbs,
  className = "",
}: PageHeaderProps) {
  return (
    <div className={`mb-[24px] ${className}`}>
      {breadcrumbs && breadcrumbs.length > 0 && (
        <div className="flex items-center gap-[6px] mb-[8px]">
          {breadcrumbs.map((crumb, i) => (
            <React.Fragment key={i}>
              {i > 0 && <span className="text-[12px] text-gray-300">/</span>}
              {crumb.href ? (
                <a
                  href={crumb.href}
                  className="text-[12px] text-gray-400 hover:text-gray-600 transition-colors"
                >
                  {crumb.label}
                </a>
              ) : (
                <span className="text-[12px] text-gray-500 font-medium">
                  {crumb.label}
                </span>
              )}
            </React.Fragment>
          ))}
        </div>
      )}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-display text-[22px] md:text-[26px] font-bold text-[#0A0F1C] mb-[4px]">
            {title}
          </h1>
          {description && (
            <p className="text-[13px] text-gray-500">{description}</p>
          )}
        </div>
        {action && <div>{action}</div>}
      </div>
    </div>
  );
}
