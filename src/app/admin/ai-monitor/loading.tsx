export default function AIMonitorLoading() {
  return (
    <div>
      <div className="h-[28px] w-[200px] bg-gray-100 rounded animate-pulse mb-[4px]" />
      <div className="h-[14px] w-[320px] bg-gray-50 rounded animate-pulse mb-[24px]" />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-[12px] mb-[24px]">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="bg-white rounded-[14px] p-[16px] border border-gray-100 animate-pulse">
            <div className="h-[14px] w-[100px] bg-gray-100 rounded mb-[8px]" />
            <div className="h-[28px] w-[60px] bg-gray-100 rounded" />
          </div>
        ))}
      </div>

      <div className="space-y-[4px]">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-white rounded-[14px] p-[16px] border border-gray-100 animate-pulse">
            <div className="h-[13px] w-[200px] bg-gray-100 rounded mb-[8px]" />
            <div className="h-[11px] w-[300px] bg-gray-50 rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}
