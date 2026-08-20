export function MatchDetailSkeleton() {
  return (
    <div className="space-y-[24px] animate-pulse">
      {/* Header skeleton */}
      <div className="bg-white rounded-[16px] p-[24px] md:p-[32px] border border-gray-100">
        <div className="flex items-center justify-between mb-[20px]">
          <div className="h-[12px] w-[120px] bg-gray-100 rounded-full"></div>
          <div className="h-[24px] w-[50px] bg-gray-100 rounded-full"></div>
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-[12px] flex-1">
            <div className="w-[44px] h-[44px] bg-gray-100 rounded-full"></div>
            <div className="h-[18px] w-[100px] bg-gray-100 rounded-full"></div>
          </div>
          <div className="h-[28px] w-[80px] bg-gray-100 rounded-full"></div>
          <div className="flex items-center gap-[12px] flex-1 justify-end">
            <div className="h-[18px] w-[100px] bg-gray-100 rounded-full"></div>
            <div className="w-[44px] h-[44px] bg-gray-100 rounded-full"></div>
          </div>
        </div>
      </div>

      {/* Tabs skeleton */}
      <div className="h-[40px] bg-gray-50 rounded-[12px]"></div>

      {/* Content skeletons */}
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="bg-white rounded-[14px] p-[20px] border border-gray-100">
          <div className="flex items-center justify-between mb-[12px]">
            <div className="h-[14px] w-[120px] bg-gray-100 rounded-full"></div>
            <div className="h-[20px] w-[60px] bg-gray-100 rounded-full"></div>
          </div>
          <div className="h-[3px] w-full bg-gray-100 rounded-full mb-[12px]"></div>
          <div className="flex gap-[8px]">
            <div className="h-[20px] w-[80px] bg-gray-100 rounded-full"></div>
            <div className="h-[20px] w-[80px] bg-gray-100 rounded-full"></div>
          </div>
        </div>
      ))}
    </div>
  );
}
