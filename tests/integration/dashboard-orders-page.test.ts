import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { setMockSession } from "@/tests/helpers/auth";
import {
  createEvent,
  createMember,
  createOrder,
  createOrganisationAccount
} from "@/tests/helpers/test-data";
import OrganisationOrdersPage from "@/app/(dashboard)/dashboard/orders/page";

async function renderOrdersPage(
  searchParams: {
    status?: string;
    eventId?: string;
    includeSystem?: string;
    search?: string;
    startDate?: string;
    endDate?: string;
    limit?: string;
    cursor?: string;
    direction?: string;
  } = {}
) {
  const element = await OrganisationOrdersPage({
    searchParams: Promise.resolve(searchParams)
  });

  return renderToStaticMarkup(element);
}

describe("dashboard orders page", () => {
  test("malformed cursor falls back to first page with warning", async () => {
    const { user, organisation } = await createOrganisationAccount();
    const member = await createMember();
    const event = await createEvent({ organisationId: organisation.id });
    const ticketType = event.ticketTypes[0];

    for (let index = 0; index < 27; index += 1) {
      await createOrder({
        organisationId: organisation.id,
        eventId: event.id,
        ticketTypeId: ticketType.id,
        userId: member.id,
        status: "paid",
        paidAt: new Date(),
        unitPrice: ticketType.price,
        createdAt: new Date(`2026-05-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`)
      });
    }

    setMockSession({ userId: user.id, email: user.email, accountRole: "organisation" });
    const html = await renderOrdersPage({
      cursor: "bad-cursor"
    });

    expect(html).toContain(
      "Invalid pagination parameters were ignored. Showing the first page."
    );
    expect(html).toContain("Order pagination");
    expect(html).toContain("direction=next");
    expect(html).not.toContain("bad-cursor");
  });

  test("failed filter shows compensation-required failed orders", async () => {
    const { user, organisation } = await createOrganisationAccount();
    const member = await createMember();
    const event = await createEvent({ organisationId: organisation.id });
    const ticketType = event.ticketTypes[0];
    await createOrder({
      organisationId: organisation.id,
      eventId: event.id,
      ticketTypeId: ticketType.id,
      userId: member.id,
      status: "failed",
      paidAt: new Date(),
      failedAt: new Date(),
      failureReason: "inventory_unavailable_after_payment",
      requiresCompensationReview: true,
      fulfilmentFailedAt: new Date(),
      fulfilmentFailureReason: "inventory_unavailable_after_payment",
      unitPrice: ticketType.price
    });

    setMockSession({ userId: user.id, email: user.email, accountRole: "organisation" });
    const html = await renderOrdersPage({
      status: "failed"
    });

    expect(html).toContain("Payment received; fulfilment review required");
  });
});
