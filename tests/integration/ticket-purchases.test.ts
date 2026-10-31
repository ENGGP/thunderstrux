import { beforeEach, describe, expect, test, vi } from "vitest";
import { GET as statusRoute } from "@/app/api/purchases/tickets/[orderId]/status/route";
import ConfirmedPage from "@/app/(public)/events/[eventId]/checkout/confirmed/page";
import CancelPage from "@/app/cancel/page";
import PurchasesPage from "@/app/purchases/page";
import SuccessPage from "@/app/success/page";
import MyTicketsPage from "@/app/tickets/page";
import { prisma } from "@/lib/db";
import { ticketReference } from "@/lib/format";
import { purchaseLinkForEmail, redeemGuestAccess } from "@/lib/guest/guest-access";
import { TicketOrderNotice } from "@/components/purchases/ticket-order-notice";
import { getOwnTicketPurchase, getWalletTickets } from "@/lib/purchases/ticket-purchases";
import { StripeConfigurationError } from "@/lib/stripe";
import { clearMockSession, setMockSession } from "@/tests/helpers/auth";
import { parseJsonResponse, routeContext } from "@/tests/helpers/http";
import { renderPage } from "@/tests/helpers/render";
import { createEvent, createMember, createOrder, createOrganisationAccount, unique } from "@/tests/helpers/test-data";

