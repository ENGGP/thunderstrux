import { describe, expect, test, vi } from "vitest";
import AccountSettingsPage from "@/app/account/settings/page";
import { PATCH as updateEventRoute } from "@/app/api/events/[eventId]/route";
import { PATCH as preferencesRoute } from "@/app/api/me/notification-preferences/route";
import { prisma } from "@/lib/db";
import { decryptNotification } from "@/lib/email/notification-crypto";
import { eventChangeDelayMs, fanOutEventChanges } from "@/lib/events/event-changes";
import { queueMembershipNotices } from "@/lib/memberships/reminders";
import { setMockSession } from "@/tests/helpers/auth";
import { jsonRequest, parseJsonResponse, routeContext } from "@/tests/helpers/http";
import { renderPage } from "@/tests/helpers/render";
import { createEvent, createMember, createMembershipGrant, createOrder, createOrganisationAccount } from "@/tests/helpers/test-data";

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  usePathname: () => "/account/settings",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() })
}));
vi.mock("next-auth/react", () => ({ signOut: vi.fn(), useSession: () => ({ status: "authenticated", data: null, update: vi.fn() }) }));

// T30 rows of the readiness plan §5 email matrix: material event changes,
// renewal reminders and expiry notices, and the one optional preference.
// The other rows are covered where their owning service is tested; the
// matrix in Email Delivery Implementation names each test.

const day = 86_400_000;
const later = () => new Date(Date.now() + eventChangeDelayMs + 60_000);
const read = (job: { id: string; encryptedPayload: string }) => decryptNotification(job.encryptedPayload, job.id) as { subject: string; text: string };

// A published event with a member's paid order, a guest's paid order, a
// refunded order and a checkout still pending.
async function ticketedEvent() {
  const { organisation, user } = await createOrganisationAccount({ stripeReady: true });
  const event = await createEvent({ organisationId: organisation.id, status: "published" });
  const ticketType = event.ticketTypes[0];
  const paid = { organisationId: organisation.id, eventId: event.id, ticketTypeId: ticketType.id, status: "paid" as const, paidAt: new Date() };
  const issue = (orderId: string, validity: "active" | "void" = "active") =>
    prisma.ticket.create({ data: { orderId, eventId: event.id, ticketTypeId: ticketType.id, organisationId: organisation.id, issueSequence: 1, validity } });
  const member = await createMember();
  const memberOrder = await createOrder({ ...paid, userId: member.id });
  await issue(memberOrder.id);
  const guestOrder = await createOrder(paid);
  await prisma.order.update({ where: { id: guestOrder.id }, data: { buyerEmailSnapshot: "guest@example.com", buyerIdentityCapturedAt: new Date(), buyerIdentityProvenance: "purchase" } });
  await issue(guestOrder.id);
  const refunded = await createOrder({ ...paid, userId: (await createMember()).id });
  await issue(refunded.id, "void");
  await createOrder({ organisationId: organisation.id, eventId: event.id, ticketTypeId: ticketType.id, userId: (await createMember()).id });
  setMockSession({ userId: user.id, email: user.email, accountRole: "organisation" });
  return { organisation, event, ticketType, member, memberOrder, guestOrder };
}

async function edit(event: Awaited<ReturnType<typeof createEvent>>, version: number, changes: Record<string, unknown>) {
  const current = await prisma.event.findUniqueOrThrow({ where: { id: event.id }, include: { ticketTypes: true } });
  const body = {
    organisationId: current.organisationId, title: current.title, description: current.description, location: current.location,
    startTime: current.startTime.toISOString(), endTime: current.endTime.toISOString(), status: current.status, version,
    ticketTypes: current.ticketTypes.map((type) => ({ id: type.id, name: type.name, price: type.price, quantity: type.quantity, expectedQuantity: type.quantity })),
    ...changes
  };
  const response = await updateEventRoute(jsonRequest(`http://localhost/api/events/${event.id}`, body, { method: "PATCH" }), routeContext({ eventId: event.id }));
  expect(response.status).toBe(200);
  return parseJsonResponse(response);
}

