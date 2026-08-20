import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "ODDLY — Oddly accurate.",
  description:
    "AI-Powered Football Predictions, Probability Analysis & Accumulator Intelligence",
};

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div>
      <main className="min-h-screen">{children}</main>
    </div>
  );
}