// The success page's development fallback reads Stripe; unless a test says otherwise, Stripe isn't configured.
const stripe = vi.hoisted(() => ({ retrieve: vi.fn() }));
vi.mock("@/lib/stripe", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/stripe")>()),
  getStripe: () => ({ checkout: { sessions: { retrieve: stripe.retrieve } } })
}));
beforeEach(() => { stripe.retrieve.mockReset().mockRejectedValue(new StripeConfigurationError("Stripe is not configured")); });
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
  // PAY-048: refunded one ticket at a time, the page read only the last refund. 11:30 pm in Perth is already tomorrow in Brisbane.
  test("the refund notice adds up every refund, here and in Stripe, and dates it in the society's zone", async () => {
    const fixture = await pendingPurchase();
    await fulfil(fixture);
    await prisma.organisation.update({ where: { id: fixture.owner.organisation.id }, data: { timeZone: "Australia/Perth" } });
    await prisma.order.update({ where: { id: fixture.order.id }, data: { refundStatus: "refunded", externalRefundedAmount: 500 } });
    for (const [amount, resolvedAt] of [[2000, "2026-10-29T02:00:00Z"], [2000, "2026-10-30T15:30:00Z"]] as const) {
      await prisma.refundRequest.create({ data: { orderId: fixture.order.id, organisationId: fixture.owner.organisation.id, amount, reason: "One ticket at a time.", operationKey: unique("refund"), status: "succeeded", resolvedAt: new Date(resolvedAt) } });
    }
    const order = await getOwnTicketPurchase(fixture.buyer.id, fixture.order.id);
    const notice = await renderPage(TicketOrderNotice({ order: order!, processing: null }));
    expect(notice).toContain("$45.00 was refunded to your card on 30 Oct 2026.");

    // Partly refunded, in Stripe and here: the buyer's total, not only Stripe's part.
    await prisma.order.update({ where: { id: fixture.order.id }, data: { refundStatus: null } });
    const partly = await renderPage(TicketOrderNotice({ order: (await getOwnTicketPurchase(fixture.buyer.id, fixture.order.id))!, processing: null }));
    expect(partly).toContain("$45.00 of");
  });

  // PAY-056: no tickets were issued, so a dispute on a payment under review is about the money.
  test("a disputed payment under review says what happens to the money, not to tickets", async () => {
    const fixture = await pendingPurchase();
    const notice = async (disputeStatus: "open" | "lost" | "won") => {
      await prisma.order.update({ where: { id: fixture.order.id }, data: { status: "failed", paidAt: new Date(), failedAt: new Date(), requiresCompensationReview: true, fulfilmentFailedAt: new Date(), fulfilmentFailureReason: "sold_out", disputeStatus } });
      return renderPage(TicketOrderNotice({ order: (await getOwnTicketPurchase(fixture.buyer.id, fixture.order.id))!, processing: null }));
    };
    const open = await notice("open");
    expect(open).toContain("Your bank has disputed this payment");
    expect(open).not.toContain("under review");
    const lost = await notice("lost");
    expect(lost).toContain("Refunded by your bank");
    expect(lost).not.toContain("no longer valid");
    const won = await notice("won");
    expect(won).toContain("will sort it out");
    expect(won).not.toContain("under review");
  });

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

  test("the confirmed page shows only the buyer's own paid order for that event; anything else is the same 404 and signed out goes to login", async () => {
    const fixture = await pendingPurchase();
    const otherEvent = await createEvent({ organisationId: fixture.owner.organisation.id, status: "published" });
    const confirmed = (eventId: string, orderId?: string) => ConfirmedPage({ params: Promise.resolve({ eventId }), searchParams: Promise.resolve({ orderId }) });
    const notFound = { digest: expect.stringContaining("NEXT_HTTP_ERROR_FALLBACK;404") };

    clearMockSession();
    await expect(confirmed(fixture.event.id, fixture.order.id)).rejects.toMatchObject({ digest: expect.stringContaining(`/login?callbackUrl=${encodeURIComponent(`/events/${fixture.event.id}`)}`) });
    asMember(fixture.buyer);
    // Not confirmed until the webhook has paid it.
    await expect(confirmed(fixture.event.id, fixture.order.id)).rejects.toMatchObject(notFound);
    await fulfil(fixture);
    const page = await renderPage(await confirmed(fixture.event.id, fixture.order.id));
    expect(page).toContain("Booking confirmed");
    for (const ticket of await prisma.ticket.findMany({ where: { orderId: fixture.order.id } })) expect(page).toContain(`Ticket ${ticketReference(ticket.id)}`);
    await expect(confirmed(otherEvent.id, fixture.order.id)).rejects.toMatchObject(notFound);
    await expect(confirmed(fixture.event.id)).rejects.toMatchObject(notFound);
    asMember(fixture.stranger);
    await expect(confirmed(fixture.event.id, fixture.order.id)).rejects.toMatchObject(notFound);

    // It says the tickets were emailed only once they were, and never "ready" after a refund.
    asMember(fixture.buyer);
    expect(page).toContain("We&#x27;re emailing them");
    await prisma.order.update({ where: { id: fixture.order.id }, data: { ticketEmailSentAt: new Date() } });
    expect(await renderPage(await confirmed(fixture.event.id, fixture.order.id))).toContain("We&#x27;ve emailed them");
    await prisma.order.update({ where: { id: fixture.order.id }, data: { refundStatus: "refunded" } });
    await expect(confirmed(fixture.event.id, fixture.order.id)).rejects.toMatchObject({ digest: expect.stringContaining(`/purchases/tickets/${fixture.order.id}`) });
  });

  test("the cancel page names the order only to its buyer", async () => {
    const fixture = await pendingPurchase();
    const cancel = () => CancelPage({ searchParams: Promise.resolve({ order: fixture.order.id }) }).then(renderPage);
    asMember(fixture.stranger);
    const foreign = await cancel();
    expect(foreign).toContain("You left the payment page before paying.");
    expect(foreign).not.toContain("Engineering Mixer");
    asMember(fixture.buyer);
    expect(await cancel()).toContain("Back to Engineering Mixer");
    // Paid after all, then refunded: the page sends the buyer to the order, never "went through".
    await fulfil(fixture);
    expect(await cancel()).toContain("Your order went through");
    await prisma.order.update({ where: { id: fixture.order.id }, data: { refundStatus: "refunded" } });
    await expect(cancel()).rejects.toMatchObject({ digest: expect.stringContaining(`/purchases/tickets/${fixture.order.id}`) });
  });

  test("Purchases lists orders in the buyer's words, checkouts that didn't complete behind a link; the wallet splits tickets into upcoming, past and not valid", async () => {
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
    expect(purchases).not.toContain("Didn&#x27;t complete");
    expect(purchases).toContain("Show 1 checkout that didn&#x27;t complete");
    expect(purchases).toContain("/purchases?incomplete=1");
    expect(purchases).toContain(`/purchases/tickets/${past.id}`);
    expect(purchases).not.toContain(theirs.id);
    const everything = await renderPage(await PurchasesPage({ searchParams: Promise.resolve({ incomplete: "1" }) }));
    expect(everything).toContain("Didn&#x27;t complete");
    expect(everything).toContain("Not charged");
    expect(everything).toContain("Checkouts that didn&#x27;t complete took no money.");
    expect(everything).toContain(`/purchases/tickets/${past.id}`);
    expect(everything).not.toContain(theirs.id);
  });

  // AGENTS.md: an order is never marked paid from the browser's success page.
  test("the success page never asks Stripe or confirms a payment, in any environment; other outcomes say where the order stands", async () => {
    const fixture = await pendingPurchase();
    asMember(fixture.buyer);
    const visit = () => SuccessPage({ searchParams: Promise.resolve({ session_id: fixture.order.stripeSessionId as string }) }).then(renderPage);
    stripe.retrieve.mockResolvedValue({ id: fixture.order.stripeSessionId, payment_status: "paid", metadata: { orderId: fixture.order.id } });

    // PAY-024: the webhook or the reconciliation sweep confirms it; arriving here proves nothing.
    for (const environment of ["production", "development", "test"]) {
      vi.stubEnv("NODE_ENV", environment);
      expect(await visit()).toContain("Confirming your payment");
    }
    expect(stripe.retrieve).not.toHaveBeenCalled();
    expect(await prisma.order.findUniqueOrThrow({ where: { id: fixture.order.id }, select: { status: true, paidAt: true } })).toEqual({ status: "pending", paidAt: null });

    await prisma.order.update({ where: { id: fixture.order.id }, data: { status: "failed", failedAt: new Date() } });
    const failed = await visit();
    expect(failed).toContain("This checkout didn&#x27;t complete");
    expect(failed).toContain("Nothing was charged.");

    await prisma.order.update({ where: { id: fixture.order.id }, data: { status: "paid", paymentKind: "free", unitPrice: 0, totalAmount: 0, paidAt: new Date(), failedAt: null } });
    expect(await visit()).toContain("Registration confirmed for 2 tickets");
    await prisma.order.update({ where: { id: fixture.order.id }, data: { refundStatus: "refunded" } });
    expect(await visit()).toContain("for where it stands.");
  });
});
