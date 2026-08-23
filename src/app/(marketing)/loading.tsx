export default function MarketingLoading() {
  return (
    <div className="min-h-screen bg-[#FAFBFC]">
      {/* Navbar skeleton */}
      <div className="fixed top-0 left-0 right-0 z-[999] flex justify-center px-4 pt-4 md:pt-5">
        <div className="w-full max-w-[920px] h-[56px] md:h-[60px] px-4 md:px-6 rounded-full bg-white/40 backdrop-blur-xl animate-pulse" />
      </div>

      {/* Hero skeleton */}
      <div className="px-4 md:px-6 pt-[80px]">
        <div className="bg-[#0A0F1C] py-[60px] md:py-[100px] xl:px-[80px] xl:rounded-[2.5rem]">
          <div className="container mx-auto px-[16px]">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-[48px] items-center">
              <div className="space-y-[24px]">
                <div className="h-[12px] w-[220px] bg-white/10 rounded-full animate-pulse" />
                <div className="space-y-[16px]">
                  <div className="h-[36px] md:h-[48px] lg:h-[56px] w-[85%] bg-white/10 rounded-[8px] animate-pulse" />
                  <div className="h-[36px] md:h-[48px] lg:h-[56px] w-[65%] bg-white/10 rounded-[8px] animate-pulse" />
                  <div className="h-[36px] md:h-[48px] lg:h-[56px] w-[45%] bg-white/10 rounded-[8px] animate-pulse" />
                </div>
                <div className="h-[50px] w-[80%] bg-white/5 rounded-[8px] animate-pulse" />
                <div className="flex gap-[12px]">
                  <div className="h-[48px] w-[140px] bg-white/10 rounded-full animate-pulse" />
                  <div className="h-[48px] w-[160px] bg-white/5 rounded-full animate-pulse" />
                </div>
                <div className="flex items-center gap-[20px] mt-[16px]">
                  <div className="h-[12px] w-[60px] bg-white/8 rounded-full animate-pulse" />
                  <div className="h-[12px] w-[80px] bg-white/8 rounded-full animate-pulse" />
                  <div className="h-[12px] w-[90px] bg-white/8 rounded-full animate-pulse" />
                </div>
              </div>
              <div className="h-[400px] bg-white/5 rounded-[2rem] animate-pulse" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
