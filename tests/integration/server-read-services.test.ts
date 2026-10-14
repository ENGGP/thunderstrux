import { renderPage } from "@/tests/helpers/render";
import { describe, expect, test, vi } from "vitest";
import PublicEventPage from "@/app/(public)/events/[eventId]/page";
import LegacyNewEventPage from "@/app/(dashboard)/dashboard/[orgSlug]/events/new/page";
import { GET as getAccount } from "@/app/api/me/account/route";
import { GET as getClosure } from "@/app/api/me/account/closure/route";
import { GET as getContext } from "@/app/api/me/context/route";
import { GET as getMfaStatus } from "@/app/api/me/mfa/status/route";
import { GET as getNotifications } from "@/app/api/notifications/route";
import { GET as getOrganisations } from "@/app/api/orgs/route";
import { GET as getOrganisation } from "@/app/api/orgs/[orgSlug]/route";
import { GET as getStaff } from "@/app/api/orgs/[orgSlug]/staff/route";
import { GET as getPublicEvent } from "@/app/api/public/events/[eventId]/route";
import { redirectLegacyOrganisationPage } from "@/lib/auth/page-access";
import { resolveAuthSecret } from "@/lib/auth/secret";
import { prisma } from "@/lib/db";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { getUpcomingTicketOrders } from "@/lib/orders/member-tickets";
import { getOrganisationOverview } from "@/lib/organisations/overview";
import { listPastStaffInvites } from "@/lib/staff/management";
import { selectMockContext, setMockSession } from "@/tests/helpers/auth";
import { parseJsonResponse, routeContext } from "@/tests/helpers/http";
import {
  createEvent,
  createMember,
  createOrder,
  createOrganisationAccount,
  createOrganisationStaff
} from "@/tests/helpers/test-data";

vi.mock("next-auth/react", () => ({
  useSession: () => ({ status: "unauthenticated" })
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  redirect: (path: string) => {
    throw new Error(`REDIRECT:${path}`);
  },
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() })
}));

describe("shared formatters", () => {
  test("money is AUD from integer cents", () => {
    expect(formatMoney(1250)).toBe("$12.50");
    expect(formatMoney(0)).toBe("$0.00");
  });

  test("dates use the given zone and never throw on missing values", () => {
    const instant = "2026-01-01T00:30:00.000Z";

    expect(formatDateTime(instant)).toContain("1 Jan 2026");
    expect(formatDateTime(instant)).toContain("10:30");
    expect(formatDateTime(instant, { timeZone: "Australia/Perth" })).toContain(
      "8:30"
    );
    expect(formatDateTime(new Date(instant), { dateStyle: "full" })).toContain(
      "Thursday"
    );
    expect(formatDateTime(null)).toBe("Not available");
    expect(formatDateTime("nonsense", { fallback: "Invalid date" })).toBe(
      "Invalid date"
    );
    expect(formatDate(instant)).toBe("1 Jan 2026");
  });
});

describe("auth secret resolution", () => {
  test("auth and proxy share one development fallback", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});

    for (const AUTH_SECRET of ["", "dev-secret", "replace-with-a-non-empty-secret"]) {
      expect(resolveAuthSecret({ NODE_ENV: "development", AUTH_SECRET })).toBe(
        "dev-only-auth-secret"
      );
    }
    expect(
      resolveAuthSecret({ NODE_ENV: "production", AUTH_SECRET: " real-secret " })
    ).toBe("real-secret");
  });

  test("production rejects placeholders except while building", () => {
    expect(() =>
      resolveAuthSecret({ NODE_ENV: "production", AUTH_SECRET: "dev-secret" })
    ).toThrow("AUTH_SECRET must be set");
    expect(
      resolveAuthSecret({
        NODE_ENV: "production",
        AUTH_SECRET: "",
        npm_lifecycle_event: "build"
      })
    ).toBe("dev-only-auth-secret");
  });
});

describe("legacy organisation links", () => {
  test("live staff continue after owner handover retired the bootstrap pointer", async () => {
    const { organisation } = await createOrganisationAccount();
    const member = await createMember();
    await createOrganisationStaff({
      organisationId: organisation.id,
      userId: member.id,
      role: "owner"
    });
    await prisma.organisation.update({
      where: { id: organisation.id },
      data: { accountUserId: null }
    });
    setMockSession({ userId: member.id, email: member.email, accountRole: "member" });
    selectMockContext({ mode: "staff", organisationId: organisation.id });

    await expect(
      LegacyNewEventPage({ params: Promise.resolve({ orgSlug: organisation.slug }) })
    ).rejects.toThrow("REDIRECT:/dashboard/events/new");
  });

  test("missing, foreign and unselected societies stay concealed", async () => {
    const { organisation } = await createOrganisationAccount();
    const staffMember = await createMember();
    await createOrganisationStaff({
      organisationId: organisation.id,
      userId: staffMember.id
    });
    const outsider = await createMember();
    const target = () =>
      redirectLegacyOrganisationPage(
        organisation.slug,
        ["events:manage"],
        `/dashboard/${organisation.slug}/events`,
        "/dashboard/events"
      );

    await expect(target()).rejects.toThrow("NOT_FOUND");
    setMockSession({ userId: outsider.id, email: outsider.email, accountRole: "member" });
    await expect(target()).rejects.toThrow("NOT_FOUND");
    await expect(
      redirectLegacyOrganisationPage("no-such-society", ["events:manage"], "/x", "/y")
    ).rejects.toThrow("NOT_FOUND");

    setMockSession({
      userId: staffMember.id,
      email: staffMember.email,
      accountRole: "member"
    });
    await expect(target()).rejects.toThrow(/^REDIRECT:\/dashboard$/);
    await expect(
      redirectLegacyOrganisationPage(organisation.slug, ["orders:read"], "/x", "/y")
    ).rejects.toThrow("NOT_FOUND");
  });
});