describe("notification matrix (T30)", () => {
  test("a new time and place emails each valid ticket holder once, after a pause, resuming from its cursor", async () => {
    const { organisation, event, member, memberOrder, guestOrder } = await ticketedEvent();
    const startTime = new Date(event.startTime.getTime() + day);
    await edit(event, 1, { location: "Main Hall", startTime: startTime.toISOString(), endTime: new Date(startTime.getTime() + 2 * 3600_000).toISOString() });
    const change = await prisma.eventChange.findFirstOrThrow({ where: { eventId: event.id } });
    expect(change).toMatchObject({ eventVersion: 2, previousLocation: "Integration Room", location: "Main Hall", completedAt: null, cursor: null });

    // Nothing goes during the pause.
    expect(await fanOutEventChanges(new Date())).toBe(0);
    // A run that stopped after the first order resumes after it.
    const [first, second] = [memberOrder.id, guestOrder.id].sort();
    await prisma.eventChange.update({ where: { id: change.id }, data: { cursor: first } });
    expect(await fanOutEventChanges(later())).toBe(1);
    expect(await prisma.notificationOutbox.findMany({ where: { eventKey: { startsWith: "event-change/" } }, select: { eventKey: true } }))
      .toEqual([{ eventKey: `event-change/${event.id}/2/${second}` }]);
    // Replaying every page queues only what is missing: one per purchase and recipient.
    await prisma.eventChange.update({ where: { id: change.id }, data: { cursor: null, completedAt: null, outcome: null } });
    expect(await fanOutEventChanges(later())).toBe(1);
    expect(await fanOutEventChanges(later())).toBe(0);
    expect(await prisma.eventChange.findUniqueOrThrow({ where: { id: change.id } })).toMatchObject({ outcome: "sent", completedAt: expect.any(Date) });

    const jobs = await prisma.notificationOutbox.findMany({ where: { eventKey: { startsWith: "event-change/" } }, orderBy: { recipient: "asc" } });
    expect(jobs.map((job) => [job.recipient, job.organisationId, job.privacy])).toEqual([
      ["guest@example.com", organisation.id, "business"],
      [member.email, organisation.id, "business"]
    ].sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
    const guest = read(jobs.find((job) => job.recipient === "guest@example.com")!);
    expect(guest.subject).toBe(`Change to ${event.title}`);
    expect(guest.text).toContain("changed the time and place");
    expect(guest.text).toContain("Where: now Main Hall. It was Integration Room.");
    expect(guest.text).toContain("Your tickets are still valid.");
    expect(guest.text).toContain("(Brisbane time)");
    expect(guest.text).not.toContain("time time");
    expect(guest.text).not.toContain("http");
    // A member's copy links to their tickets.
    expect(read(jobs.find((job) => job.recipient === member.email)!).text).toContain("http://localhost:3000/tickets");
  });

  test("other edits, events without tickets and an undo before anyone heard send nothing; a correction keeps the original 'was'", async () => {
    const { event } = await ticketedEvent();
    await edit(event, 1, { title: "Renamed night", description: "New words" });
    expect(await prisma.eventChange.count()).toBe(0);

    await edit(event, 2, { location: "Room B" });
    await edit(event, 3, { location: "Room C" });
    const changes = await prisma.eventChange.findMany({ where: { eventId: event.id }, orderBy: { eventVersion: "asc" } });
    expect(changes.map((change) => [change.eventVersion, change.outcome, change.previousLocation, change.location])).toEqual([
      [3, "superseded", "Integration Room", "Room B"],
      [4, null, "Integration Room", "Room C"]
    ]);
    await edit(event, 4, { location: "Integration Room" });
    expect(await prisma.eventChange.count({ where: { completedAt: null } })).toBe(0);
    expect(await fanOutEventChanges(later())).toBe(0);

    // No tickets, no one to tell.
    const other = await createOrganisationAccount();
    const empty = await createEvent({ organisationId: other.organisation.id, status: "published" });
    setMockSession({ userId: other.user.id, email: other.user.email, accountRole: "organisation" });
    await edit(empty, 1, { location: "Room D" });
    expect(await prisma.eventChange.count({ where: { eventId: empty.id } })).toBe(0);
  });

  test("a renewal reminder goes once, seven days out, only when wanted and not yet renewed; an expiry notice goes once it ends", async () => {
    const { organisation } = await createOrganisationAccount();
    const now = new Date();
    const grant = async (endsIn: number, member = undefined as undefined | Awaited<ReturnType<typeof createMember>>, startsIn = -60) => {
      const holder = member ?? await createMember();
      const created = await createMembershipGrant(organisation.id, holder.id, holder.email, {
        startsAt: new Date(now.getTime() + startsIn * day), endsAt: new Date(now.getTime() + endsIn * day), grantedAt: new Date(now.getTime() - 60 * day)
      });
      return { holder, grant: created };
    };
    const reminded = await grant(6);
    const optedOut = await grant(6);
    await prisma.user.update({ where: { id: optedOut.holder.id }, data: { renewalReminders: false } });
    const renewed = await grant(6);
    await grant(200, renewed.holder, 6);
    await grant(30);
    const ended = await grant(-1);
    const revoked = await grant(-1);
    await prisma.membershipGrant.update({ where: { id: revoked.grant.id }, data: { revokedAt: new Date(now.getTime() - 3 * day), revocationReason: "Left the club." } });
    await grant(-10);
    // Bought inside the last week: the receipt is enough.
    const late = await createMember();
    await createMembershipGrant(organisation.id, late.id, late.email, { startsAt: new Date(now.getTime() - day), endsAt: new Date(now.getTime() + 5 * day), grantedAt: new Date(now.getTime() - day) });

    expect(await queueMembershipNotices(now)).toBe(2);
    expect(await queueMembershipNotices(now)).toBe(0);
    const jobs = await prisma.notificationOutbox.findMany({ where: { eventKey: { startsWith: "membership-" } }, orderBy: { eventKey: "asc" } });
    expect(jobs.map((job) => [job.eventKey, job.recipient])).toEqual([
      [`membership-expired/${ended.grant.id}`, ended.holder.email],
      [`membership-renewal/${reminded.grant.id}`, reminded.holder.email]
    ]);
    const reminder = read(jobs[1]);
    expect(reminder.text).toContain("Memberships don't renew automatically.");
    expect(reminder.text).not.toContain("time time");
    expect(reminder.text).toContain("turn off renewal reminders in Account settings");
    expect(reminder.text).toContain("http://localhost:3000/memberships");
    expect(read(jobs[0]).text).toContain("its member benefits have stopped");
  });

  test("Account settings turns renewal reminders off and on; the route refuses other fields, foreign origins and signed-out callers", async () => {
    const member = await createMember();
    const patch = (body: unknown, init: RequestInit = {}) =>
      preferencesRoute(jsonRequest("http://localhost:3000/api/me/notification-preferences", body, { method: "PATCH", ...init }));
    expect((await patch({ renewalReminders: false })).status).toBe(401);

    setMockSession({ userId: member.id, email: member.email, accountRole: "member" });
    expect(await renderPage(await AccountSettingsPage())).toContain("Membership renewal reminders");
    const off = await patch({ renewalReminders: false });
    expect(off.status).toBe(200);
    expect(await parseJsonResponse(off)).toEqual({ preferences: { renewalReminders: false } });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: member.id } })).renewalReminders).toBe(false);
    expect((await patch({ renewalReminders: true, receipts: false })).status).toBe(400);
    expect((await patch({ renewalReminders: true }, { headers: { origin: "https://evil.example", "content-type": "application/json" } })).status).toBe(403);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: member.id } })).renewalReminders).toBe(false);
  });
});
