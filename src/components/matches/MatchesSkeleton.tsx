export function MatchesSkeleton() {
  return (
    <div className="space-y-[8px]">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="bg-white rounded-[14px] p-[16px] md:p-[20px] border border-gray-100 animate-pulse"
        >
          <div className="flex items-center justify-between mb-[12px]">
            <div className="h-[12px] w-[100px] bg-gray-100 rounded-full" />
            <div className="h-[20px] w-[50px] bg-gray-100 rounded-full" />
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-[16px] flex-1">
              <div className="flex items-center gap-[10px] flex-1">
                <div className="w-[32px] h-[32px] bg-gray-100 rounded-full" />
                <div className="h-[14px] w-[80px] bg-gray-100 rounded-full" />
              </div>
              <div className="h-[18px] w-[30px] bg-gray-100 rounded-full" />
              <div className="flex items-center gap-[10px] flex-1 justify-end">
                <div className="h-[14px] w-[80px] bg-gray-100 rounded-full" />
                <div className="w-[32px] h-[32px] bg-gray-100 rounded-full" />
              </div>
            </div>
          </div>
          <div className="mt-[12px] pt-[12px] border-t border-gray-50">
            <div className="flex items-center justify-between">
              <div className="h-[12px] w-[100px] bg-gray-100 rounded-full" />
              <div className="h-[12px] w-[60px] bg-gray-100 rounded-full" />
            </div>
            <div className="w-full bg-gray-100 rounded-full h-[2px] mt-[6px]" />
          </div>
        </div>
      ))}
    </div>
  );
}
