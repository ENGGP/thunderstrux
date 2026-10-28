import { beforeEach, describe, expect, test, vi } from "vitest";
import HistoryPage from "@/app/(dashboard)/dashboard/history/page";
import { PATCH as updateEventRoute } from "@/app/api/events/[eventId]/route";
import { readdir, readFile } from "node:fs/promises";
import { describe as describeEntry, historyPeople, readHistory } from "@/lib/audit/history";
import { createCommerceOrder } from "@/lib/commerce/orders";
import { prisma } from "@/lib/db";
import { orderReference } from "@/lib/format";
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
    const back = await readHistory(organisation.id, {}, zone, second.previousCursor!, "prev");
    expect(back.entries.map((entry) => entry.id)).toEqual(first.entries.map((entry) => entry.id));
    expect(back.previousCursor).toBeNull();
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

  test("a lost dispute taken back from the society reads as Thunderstrux's step, with the amount and no Stripe IDs", async () => {
    const { organisation } = await createOrganisationAccount();
    await prisma.auditLog.create({ data: {
      organisationId: organisation.id, action: "order.dispute_funds_recovered", targetType: "Order", targetId: "cmorderRECOVERED",
      metadata: { disputeId: "dp_SENTINEL", amount: 3000, transferReversalId: "trr_SENTINEL" }
    } });
    const { entries } = await readHistory(organisation.id, {}, zone);
    const recovered = entries.find((entry) => entry.sentence.some((part) => typeof part === "string" && part.startsWith("took back the lost dispute's money")))!;
    expect(recovered.actor).toMatchObject({ kind: "thunderstrux", name: "Thunderstrux" });
    expect(recovered.facts).toEqual([{ label: "Amount", value: "$30.00" }]);
    expect(JSON.stringify(recovered)).not.toMatch(/dp_SENTINEL|trr_SENTINEL/);
  });

  test("steps Thunderstrux takes itself without a person read as Thunderstrux, not Stripe (AUD-002)", async () => {
    const { organisation } = await createOrganisationAccount();
    for (const [action, targetType] of [["commerce_order.compensation_refund_queued", "CommerceOrder"], ["order.compensation_review_required", "Order"]]) {
      await prisma.auditLog.create({ data: { organisationId: organisation.id, action, targetType, targetId: `cm${action}` } });
    }
    const { entries } = await readHistory(organisation.id, {}, zone);
    expect(entries.map((entry) => entry.actor.kind)).toEqual(["thunderstrux", "thunderstrux"]);
    expect((await readHistory(organisation.id, { who: "stripe" }, zone)).entries).toEqual([]);
  });

  // Every action the app writes, with the dynamic families spelled out.
  const recordedActions = [
    "event.created", "event.updated", "event.published", "event.unpublished", "event.sales_closed", "event.sales_reopened", "event.deleted", "event.cancelled",
    // Written before the standalone ticket-type route was removed; old rows still show.
    "ticket_type.created",
    "ticket.checked_in", "ticket.checked_out",
    ...["order", "commerce_order"].flatMap((family) => [
      `${family}.refund_requested`, ...["succeeded", "pending", "failed", "canceled"].map((state) => `${family}.refund_${state}`),
      `${family}.external_refund_recorded`, `${family}.external_refund_reviewed`,
      ...["opened", "open", "won", "lost"].map((outcome) => `${family}.dispute_${outcome}`),
      `${family}.dispute_funds_recovered`, `${family}.compensation_refund_queued`
    ]),
    "order.manual_refund_marked", "order.dispute_resolved", "order.free_cancelled", "order.guest_claimed", "order.ticket_email_queued",
    "order.compensation_refund_review_required", "order.compensation_refund_started", "order.compensation_refund_confirmed",
    ...["refunded", "refund_failed", "refund_pending", "review_required"].map((state) => `order.compensation_${state}`),
    "email_outbox.requeued", "notification.requeued",
    ...["created", "updated", "published", "archived"].map((step) => `membership_plan.${step}`),
    "membership.revoked", "membership.free_cancelled",
    ...["created", "updated", "published", "archived", "restored"].map((step) => `merchandise_product.${step}`),
    "merchandise_order.ready", "merchandise_order.collected", "merchandise_order.return_recorded", "merchandise_order.free_cancelled",
    "staff.updated", "staff.ownership.handed_over", ...["created", "resent", "revoked", "accepted"].map((step) => `staff.invite.${step}`),
    "staff_mfa.enabled", "staff_mfa.verified", "staff_mfa.recovery_used",
    "stripe_connect.account_created", "stripe_connect.disconnected", "stripe_connect.dashboard_opened", "stripe_connect.payout_account_changed",
    "organisation.created", "organisation.profile_updated", "asset.uploaded", "asset.deleted", "asset.orphan_removed"
  ];

  test("every action the app records has its own sentence in a History family, never the raw action name", async () => {
    // A new literal action in the code must join the list above.
    const literal = new Set<string>();
    for (const root of ["lib", "app"]) {
      for (const file of (await readdir(root, { recursive: true })).filter((name) => name.endsWith(".ts"))) {
        for (const match of (await readFile(`${root}/${file}`, "utf8")).matchAll(/action: "([a-z_]+\.[a-z_.]+)"/g)) literal.add(match[1]);
      }
    }
    expect([...literal].filter((action) => !recordedActions.includes(action))).toEqual([]);

    const none = new Map();
    const targets = { events: none, orders: none, commerce: none, grants: none, plans: none, products: none, staff: none, invites: none, tickets: none, ticketTypes: none, assets: none };
    const unexplained = recordedActions.flatMap((action) => {
      const entry = describeEntry({ id: action, action, targetType: "", targetId: null, metadata: {}, createdAt: new Date(), actorUserId: null, actorRole: null, actor: null }, targets, zone);
      const sentence = entry.sentence.map((part) => (typeof part === "string" ? part : part.text)).join("");
      return entry.category && !sentence.startsWith("recorded “") ? [] : [action];
    });
    expect(unexplained).toEqual([]);
  });

  test("filters keep Stripe's steps, one person's, and whole days in the society's time zone; the Who list is sorted by name", async () => {
    const { organisation, user: owner } = await createOrganisationAccount();
    const helper = await createMember();
    await prisma.user.update({ where: { id: helper.id }, data: { displayName: "Aaron Helper" } });
    await prisma.user.update({ where: { id: owner.id }, data: { displayName: "Zoe Owner" } });
    await prisma.auditLog.deleteMany({ where: { organisationId: organisation.id } });
    const row = (action: string, createdAt: string, actorUserId: string | null = owner.id) => ({ organisationId: organisation.id, actorUserId, action, targetType: "Event", targetId: "cmevent", metadata: { title: action }, createdAt: new Date(createdAt) });
    // Brisbane is UTC+10: 20 October runs from 19 Oct 14:00 to 20 Oct 14:00 UTC.
    await prisma.auditLog.createMany({ data: [
      row("event.created", "2026-10-19T13:30:00Z"),
      row("event.published", "2026-10-19T14:30:00Z"),
      row("event.deleted", "2026-10-20T13:30:00Z", helper.id),
      row("event.sales_closed", "2026-10-20T14:30:00Z"),
      row("order.refund_succeeded", "2026-10-20T12:00:00Z", null),
      row("order.compensation_refund_started", "2026-10-20T12:30:00Z", null)
    ] });
    const actions = async (filters: Parameters<typeof readHistory>[1]) =>
      (await readHistory(organisation.id, filters, zone)).entries.map((entry) => entry.sentence.map((part) => (typeof part === "string" ? part : part.text)).join("")).sort();

    expect(await actions({ who: "stripe" })).toEqual(["confirmed the refund of order MEVENT"]);
    expect(await actions({ who: helper.id })).toEqual(["deleted the draft event.deleted"]);
    expect(await actions({ from: "2026-10-20", to: "2026-10-20" })).toHaveLength(4);
    expect(await actions({ from: "2026-10-21" })).toEqual(["closed ticket sales for event.sales_closed"]);
    expect(await actions({ to: "2026-10-19" })).toEqual(["created event.created"]);
    expect(await historyPeople(organisation.id)).toEqual([{ id: helper.id, name: "Aaron Helper" }, { id: owner.id, name: "Zoe Owner" }]);
  });

  test("facts say what changed, for each family that records it", () => {
    const none = new Map();
    const targets = { events: none, orders: none, commerce: none, grants: none, plans: none, products: none, staff: none, invites: none, tickets: none, ticketTypes: none, assets: none };
    const facts = (action: string, metadata: Record<string, unknown>) =>
      describeEntry({ id: action, action, targetType: "", targetId: null, metadata: metadata as never, createdAt: new Date(), actorUserId: null, actorRole: null, actor: null }, targets, zone).facts;

    expect(facts("event.updated", { changes: [
      { field: "ticketTypes", added: ["Student"], removed: ["Early bird"], changed: [{ name: "General", renamedFrom: "Standard", price: [1500, 1800], quantity: [10, 8] }] },
      { field: "description" }, { field: "heroAssetId", after: null }, { field: "visibility", before: "public", after: "members_only" },
      { field: "startTime", before: "2026-11-01T08:00:00.000Z", after: null }, { field: "capacity", before: 100, after: 80 }
    ] })).toEqual([
      { label: "Ticket type added", value: "Student" }, { label: "Ticket type removed", value: "Early bird" },
      { label: "General, price", value: "$18.00", was: "$15.00" }, { label: "General, left", value: "8", was: "10" }, { label: "Ticket type renamed", value: "General", was: "Standard" },
      { label: "Description", value: "Changed" }, { label: "Image", value: "Removed" }, { label: "Visibility", value: "Members only", was: "Public" },
      { label: "Starts", value: "None", was: "Sun 1 Nov, 6:00 pm" }, { label: "Capacity", value: "80", was: "100" }
    ]);
    expect(facts("staff.updated", { previousRole: "event_manager", nextRole: "admin", previousStatus: "invited", nextStatus: "active" }))
      .toEqual([{ label: "Role", value: "Admin", was: "Event manager" }, { label: "Access", value: "Active", was: "Invited" }]);
    expect(facts("staff.updated", { previousRole: "admin", nextRole: "admin", previousStatus: "active", nextStatus: "revoked" })).toEqual([]);
    expect(facts("staff.invite.created", { role: "check_in_staff" })).toEqual([{ label: "Role", value: "Check-in staff" }]);
    expect(facts("membership_plan.updated", { changedFields: ["priceAmount", "endsAt"] })).toEqual([{ label: "Changed", value: "price, last day" }]);
    expect(facts("organisation.profile_updated", { changedFields: ["supportEmail", "logoAssetId"] })).toEqual([{ label: "Changed", value: "contact email, logo" }]);
    expect(facts("merchandise_product.updated", { stock: [{ option: "M", before: 5, after: 8 }, { option: "L", after: 3 }] }))
      .toEqual([{ label: "Stock, M", value: "8", was: "5" }, { label: "Stock, L", value: "3", was: undefined }]);
    expect(facts("merchandise_order.return_recorded", { quantity: 2, restocked: false })).toEqual([{ label: "Items", value: "2" }, { label: "Back in stock", value: "No" }]);
    expect(facts("order.dispute_resolved", { reason: "Bank sided with us", ticketCount: 2 })).toEqual([{ label: "Reason", value: "“Bank sided with us”" }, { label: "Tickets", value: "2 valid again" }]);
    expect(facts("order.free_cancelled", { ticketCount: 1 })).toEqual([{ label: "Tickets", value: "1 no longer valid" }]);
    expect(facts("order.external_refund_recorded", { refundedOutside: 500, totalAmount: 3000 })).toEqual([{ label: "Refunded", value: "$5.00", was: "$30.00 paid" }]);
  });

  test("an entry names and links only this society's own records; another society's reads as a plain description", async () => {
    const { organisation, user } = await createOrganisationAccount();
    const other = await createOrganisationAccount();
    const planOf = (organisationId: string, name: string) => prisma.membershipProduct.create({ data: { organisationId, name, priceAmount: 0, startsAt: new Date(), endsAt: new Date(Date.now() + 86_400_000), entitlements: [] } });
    const ownPlan = await planOf(organisation.id, "Semester 2");
    const foreignPlan = await planOf(other.organisation.id, "Rival plan");
    const product = await prisma.merchandiseProduct.create({ data: { organisationId: organisation.id, name: "EngSoc hoodie" } });
    const staffer = await createMember();
    await prisma.user.update({ where: { id: staffer.id }, data: { displayName: "Sam Staff" } });
    const staff = await createOrganisationStaff({ organisationId: organisation.id, userId: staffer.id, role: "admin" });
    const invite = await prisma.organisationStaffInvite.create({ data: { organisationId: organisation.id, email: "new.helper@example.com", role: "event_manager", tokenHash: `invite-${staff.id}`, invitedById: user.id, expiresAt: new Date(Date.now() + 86_400_000) } });
    const order = await prisma.$transaction((tx) => createCommerceOrder(tx, {
      organisationId: organisation.id, kind: "merchandise", buyer: { userId: staffer.id }, buyerEmail: staffer.email, paymentKind: "free", feeAmount: 0, source: "checkout",
      lines: [{ quantity: 1, unitAmount: 0, name: "EngSoc hoodie", variant: "M" }]
    }));
    await prisma.auditLog.deleteMany({ where: { organisationId: organisation.id } });
    const base = { organisationId: organisation.id, actorUserId: user.id };
    await prisma.auditLog.createMany({ data: [
      { ...base, action: "membership_plan.published", targetType: "MembershipProduct", targetId: ownPlan.id },
      { ...base, action: "membership_plan.archived", targetType: "MembershipProduct", targetId: foreignPlan.id },
      { ...base, action: "merchandise_product.published", targetType: "MerchandiseProduct", targetId: product.id },
      { ...base, action: "staff.updated", targetType: "OrganisationStaff", targetId: staff.id, metadata: { previousStatus: "active", nextStatus: "revoked" } },
      { ...base, action: "staff.invite.resent", targetType: "OrganisationStaffInvite", targetId: invite.id },
      { ...base, action: "merchandise_order.ready", targetType: "CommerceOrder", targetId: order.id }
    ] });
    const parts = (await readHistory(organisation.id, {}, zone)).entries.flatMap((entry) => entry.sentence.filter((part) => typeof part !== "string"));
    expect(parts).toEqual(expect.arrayContaining([
      { text: "Semester 2 membership", href: `/dashboard/memberships/${ownPlan.id}` },
      { text: "a membership plan", href: null },
      { text: "EngSoc hoodie", href: `/dashboard/merchandise/${product.id}` },
      { text: "Sam Staff", href: "/dashboard/settings/staff" },
      { text: `order ${orderReference(order.id)}`, href: `/dashboard/merchandise/orders/${order.id}` }
    ]));
    const sentences = (await readHistory(organisation.id, {}, zone)).entries.map((entry) => entry.sentence.map((part) => (typeof part === "string" ? part : part.text)).join(""));
    expect(sentences).toContain("sent the invitation again to new.helper@example.com");
    expect(sentences).toContain("removed Sam Staff from the staff");
    expect(JSON.stringify(sentences)).not.toContain("Rival plan");
  });
});

