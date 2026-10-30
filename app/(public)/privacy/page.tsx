import type { Metadata } from "next";
import { PolicyPage, PolicySection, platformSupportEmail } from "@/components/public/policy-page";

export const metadata: Metadata = { title: "Privacy" };
// The support address is read when the page is served, not when it is built.
export const dynamic = "force-dynamic";

const list = "grid list-disc gap-1.5 pl-5 [&_strong]:font-semibold [&_strong]:text-ink";

// A plain-language account of what the code keeps and shares (T46). It is
// not a reviewed legal policy; that is LEGAL-001 before a public launch.
export default function PrivacyPage() {
  const support = platformSupportEmail();
  return (
    <PolicyPage lead="What Thunderstrux keeps about you, who can see it, and who else handles it, in plain words." title="Privacy">
      <PolicySection title="What we keep">
        <ul className={list}>
          <li><strong>Your account:</strong> your name, email address and any profile details you add. Your password is stored only in a form that can&apos;t be turned back into it.</li>
          <li><strong>What you buy:</strong> each ticket, membership and merchandise order, its price, and the name and email you bought it with.</li>
          <li><strong>Buying as a guest:</strong> the email address you confirm at checkout.</li>
          <li><strong>At events:</strong> when a ticket was checked in.</li>
          <li><strong>Messages to a society:</strong> when you use Contact, we email your name, address and message to that society so it can reply.</li>
          <li><strong>Society staff:</strong> your role and the changes you make, so the society can see who did what. Authenticator app secrets are stored encrypted.</li>
        </ul>
      </PolicySection>
      <PolicySection title="Who can see it">
        <ul className={list}>
          <li>A society sees the name, email and tickets of the people who buy from it, so it can run its events, answer questions and give refunds.</li>
          <li>A society never sees what you bought from another society.</li>
          <li>Other members never see your purchases. Public pages show only what a society publishes about itself and its events.</li>
        </ul>
      </PolicySection>
      <PolicySection title="Who else handles it">
        <ul className={list}>
          <li><strong>Stripe</strong> takes payments. You type your card details on Stripe&apos;s own page; Thunderstrux never sees or stores them. If you dispute a payment with your bank, we give Stripe the order&apos;s details, when its tickets were emailed and scanned, and any refund, to answer it.</li>
          <li><strong>Resend</strong> sends our emails, so it handles your email address and the message.</li>
          <li>Our hosting and storage providers keep the service and its images running.</li>
        </ul>
        <p>We don&apos;t sell your information or show ads, and our pages load no advertising or tracking scripts. Your IP address is used briefly to slow down repeated sign-in and purchase attempts.</p>
      </PolicySection>
      <PolicySection title="Emails we send">
        <p>Receipts, tickets, refund and order updates, changes to events you&apos;re going to, and security notices. Optional reminders, such as a membership about to end, can be turned off in Account settings.</p>
        <p>We keep a record of each email, including the address it went to, for 30 days after it&apos;s sent, then delete it. A notice to society staff about a Stripe deadline stays until 30 days after that deadline.</p>
      </PolicySection>
      <PolicySection title="Closing your account">
        <p>You can close your account in Account settings. Your login and profile are removed for good and can&apos;t be restored. Records of what you bought and attended stay, because societies need them for their accounts and refunds. Records of emails we already sent you are deleted on the usual 30-day timetable above.</p>
      </PolicySection>
      <PolicySection title="Questions">
        <p>
          {support ? <>Email <a className="font-semibold text-brand underline underline-offset-4" href={`mailto:${support}`}>{support}</a>. For something you bought, the society that sold it can also help.</> : "For something you bought, ask the society that sold it: use Contact on its event or society page."}
        </p>
      </PolicySection>
    </PolicyPage>
  );
}
