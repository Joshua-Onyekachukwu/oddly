export default function ModelHealthLoading() {
  return (
    <div>
      <div className="h-[28px] w-[200px] bg-gray-100 rounded animate-pulse mb-[4px]" />
      <div className="h-[14px] w-[300px] bg-gray-50 rounded animate-pulse mb-[24px]" />

      <div className="grid grid-cols-1 md:grid-cols-4 gap-[12px] mb-[24px]">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-white rounded-[14px] p-[16px] border border-gray-100 animate-pulse">
            <div className="h-[12px] w-[80px] bg-gray-100 rounded mb-[8px]" />
            <div className="h-[28px] w-[50px] bg-gray-100 rounded" />
          </div>
        ))}
      </div>

      <div className="bg-white rounded-[14px] p-[16px] border border-gray-100 animate-pulse">
        <div className="h-[16px] w-[160px] bg-gray-100 rounded mb-[16px]" />
        <div className="space-y-[8px]">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-[12px] bg-gray-50 rounded" style={{ width: `${85 - i * 10}%` }} />
          ))}
        </div>
      </div>
    </div>
  );
}
