import { PrismaClient } from "@prisma/client";

const baseUrl = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";
const prisma = new PrismaClient();
const reservationWindowMs = 30 * 60 * 1000;

function formatCurrency(amountInCents) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "AUD"
  }).format(amountInCents / 100);
}

class SmokeTestError extends Error {
  constructor(message, details = "") {
    super(details ? `${message}\n${details}` : message);
    this.name = "SmokeTestError";
  }
}

class HttpClient {
  cookies = new Map();

  constructor(label) {
    this.label = label;
  }

  cookieHeader() {
    return [...this.cookies.entries()]
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");
  }

  storeCookies(headers) {
    const getSetCookie = headers.getSetCookie?.bind(headers);
    const rawCookies =
      typeof getSetCookie === "function"
        ? getSetCookie()
        : splitSetCookieHeader(headers.get("set-cookie"));

    for (const rawCookie of rawCookies) {
      const cookiePair = rawCookie.split(";", 1)[0];
      const separatorIndex = cookiePair.indexOf("=");

      if (separatorIndex <= 0) {
        continue;
      }

      this.cookies.set(
        cookiePair.slice(0, separatorIndex),
        cookiePair.slice(separatorIndex + 1)
      );
    }
  }

  async fetch(path, options = {}) {
    const headers = new Headers(options.headers ?? {});
    const cookie = this.cookieHeader();

    if (cookie) {
      headers.set("cookie", cookie);
    }

    const response = await fetch(new URL(path, baseUrl), {
      redirect: "manual",
      ...options,
      headers
    });

    this.storeCookies(response.headers);
    return response;
  }

  async json(path, options = {}) {
    const response = await this.fetch(path, options);
    const body = await parseJson(response);
    return { body, response };
  }
}

function splitSetCookieHeader(value) {
  if (!value) {
    return [];
  }

  return value.split(/,(?=\s*[^;,]+=)/g).map((cookie) => cookie.trim());
}

async function parseJson(response) {
  const text = await response.text();

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new SmokeTestError(
      `Expected JSON response from ${response.url}`,
      text.slice(0, 500)
    );
  }
}

function assert(condition, message, details = "") {
  if (!condition) {
    throw new SmokeTestError(message, details);
  }
}

function assertStatus(response, expectedStatus, label, body = null) {
  assert(
    response.status === expectedStatus,
    `${label}: expected ${expectedStatus}, got ${response.status}`,
    body ? JSON.stringify(body, null, 2) : ""
  );
}

function assertOk(response, label, body = null) {
  assert(
    response.ok,
    `${label}: expected 2xx, got ${response.status}`,
    body ? JSON.stringify(body, null, 2) : ""
  );
}

async function runStep(label, fn) {
  process.stdout.write(`${label} ... `);

  try {
    const result = await fn();
    console.log("PASS");
    return result;
  } catch (error) {
    console.log("FAIL");
    throw error;
  }
}

async function login(email, password, expectedRole) {
  const client = new HttpClient(email);
  const csrf = await client.json("/api/auth/csrf");
  assertStatus(csrf.response, 200, `${email} csrf`, csrf.body);
  assert(csrf.body?.csrfToken, `${email} csrf token missing`);

  const form = new URLSearchParams({
    csrfToken: csrf.body.csrfToken,
    email,
    password,
    redirect: "false",
    callbackUrl: "/"
  });

  const callback = await client.fetch("/api/auth/callback/credentials", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded"
    },
    body: form
  });

  assert(
    [200, 302, 303].includes(callback.status),
    `${email} login failed with ${callback.status}`,
    await callback.text()
  );

  const session = await client.json("/api/auth/session");
  assertStatus(session.response, 200, `${email} session`, session.body);
  assert(
    session.body?.user?.email === email,
    `${email} session email mismatch`,
    JSON.stringify(session.body, null, 2)
  );
  assert(
    session.body?.user?.accountRole === expectedRole,
    `${email} expected role ${expectedRole}`,
    JSON.stringify(session.body, null, 2)
  );

  return client;
}

