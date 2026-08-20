export default function AdminPipelineLoading() {
  return (
    <div>
      <div className="flex items-center justify-between mb-[24px]">
        <div>
          <div className="h-[28px] w-[200px] bg-gray-100 rounded animate-pulse mb-[4px]" />
          <div className="h-[14px] w-[300px] bg-gray-50 rounded animate-pulse" />
        </div>
        <div className="flex gap-[8px]">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-[36px] w-[100px] bg-gray-100 rounded-[10px] animate-pulse" />
          ))}
        </div>
      </div>

      <div className="grid grid-cols-4 gap-[12px] mb-[24px]">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-white rounded-[14px] p-[16px] border border-gray-100 animate-pulse">
            <div className="h-[12px] w-[80px] bg-gray-100 rounded mb-[8px]" />
            <div className="h-[28px] w-[50px] bg-gray-100 rounded" />
          </div>
        ))}
      </div>

      <div className="space-y-[6px]">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="bg-white rounded-[14px] p-[16px] border border-gray-100 animate-pulse flex items-center gap-[16px]">
            <div className="w-[24px] h-[12px] bg-gray-100 rounded" />
            <div className="w-[36px] h-[36px] bg-gray-100 rounded-[10px]" />
            <div className="flex-1">
              <div className="h-[13px] w-[140px] bg-gray-100 rounded mb-[4px]" />
              <div className="h-[11px] w-[200px] bg-gray-50 rounded" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
