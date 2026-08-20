import LayoutProvider from "@/providers/LayoutProvider";

export const metadata = {
  title: {
    template: "%s | ODDLY Dashboard",
    default: "ODDLY Dashboard",
  },
  description: "AI-Powered Football Predictions Dashboard",
};

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <LayoutProvider>{children}</LayoutProvider>;
}
