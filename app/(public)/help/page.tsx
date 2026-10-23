import type { Metadata } from "next";
import Link from "next/link";
import { PolicyPage, PolicySection, platformSupportEmail } from "@/components/public/policy-page";

export const metadata: Metadata = { title: "Help" };
// The support address is read when the page is served, not when it is built.
export const dynamic = "force-dynamic";

const link = "font-semibold text-brand underline underline-offset-4";

export default function HelpPage() {
  const support = platformSupportEmail();
  return (
    <PolicyPage
      lead="Each society runs its own events, memberships and shop. For anything about what you bought, the society is the quickest answer."
      title="Help"
    >
      <PolicySection highlight title="A question about an event or something you bought">
        <p>Contact the society that runs it. Every event and shop page shows the society&apos;s contact email and its refund policy.</p>
      </PolicySection>
      <PolicySection title="Refunds">
        <p>Refunds are up to the society, under the policy on its page. A refund is always for the whole order and goes back to the card you paid with; refunded tickets stop working. To give up a free ticket, ask the society to cancel it.</p>
      </PolicySection>
      <PolicySection title="Bought without an account?">
        <p><Link className={link} href="/guest/recover">Find your purchase</Link> with the email you used at checkout, and we&apos;ll send a link to each order.</p>
      </PolicySection>
      <PolicySection title="Memberships">
        <p>A membership runs for the dates shown before you buy it and doesn&apos;t renew by itself. Joining a society for free is separate: it follows the society, and doesn&apos;t give member prices.</p>
      </PolicySection>
      <PolicySection title="Merchandise">
        <p>You collect merchandise from the society in person; its shop says where and when. Thunderstrux doesn&apos;t ship.</p>
      </PolicySection>
      <PolicySection title="Signing in and your account">
        <p>Forgot your password? Choose <Link className={link} href="/forgot-password">Forgot password</Link> on the sign-in page. Your details, password and emails are in Account settings.</p>
      </PolicySection>
      <PolicySection title="Something wrong with Thunderstrux itself">
        <p>
          {support ? <>Email <a className={link} href={`mailto:${support}`}>{support}</a>. </> : null}
          Never send card details: payments are handled by Stripe, and Thunderstrux never sees your card number.
        </p>
      </PolicySection>
    </PolicyPage>
  );
}
