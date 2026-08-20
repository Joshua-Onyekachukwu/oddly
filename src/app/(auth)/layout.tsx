export const metadata = {
  title: {
    template: "%s | ODDLY",
    default: "Sign In",
  },
  description: "Sign in or create your ODDLY account",
};

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex">
      {/* Left — Branding panel (hidden on mobile) */}
      <div className="hidden lg:flex lg:w-[480px] xl:w-[540px] bg-[#0A0F1C] relative overflow-hidden flex-col justify-between p-[48px]">
        {/* Ambient orbs */}
        <div className="absolute top-[-20%] right-[-30%] w-[500px] h-[500px] rounded-full bg-[#BFFF00]/[0.04] blur-[120px] pointer-events-none" />
        <div className="absolute bottom-[-10%] left-[-20%] w-[400px] h-[400px] rounded-full bg-[#2563EB]/[0.06] blur-[100px] pointer-events-none" />

        {/* Grid pattern */}
        <div
          className="absolute inset-0 opacity-[0.02] pointer-events-none"
          style={{
            backgroundImage: "linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)",
            backgroundSize: "60px 60px",
          }}
        />

        <div className="relative z-[1]">
          <a href="/" className="font-display font-bold text-[28px] tracking-[-0.02em] text-white">
            ODDLY
          </a>
        </div>

        <div className="relative z-[1]">
          <h2 className="font-display text-[32px] xl:text-[40px] font-bold text-white !leading-[1.1] !tracking-[-0.03em] mb-[16px]">
            Every edge.
            <br />
            <span className="text-[#BFFF00]">Every model.</span>
            <br />
            One pick.
          </h2>
          <p className="text-[15px] text-gray-400/80 max-w-[320px] !leading-[1.7]">
            AI-powered football predictions with 7 models working together
            to find value where the market gets it wrong.
          </p>

          {/* Stats */}
          <div className="flex items-center gap-[24px] mt-[32px]">
            {[
              { value: "94.4%", label: "accuracy" },
              { value: "7", label: "models" },
              { value: "100+", label: "leagues" },
            ].map((stat, i) => (
              <div key={i}>
                <span className="block text-[18px] font-bold text-white font-mono-data">
                  {stat.value}
                </span>
                <span className="text-[11px] text-white/30 uppercase tracking-wider">
                  {stat.label}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="relative z-[1]">
          <p className="text-[11px] text-white/20">
            &copy; {new Date().getFullYear()} ODDLY. All rights reserved.
          </p>
        </div>
      </div>

      {/* Right — Form */}
      <div className="flex-1 flex items-center justify-center py-[40px] px-[16px]">
        {children}
      </div>
    </div>
  );
}
