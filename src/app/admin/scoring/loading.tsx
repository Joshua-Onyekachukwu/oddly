export default function ScoringLoading() {
  return (
    <div>
      <div className="h-[28px] w-[200px] bg-gray-100 rounded animate-pulse mb-[4px]" />
      <div className="h-[14px] w-[260px] bg-gray-50 rounded animate-pulse mb-[24px]" />

      <div className="bg-white rounded-[14px] p-[16px] border border-gray-100 animate-pulse">
        <div className="h-[16px] w-[180px] bg-gray-100 rounded mb-[16px]" />
        <div className="space-y-[12px]">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-[12px]">
              <div className="h-[12px] w-[120px] bg-gray-100 rounded" />
              <div className="h-[12px] flex-1 bg-gray-50 rounded" />
              <div className="h-[12px] w-[60px] bg-gray-100 rounded" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
