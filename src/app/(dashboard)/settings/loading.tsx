export default function SettingsLoading() {
  return (
    <div className="max-w-[600px]">
      <div className="mb-[24px]">
        <div className="h-[28px] w-[120px] bg-gray-100 rounded-full mb-[8px] animate-pulse"></div>
        <div className="h-[16px] w-[250px] bg-gray-50 rounded-full animate-pulse"></div>
      </div>
      {[1, 2, 3].map((i) => (
        <div key={i} className="bg-white rounded-[16px] p-[20px] border border-gray-100 mb-[16px] animate-pulse">
          <div className="h-[16px] w-[100px] bg-gray-100 rounded-full mb-[16px]"></div>
          <div className="space-y-[12px]">
            <div className="h-[38px] w-full bg-gray-50 rounded-[10px]"></div>
            <div className="h-[38px] w-full bg-gray-50 rounded-[10px]"></div>
          </div>
        </div>
      ))}
    </div>
  );
}
