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
    <div className="min-h-screen flex items-center justify-center bg-[#FAFBFC]">
      {children}
    </div>
  );
}
