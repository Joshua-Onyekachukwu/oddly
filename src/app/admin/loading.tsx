export default function AdminLoading() {
  return (
    <div className="animate-pulse">
      <div className="h-[26px] bg-gray-100 rounded-[6px] w-[200px] mb-[4px]" />
      <div className="h-[13px] bg-gray-50 rounded w-[300px] mb-[24px]" />
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-[12px] mb-[24px]">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="bg-white rounded-[10px] p-[16px] border border-gray-100">
            <div className="flex items-center gap-[10px] mb-[8px]">
              <div className="w-[32px] h-[32px] bg-gray-100 rounded-[8px]" />
              <div className="h-[10px] bg-gray-100 rounded w-[60px]" />
            </div>
            <div className="h-[20px] bg-gray-100 rounded w-[40px]" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-[8px] mb-[24px]">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="bg-white rounded-[10px] p-[14px] border border-gray-100">
            <div className="h-[18px] bg-gray-100 rounded mb-[6px]" />
            <div className="h-[10px] bg-gray-50 rounded w-[80%]" />
          </div>
        ))}
      </div>
      <div className="bg-white rounded-[10px] p-[20px] border border-gray-100">
        <div className="h-[14px] bg-gray-100 rounded w-[120px] mb-[16px]" />
        <div className="space-y-[6px]">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-[40px] bg-gray-50 rounded-[8px]" />
          ))}
        </div>
      </div>
    </div>
  );
}
