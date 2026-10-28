import { describe, expect, test, vi } from "vitest";
import AnalyticsPage from "@/app/(dashboard)/dashboard/analytics/page";
import { prisma } from "@/lib/db";
import { selectMockContext, setMockSession } from "@/tests/helpers/auth";
import { renderPage } from "@/tests/helpers/render";
import { createEvent, createMember, createOrder, createOrganisationAccount, createOrganisationStaff } from "@/tests/helpers/test-data";

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  usePathname: () => "/dashboard/analytics",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() })
}));

const page = (params: Record<string, string> = {}) => AnalyticsPage({ searchParams: Promise.resolve(params) }).then(renderPage);

// A society with one paid order of two tickets today, and a staff member of the given role.
async function society() {
  const account = await createOrganisationAccount();
  const event = await createEvent({ organisationId: account.organisation.id, status: "published", title: "Engineering Mixer", ticketTypes: [{ name: "General", price: 1500, quantity: 50 }] });
  const order = await createOrder({ organisationId: account.organisation.id, eventId: event.id, ticketTypeId: event.ticketTypes[0].id, status: "paid", quantity: 2, unitPrice: 1500, paidAt: new Date() });
  for (const issueSequence of [1, 2]) {
    await prisma.ticket.create({ data: { orderId: order.id, eventId: event.id, ticketTypeId: event.ticketTypes[0].id, organisationId: account.organisation.id, issueSequence } });
  }
  const staff = async (role: "event_manager" | "check_in_staff") => {
    const member = await createMember();
    await createOrganisationStaff({ organisationId: account.organisation.id, userId: member.id, role });
    setMockSession({ userId: member.id, email: member.email, accountRole: "member" });
    selectMockContext({ mode: "staff", organisationId: account.organisation.id });
  };
  setMockSession({ userId: account.user.id, email: account.user.email, accountRole: "organisation" });
  return { ...account, event, staff };
}

describe("analytics page", () => {
  test("an owner sees money on every tab, with the chart's numbers in a table", async () => {
    vi.stubEnv("MFA_ENFORCEMENT_MODE", "off");
    await society();
    const tickets = await page();
    for (const text of ["Gross sales", "$30.00", "Net sales", "Tickets and attendance", "Sales by day, in numbers", "How these numbers are counted"]) expect(tickets).toContain(text);
    for (const tab of ["?tab=memberships", "?tab=merchandise", "?tab=engagement"]) expect(tickets).toContain(`/dashboard/analytics${tab}`);
    expect(await page({ tab: "memberships" })).toContain("Members now");
    expect(await page({ tab: "merchandise" })).toContain("Pickups and stock, now");
    expect(await page({ tab: "engagement" })).toContain("Who took part");
  });

  test("an event manager gets tickets and attendance without money or the commerce tabs", async () => {
    vi.stubEnv("MFA_ENFORCEMENT_MODE", "off");
    const { staff } = await society();
    await staff("event_manager");
    const html = await page({ tab: "memberships" });
    expect(html).toContain("Tickets issued");
    expect(html).toContain("Attendance rate");
    for (const hidden of ["Gross sales", "Net sales", "$30.00", "tab=memberships", "tab=merchandise"]) expect(html).not.toContain(hidden);
    expect(html).toContain("tab=engagement");
  });

  // UI-019: by day past 62 days would be hundreds of rows, so it reads by week.
  test("by day over a long range is shown by week, and says so", async () => {
    await society();
    const today = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - 89 * 86400000).toISOString().slice(0, 10);
    const long = await page({ from, to: today, bucket: "day" });
    expect(long).toContain("Shown by week");
    expect(long).toContain("by week");
    expect(long).not.toContain("Sales by day, in numbers");
    expect(await page()).not.toContain("Shown by week");
  });

  test("a range over 366 days says so and falls back; another society's event is ignored; check-in staff are refused", async () => {
    vi.stubEnv("MFA_ENFORCEMENT_MODE", "off");
    const { staff } = await society();
    const other = await createOrganisationAccount();
    const foreign = await createEvent({ organisationId: other.organisation.id, status: "published", title: "Another society's gala" });
    const html = await page({ from: "2020-01-01", to: "2026-01-01", eventId: foreign.id });
    expect(html).toContain("Pick a shorter range");
    expect(html).toContain("Showing the last 30 days instead");
    expect(html).not.toContain("Another society");
    expect(html).toContain("$30.00");

    await staff("check_in_staff");
    await expect(page()).rejects.toThrow();
  });
});
