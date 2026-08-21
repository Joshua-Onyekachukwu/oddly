import React from "react";

/**
 * ResponsiveGrid — The core layout component for card-based pages.
 * 
 * Extracted from Upcoming Matches design language.
 * Used across: Today's Matches, Results, Admin cards, etc.
 * 
 * Desktop: 4 columns (xl), 3 columns (lg), 2 columns (sm), 1 column (mobile)
 * Adjust via `columns` prop for denser/sparser layouts.
 */

type Columns = "match" | "stat" | "admin" | "narrow";

const columnStyles: Record<Columns, string> = {
  match: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4",
  stat: "grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6",
  admin: "grid-cols-2 md:grid-cols-3 lg:grid-cols-6",
  narrow: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
};

interface ResponsiveGridProps {
  children: React.ReactNode;
  columns?: Columns;
  gap?: string;
  className?: string;
}

export function ResponsiveGrid({
  children,
  columns = "match",
  gap = "12px",
  className = "",
}: ResponsiveGridProps) {
  return (
    <div
      className={`grid ${columnStyles[columns]} ${className}`}
      style={{ gap }}
    >
      {children}
    </div>
  );
}

/**
 * FilterBar — Consistent filter/search/sort pattern.
 * 
 * Used across Upcoming Matches, Today's Matches, Results, etc.
 */

interface FilterOption {
  key: string;
  label: string;
}

interface FilterBarProps {
  dateFilters?: FilterOption[];
  activeDateFilter?: string;
  onDateFilterChange?: (key: string) => void;
  confidenceFilters?: FilterOption[];
  activeConfidenceFilter?: string;
  onConfidenceFilterChange?: (key: string) => void;
  searchPlaceholder?: string;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  leagueFilter?: React.ReactNode;
  sortToggle?: React.ReactNode;
  matchCount?: number;
  pageLabel?: string;
  children?: React.ReactNode;
}

export function FilterBar({
  dateFilters,
  activeDateFilter,
  onDateFilterChange,
  confidenceFilters,
  activeConfidenceFilter,
  onConfidenceFilterChange,
  searchPlaceholder,
  searchValue,
  onSearchChange,
  leagueFilter,
  sortToggle,
  matchCount,
  pageLabel,
  children,
}: FilterBarProps) {
  return (
    <div className="flex flex-col gap-[10px] mb-[20px]">
      {/* Row 1: Date tabs + Confidence + Sort */}
      {(dateFilters || confidenceFilters || sortToggle) && (
        <div className="flex flex-wrap items-center gap-[6px]">
          {dateFilters && (
            <div className="flex items-center gap-[4px] bg-gray-50 rounded-[10px] p-[3px]">
              {dateFilters.map((opt) => (
                <button
                  key={opt.key}
                  onClick={() => onDateFilterChange?.(opt.key)}
                  className={`px-[12px] py-[6px] rounded-[8px] text-[11px] font-semibold whitespace-nowrap transition-all ${
                    activeDateFilter === opt.key
                      ? "bg-white text-[#0A0F1C] shadow-sm"
                      : "text-gray-400 hover:text-gray-600"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}

          {confidenceFilters && (
            <div className="flex items-center gap-[4px] bg-gray-50 rounded-[10px] p-[3px]">
              {confidenceFilters.map((opt) => (
                <button
                  key={opt.key}
                  onClick={() => onConfidenceFilterChange?.(opt.key)}
                  className={`px-[10px] py-[6px] rounded-[8px] text-[11px] font-semibold whitespace-nowrap transition-all ${
                    activeConfidenceFilter === opt.key
                      ? "bg-white text-[#0A0F1C] shadow-sm"
                      : "text-gray-400 hover:text-gray-600"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}

          {sortToggle}
        </div>
      )}

      {/* Row 2: Search + League + Count */}
      {(searchPlaceholder || leagueFilter || matchCount !== undefined) && (
        <div className="flex flex-wrap items-center gap-[8px]">
          {searchPlaceholder && (
            <div className="relative flex-1 min-w-[180px] max-w-[320px]">
              <i className="ri-search-line absolute left-[10px] top-1/2 -translate-y-1/2 text-[13px] text-gray-300" />
              <input
                type="text"
                placeholder={searchPlaceholder}
                value={searchValue || ""}
                onChange={(e) => onSearchChange?.(e.target.value)}
                className="w-full h-[34px] rounded-[10px] border border-gray-100 bg-gray-50 pl-[30px] pr-[12px] text-[12px] text-[#0A0F1C] placeholder:text-gray-300 focus:outline-none focus:ring-1 focus:ring-[#1B2A4A]/20 focus:border-[#1B2A4A]/20 transition-all"
              />
              {searchValue && (
                <button
                  onClick={() => onSearchChange?.("")}
                  className="absolute right-[8px] top-1/2 -translate-y-1/2 text-[12px] text-gray-300 hover:text-gray-500"
                >
                  ✕
                </button>
              )}
            </div>
          )}

          {leagueFilter}

          {matchCount !== undefined && (
            <div className="flex items-center gap-[6px] text-[11px] text-gray-400 ml-auto">
              <span className="font-mono-data font-bold text-[#0A0F1C]">{matchCount}</span>
              <span>match{matchCount !== 1 ? "es" : ""}</span>
            </div>
          )}
        </div>
      )}

      {children}
    </div>
  );
}

/**
 * SkeletonGrid — Loading placeholder grid that matches ResponsiveGrid layout.
 */

export function SkeletonGrid({ count = 8, columns = "match" as Columns }) {
  return (
    <ResponsiveGrid columns={columns}>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="bg-white rounded-[14px] border border-gray-100 overflow-hidden animate-pulse"
        >
          <div className="px-[14px] pt-[12px] pb-[8px] flex items-center justify-between">
            <div className="h-[12px] w-[80px] bg-gray-100 rounded" />
            <div className="h-[12px] w-[60px] bg-gray-100 rounded" />
          </div>
          <div className="px-[14px] py-[8px]">
            <div className="flex items-center gap-[10px]">
              <div className="flex items-center gap-[8px] flex-1">
                <div className="w-[28px] h-[28px] bg-gray-100 rounded-full" />
                <div className="h-[14px] w-[80px] bg-gray-100 rounded" />
              </div>
              <div className="h-[14px] w-[20px] bg-gray-100 rounded" />
              <div className="flex items-center gap-[8px] flex-1 justify-end">
                <div className="h-[14px] w-[80px] bg-gray-100 rounded" />
                <div className="w-[28px] h-[28px] bg-gray-100 rounded-full" />
              </div>
            </div>
          </div>
          <div className="px-[14px] pb-[12px] pt-[8px] border-t border-gray-50">
            <div className="h-[16px] w-[100px] bg-gray-100 rounded" />
          </div>
        </div>
      ))}
    </ResponsiveGrid>
  );
}
