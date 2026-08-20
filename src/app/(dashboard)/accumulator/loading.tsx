export default function AccumulatorLoading() {
  return (
    <div>
      <div className="mb-[24px]">
        <div className="h-[28px] w-[200px] bg-gray-100 rounded-full mb-[8px] animate-pulse"></div>
        <div className="h-[16px] w-[300px] bg-gray-50 rounded-full animate-pulse"></div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-[24px]">
        <div className="space-y-[8px]">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-white rounded-[14px] p-[16px] border border-gray-100 animate-pulse">
              <div className="flex items-center justify-between">
                <div className="space-y-[6px]">
                  <div className="h-[14px] w-[180px] bg-gray-100 rounded-full"></div>
                  <div className="h-[12px] w-[120px] bg-gray-50 rounded-full"></div>
                </div>
                <div className="h-[24px] w-[60px] bg-gray-100 rounded-full"></div>
              </div>
            </div>
          ))}
        </div>
        <div className="bg-white rounded-[16px] p-[20px] border border-gray-100 animate-pulse">
          <div className="h-[16px] w-[140px] bg-gray-100 rounded-full mb-[16px]"></div>
          <div className="space-y-[8px]">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-[36px] bg-gray-50 rounded-[10px]"></div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
