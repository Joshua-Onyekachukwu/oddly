export default function AnnouncementsLoading() {
  return (
    <div>
      <div className="h-[28px] w-[220px] bg-gray-100 rounded animate-pulse mb-[4px]" />
      <div className="h-[14px] w-[280px] bg-gray-50 rounded animate-pulse mb-[24px]" />

      <div className="space-y-[4px]">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="bg-white rounded-[14px] p-[16px] border border-gray-100 animate-pulse">
            <div className="flex items-center justify-between mb-[8px]">
              <div className="h-[13px] w-[180px] bg-gray-100 rounded" />
              <div className="h-[24px] w-[80px] bg-gray-100 rounded-full" />
            </div>
            <div className="h-[11px] w-[300px] bg-gray-50 rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}
