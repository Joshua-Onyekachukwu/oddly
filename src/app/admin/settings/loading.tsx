export default function AdminSettingsLoading() {
  return (
    <div>
      <div className="h-[28px] w-[180px] bg-gray-100 rounded animate-pulse mb-[4px]" />
      <div className="h-[14px] w-[260px] bg-gray-50 rounded animate-pulse mb-[24px]" />

      <div className="space-y-[16px]">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="bg-white rounded-[14px] p-[20px] border border-gray-100 animate-pulse">
            <div className="h-[16px] w-[160px] bg-gray-100 rounded mb-[16px]" />
            <div className="space-y-[12px]">
              {Array.from({ length: 3 }).map((_, j) => (
                <div key={j} className="flex items-center justify-between">
                  <div className="h-[12px] w-[140px] bg-gray-50 rounded" />
                  <div className="h-[32px] w-[200px] bg-gray-100 rounded-[8px]" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
