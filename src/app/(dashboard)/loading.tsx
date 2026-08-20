export default function DashboardLoading() {
  return (
    <div className="min-h-screen bg-[#FAFBFC]">
      {/* Sidebar skeleton */}
      <div className="hidden xl:block fixed top-0 left-0 w-[270px] h-screen bg-white border-r border-gray-100 animate-pulse">
        <div className="p-[24px]">
          <div className="h-[24px] w-[100px] bg-gray-100 rounded-[8px]" />
        </div>
        <div className="px-[16px] space-y-[8px]">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-[40px] bg-gray-50 rounded-[10px]" />
          ))}
        </div>
      </div>

      {/* Header skeleton */}
      <div className="fixed top-0 left-0 right-0 h-[72px] bg-white border-b border-gray-100 animate-pulse xl:left-[270px]" />

      {/* Content skeleton */}
      <div className="pt-[96px] xl:pl-[270px] p-[24px]">
        <div className="space-y-[24px]">
          <div className="h-[32px] w-[200px] bg-gray-100 rounded-[8px]" />
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-[16px]">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-[200px] bg-white rounded-[16px] border border-gray-100 animate-pulse" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
