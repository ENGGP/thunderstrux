import { notFound } from "next/navigation";
import { PublicEventView } from "@/components/events/public-event-view";
import type { BuyBoxViewer } from "@/components/events/public-ticket-purchase";
import { getLiveSession } from "@/lib/auth/live-session";
import { getPublishedEventDetail, priceForViewer } from "@/lib/events/public-events";
import { memberPricePlan } from "@/lib/memberships/offers";

type PublicEventPageProps = {
  params: Promise<{
    eventId: string;
  }>;
};

// Anyone can open a public or link-only event (T15a); drafts and members-only
// events read as not found. Society accounts see the page as buyers do.
export default async function PublicEventPage({ params }: PublicEventPageProps) {
  const { eventId } = await params;
  const [event, session] = await Promise.all([getPublishedEventDetail(eventId), getLiveSession()]);

  if (!event) {
    notFound();
  }

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
