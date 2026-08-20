export default function AIChatLoading() {
  return (
    <div className="flex flex-col h-[calc(100vh-140px)]">
      <div className="mb-[16px]">
        <div className="h-[28px] w-[160px] bg-gray-100 rounded-full mb-[8px] animate-pulse"></div>
        <div className="h-[16px] w-[250px] bg-gray-50 rounded-full animate-pulse"></div>
      </div>
      <div className="flex-1 bg-white rounded-[16px] border border-gray-100 p-[20px] animate-pulse">
        <div className="space-y-[16px]">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className={`flex ${i % 2 === 0 ? "justify-start" : "justify-end"}`}>
              <div className={`max-w-[70%] h-[40px] rounded-[12px] ${i % 2 === 0 ? "bg-gray-100" : "bg-[#1B2A4A]/5"}`}></div>
            </div>
          ))}
        </div>
      </div>
      <div className="mt-[16px] h-[44px] bg-gray-100 rounded-[12px] animate-pulse"></div>
    </div>
  );
}
