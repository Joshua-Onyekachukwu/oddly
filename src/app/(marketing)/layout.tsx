import type { Metadata } from "next";
import Navbar from "@/components/landing/Navbar";
import Footer from "@/components/landing/Footer";

export const metadata: Metadata = {
  title: {
    default: "ODDLY — Oddly accurate.",
    template: "%s | ODDLY",
  },
  description:
    "AI-powered football prediction platform. Ensemble model predictions across 1X2, goals, BTTS and more, value bet detection, accumulator builder, and rollover tracking.",
  keywords: ["football predictions", "betting tips", "value bets", "accumulator", "AI predictions", "sports betting", "football AI"],
  openGraph: {
    title: "ODDLY — Oddly accurate.",
    description: "AI-powered football prediction platform — ensemble model picks across major leagues.",
    url: "https://oddly.ng",
    siteName: "ODDLY",
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "ODDLY — Oddly accurate.",
    description: "AI-powered football prediction platform — ensemble model picks across major leagues.",
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
      <Navbar />
      <main className="min-h-screen">{children}</main>
      <Footer />
    </div>
  );
}
