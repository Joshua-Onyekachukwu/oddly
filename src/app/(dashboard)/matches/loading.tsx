export default function MatchesLoading() {
  return (
    <div>
      <div className="flex items-center justify-between mb-[24px]">
        <div>
          <div className="h-[28px] w-[200px] bg-gray-100 rounded animate-pulse mb-[4px]" />
          <div className="h-[14px] w-[280px] bg-gray-50 rounded animate-pulse" />
        </div>
        <div className="flex gap-[8px]">
          <div className="h-[36px] w-[100px] bg-gray-100 rounded-[10px] animate-pulse" />
          <div className="h-[36px] w-[80px] bg-gray-100 rounded-[10px] animate-pulse" />
        </div>
      </div>

      {/* Filter tabs skeleton */}
      <div className="flex gap-[8px] mb-[20px]">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-[30px] w-[80px] bg-gray-100 rounded-full animate-pulse" />
        ))}
      </div>

      {/* Match cards skeleton */}
      <div className="space-y-[8px]">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="bg-white rounded-[14px] p-[16px] border border-gray-100 animate-pulse">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-[12px]">
                <div className="w-[32px] h-[32px] bg-gray-100 rounded-full" />
                <div className="space-y-[6px]">
                  <div className="h-[13px] w-[120px] bg-gray-100 rounded" />
                  <div className="h-[11px] w-[80px] bg-gray-50 rounded" />
                </div>
              </div>
              <div className="h-[24px] w-[60px] bg-gray-100 rounded" />
              <div className="flex items-center gap-[12px]">
                <div className="w-[32px] h-[32px] bg-gray-100 rounded-full" />
                <div className="space-y-[6px]">
                  <div className="h-[13px] w-[120px] bg-gray-100 rounded" />
                  <div className="h-[11px] w-[80px] bg-gray-50 rounded" />
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
