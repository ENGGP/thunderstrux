import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MembersOnlyGate } from "@/components/events/members-only-gate";
import { PublicEventView } from "@/components/events/public-event-view";
import type { BuyBoxViewer } from "@/components/events/public-ticket-purchase";
import { appUrl } from "@/lib/app-url";
import { getLiveSession } from "@/lib/auth/live-session";
import { formatDateTime } from "@/lib/format";
import { getEventForViewer, priceForViewer, priceWithTicketCode } from "@/lib/events/public-events";
import { codeForBuyer, describeCode } from "@/lib/events/ticket-codes";
import { memberPricePlan } from "@/lib/memberships/offers";

type Selection = { ticketTypeId?: string; quantity?: string; code?: string };

type PublicEventPageProps = {
  params: Promise<{
    eventId: string;
  }>;
  // Checkout's "Change tickets" comes back with the buyer's choice; the ticket box checks it.
  searchParams?: Promise<Selection>;
};

async function readPage(eventId: string, unlock: string | null = null) {
  const session = await getLiveSession();
  return { session, access: await getEventForViewer(eventId, session?.user.id ?? null, unlock) };
}

// Members-only pages, gated or open, stay out of search engines and keep a
// generic title (the gate names only the society). Public and link-only
// events are titled with the event, as shared links expect.
export async function generateMetadata({ params }: PublicEventPageProps): Promise<Metadata> {
  const { access } = await readPage((await params).eventId);
  if (access?.kind === "gated") return { title: `Members-only event · ${access.gate.society.name}`, robots: { index: false, follow: false } };
  if (!access) return {};
  const { event } = access;
  if (event.membersOnly) return { robots: { index: false, follow: false } };
  // Societies share events in Instagram, Messenger and Discord: the link preview
  // says when and where, with the event image when there is one.
  const origin = appUrl();
  const description = `${formatDateTime(event.startTime, { timeZone: event.organisation.timeZone, dateStyle: "full" })} · ${event.location}. ${event.description}`.slice(0, 200);
  const images = event.heroAssetId ? [`/api/public/assets/${event.heroAssetId}`] : undefined;
  return {
    title: event.title,
    description,
    ...(origin ? { metadataBase: new URL(origin) } : {}),
    openGraph: { title: event.title, description, type: "website", siteName: "Thunderstrux", images },
    twitter: { card: images ? "summary_large_image" : "summary", title: event.title, description, images }
  };
}

// Anyone can open a public or link-only event (T15a); a members-only event
// opens for members whose membership unlocks it and shows everyone else the
// gate (T24b). Drafts and wrong ids are not found. The page reads the session,
// so it renders per request and is never cached as public. Society accounts
// see the page as buyers do.
export default async function PublicEventPage({ params, searchParams }: PublicEventPageProps) {
  const [{ eventId }, query] = await Promise.all([params, searchParams ?? Promise.resolve<Selection>({})]);
  // A code in the address (typed in the ticket box, or a shared link) may unlock a hidden type.
  const buyerCode = await codeForBuyer(eventId, query.code);
  const { session, access } = await readPage(eventId, buyerCode?.code?.ticketTypeId ?? null);

  if (!access) {
    notFound();
  }
  if (access.kind === "gated") {
    return (
      <main id="main" tabIndex={-1} className="bg-paper">
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

  const code = buyerCode?.code ?? null;
  const unlocked = code?.ticketTypeId ? event.ticketTypes.find((type) => type.id === code.ticketTypeId) : undefined;
  return (
    <main id="main" tabIndex={-1} className="bg-paper">
      <PublicEventView
        code={buyerCode && { text: buyerCode.text, gives: code ? describeCode(code, unlocked?.name) : null, message: buyerCode.message }}
        event={{ ...event, ticketTypes: priceWithTicketCode(priceForViewer(event.ticketTypes, memberPlan !== null), code) }}
        memberPlan={memberPlan}
        selection={{ ticketTypeId: query.ticketTypeId ?? unlocked?.id, quantity: Number(query.quantity) }}
        viewer={viewer}
      />
    </main>
  );
}
