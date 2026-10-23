import { beforeEach, describe, expect, test, vi } from "vitest";
import HistoryPage from "@/app/(dashboard)/dashboard/history/page";
import { PATCH as updateEventRoute } from "@/app/api/events/[eventId]/route";
import { readHistory } from "@/lib/audit/history";
import { prisma } from "@/lib/db";
import { selectMockContext, setMockSession } from "@/tests/helpers/auth";
import { jsonRequest, routeContext } from "@/tests/helpers/http";
import { renderPage } from "@/tests/helpers/render";
import { createEvent, createMember, createOrganisationAccount, createOrganisationStaff } from "@/tests/helpers/test-data";

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  usePathname: () => "/dashboard/history",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() })
}));

beforeEach(() => {
  vi.stubEnv("MFA_ENFORCEMENT_MODE", "off");
});

const page = (params: Record<string, string> = {}) => HistoryPage({ searchParams: Promise.resolve(params) }).then(renderPage);
const zone = "Australia/Brisbane";

async function edit(event: Awaited<ReturnType<typeof createEvent>>, version: number, changes: Record<string, unknown>) {
  const current = await prisma.event.findUniqueOrThrow({ where: { id: event.id }, include: { ticketTypes: true } });
  const body = {
    organisationId: current.organisationId, title: current.title, description: current.description, location: current.location,
    startTime: current.startTime.toISOString(), endTime: current.endTime.toISOString(), status: current.status, version,
    ticketTypes: current.ticketTypes.map((type) => ({ id: type.id, name: type.name, price: type.price, quantity: type.quantity, expectedQuantity: type.quantity })),
    ...changes
  };
  return updateEventRoute(jsonRequest(`http://localhost/api/events/${event.id}`, body, { method: "PATCH" }), routeContext({ eventId: event.id }));
}