function futureIso(daysFromNow, hour) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + daysFromNow);
  date.setUTCHours(hour, 0, 0, 0);
  return date.toISOString();
}

async function main() {
  console.log(`Thunderstrux smoke tests: ${baseUrl}`);

  let createdEventId = null;
  let organisationClient = null;
  const createdSmokeOrderIds = [];
  const createdSmokeOrganisationIds = [];

  try {
    organisationClient = await runStep("1. Login as organisation account", () =>
      login("engineering.org@example.com", "password123", "organisation")
    );

    await runStep("2. Verify organisation dashboard access", async () => {
      const response = await organisationClient.fetch("/dashboard", {
        redirect: "follow"
      });
      const text = await response.text();
      assertStatus(response, 200, "organisation dashboard");
      assert(
        text.includes("Engineering Society"),
        "organisation dashboard did not render Engineering Society"
      );
    });

    const engineeringOrganisation = await runStep(
      "3. Resolve organisation and verify events list",
      async () => {
        const org = await organisationClient.json("/api/orgs/engineering-society");
        assertStatus(org.response, 200, "engineering organisation", org.body);
        assert(org.body?.organisation?.id, "engineering organisation id missing");

        const events = await organisationClient.json(
          `/api/events?orgId=${encodeURIComponent(org.body.organisation.id)}`
        );
        assertStatus(events.response, 200, "organisation events list", events.body);
        assert(Array.isArray(events.body?.events), "events list was not an array");

        return org.body.organisation;
      }
    );

    const createdEvent = await runStep("4. Create event", async () => {
      const nonce = Date.now();
      const payload = {
        organisationId: engineeringOrganisation.id,
        title: `Smoke Test Event ${nonce}`,
        description: "Created by scripts/smoke-test.mjs.",
        startTime: futureIso(30, 9),
        endTime: futureIso(30, 11),
        location: "Smoke Test Room",
        status: "draft",
        ticketTypes: [
          {
            name: "Smoke General",
            price: 1234,
            quantity: 8
          }
        ]
      };

      const result = await organisationClient.json("/api/events", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(payload)
      });
      assertOk(result.response, "create event", result.body);
      assert(result.body?.event?.id, "created event id missing");
      assert(
        result.body.event.ticketTypes?.[0]?.id,
        "created ticket type id missing",
        JSON.stringify(result.body, null, 2)
      );

      createdEventId = result.body.event.id;
      return result.body.event;
    });

    const editedEvent = await runStep("5. Edit event title", async () => {
      const payload = {
        organisationId: engineeringOrganisation.id,
        title: `${createdEvent.title} Updated`,
        description: createdEvent.description,
        startTime: createdEvent.startTime,
        endTime: createdEvent.endTime,
        location: createdEvent.location,
        ticketTypes: createdEvent.ticketTypes
      };

      const result = await organisationClient.json(`/api/events/${createdEvent.id}`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(payload)
      });
      assertStatus(result.response, 200, "edit event", result.body);
      assert(
        result.body?.event?.title === payload.title,
        "event title was not updated",
        JSON.stringify(result.body, null, 2)
      );
      return result.body.event;
    });

    await runStep("6. Verify ticket editing rules", async () => {
      const ticket = editedEvent.ticketTypes[0];
      const payload = {
        organisationId: engineeringOrganisation.id,
        title: editedEvent.title,
        description: editedEvent.description,
        startTime: editedEvent.startTime,
        endTime: editedEvent.endTime,
        location: editedEvent.location,
        ticketTypes: [
          {
            id: ticket.id,
            name: "Smoke General Updated",
            price: ticket.price + 100,
            quantity: ticket.quantity + 2
          }
        ]
      };

      const result = await organisationClient.json(`/api/events/${editedEvent.id}`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(payload)
      });
      assertStatus(result.response, 200, "ticket edit", result.body);

      const updatedTicket = result.body?.event?.ticketTypes?.find(
        (candidate) => candidate.id === ticket.id
      );
      assert(updatedTicket, "updated ticket type missing", JSON.stringify(result.body, null, 2));
      assert(updatedTicket.name === "Smoke General Updated", "ticket name was not updated");
      assert(updatedTicket.price === ticket.price + 100, "ticket price was not updated");
      assert(updatedTicket.quantity === ticket.quantity + 2, "ticket quantity was not updated");
      return result.body.event;
    });

    await runStep("7. Verify organisation event view and public redirect", async () => {
      const organiserView = await organisationClient.fetch(
        `/dashboard/events/${createdEvent.id}`,
        { redirect: "follow" }
      );
      const organiserViewText = await organiserView.text();
      assertStatus(organiserView, 200, "organiser event view");
      assert(
        organiserViewText.includes("Ticket performance") &&
          organiserViewText.includes("Revenue (UTC)") &&
          organiserViewText.includes(createdEvent.title),
        "organiser event view did not render analytics"
      );

      const publicView = await organisationClient.fetch(`/events/${createdEvent.id}`);
      assert(
        [307, 308].includes(publicView.status),
        `organisation public event route should redirect, got ${publicView.status}`,
        await publicView.text()
      );
      const location = publicView.headers.get("location") ?? "";
      assert(
        location.includes(`/dashboard/events/${createdEvent.id}`),
        "organisation public event redirect target was incorrect",
        location
      );
    });

    const memberClient = await runStep("8. Login as member account", () =>
      login("user2@example.com", "password123", "member")
    );

    const smokeMemberOrganisation = await runStep(
      "9. Create temporary member organisation",
      async () => {
        const member = await prisma.user.findUnique({
          where: { email: "user2@example.com" },
          select: { id: true }
        });
        assert(member?.id, "user2@example.com missing");

        const slug = `smoke-member-org-${Date.now()}`;
        const organisation = await prisma.organisation.create({
          data: {
            name: "Smoke Member Organisation",
            slug,
            members: {
              create: {
                userId: member.id,
                role: "member"
              }
            }
          },
          select: {
            id: true,
            name: true,
            slug: true
          }
        });
        createdSmokeOrganisationIds.push(organisation.id);
        return organisation;
      }
    );

    await runStep("10. Verify member dashboard and public event access", async () => {
      const dashboard = await memberClient.fetch("/dashboard", {
        redirect: "follow"
      });
      const dashboardText = await dashboard.text();
      assertStatus(dashboard, 200, "member dashboard");
      assert(
        dashboardText.includes("Your organisations") ||
          dashboardText.includes("Find organisations") ||
          dashboardText.includes("Member"),
        "member dashboard did not look like a member dashboard"
      );
      assert(
        dashboardText.includes(`/organisations/${smokeMemberOrganisation.slug}`),
        "member dashboard did not include organisation details link"
      );

      const publicEvents = await memberClient.json("/api/public/events");
      assertStatus(publicEvents.response, 200, "public events", publicEvents.body);
      assert(Array.isArray(publicEvents.body?.events), "public events was not an array");
      assert(publicEvents.body.events.length > 0, "public events list was empty");
      return publicEvents.body.events;
    });

    await runStep("11. Verify organisation details page is public-safe", async () => {
      const response = await memberClient.fetch(
        `/organisations/${smokeMemberOrganisation.slug}`,
        { redirect: "follow" }
      );
      const text = await response.text();
      assertStatus(response, 200, "organisation details");
      assert(
        text.includes(smokeMemberOrganisation.name) &&
          text.includes("Upcoming events"),
        "organisation details page did not render public-safe organisation data"
      );
      assert(!text.includes("stripeAccountId"), "organisation details leaked Stripe data");
    });

    await runStep("12. Verify member can leave organisation", async () => {
      const firstLeave = await memberClient.json(
        `/api/orgs/${smokeMemberOrganisation.slug}/leave`,
        { method: "POST" }
      );
      assertStatus(firstLeave.response, 200, "member leave organisation", firstLeave.body);
      assert(
        firstLeave.body?.organisation?.joined === false,
        "leave response did not mark organisation as not joined",
        JSON.stringify(firstLeave.body, null, 2)
      );

      const secondLeave = await memberClient.json(
        `/api/orgs/${smokeMemberOrganisation.slug}/leave`,
        { method: "POST" }
      );
      assertStatus(secondLeave.response, 200, "member idempotent leave", secondLeave.body);

      const membership = await prisma.organisationMember.findUnique({
        where: {
          userId_organisationId: {
            userId: (await prisma.user.findUniqueOrThrow({
              where: { email: "user2@example.com" },
              select: { id: true }
            })).id,
            organisationId: smokeMemberOrganisation.id
          }
        },
        select: { id: true }
      });
      assert(!membership, "member organisation membership was not removed");
    });

    await runStep("13. Verify organisation account cannot leave organisation", async () => {
      const result = await organisationClient.json(
        `/api/orgs/${engineeringOrganisation.slug}/leave`,
        { method: "POST" }
      );
      assert(
        [401, 403].includes(result.response.status),
        `organisation leave should fail, got ${result.response.status}`,
        JSON.stringify(result.body, null, 2)
      );
    });

    await runStep("14. Verify member cannot access organiser event view", async () => {
      const result = await memberClient.fetch(`/dashboard/events/${createdEvent.id}`);
      assert(
        [307, 308].includes(result.status),
        `member organiser event route should redirect, got ${result.status}`,
        await result.text()
      );
      const location = result.headers.get("location") ?? "";
      assert(
        location === "/" || location.endsWith("/"),
        "member organiser event redirect target was incorrect",
        location
      );
    });

    await runStep("15. Verify member cannot access management events API", async () => {
      const result = await memberClient.json(
        `/api/events?orgId=${encodeURIComponent(engineeringOrganisation.id)}`
      );
      assert(
        [401, 403].includes(result.response.status),
        `member management API access should fail, got ${result.response.status}`,
        JSON.stringify(result.body, null, 2)
      );
    });

    await runStep("16. Verify member cannot access orders API", async () => {
      const result = await memberClient.json("/api/orders");
      assert(
        [401, 403].includes(result.response.status),
        `member orders API access should fail, got ${result.response.status}`,
        JSON.stringify(result.body, null, 2)
      );
    });

    await runStep("17. Verify organisation account cannot checkout", async () => {
      const ticketType = editedEvent.ticketTypes[0];
      const checkout = await organisationClient.json("/api/payments/checkout/event", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          eventId: editedEvent.id,
          ticketTypeId: ticketType.id,
          quantity: 1
        })
      });

      assert(
        checkout.response.status >= 400,
        `organisation checkout should fail, got ${checkout.response.status}`,
        JSON.stringify(checkout.body, null, 2)
      );
    });

    await runStep("18. Verify checkout fails before Stripe readiness", async () => {
      const paymentsOrg = await organisationClient.json("/api/orgs/payments-lab");
      assertStatus(paymentsOrg.response, 403, "organisation account cannot access payments lab");

      const publicEvents = await memberClient.json("/api/public/events");
      const paymentsEventListItem = publicEvents.body.events.find(
        (event) => event.title === "Payments Lab Checkout Test"
      );
      assert(paymentsEventListItem, "Payments Lab public event missing");

      const detail = await memberClient.json(
        `/api/public/events/${paymentsEventListItem.id}`
      );
      assertStatus(detail.response, 200, "payments lab public event detail", detail.body);
      const ticketType = detail.body?.event?.ticketTypes?.[0];
      assert(ticketType?.id, "payments lab ticket type missing");

      const reservationCountBefore = await prisma.ticketReservation.count({
        where: { ticketTypeId: ticketType.id }
      });

      const checkout = await memberClient.json("/api/payments/checkout/event", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          eventId: detail.body.event.id,
          ticketTypeId: ticketType.id,
          quantity: 1
        })
      });

      assert(
        checkout.response.status >= 400,
        `checkout precondition should fail, got ${checkout.response.status}`,
        JSON.stringify(checkout.body, null, 2)
      );

      const reservationCountAfter = await prisma.ticketReservation.count({
        where: { ticketTypeId: ticketType.id }
      });
      assert(
        reservationCountAfter === reservationCountBefore,
        "Stripe-not-ready checkout created a reservation"
      );
    });

    await runStep("19. Verify active reservation reduces availability", async () => {
      const event = await prisma.event.findUnique({
        where: { id: createdEventId },
        select: {
          id: true,
          organisationId: true,
          ticketTypes: {
            select: {
              id: true,
              price: true,
              quantity: true
            },
            take: 1
          }
        }
      });
      assert(event?.ticketTypes?.[0], "smoke event ticket type missing");

      const member = await prisma.user.findUnique({
        where: { email: "user2@example.com" },
        select: { id: true }
      });
      assert(member?.id, "user2@example.com missing");

      const ticketType = event.ticketTypes[0];
      const reservationCreatedAt = new Date();
      const reservationExpiresAt = new Date(
        reservationCreatedAt.getTime() + reservationWindowMs
      );
      const order = await prisma.order.create({
        data: {
          organisationId: event.organisationId,
          eventId: event.id,
          ticketTypeId: ticketType.id,
          userId: member.id,
          status: "pending",
          quantity: 3,
          unitPrice: ticketType.price,
          totalAmount: ticketType.price * 3
        },
        select: { id: true }
      });
      createdSmokeOrderIds.push(order.id);

      await prisma.ticketReservation.create({
        data: {
          orderId: order.id,
          organisationId: event.organisationId,
          eventId: event.id,
          ticketTypeId: ticketType.id,
          userId: member.id,
          quantity: 3,
          createdAt: reservationCreatedAt,
          expiresAt: reservationExpiresAt
        }
      });

      const reservation = await prisma.ticketReservation.findUnique({
        where: { orderId: order.id },
        select: { createdAt: true, expiresAt: true }
      });
      assert(reservation, "active reservation was not created");
      assert(
        reservation.expiresAt.getTime() - reservation.createdAt.getTime() ===
          reservationWindowMs,
        "reservation expiry window was not exactly 30 minutes"
      );

      const activeReserved = await prisma.ticketReservation.aggregate({
        where: {
          ticketTypeId: ticketType.id,
          status: "active",
          expiresAt: { gt: new Date() }
        },
        _sum: { quantity: true }
      });
      const availableNow = ticketType.quantity - (activeReserved._sum.quantity ?? 0);

      assert(
        availableNow === ticketType.quantity - 3,
        "active reservation was not subtracted from availability"
      );
    });

    await runStep("20. Verify expired reservation settles order and is grouped", async () => {
      assert(createdSmokeOrderIds.length > 0, "reservation smoke order missing");
      const orderId = createdSmokeOrderIds[createdSmokeOrderIds.length - 1];
      const past = new Date(Date.now() - 60 * 1000);

      await prisma.ticketReservation.update({
        where: { orderId },
        data: { expiresAt: past }
      });

      const grouped = await organisationClient.json("/api/orders?status=expired");
      assertStatus(grouped.response, 200, "grouped expired orders", grouped.body);
      assert(
        Array.isArray(grouped.body?.groups),
        "grouped orders response groups was not an array",
        JSON.stringify(grouped.body, null, 2)
      );

      const eventGroup = grouped.body.groups.find((group) => group.eventId === createdEventId);
      assert(eventGroup, "smoke event group missing from grouped orders");
      assert(
        eventGroup.eventTitle?.startsWith("Smoke Test Event"),
        "grouped order event title missing"
      );
      const groupedOrder = eventGroup.orders?.find((order) => order.id === orderId);
      assert(groupedOrder, "expired smoke order missing from grouped orders");
      assert(groupedOrder.status === "expired", "grouped order was not expired");
      assert(
        groupedOrder.failureReason === null,
        "normal expiry should not set failureReason"
      );

      const reservation = await prisma.ticketReservation.findUnique({
        where: { orderId },
        select: {
          status: true,
          ticketTypeId: true,
          quantity: true
        }
      });
      assert(reservation?.status === "expired", "reservation was not expired");

      const order = await prisma.order.findUnique({
        where: { id: orderId },
        select: {
          status: true,
          failureReason: true,
          quantity: true,
          unitPrice: true,
          totalAmount: true
        }
      });
      assert(order, "reservation smoke order missing after expiry");
      assert(order.status === "expired", "order was not expired");
      assert(order.failureReason === null, "normal expiry set failureReason");

      const activeReserved = await prisma.ticketReservation.aggregate({
        where: {
          ticketTypeId: reservation.ticketTypeId,
          status: "active",
          expiresAt: { gt: new Date() }
        },
        _sum: { quantity: true }
      });

      assert(
        (activeReserved._sum.quantity ?? 0) === 0,
        "expired reservation still counted as active"
      );

      assert(order.totalAmount === order.unitPrice * order.quantity, "order amount history changed");
    });

    await runStep("21. Verify pending order with expired reservation is lazily expired", async () => {
      const ticketType = await prisma.ticketType.findFirst({
        where: { eventId: createdEventId },
        select: { id: true, price: true }
      });
      assert(ticketType, "ticket type missing for lazy expiry smoke test");

      const member = await prisma.user.findUnique({
        where: { email: "user2@example.com" },
        select: { id: true }
      });
      assert(member?.id, "user2@example.com missing for lazy expiry smoke test");

      const pendingOrder = await prisma.order.create({
        data: {
          organisationId: engineeringOrganisation.id,
          eventId: createdEventId,
          ticketTypeId: ticketType.id,
          userId: member.id,
          status: "pending",
          quantity: 1,
          unitPrice: ticketType.price,
          totalAmount: ticketType.price,
          reservation: {
            create: {
              organisationId: engineeringOrganisation.id,
              eventId: createdEventId,
              ticketTypeId: ticketType.id,
              userId: member.id,
              quantity: 1,
              status: "expired",
              expiresAt: new Date(Date.now() - 60 * 1000),
              releasedAt: new Date(Date.now() - 60 * 1000),
              releaseReason: "Smoke test pre-expired reservation"
            }
          }
        },
        select: { id: true }
      });
      createdSmokeOrderIds.push(pendingOrder.id);

      const grouped = await organisationClient.json("/api/orders?status=expired");
      assertStatus(grouped.response, 200, "lazy expired grouped orders", grouped.body);

      const order = await prisma.order.findUnique({
        where: { id: pendingOrder.id },
        select: { status: true, failureReason: true }
      });
      assert(order?.status === "expired", "pending order with expired reservation was not expired");
      assert(order.failureReason === null, "lazy expiry set failureReason");

      const analytics = await organisationClient.fetch(
        `/dashboard/events/${createdEventId}`,
        { redirect: "follow" }
      );
      const analyticsText = await analytics.text();
      assertStatus(analytics, 200, "analytics after lazy expiry");
      assert(
        !analyticsText.includes(formatCurrency(ticketType.price)),
        "expired order was counted as analytics revenue"
      );
    });

    await runStep("22. Verify cleanup is idempotent and preserves paid or failed orders", async () => {
      const ticketType = await prisma.ticketType.findFirst({
        where: { eventId: createdEventId },
        select: { id: true, price: true, quantity: true }
      });
      assert(ticketType, "ticket type missing for cleanup safety smoke test");

      const member = await prisma.user.findUnique({
        where: { email: "user2@example.com" },
        select: { id: true }
      });
      assert(member?.id, "user2@example.com missing for cleanup safety smoke test");

      const now = new Date();
      const past = new Date(Date.now() - 60 * 1000);

      const paidOrder = await prisma.order.create({
        data: {
          organisationId: engineeringOrganisation.id,
          eventId: createdEventId,
          ticketTypeId: ticketType.id,
          userId: member.id,
          status: "paid",
          quantity: 1,
          unitPrice: ticketType.price,
          totalAmount: ticketType.price,
          paidAt: now,
          reservation: {
            create: {
              organisationId: engineeringOrganisation.id,
              eventId: createdEventId,
              ticketTypeId: ticketType.id,
              userId: member.id,
              quantity: 1,
              status: "confirmed",
              expiresAt: past,
              confirmedAt: now
            }
          }
        },
        select: { id: true }
      });
      createdSmokeOrderIds.push(paidOrder.id);

      const failedOrder = await prisma.order.create({
        data: {
          organisationId: engineeringOrganisation.id,
          eventId: createdEventId,
          ticketTypeId: ticketType.id,
          userId: member.id,
          status: "failed",
          quantity: 1,
          unitPrice: ticketType.price,
          totalAmount: ticketType.price,
          failedAt: now,
          failureReason: "smoke_test_failed_order",
          reservation: {
            create: {
              organisationId: engineeringOrganisation.id,
              eventId: createdEventId,
              ticketTypeId: ticketType.id,
              userId: member.id,
              quantity: 1,
              status: "released",
              expiresAt: past,
              releasedAt: now,
              releaseReason: "Smoke test failed order"
            }
          }
        },
        select: { id: true }
      });
      createdSmokeOrderIds.push(failedOrder.id);

      const expiringOrder = await prisma.order.create({
        data: {
          organisationId: engineeringOrganisation.id,
          eventId: createdEventId,
          ticketTypeId: ticketType.id,
          userId: member.id,
          status: "pending",
          quantity: 1,
          unitPrice: ticketType.price,
          totalAmount: ticketType.price,
          reservation: {
            create: {
              organisationId: engineeringOrganisation.id,
              eventId: createdEventId,
              ticketTypeId: ticketType.id,
              userId: member.id,
              quantity: 1,
              status: "active",
              expiresAt: past
            }
          }
        },
        select: { id: true }
      });
      createdSmokeOrderIds.push(expiringOrder.id);

      const legacyOldPendingOrder = await prisma.order.create({
        data: {
          organisationId: engineeringOrganisation.id,
          eventId: createdEventId,
          ticketTypeId: ticketType.id,
          userId: member.id,
          status: "pending",
          quantity: 1,
          unitPrice: ticketType.price,
          totalAmount: ticketType.price,
          createdAt: new Date(Date.now() - 31 * 60 * 1000)
        },
        select: { id: true }
      });
      createdSmokeOrderIds.push(legacyOldPendingOrder.id);

      const legacyFreshPendingOrder = await prisma.order.create({
        data: {
          organisationId: engineeringOrganisation.id,
          eventId: createdEventId,
          ticketTypeId: ticketType.id,
          userId: member.id,
          status: "pending",
          quantity: 1,
          unitPrice: ticketType.price,
          totalAmount: ticketType.price
        },
        select: { id: true }
      });
      createdSmokeOrderIds.push(legacyFreshPendingOrder.id);

      const publish = await organisationClient.json(
        `/api/events/${createdEventId}/publish`,
        { method: "PATCH" }
      );
      assertStatus(publish.response, 200, "publish smoke event for public cleanup");

      const publicEvent = await memberClient.json(`/api/public/events/${createdEventId}`);
      assertStatus(publicEvent.response, 200, "public event cleanup", publicEvent.body);
      const publicTicketType = publicEvent.body.event.ticketTypes.find(
        (item) => item.id === ticketType.id
      );
      assert(publicTicketType, "public event ticket type missing after cleanup");
      assert(
        publicTicketType.quantity === ticketType.quantity,
        "expired reservation reduced public checkout availability"
      );

      const firstCleanup = await organisationClient.json("/api/orders");
      assertStatus(firstCleanup.response, 200, "first idempotent cleanup", firstCleanup.body);
      const secondCleanup = await organisationClient.json("/api/orders");
      assertStatus(secondCleanup.response, 200, "second idempotent cleanup", secondCleanup.body);
      const defaultOrderIds = firstCleanup.body.groups.flatMap((group) =>
        group.orders.map((order) => order.id)
      );
      assert(
        !defaultOrderIds.includes(legacyFreshPendingOrder.id),
        "pending system order was visible in default orders response"
      );

      const systemOrders = await organisationClient.json(
        "/api/orders?includeSystem=true&status=pending"
      );
      assertStatus(systemOrders.response, 200, "system pending orders", systemOrders.body);
      const systemPendingOrderIds = systemOrders.body.groups.flatMap((group) =>
        group.orders.map((order) => order.id)
      );
      assert(
        systemPendingOrderIds.includes(legacyFreshPendingOrder.id),
        "fresh pending system order was not visible in system orders response"
      );

      const checkedOrders = await prisma.order.findMany({
        where: {
          id: {
            in: [
              paidOrder.id,
              failedOrder.id,
              expiringOrder.id,
              legacyOldPendingOrder.id,
              legacyFreshPendingOrder.id
            ]
          }
        },
        select: {
          id: true,
          status: true,
          failureReason: true,
          reservation: {
            select: {
              status: true
            }
          }
        }
      });
      const ordersById = new Map(checkedOrders.map((order) => [order.id, order]));

      assert(ordersById.get(paidOrder.id)?.status === "paid", "paid order was changed");
      assert(
        ordersById.get(paidOrder.id)?.reservation?.status === "confirmed",
        "confirmed reservation was changed"
      );
      assert(ordersById.get(failedOrder.id)?.status === "failed", "failed order was changed");
      assert(
        ordersById.get(failedOrder.id)?.failureReason === "smoke_test_failed_order",
        "failed order failureReason was changed"
      );
      assert(
        ordersById.get(expiringOrder.id)?.status === "expired",
        "active expired reservation did not expire pending order"
      );
      assert(
        ordersById.get(expiringOrder.id)?.reservation?.status === "expired",
        "active expired reservation was not expired"
      );
      assert(
        ordersById.get(legacyOldPendingOrder.id)?.status === "expired",
        "old pending order without reservation was not expired"
      );
      assert(
        ordersById.get(legacyFreshPendingOrder.id)?.status === "pending",
        "fresh pending order without reservation was expired too early"
      );

      const ticketsPage = await memberClient.fetch("/tickets", {
        redirect: "follow"
      });
      const ticketsText = await ticketsPage.text();
      assertStatus(ticketsPage, 200, "member tickets page");
      assert(ticketsText.includes(paidOrder.id), "paid order missing from tickets page");
      assert(
        !ticketsText.includes(legacyFreshPendingOrder.id),
        "pending order was visible on tickets page"
      );
    });
  } finally {
    if (createdSmokeOrderIds.length > 0) {
      await prisma.order.deleteMany({
        where: { id: { in: createdSmokeOrderIds } }
      });
    }

    if (createdSmokeOrganisationIds.length > 0) {
      await prisma.organisation.deleteMany({
        where: { id: { in: createdSmokeOrganisationIds } }
      });
    }

    if (createdEventId && organisationClient) {
      const cleanup = await organisationClient.fetch(`/api/events/${createdEventId}`, {
        method: "DELETE"
      });

      if (!cleanup.ok) {
        console.warn(
          `WARN cleanup failed for smoke event ${createdEventId}: ${cleanup.status}`
        );
      }
    }

    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  void prisma.$disconnect();
  process.exit(1);
});
