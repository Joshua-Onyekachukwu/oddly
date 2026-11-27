import type { Metadata } from "next";
import LegalPage from "@/components/legal/LegalPage";

export const metadata: Metadata = {
  title: "Cookie Policy",
  description:
    "Cookie Policy for ODDLY — the cookies and similar technologies we use on oddly.ng and why.",
};

const LAST_UPDATED = "15 January 2026";

export default function CookiesPage() {
  return (
    <LegalPage
      title="Cookie Policy"
      subtitle="What cookies we use on oddly.ng, why we use them, and how you can control them."
      lastUpdated={LAST_UPDATED}
    >
      <h2>1. What Are Cookies</h2>
      <p>
        Cookies are small text files stored on your device by your browser. We also use similar
        technologies such as local storage and session storage. They help the Service remember you,
        keep you signed in, and understand how the platform is used.
      </p>

      <h2>2. Cookies We Use</h2>
      <h3>Strictly necessary</h3>
      <p>
        Required for the Service to function — authentication, security, and session management.
        These cannot be disabled without breaking core features.
      </p>
      <ul>
        <li><strong>Session/auth cookies</strong> — keep you signed in and secure your session (Supabase auth).</li>
        <li><strong>Security cookies</strong> — help detect and prevent fraud and abuse.</li>
      </ul>

      <h3>Preferences</h3>
      <p>
        Remember choices you make, such as UI settings and dismissed notices.
      </p>

      <h3>Analytics</h3>
      <p>
        Help us understand how visitors use the site so we can improve it. Analytics data is
        aggregated and does not identify you personally.
      </p>

      <h3>Third-party cookies</h3>
      <p>
        Stripe may set cookies during payment flows to process subscriptions securely. These are
        governed by Stripe&apos;s own policies.
      </p>

      <h2>3. Managing Cookies</h2>
      <p>
        You can control or delete cookies through your browser settings. Blocking strictly
        necessary cookies will prevent you from signing in or using account features. Most browsers
        also offer &quot;Do Not Track&quot; signals, though the Service may not respond to them.
      </p>
      <p>
        To opt out of non-essential cookies, you can adjust your browser preferences or use any
        cookie-consent controls presented on the site.
      </p>

      <h2>4. Changes to This Policy</h2>
      <p>
        We may update this Cookie Policy as the technologies we use evolve. The &quot;Last
        updated&quot; date above reflects the current version.
      </p>

      <h2>5. Contact</h2>
      <p>
        Questions about cookies? Email{" "}
        <a href="mailto:privacy@oddly.ng">privacy@oddly.ng</a>.
      </p>
    </LegalPage>
  );
}
