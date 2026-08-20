import type { Metadata } from "next";

export const metadata: Metadata = {
  title: {
    default: "ODDLY — Oddly accurate.",
    template: "%s | ODDLY",
  },
  description:
    "AI-powered football prediction platform with 94.4% accuracy. Value bet detection, accumulator builder, and Crown Jewel daily picks across 100+ leagues.",
  keywords: ["football predictions", "betting tips", "value bets", "accumulator", "AI predictions", "sports betting", "football AI"],
  openGraph: {
    title: "ODDLY — Oddly accurate.",
    description: "AI-powered football prediction platform with 94.4% accuracy.",
    url: "https://oddly.ng",
    siteName: "ODDLY",
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "ODDLY — Oddly accurate.",
    description: "AI-powered football prediction platform with 94.4% accuracy.",
  },
  robots: {
    index: true,
    follow: true,
  },
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