describe("History (T38)", () => {
  test("an event edit records what changed and who did it, in their role at the time; a refused edit records nothing", async () => {
    const { organisation, user } = await createOrganisationAccount();
    const event = await createEvent({ organisationId: organisation.id, title: "Engineering Mixer" });
    setMockSession({ userId: user.id, email: user.email, accountRole: "organisation" });
    const start = new Date(event.startTime.getTime() + 3600_000);
    const response = await edit(event, 1, {
      location: "The Pav", startTime: start.toISOString(), endTime: new Date(start.getTime() + 2 * 3600_000).toISOString(),
      ticketTypes: [{ id: event.ticketTypes[0].id, name: "General", price: 1500, quantity: 10, expectedQuantity: 10 }, { name: "Student", price: 800, quantity: 20 }]
    });
    expect(response.status).toBe(200);
    // A stale version is refused inside the transaction, so no row is written.
    expect((await edit(event, 1, { title: "Stale" })).status).toBe(409);
    const rows = await prisma.auditLog.findMany({ where: { organisationId: organisation.id, action: "event.updated" } });
    expect(rows).toHaveLength(1);
    expect(rows[0].actorRole).toBe("owner");

    const { entries } = await readHistory(organisation.id, {}, zone);
    const edited = entries.find((entry) => entry.sentence.some((part) => typeof part === "object" && part.text === "Engineering Mixer") && entry.facts.length)!;
    expect(edited.actor).toMatchObject({ kind: "person", role: "Owner" });
    expect(edited.facts).toEqual(expect.arrayContaining([
      { label: "Location", value: "The Pav", was: "Integration Room" },
      expect.objectContaining({ label: "Starts" }),
      { label: "General, price", value: "$15.00", was: "$12.00" },
      { label: "Ticket type added", value: "Student" }
    ]));
  });

  test("the page shows owners each family with safe facts, hides check-ins from All, filters, pages and never leaks raw metadata", async () => {
    const { organisation, user } = await createOrganisationAccount();
    const other = await createOrganisationAccount();
    const secret = "acct_SENTINEL_ID";
    const base = { organisationId: organisation.id, actorUserId: user.id };
    await prisma.auditLog.createMany({ data: [
      { ...base, action: "stripe_connect.account_created", targetType: "Organisation", targetId: organisation.id, metadata: { stripeAccountId: secret }, createdAt: new Date(Date.now() - 5000) },
      { ...base, action: "stripe_connect.dashboard_opened", targetType: "Organisation", targetId: organisation.id, metadata: { stripeAccountId: secret }, createdAt: new Date(Date.now() - 4500) },
      { ...base, action: "order.refund_requested", targetType: "Order", targetId: "cmorder1234ABCDEF", metadata: { amount: 1500, reason: "Can't attend", refundRequestId: "rr_SENTINEL" }, createdAt: new Date(Date.now() - 4000) },
      { ...base, action: "ticket.checked_in", targetType: "Ticket", targetId: "cmticket1", createdAt: new Date(Date.now() - 3000) },
      { organisationId: organisation.id, action: "order.compensation_refund_review_required", targetType: "Order", targetId: "cmorder9", metadata: { reason: "sold_out" }, createdAt: new Date(Date.now() - 2000) },
      // Written before History kept what changed.
      { ...base, action: "event.updated", targetType: "Event", targetId: "cmgone", createdAt: new Date(Date.now() - 1000) },
      { organisationId: other.organisation.id, actorUserId: other.user.id, action: "event.created", targetType: "Event", targetId: "cmforeign", metadata: { title: "Another society's gala" } }
    ] });
    setMockSession({ userId: user.id, email: user.email, accountRole: "organisation" });
    const html = await page();
    for (const text of ["History", "started connecting a Stripe account", "opened the Stripe dashboard", "refunded", "order ABCDEF", "$15.00", "“Can&#x27;t attend”", "Thunderstrux", "in payment review", "Paid after the last ticket sold", "Historical detail unavailable", "That&#x27;s the start of the society&#x27;s history"]) expect(html).toContain(text);
    for (const hidden of [secret, "rr_SENTINEL", "checked in a ticket", "Another society"]) expect(html).not.toContain(hidden);

    const checkins = await page({ category: "checkins" });
    expect(checkins).toContain("checked in a ticket");
    expect(checkins).not.toContain("refunded");
    const automatic = await page({ who: "thunderstrux" });
    expect(automatic).toContain("in payment review");
    expect(automatic).not.toContain("Stripe account");
    expect(await page({ category: "merchandise" })).toContain("No matches");
    expect(await page({ cursor: "not-a-cursor" })).toContain("Showing the newest entries");

    await prisma.auditLog.createMany({ data: Array.from({ length: 55 }, (_, index) => ({ ...base, action: "staff_mfa.verified", targetType: "User", targetId: user.id, createdAt: new Date(Date.now() - 100_000 - index * 1000) })) });
    const first = await readHistory(organisation.id, {}, zone);
    expect(first.entries).toHaveLength(50);
    const second = await readHistory(organisation.id, {}, zone, first.nextCursor!);
    expect(second.nextCursor).toBeNull();
    expect(new Set([...first.entries, ...second.entries].map((entry) => entry.id)).size).toBe(first.entries.length + second.entries.length);
  });

  test("a new society says nothing is recorded yet; staff without audit:read are refused", async () => {
    const { organisation, user } = await createOrganisationAccount();
    await prisma.auditLog.deleteMany({ where: { organisationId: organisation.id } });
    setMockSession({ userId: user.id, email: user.email, accountRole: "organisation" });
    expect(await page()).toContain("Nothing recorded yet");

    for (const role of ["event_manager", "finance_manager", "check_in_staff"] as const) {
      const member = await createMember();
      await createOrganisationStaff({ organisationId: organisation.id, userId: member.id, role });
      setMockSession({ userId: member.id, email: member.email, accountRole: "member" });
      selectMockContext({ mode: "staff", organisationId: organisation.id });
      await expect(page()).rejects.toThrow();
    }
  });

  test("a closed account shows as a former staff member", async () => {
    const { organisation, user } = await createOrganisationAccount();
    const leaver = await createMember();
    await createOrganisationStaff({ organisationId: organisation.id, userId: leaver.id, role: "admin" });
    await prisma.auditLog.create({ data: { organisationId: organisation.id, actorUserId: leaver.id, action: "event.created", targetType: "Event", targetId: "cmx", metadata: { title: "Launch Night" } } });
    await prisma.user.update({ where: { id: leaver.id }, data: { closedAt: new Date(), disabledAt: new Date() } });
    const { entries } = await readHistory(organisation.id, {}, zone);
    expect(entries.find((entry) => entry.actor.kind === "former")).toMatchObject({ actor: { name: "A former staff member", role: "Admin" } });
    setMockSession({ userId: user.id, email: user.email, accountRole: "organisation" });
    expect(await page()).not.toContain(leaver.email);
  });
});
