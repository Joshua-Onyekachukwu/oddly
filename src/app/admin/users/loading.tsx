export default function AdminUsersLoading() {
  return (
    <div>
      <div className="h-[28px] w-[160px] bg-gray-100 rounded animate-pulse mb-[4px]" />
      <div className="h-[14px] w-[240px] bg-gray-50 rounded animate-pulse mb-[24px]" />

      <div className="bg-white rounded-[14px] border border-gray-100 overflow-hidden">
        <div className="p-[16px] border-b border-gray-50 flex items-center justify-between">
          <div className="h-[13px] w-[160px] bg-gray-100 rounded" />
          <div className="h-[30px] w-[120px] bg-gray-100 rounded-[10px]" />
        </div>
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="p-[16px] border-b border-gray-50 last:border-b-0 animate-pulse">
            <div className="flex items-center gap-[12px]">
              <div className="w-[32px] h-[32px] bg-gray-100 rounded-full" />
              <div className="flex-1 space-y-[6px]">
                <div className="h-[13px] w-[140px] bg-gray-100 rounded" />
                <div className="h-[11px] w-[200px] bg-gray-50 rounded" />
              </div>
              <div className="h-[24px] w-[70px] bg-gray-100 rounded-full" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
