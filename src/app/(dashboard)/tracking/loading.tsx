export default function TrackingLoading() {
  return (
    <div>
      <div className="flex items-center justify-between mb-[24px]">
        <div>
          <div className="h-[28px] w-[180px] bg-gray-100 rounded-full mb-[8px] animate-pulse"></div>
          <div className="h-[16px] w-[280px] bg-gray-50 rounded-full animate-pulse"></div>
        </div>
        <div className="h-[36px] w-[100px] bg-gray-100 rounded-[10px] animate-pulse"></div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-[12px] mb-[24px]">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-white rounded-[14px] p-[16px] border border-gray-100 animate-pulse">
            <div className="h-[12px] w-[70px] bg-gray-100 rounded-full mb-[4px]"></div>
            <div className="h-[20px] w-[50px] bg-gray-50 rounded-full"></div>
          </div>
        ))}
      </div>
      <div className="space-y-[8px]">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-white rounded-[14px] p-[16px] border border-gray-100 animate-pulse">
            <div className="flex items-center justify-between">
              <div className="space-y-[6px]">
                <div className="h-[14px] w-[150px] bg-gray-100 rounded-full"></div>
                <div className="h-[12px] w-[100px] bg-gray-50 rounded-full"></div>
              </div>
              <div className="h-[24px] w-[60px] bg-gray-100 rounded-full"></div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
