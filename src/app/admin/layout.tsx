import AdminLayoutClient from "./AdminLayoutClient";

export const metadata = {
  title: {
    template: "%s | ODDLY Admin",
    default: "ODDLY Admin Dashboard",
  },
  description: "ODDLY Admin Dashboard — system health, model performance, and user activity.",
};

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AdminLayoutClient>{children}</AdminLayoutClient>;
}
