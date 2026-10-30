import { createElement } from "react";
import { describe, expect, test, vi } from "vitest";
import DashboardPage from "@/app/(dashboard)/dashboard/page";
import OrganisationOrderDetailPage from "@/app/(dashboard)/dashboard/orders/[orderId]/page";
import PurchasesPage from "@/app/purchases/page";
import { MemberOrganisationsList } from "@/components/organisations/member-organisations-list";
import { PayoutFailedNotice, PayoutsCard } from "@/components/settings/payouts-card";
import { StaffManagement } from "@/components/settings/staff-management";
import { prisma } from "@/lib/db";
import { setMockSession } from "@/tests/helpers/auth";
import { renderPage } from "@/tests/helpers/render";
import { createEvent, createMember, createOrder, createOrganisationAccount } from "@/tests/helpers/test-data";

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  usePathname: () => "/dashboard",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() })
}));

// 2 Mar in Brisbane, the default zone, and still 1 Mar in Perth: a date that
// forgets its society's zone reads a day late.
const instant = new Date("2026-03-01T15:00:00Z");
const timeZone = "Australia/Perth";
const perthDays = (html: string) => html.match(/1 Mar 2026/g)?.length ?? 0;
const brisbaneDays = (html: string) => html.match(/2 Mar 2026/g)?.length ?? 0;

async function perthSociety() {
  const account = await createOrganisationAccount();
  await prisma.organisation.update({ where: { id: account.organisation.id }, data: { timeZone } });
  const event = await createEvent({ organisationId: account.organisation.id, status: "published" });
  return { ...account, event };
}

describe("society dates use the society's zone, not Brisbane", () => {
  test("Payments dates each payout in the society's zone", async () => {
    const when = instant.toISOString();
    const card = await renderPage(createElement(PayoutsCard, {
      payouts: {
        held: { events: { amount: 1000, eventCount: 1, nextEndsAt: when }, commerce: { amount: 0 }, total: 1000 },
        onTheWay: { amount: 500, sentAt: when },
        recent: [{ id: "po_1", amount: 500, status: "paid", createdAt: when }],
        failed: null
      },
      payoutsEnabled: true,
      seeAll: null,
      timeZone
    }));
    expect([perthDays(card), brisbaneDays(card)]).toEqual([3, 0]);
    const notice = await renderPage(createElement(PayoutFailedNotice, { action: null, failed: { amount: 500, createdAt: when }, timeZone }));
    expect([perthDays(notice), brisbaneDays(notice)]).toEqual([1, 0]);
  });

  test("the staff screen dates invitations and revocations in the society's zone", async () => {
    const html = await renderPage(createElement(StaffManagement, {
      canManageOwners: true,
      initialInvites: [{ id: "invite-1", email: "pending@example.com", role: "event_manager", expiresAt: instant }],
      initialStaff: [{ id: "staff-1", role: "event_manager", status: "revoked", revokedAt: instant, user: { email: "past@example.com", firstName: null, lastName: null } }],
      orgSlug: "perth-society",
      pastInvites: [{ id: "invite-2", email: "old@example.com", role: "event_manager", createdAt: instant, state: "expired" }],
      timeZone
    }));
    expect([perthDays(html), brisbaneDays(html)]).toEqual([3, 0]);
  });

  test("a joined society's date is in that society's zone", async () => {
    const html = await renderPage(createElement(MemberOrganisationsList, { organisations: [{ id: "society-1", name: "Perth Society", slug: "perth-society", joinedAt: instant, timeZone }] }));
    expect([perthDays(html), brisbaneDays(html)]).toEqual([1, 0]);
  });

  test("a buyer's purchase lists show the date its order page shows", async () => {
    const { organisation, event } = await perthSociety();
    const buyer = await createMember();
    await createOrder({ organisationId: organisation.id, eventId: event.id, ticketTypeId: event.ticketTypes[0].id, userId: buyer.id, status: "paid", paidAt: instant, createdAt: instant });
    setMockSession({ userId: buyer.id, email: buyer.email, accountRole: "member" });
    for (const html of [await renderPage(await PurchasesPage({ searchParams: Promise.resolve({}) })), await renderPage(await DashboardPage())]) {
      expect(perthDays(html)).toBeGreaterThan(0);
      expect(brisbaneDays(html)).toBe(0);
    }
  });

  test("a staff order's history is timed in the society's zone", async () => {
    const { organisation, user, event } = await perthSociety();
    const order = await createOrder({ organisationId: organisation.id, eventId: event.id, ticketTypeId: event.ticketTypes[0].id, status: "paid", paidAt: instant, createdAt: instant });
    await prisma.orderLifecycleEvent.create({ data: { orderId: order.id, sequence: 1, type: "legacy_baseline", source: "legacy", createdAt: instant } });
    setMockSession({ userId: user.id, email: user.email, accountRole: "organisation" });
    const html = await renderPage(await OrganisationOrderDetailPage({ params: Promise.resolve({ orderId: order.id }), searchParams: Promise.resolve({}) }));
    expect(perthDays(html)).toBeGreaterThan(0);
    expect(brisbaneDays(html)).toBe(0);
  });
});
