export default function RolloverLoading() {
  return (
    <div>
      <div className="flex items-center justify-between mb-[24px]">
        <div>
          <div className="h-[28px] w-[240px] bg-gray-100 rounded-full mb-[8px] animate-pulse"></div>
          <div className="h-[16px] w-[350px] bg-gray-50 rounded-full animate-pulse"></div>
        </div>
        <div className="h-[36px] w-[120px] bg-gray-100 rounded-[10px] animate-pulse"></div>
      </div>
      <div className="bg-white rounded-[16px] p-[24px] border border-gray-100 animate-pulse mb-[24px]">
        <div className="flex items-center gap-[8px] mb-[20px]">
          <div className="h-[18px] w-[160px] bg-gray-100 rounded-full"></div>
          <div className="h-[20px] w-[60px] bg-gray-50 rounded-full"></div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-[12px]">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="p-[14px] bg-gray-50 rounded-[12px]">
              <div className="h-[10px] w-[60px] bg-gray-200 rounded-full mb-[4px]"></div>
              <div className="h-[18px] w-[80px] bg-gray-100 rounded-full"></div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
