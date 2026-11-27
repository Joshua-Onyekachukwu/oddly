import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Contact",
  description:
    "Get in touch with the ODDLY team — support, billing, privacy, and legal inquiries.",
};

const channels = [
  {
    title: "Support",
    description:
      "Help with your account, predictions, subscriptions, or technical issues.",
    email: "support@oddly.ng",
    icon: "ri-customer-service-2-line",
  },
  {
    title: "Billing",
    description:
      "Questions about subscriptions, payments, invoices, or refunds.",
    email: "support@oddly.ng",
    icon: "ri-bank-card-line",
  },
  {
    title: "Privacy & Legal",
    description:
      "Data requests, privacy questions, and legal notices.",
    email: "legal@oddly.ng",
    icon: "ri-shield-check-line",
  },
];

export default function ContactPage() {
  return (
    <div className="bg-[#F8FAFC] min-h-screen">
      {/* Hero */}
      <section className="pt-[120px] md:pt-[140px] pb-[48px] md:pb-[64px]">
        <div className="container sm:max-w-[540px] md:max-w-[720px] lg:max-w-[960px] xl:max-w-[1200px] mx-auto px-[16px] text-center">
          <div className="inline-flex items-center gap-[8px] mb-[16px]">
            <span className="w-[6px] h-[6px] rounded-full bg-[#BFFF00]"></span>
            <span className="text-[11px] font-semibold tracking-[0.15em] uppercase font-display text-[#1B2A4A]">
              Contact
            </span>
          </div>
          <h1 className="font-display !text-[32px] md:!text-[44px] lg:!text-[52px] !leading-[1.1] !tracking-[-0.03em] !mb-[16px] text-[#0A0F1C]">
            Get in <span className="text-[#1B2A4A]">touch</span>
          </h1>
          <p className="text-[15px] md:text-[17px] text-gray-500 max-w-[560px] mx-auto !leading-[1.75]">
            Questions about ODDLY, your account, or our predictions? Reach out —
            we read every message.
          </p>
        </div>
      </section>

      {/* Channels */}
      <section className="pb-[80px] md:pb-[100px]">
        <div className="container sm:max-w-[540px] md:max-w-[720px] lg:max-w-[960px] xl:max-w-[1200px] mx-auto px-[16px]">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-[16px] max-w-[960px] mx-auto">
            {channels.map((c) => (
              <a
                key={c.title}
                href={`mailto:${c.email}`}
                className="group bg-white rounded-[20px] p-[28px] border border-gray-100 hover:border-[#1B2A4A]/20 hover:shadow-[0_8px_30px_-12px_rgba(27,42,74,0.15)] transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)]"
              >
                <div className="w-[44px] h-[44px] bg-[#1B2A4A]/[0.06] rounded-[12px] flex items-center justify-center mb-[16px]">
                  <i className={`${c.icon} text-[20px] text-[#1B2A4A]`}></i>
                </div>
                <h2 className="font-display text-[16px] font-semibold text-[#0A0F1C] mb-[8px]">
                  {c.title}
                </h2>
                <p className="text-[13px] text-gray-500 !leading-[1.7] !mb-[12px]">
                  {c.description}
                </p>
                <span className="text-[13px] font-medium text-[#1B2A4A] group-hover:underline break-all">
                  {c.email}
                </span>
              </a>
            ))}
          </div>

          <p className="text-center text-[13px] text-gray-400 mt-[32px] !mb-0">
            For answers to common questions, check the{" "}
            <Link href="/faq" className="text-[#1B2A4A] font-medium hover:underline">
              FAQ
            </Link>
            {" · "}
            <Link href="/about" className="text-[#1B2A4A] font-medium hover:underline">
              About ODDLY
            </Link>
          </p>
        </div>
      </section>
    </div>
  );
}
