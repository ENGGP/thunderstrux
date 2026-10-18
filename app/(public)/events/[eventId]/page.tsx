import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MembersOnlyGate } from "@/components/events/members-only-gate";
import { PublicEventView } from "@/components/events/public-event-view";
import type { BuyBoxViewer } from "@/components/events/public-ticket-purchase";
import { getLiveSession } from "@/lib/auth/live-session";
import { getEventForViewer, priceForViewer } from "@/lib/events/public-events";
import { memberPricePlan } from "@/lib/memberships/offers";

type PublicEventPageProps = {
  params: Promise<{
    eventId: string;
  }>;
};

async function readPage(eventId: string) {
  const session = await getLiveSession();
  return { session, access: await getEventForViewer(eventId, session?.user.id ?? null) };
}

// Members-only pages, gated or open, stay out of search engines; the gate's
// title names only the society. Public pages keep the default title.
export async function generateMetadata({ params }: PublicEventPageProps): Promise<Metadata> {
  const { access } = await readPage((await params).eventId);
  if (access?.kind === "gated") return { title: `Members-only event · ${access.gate.society.name}`, robots: { index: false, follow: false } };
  return access?.event.membersOnly ? { robots: { index: false, follow: false } } : {};
}

// Anyone can open a public or link-only event (T15a); a members-only event
// opens for members whose membership unlocks it and shows everyone else the
// gate (T24b). Drafts and wrong ids are not found. The page reads the session,
// so it renders per request and is never cached as public. Society accounts
// see the page as buyers do.
export default async function PublicEventPage({ params }: PublicEventPageProps) {
  const { eventId } = await params;
  const { session, access } = await readPage(eventId);

  if (!access) {
    notFound();
  }
  if (access.kind === "gated") {
    return (
      <main className="bg-paper">
        <MembersOnlyGate eventHref={`/events/${eventId}`} gate={access.gate} />
      </main>
    );
  }
  const { event } = access;

  const viewer: BuyBoxViewer = !session
    ? "anonymous"
    : session.user.accountRole !== "member"
      ? "society"
      : session.user.emailVerifiedAt
        ? "member"
        : "unverified";

  // Member prices apply only to a verified member account with the right membership.
  const memberPlan = viewer === "member" && session && event.ticketTypes.some((type) => type.memberPrice !== null)
    ? await memberPricePlan(event.organisation.slug, session.user.id)
    : null;

  return (
    <main className="bg-paper">
      <PublicEventView event={{ ...event, ticketTypes: priceForViewer(event.ticketTypes, memberPlan !== null) }} memberPlan={memberPlan} viewer={viewer} />
    </main>
  );
}
