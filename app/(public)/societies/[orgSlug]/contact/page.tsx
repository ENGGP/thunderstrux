import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EnquiryForm } from "@/components/organisations/enquiry-form";
import { Card } from "@/components/ui/card";
import { getLiveSession } from "@/lib/auth/live-session";
import { enquiryEvent } from "@/lib/organisations/enquiries";
import { publicOrganisation } from "@/lib/organisations/public-organisations";

export const metadata: Metadata = { title: "Contact a society", robots: { index: false, follow: false } };

// "Contact {society}" (DEBT-002), as Humanitix's "Contact host": the message is
// emailed to the society, which replies to the sender. Its own addresses stay private.
export default async function ContactSocietyPage({
  params,
  searchParams
}: {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<{ event?: string }>;
}) {
  const [{ orgSlug }, query, session] = await Promise.all([params, searchParams, getLiveSession()]);
  const organisation = await publicOrganisation(orgSlug);
  if (!organisation) notFound();
  // A members-only event isn't named to whoever has the link.
  const event = query.event ? await enquiryEvent(organisation.id, query.event) : null;
  const named = event && event.visibility !== "members_only" ? event.title : null;
  const back = event ? `/events/${event.id}` : `/societies/${organisation.slug}`;
  const name = session ? [session.user.firstName, session.user.lastName].filter(Boolean).join(" ") : "";

  return (
    <main id="main" tabIndex={-1} className="bg-paper">
      <div className="mx-auto grid max-w-2xl gap-6 px-4 py-10 md:px-8">
        <Link className="inline-flex min-h-11 w-fit items-center text-sm font-semibold text-brand underline underline-offset-4" href={back}>
          {event ? "Back to the event" : `Back to ${organisation.name}`}
        </Link>
        <header className="grid gap-2">
          <h1 className="font-display text-3xl font-semibold text-ink [overflow-wrap:anywhere]">Contact {organisation.name}</h1>
          <p className="text-ink-soft [overflow-wrap:anywhere]">
            {named ? <>About <strong className="font-semibold text-ink">{named}</strong>. </> : null}
            We&apos;ll email your message to {organisation.name}. They&apos;ll reply to your email.
          </p>
        </header>
        <Card>
          <EnquiryForm
            defaultEmail={session?.user.email ?? ""}
            defaultName={name}
            eventId={event?.id}
            society={organisation.name}
            societySlug={organisation.slug}
          />
        </Card>
        {organisation.supportEmail ? (
          <p className="text-sm text-ink-soft [overflow-wrap:anywhere]">
            Or email {organisation.name} directly:{" "}
            <a className="font-semibold text-brand underline underline-offset-4" href={`mailto:${organisation.supportEmail}`}>
              {organisation.supportEmail}
            </a>
          </p>
        ) : null}
      </div>
    </main>
  );
}
