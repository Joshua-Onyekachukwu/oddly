export default function MatchesUpcomingLoading() {
  return (
    <div>
      <div className="mb-[24px]">
        <div className="h-[28px] w-[220px] bg-gray-100 rounded animate-pulse mb-[4px]" />
        <div className="h-[14px] w-[300px] bg-gray-50 rounded animate-pulse" />
      </div>

      <div className="space-y-[8px]">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="bg-white rounded-[14px] p-[16px] border border-gray-100 animate-pulse">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-[12px]">
                <div className="w-[32px] h-[32px] bg-gray-100 rounded-full" />
                <div className="space-y-[6px]">
                  <div className="h-[13px] w-[140px] bg-gray-100 rounded" />
                  <div className="h-[11px] w-[90px] bg-gray-50 rounded" />
                </div>
              </div>
              <div className="h-[24px] w-[60px] bg-gray-100 rounded" />
              <div className="flex items-center gap-[12px]">
                <div className="w-[32px] h-[32px] bg-gray-100 rounded-full" />
                <div className="space-y-[6px]">
                  <div className="h-[13px] w-[140px] bg-gray-100 rounded" />
                  <div className="h-[11px] w-[90px] bg-gray-50 rounded" />
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
