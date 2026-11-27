import type { Metadata } from "next";
import LegalPage from "@/components/legal/LegalPage";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "Privacy Policy for ODDLY — how we collect, use, and protect your personal data on our AI-powered football prediction platform.",
};

const LAST_UPDATED = "15 January 2026";

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      subtitle="How ODDLY collects, uses, stores, and protects your personal information."
      lastUpdated={LAST_UPDATED}
    >
      <h2>1. Who We Are</h2>
      <p>
        ODDLY (&quot;we&quot;, &quot;us&quot;) operates oddly.ng, an AI-powered football prediction
        platform operated from Nigeria. This Privacy Policy explains what information we collect
        when you use our website, apps, and related services (the &quot;Service&quot;), and how we
        handle it. By using the Service you agree to the practices described here.
      </p>

      <h2>2. Information We Collect</h2>
      <h3>Information you provide</h3>
      <ul>
        <li>
          <strong>Account data:</strong> name, email address, and password (stored only as a secure
          hash) when you register.
        </li>
        <li>
          <strong>Billing data:</strong> subscription tier, billing history, and payment status.
          Card details are processed directly by Stripe — we never see or store your full card
          number.
        </li>
        <li>
          <strong>Usage data you create:</strong> predictions you track, accumulator slips, rollover
          challenge entries, and messages sent to the AI analyst.
        </li>
      </ul>
      <h3>Information collected automatically</h3>
      <ul>
        <li>
          <strong>Device &amp; log data:</strong> IP address, browser type, device identifiers,
          pages visited, and timestamps.
        </li>
        <li>
          <strong>Cookies &amp; similar technologies:</strong> see our{" "}
          <a href="/cookies">Cookie Policy</a> for details.
        </li>
        <li>
          <strong>Performance data:</strong> model accuracy statistics and anonymized prediction
          outcomes used to improve the Service.
        </li>
      </ul>

      <h2>3. How We Use Your Information</h2>
      <ul>
        <li>To provide, operate, and maintain the Service (predictions, tracking, analytics).</li>
        <li>To process subscriptions and payments via Stripe.</li>
        <li>To personalize your experience and generate AI analyst responses.</li>
        <li>To send service-related communications (receipts, security alerts, product updates).</li>
        <li>To detect, prevent, and investigate fraud, abuse, or violations of our Terms.</li>
        <li>To comply with legal obligations and enforce our agreements.</li>
      </ul>
      <p>
        We do <strong>not</strong> sell your personal data, and we do not use your betting or
        prediction activity for targeted advertising.
      </p>

      <h2>4. Legal Bases</h2>
      <p>We process personal data on the following bases:</p>
      <ul>
        <li>
          <strong>Contract:</strong> to deliver the Service you subscribed to.
        </li>
        <li>
          <strong>Legitimate interests:</strong> to secure and improve the Service, prevent fraud,
          and analyze aggregate model performance.
        </li>
        <li>
          <strong>Consent:</strong> for optional communications and non-essential cookies, where
          required.
        </li>
        <li>
          <strong>Legal obligation:</strong> to retain records required by Nigerian law.
        </li>
      </ul>

      <h2>5. Data Sharing</h2>
      <p>We share data only with the service providers needed to run the platform:</p>
      <ul>
        <li>
          <strong>Stripe</strong> — payment processing (card data never touches our servers).
        </li>
        <li>
          <strong>Supabase</strong> — authentication, database, and file storage.
        </li>
        <li>
          <strong>Vercel</strong> — hosting and content delivery.
        </li>
        <li>
          <strong>Sports data providers</strong> — fixture, odds, and statistics data used to power
          predictions.
        </li>
      </ul>
      <p>
        Each provider is bound by contractual obligations to process data only as instructed. We may
        also disclose data if required by law or to protect the rights, safety, and security of our
        users and the Service.
      </p>

      <h2>6. Data Retention</h2>
      <p>
        We retain account data for as long as your account is active. If you delete your account, we
        delete or anonymize personal data within 30 days, except records we must keep for legal,
        tax, or fraud-prevention purposes. Aggregated, anonymized statistics may be retained
        indefinitely.
      </p>

      <h2>7. Your Rights</h2>
      <p>Depending on your jurisdiction, you may have the right to:</p>
      <ul>
        <li>Access the personal data we hold about you.</li>
        <li>Correct inaccurate data.</li>
        <li>Request deletion of your data.</li>
        <li>Object to or restrict certain processing.</li>
        <li>Export your data in a portable format.</li>
        <li>Withdraw consent for optional processing at any time.</li>
      </ul>
      <p>
        To exercise any of these rights, email{" "}
        <a href="mailto:privacy@oddly.ng">privacy@oddly.ng</a>. We will respond within 30 days.
      </p>

      <h2>8. Data Security</h2>
      <p>
        We use industry-standard safeguards including encryption in transit (TLS), hashed password
        storage, access controls, and secure hosting. No method of transmission or storage is 100%
        secure, but we work continuously to protect your data.
      </p>

      <h2>9. Children&apos;s Privacy</h2>
      <p>
        The Service is not directed at anyone under 18, and we do not knowingly collect personal data
        from children. If you believe a child has provided us data, contact us and we will delete it.
      </p>

      <h2>10. International Transfers</h2>
      <p>
        Some of our service providers (e.g., hosting and payment infrastructure) process data outside
        Nigeria. Where this occurs, we ensure appropriate safeguards are in place for the transfer.
      </p>

      <h2>11. Changes to This Policy</h2>
      <p>
        We may update this Privacy Policy periodically. We will notify you of material changes by
        email or an in-app notice before they take effect.
      </p>

      <h2>12. Contact</h2>
      <p>
        Privacy questions or requests? Email{" "}
        <a href="mailto:privacy@oddly.ng">privacy@oddly.ng</a>.
      </p>
    </LegalPage>
  );
}
