import { describe, expect, test, vi } from "vitest";
import { GET as statusRoute } from "@/app/api/purchases/tickets/[orderId]/status/route";
import CancelPage from "@/app/cancel/page";
import PurchasesPage from "@/app/purchases/page";
import SuccessPage from "@/app/success/page";
import MyTicketsPage from "@/app/tickets/page";
import { prisma } from "@/lib/db";
import { purchaseLinkForEmail, redeemGuestAccess } from "@/lib/guest/guest-access";
import { getOwnTicketPurchase, getWalletTickets } from "@/lib/purchases/ticket-purchases";
import { clearMockSession, setMockSession } from "@/tests/helpers/auth";
import { parseJsonResponse, routeContext } from "@/tests/helpers/http";
import { renderPage } from "@/tests/helpers/render";
import { createEvent, createMember, createOrder, createOrganisationAccount, unique } from "@/tests/helpers/test-data";

// The success page's development fallback must not reach Stripe in tests.
vi.mock("@/lib/stripe", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/stripe")>();
  return { ...actual, getStripe: () => { throw new actual.StripeConfigurationError("Stripe is not configured"); } };
});
vi.mock("next/navigation", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/navigation")>()), usePathname: () => "/purchases", useRouter: () => ({ refresh: () => undefined }) }));

const asMember = (member: { id: string; email: string }) => setMockSession({ userId: member.id, email: member.email, accountRole: "member" });
const status = async (orderId: string) => {
  const response = await statusRoute(new Request(`http://localhost:3000/api/purchases/tickets/${orderId}/status`), routeContext({ orderId }));
  return { code: response.status, body: response.status === 200 ? await parseJsonResponse(response) : null };
};

// A member's pending Stripe order and a stranger, both members.
async function pendingPurchase() {
  const owner = await createOrganisationAccount();
  const event = await createEvent({ organisationId: owner.organisation.id, status: "published", title: "Engineering Mixer" });
  const buyer = await createMember();
  const stranger = await createMember();
  const order = await createOrder({ organisationId: owner.organisation.id, eventId: event.id, ticketTypeId: event.ticketTypes[0].id, userId: buyer.id, quantity: 2, unitPrice: 1500 });
  await prisma.order.update({ where: { id: order.id }, data: { buyerEmailSnapshot: buyer.email, buyerIdentityCapturedAt: new Date(), buyerIdentityProvenance: "purchase" } });
  return { owner, event, buyer, stranger, order };
}

async function fulfil(fixture: Awaited<ReturnType<typeof pendingPurchase>>) {
  await prisma.order.update({ where: { id: fixture.order.id }, data: { status: "paid", paidAt: new Date(), fulfilledAt: new Date() } });
  await prisma.ticket.createMany({ data: [1, 2].map((issueSequence) => ({ issueSequence, orderId: fixture.order.id, eventId: fixture.event.id, ticketTypeId: fixture.event.ticketTypes[0].id, organisationId: fixture.owner.organisation.id })) });
}

describe("purchases and order status", () => {
  test("only the buyer or the guest session that bought it can read an order; everyone else gets the same 404", async () => {
    const fixture = await pendingPurchase();
    clearMockSession();
    expect((await status(fixture.order.id)).code).toBe(404);
    asMember(fixture.stranger);
    expect((await status(fixture.order.id)).code).toBe(404);
    expect(await getOwnTicketPurchase(fixture.stranger.id, fixture.order.id)).toBeNull();
    asMember(fixture.buyer);
    expect(await status(fixture.order.id)).toEqual({ code: 200, body: { status: "processing" } });
    expect((await getOwnTicketPurchase(fixture.buyer.id, fixture.order.id))?.id).toBe(fixture.order.id);

    // A guest order answers its own purchase-link session, not another guest's.
    clearMockSession();
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
    const sessionFor = async (email: string) => {
      const identity = await prisma.guestIdentity.create({ data: { email, verifiedAt: new Date() } });
      const guestOrder = await createOrder({ organisationId: fixture.owner.organisation.id, eventId: fixture.event.id, ticketTypeId: fixture.event.ticketTypes[0].id, status: "paid", paidAt: new Date() });
      await prisma.order.update({ where: { id: guestOrder.id }, data: { guestIdentityId: identity.id } });
      const link = await purchaseLinkForEmail(guestOrder.id, identity.id);
      const { sessionId } = await redeemGuestAccess(new URLSearchParams(new URL(link).hash.slice(1)).get("token")!);
      return { orderId: guestOrder.id, sessionId };
    };
    const guest = await sessionFor(`${unique("guest")}@example.com`);
    const otherGuest = await sessionFor(`${unique("guest")}@example.com`);
    globalThis.__THUNDERSTRUX_TEST_GUEST__ = guest.sessionId;
    expect(await status(guest.orderId)).toEqual({ code: 200, body: { status: "paid" } });
    expect((await status(otherGuest.orderId)).code).toBe(404);
    expect((await status(fixture.order.id)).code).toBe(404);
  });

  test("the success page shows the real state: confirming until the webhook lands, then paid, and the email only once it was sent", async () => {
    const fixture = await pendingPurchase();
    const success = () => SuccessPage({ searchParams: Promise.resolve({ session_id: fixture.order.stripeSessionId as string }) }).then(renderPage);

    asMember(fixture.stranger);
    const foreign = await success();
    expect(foreign).toContain("Checking payment status");
    expect(foreign).not.toContain("Engineering Mixer");

    asMember(fixture.buyer);
    expect(await success()).toContain("Confirming your payment");
    await fulfil(fixture);
    const paid = await success();
    expect(paid).toContain("You&#x27;re going");
    expect(paid).toContain("they&#x27;re in My tickets now");
    await prisma.order.update({ where: { id: fixture.order.id }, data: { ticketEmailSentAt: new Date() } });
    expect(await success()).toContain(`We&#x27;ve emailed them to ${fixture.buyer.email}`);
  });

  test("the cancel page names the order only to its buyer", async () => {
    const fixture = await pendingPurchase();
    const cancel = () => CancelPage({ searchParams: Promise.resolve({ order: fixture.order.id }) }).then(renderPage);
    asMember(fixture.stranger);
    const foreign = await cancel();
    expect(foreign).toContain("No payment was taken.");
    expect(foreign).not.toContain("Engineering Mixer");
    asMember(fixture.buyer);
    expect(await cancel()).toContain("Back to Engineering Mixer");
  });

  test("Purchases lists every order in the buyer's words; the wallet splits tickets into upcoming, past and not valid", async () => {
    const fixture = await pendingPurchase();
    const pastEvent = await createEvent({ organisationId: fixture.owner.organisation.id, status: "published", title: "Last Year's Ball" });
    await prisma.event.update({ where: { id: pastEvent.id }, data: { startTime: new Date(Date.now() - 2 * 86400000), endTime: new Date(Date.now() - 86400000) } });
    const past = await createOrder({ organisationId: fixture.owner.organisation.id, eventId: pastEvent.id, ticketTypeId: pastEvent.ticketTypes[0].id, userId: fixture.buyer.id, status: "paid", paidAt: new Date() });
    await prisma.ticket.create({ data: { issueSequence: 1, orderId: past.id, eventId: pastEvent.id, ticketTypeId: pastEvent.ticketTypes[0].id, organisationId: fixture.owner.organisation.id } });
    await createOrder({ organisationId: fixture.owner.organisation.id, eventId: fixture.event.id, ticketTypeId: fixture.event.ticketTypes[0].id, userId: fixture.buyer.id, status: "expired" });
    await fulfil(fixture);
    await prisma.ticket.updateMany({ where: { orderId: fixture.order.id, issueSequence: 2 }, data: { validity: "void", validityReason: "refunded", validityChangedAt: new Date() } });
    // Someone else's tickets never appear.
    const theirs = await createOrder({ organisationId: fixture.owner.organisation.id, eventId: fixture.event.id, ticketTypeId: fixture.event.ticketTypes[0].id, userId: fixture.stranger.id, status: "paid", paidAt: new Date() });
    await prisma.ticket.create({ data: { issueSequence: 1, orderId: theirs.id, eventId: fixture.event.id, ticketTypeId: fixture.event.ticketTypes[0].id, organisationId: fixture.owner.organisation.id } });

    const wallet = await getWalletTickets(fixture.buyer.id, "upcoming");
    expect(wallet.counts).toEqual({ upcoming: 1, past: 1, "not-valid": 1 });
    expect(wallet.tickets.map((ticket) => [ticket.orderId, ticket.issueSequence])).toEqual([[fixture.order.id, 1]]);
    expect((await getWalletTickets(fixture.buyer.id, "past")).tickets.map((ticket) => ticket.orderId)).toEqual([past.id]);

    asMember(fixture.buyer);
    const notValid = await renderPage(await MyTicketsPage({ searchParams: Promise.resolve({ view: "not-valid" }) }));
    expect(notValid).toContain("Refunded");
    expect(notValid).toContain("Ticket 2 of 2");
    const purchases = await renderPage(await PurchasesPage({ searchParams: Promise.resolve({}) }));
    expect(purchases).toContain("Didn&#x27;t complete");
    expect(purchases).toContain("Not charged");
    expect(purchases).toContain(`/purchases/tickets/${past.id}`);
    expect(purchases).not.toContain(theirs.id);
  });
});
