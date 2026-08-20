export default function AdminLoading() {
  return (
    <div>
      <div className="mb-[24px]">
        <div className="h-[28px] w-[200px] bg-gray-100 rounded-full mb-[8px] animate-pulse"></div>
        <div className="h-[16px] w-[300px] bg-gray-50 rounded-full animate-pulse"></div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-[12px] mb-[24px]">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="bg-white rounded-[14px] p-[16px] border border-gray-100 animate-pulse">
            <div className="flex items-center gap-[10px] mb-[8px]">
              <div className="w-[32px] h-[32px] bg-gray-100 rounded-[8px]"></div>
              <div className="h-[12px] w-[80px] bg-gray-50 rounded-full"></div>
            </div>
            <div className="h-[22px] w-[60px] bg-gray-100 rounded-full"></div>
          </div>
        ))}
      </div>
      <div className="space-y-[8px]">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-[48px] bg-white rounded-[14px] border border-gray-100 animate-pulse"></div>
        ))}
      </div>
    </div>
  );
}