describe("public event page", () => {
  test("renders from the read service without calling its own API", async () => {
    const { organisation } = await createOrganisationAccount();
    const event = await createEvent({
      organisationId: organisation.id,
      title: "Service Rendered Event",
      status: "published"
    });
    const draft = await createEvent({ organisationId: organisation.id });

    // The integration setup makes every fetch throw, so a self-fetch would fail here.
    const html = await renderPage(
      await PublicEventPage({ params: Promise.resolve({ eventId: event.id }) })
    );

    expect(html).toContain("Service Rendered Event");
    expect(html).toContain(organisation.name);
    expect(html).toContain("Integration Room");
    await expect(
      PublicEventPage({ params: Promise.resolve({ eventId: draft.id }) })
    ).rejects.toThrow("NOT_FOUND");
  });
});

describe("error contract for routes on the shared mapper", () => {
  const request = (path: string) => new Request(`http://localhost${path}`);
  const slug = routeContext({ orgSlug: "contract-society" });
  const anonymous: Array<[string, () => Promise<Response>]> = [
    ["account", () => getAccount(request("/api/me/account"))],
    ["closure eligibility", () => getClosure(request("/api/me/account/closure"))],
    ["context", () => getContext(request("/api/me/context"))],
    ["mfa status", () => getMfaStatus(request("/api/me/mfa/status"))],
    ["notifications", () => getNotifications(request("/api/notifications"))],
    ["organisations", () => getOrganisations(request("/api/orgs"))],
    ["organisation", () => getOrganisation(request("/api/orgs/contract-society"), slug)],
    ["staff", () => getStaff(request("/api/orgs/contract-society/staff"), slug)]
  ];

  test.each(anonymous)("%s answers 401 in the standard envelope", async (_name, call) => {
    await createOrganisationAccount({ slug: "contract-society" });
    const response = await call();

    expect(response.status).toBe(401);
    await expect(parseJsonResponse(response)).resolves.toEqual({
      error: { code: "UNAUTHORIZED", message: "Authentication required", details: [] }
    });
  });

  test("missing targets stay 404 and unknown failures are redacted and logged", async () => {
    const missing = await getPublicEvent(
      request("/api/public/events/missing"),
      routeContext({ eventId: "missing" })
    );
    expect(missing.status).toBe(404);
    expect((await parseJsonResponse(missing)).error.code).toBe("NOT_FOUND");
    expect(
      (await getStaff(request("/api/orgs/nowhere/staff"), routeContext({ orgSlug: "nowhere" }))).status
    ).toBe(404);

    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(prisma.event, "findFirst").mockRejectedValueOnce(
      new Error("connection string with password")
    );
    const failed = await getPublicEvent(
      request("/api/public/events/any"),
      routeContext({ eventId: "any" })
    );

    expect(failed.status).toBe(500);
    await expect(parseJsonResponse(failed)).resolves.toEqual({
      error: { code: "INTERNAL_ERROR", message: "Internal server error", details: [] }
    });
    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toMatchObject({
      event: "api.request_failed",
      operation: "public_events.detail",
      method: "GET"
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain("password");
  });
});

describe("dashboard read services", () => {
  test("upcoming tickets are the caller's own paid orders for future events", async () => {
    const { organisation } = await createOrganisationAccount();
    const member = await createMember();
    const other = await createMember();
    const event = await createEvent({ organisationId: organisation.id, status: "published" });
    const base = { organisationId: organisation.id, eventId: event.id, ticketTypeId: event.ticketTypes[0].id };
    const paid = await createOrder({ ...base, userId: member.id, status: "paid", paidAt: new Date() });
    await createOrder({ ...base, userId: member.id, status: "pending" });
    await createOrder({ ...base, userId: other.id, status: "paid", paidAt: new Date() });

    expect((await getUpcomingTicketOrders(member.id)).map((order) => order.id)).toEqual([paid.id]);

    await prisma.event.update({
      where: { id: event.id },
      data: { startTime: new Date(Date.now() - 2 * 86400000), endTime: new Date(Date.now() - 86400000) }
    });
    expect(await getUpcomingTicketOrders(member.id)).toEqual([]);
  });

  test("past invitations are classified and pending ones are left out", async () => {
    const { user, organisation } = await createOrganisationAccount();
    const invite = (email: string, data: object) =>
      prisma.organisationStaffInvite.create({
        data: {
          organisationId: organisation.id,
          email,
          role: "event_manager",
          tokenHash: `hash-${email}`,
          invitedById: user.id,
          expiresAt: new Date(Date.now() + 86400000),
          ...data
        }
      });
    await invite("pending@example.com", {});
    await invite("accepted@example.com", { acceptedAt: new Date() });
    await invite("revoked@example.com", { revokedAt: new Date() });
    await invite("expired@example.com", { expiresAt: new Date(Date.now() - 1000) });

    const past = await listPastStaffInvites(organisation.id);

    expect(Object.fromEntries(past.map((row) => [row.email, row.state]))).toEqual({
      "accepted@example.com": "accepted",
      "revoked@example.com": "revoked",
      "expired@example.com": "expired"
    });
  });

  test("the overview reports setup facts and skips finance reads without orders:read", async () => {
    const { organisation } = await createOrganisationAccount({ stripeReady: true });
    const orders = vi.spyOn(prisma.order, "findMany");

    const overview = await getOrganisationOverview(organisation.id, {
      includeOrders: false,
      paidSince: new Date(0)
    });

    expect(overview).toMatchObject({
      profileComplete: false,
      chargesReady: true,
      recentOrders: [],
      monthlyPaidOrders: []
    });
    expect(orders).not.toHaveBeenCalled();
  });
});
