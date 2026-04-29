import { PrismaClient } from "@prisma/client";

const baseUrl = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";
const prisma = new PrismaClient();
const reservationWindowMs = 30 * 60 * 1000;

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
        organiserViewText.includes("Ticket analytics") &&
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

    await runStep("9. Verify member dashboard and public event access", async () => {
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

      const publicEvents = await memberClient.json("/api/public/events");
      assertStatus(publicEvents.response, 200, "public events", publicEvents.body);
      assert(Array.isArray(publicEvents.body?.events), "public events was not an array");
      assert(publicEvents.body.events.length > 0, "public events list was empty");
      return publicEvents.body.events;
    });

    await runStep("10. Verify member cannot access organiser event view", async () => {
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

    await runStep("11. Verify member cannot access management events API", async () => {
      const result = await memberClient.json(
        `/api/events?orgId=${encodeURIComponent(engineeringOrganisation.id)}`
      );
      assert(
        [401, 403].includes(result.response.status),
        `member management API access should fail, got ${result.response.status}`,
        JSON.stringify(result.body, null, 2)
      );
    });

    await runStep("12. Verify member cannot access orders API", async () => {
      const result = await memberClient.json("/api/orders");
      assert(
        [401, 403].includes(result.response.status),
        `member orders API access should fail, got ${result.response.status}`,
        JSON.stringify(result.body, null, 2)
      );
    });

    await runStep("13. Verify organisation account cannot checkout", async () => {
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

    await runStep("14. Verify checkout fails before Stripe readiness", async () => {
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

    await runStep("15. Verify active reservation reduces availability", async () => {
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

    await runStep("16. Verify expired reservation settles order and is grouped", async () => {
      assert(createdSmokeOrderIds.length > 0, "reservation smoke order missing");
      const orderId = createdSmokeOrderIds[createdSmokeOrderIds.length - 1];
      const past = new Date(Date.now() - 60 * 1000);

      await prisma.ticketReservation.update({
        where: { orderId },
        data: { expiresAt: past }
      });

      const grouped = await organisationClient.json("/api/orders?status=expired");
      assertStatus(grouped.response, 200, "grouped expired orders", grouped.body);
      assert(Array.isArray(grouped.body), "grouped orders response was not an array");

      const eventGroup = grouped.body.find((group) => group.eventId === createdEventId);
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
  } finally {
    if (createdSmokeOrderIds.length > 0) {
      await prisma.order.deleteMany({
        where: { id: { in: createdSmokeOrderIds } }
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
