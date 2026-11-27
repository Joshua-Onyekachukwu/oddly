import type { Metadata } from "next";
import LegalPage from "@/components/legal/LegalPage";

export const metadata: Metadata = {
  title: "Responsible Gambling & Betting Disclaimer",
  description:
    "Responsible gambling information and betting disclaimer for ODDLY. Predictions are probabilistic, not guarantees. 18+ only. Set limits and gamble responsibly.",
};

const LAST_UPDATED = "15 January 2026";

export default function ResponsibleGamblingPage() {
  return (
    <LegalPage
      title="Responsible Gambling"
      subtitle="Important information about the risks of sports betting and how to use ODDLY safely."
      lastUpdated={LAST_UPDATED}
    >
      <div className="legal-callout">
        <p>
          <strong>18+ only.</strong> ODDLY provides football predictions and analytics for
          informational purposes. Sports betting carries real financial risk — you can lose the
          money you wager. Never bet more than you can afford to lose, and never chase losses.
        </p>
      </div>

      <h2>1. Predictions Are Probabilistic — Not Guarantees</h2>
      <p>
        Every prediction on ODDLY — whether a 1X2 outcome, goals market, BTTS pick, value bet
        indicator, or accumulator suggestion — is a <strong>probabilistic estimate</strong> produced
        by statistical and machine-learning models (including Dixon-Coles, XGBoost, and Elo-style
        ratings combined with odds analysis).
      </p>
      <ul>
        <li>
          A prediction expresses how likely an outcome appears to be — it does <strong>not</strong>{" "}
          guarantee that outcome will happen.
        </li>
        <li>
          Even high-confidence predictions lose. Football is inherently unpredictable: injuries,
          red cards, refereeing decisions, and variance mean favorites lose regularly.
        </li>
        <li>
          Model accuracy statistics, historical performance, and rollover challenge results are
          backward-looking and do not predict future results.
        </li>
        <li>
          Value bet indicators estimate expected value at the time of generation based on available
          odds; odds move, and actual returns depend on the odds you personally obtain.
        </li>
      </ul>

      <h2>2. No Guarantee of Winnings</h2>
      <p>
        ODDLY does not guarantee winnings, profits, ROI, or any betting outcome. Accumulators are
        high-risk by nature — adding more legs multiplies both potential returns and the probability
        of losing. Never stake amounts you cannot afford to lose, and treat every prediction as one
        input into your own research, not as advice.
      </p>

      <h2>3. Set Limits and Stay in Control</h2>
      <p>If you choose to bet, do it responsibly:</p>
      <ul>
        <li>
          <strong>Set a budget</strong> before you start and never exceed it — treat betting spend
          as entertainment cost, not investment.
        </li>
        <li>
          <strong>Set time limits</strong> and take regular breaks.
        </li>
        <li>
          <strong>Never chase losses.</strong> Increasing stakes to recover losses is the fastest
          route to harm.
        </li>
        <li>
          <strong>Don&apos;t bet under the influence</strong> of alcohol or when emotionally
          compromised.
        </li>
        <li>
          <strong>Keep records</strong> — tools like our tracking dashboard exist to help you see
          your real performance honestly.
        </li>
      </ul>

      <h2>4. Warning Signs of Problem Gambling</h2>
      <p>Consider seeking help if you:</p>
      <ul>
        <li>Bet more than you can afford or borrow money to gamble.</li>
        <li>Feel restless, irritable, or anxious when not gambling.</li>
        <li>Hide gambling activity from family or friends.</li>
        <li>Neglect work, relationships, or responsibilities because of betting.</li>
        <li>Continue gambling despite repeated losses or attempts to stop.</li>
      </ul>

      <h2>5. Get Help</h2>
      <p>If gambling stops being fun or starts causing harm, reach out:</p>
      <ul>
        <li>
          <strong>BeGambleAware</strong> — begambleaware.org — information and support for
          responsible gambling.
        </li>
        <li>
          <strong>GamCare</strong> — gamcare.org.uk — confidential support and counseling
          (international helplines available via their site).
        </li>
        <li>
          <strong>Nigeria:</strong> contact a local counseling service or your healthcare provider;
          mental-health support lines operate in major cities including Lagos and Abuja.
        </li>
      </ul>
      <p>
        Many licensed bookmakers also offer self-exclusion and deposit-limit tools — use them if you
        feel your gambling is becoming a problem.
      </p>

      <h2>6. Betting &amp; Odds Disclaimer</h2>
      <p>
        ODDLY is an independent analytics product and is <strong>not affiliated with, endorsed by,
        or sponsored by any bookmaker</strong> unless explicitly stated. Odds displayed are sourced
        from third-party bookmakers for comparison purposes only; they are not betting offers made by
        ODDLY, and the odds available to you at any bookmaker may differ. Always verify odds,
        rules, and terms directly with your chosen bookmaker before placing any bet.
      </p>
      <p>
        Sports betting legality varies by jurisdiction. It is your responsibility to ensure betting
        is legal where you live and that you comply with all applicable laws and bookmaker terms.
      </p>

      <h2>7. Our Commitment</h2>
      <p>
        We publish model performance transparently, including losing periods, because honest
        information serves you better than hype. If you ever feel the Service is contributing to
        harmful gambling behavior, please stop using it and seek support using the resources above.
      </p>

      <h2>8. Contact</h2>
      <p>
        Questions about responsible gambling or this disclaimer? Email{" "}
        <a href="mailto:support@oddly.ng">support@oddly.ng</a>.
      </p>
    </LegalPage>
  );
}
