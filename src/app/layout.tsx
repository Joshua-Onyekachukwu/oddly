import type { Metadata } from "next";
import { Space_Grotesk, DM_Sans, JetBrains_Mono } from "next/font/google";
import { AuthProvider } from "@/providers/AuthProvider";
import { ToastContainer } from "@/components/notifications/Toast";
import { validateEnv } from "@/lib/env";
import "./globals.css";

// Validate environment variables on startup
if (typeof window === "undefined") {
  const env = validateEnv();
  if (!env.valid) {
    console.error("[STARTUP] Cannot start — missing required environment variables");
  }
}

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "ODDLY — Oddly accurate.",
    template: "%s | ODDLY",
  },
  description:
    "AI-Powered Football Predictions, Probability Analysis & Accumulator Intelligence. Find value bets with 90%+ confidence across 360+ leagues.",
  keywords: [
    "football",
    "predictions",
    "betting",
    "odds",
    "AI",
    "accumulator",
    "value bets",
  ],
  authors: [{ name: "Joshua Onyekachukwu" }],
  openGraph: {
    title: "ODDLY — Oddly accurate.",
    description:
      "AI-Powered Football Predictions, Probability Analysis & Accumulator Intelligence",
    url: "https://oddly.gg",
    siteName: "ODDLY",
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "ODDLY — Oddly accurate.",
    description:
      "AI-Powered Football Predictions, Probability Analysis & Accumulator Intelligence",
  },
  robots: {
    index: true,
    follow: true,
  },
  icons: {
    icon: "/favicon.svg",
    apple: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${spaceGrotesk.variable} ${dmSans.variable} ${jetbrainsMono.variable}`}
      suppressHydrationWarning
    >
      <body className="font-body antialiased bg-[#FAFBFC] text-[#0A0F1C]">
        <AuthProvider>
          {children}
          <ToastContainer />
        </AuthProvider>
      </body>
    </html>
  );
}
