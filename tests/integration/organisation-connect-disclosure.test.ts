import { describe, expect, test, vi } from "vitest";
import { prisma } from "@/lib/db";
import { clearMockSession, setMockSession } from "@/tests/helpers/auth";
import { jsonRequest, parseJsonResponse, routeContext } from "@/tests/helpers/http";
import {
  createMember,
  createOrganisationAccount,
  createOrganisationStaff,
  joinOrganisation
} from "@/tests/helpers/test-data";
import { GET as searchOrganisations } from "@/app/api/orgs/search/route";
import { GET as getOrganisation } from "@/app/api/orgs/[orgSlug]/route";
import { POST as joinOrganisationRoute } from "@/app/api/orgs/[orgSlug]/join/route";
import { POST as leaveOrganisationRoute } from "@/app/api/orgs/[orgSlug]/leave/route";
import { GET as connectStatus } from "@/app/api/stripe/connect/status/route";
import { POST as connectOnboard } from "@/app/api/stripe/connect/onboard/route";
import { POST as connectContinue } from "@/app/api/stripe/connect/continue/route";
import { POST as connectDisconnect } from "@/app/api/stripe/connect/disconnect/route";

const connectMocks = vi.hoisted(() => ({
  startOrganisationStripeOnboarding: vi.fn(),
  continueOrganisationStripeOnboarding: vi.fn(),
  disconnectAccount: vi.fn(),
  getOrganisationStripeConnectStatus: vi.fn()
}));

vi.mock("@/lib/stripe/connect", () => {
  class StripeConnectPlatformNotReadyError extends Error {
    state = "PLATFORM_NOT_READY" as const;
    actionRequired = "Complete Stripe Connect platform profile";
    actionUrl = "https://dashboard.stripe.com/settings/connect/platform-profile";
  }

  class OrganisationStripeConnectNotFoundError extends Error {}
  class OrganisationStripeConnectValidationError extends Error {
    details = [];
  }

  return {
    StripeConnectPlatformNotReadyError,
    OrganisationStripeConnectNotFoundError,
    OrganisationStripeConnectValidationError,
    startOrganisationStripeOnboarding:
      connectMocks.startOrganisationStripeOnboarding,
    continueOrganisationStripeOnboarding:
      connectMocks.continueOrganisationStripeOnboarding,
    disconnectAccount: connectMocks.disconnectAccount,
    getOrganisationStripeConnectStatus:
      connectMocks.getOrganisationStripeConnectStatus,
    notConnectedStatus: () => ({
      accountId: null,
      connected: false,
      state: "NOT_CONNECTED",
      ready: false,
      charges_enabled: false,
      payouts_enabled: false,
      details_submitted: false,
      currently_due: [],
      eventually_due: [],
      disabled_reason: null,
      dashboard_url: null
    }),
    platformNotReadyStatus: () => ({
      accountId: null,
      connected: false,
      state: "PLATFORM_NOT_READY",
      ready: false,
      charges_enabled: false,
      payouts_enabled: false,
      details_submitted: false,
      currently_due: [],
      eventually_due: [],
      disabled_reason: null,
      dashboard_url: null,
      actionUrl: "https://dashboard.stripe.com/settings/connect/platform-profile",
      actionRequired: "Complete Stripe Connect platform profile",
      error: "Stripe platform setup incomplete"
    })
  };
});

const trustedAppOrigin = "http://localhost:3000";
const firstPartyHeaders = { origin: trustedAppOrigin };

async function withTrustedAppOrigin(run: () => Promise<void>) {
  const previous = process.env.NEXT_PUBLIC_APP_URL;
  process.env.NEXT_PUBLIC_APP_URL = trustedAppOrigin;

  try {
    await run();
  } finally {
    if (previous === undefined) {
      delete process.env.NEXT_PUBLIC_APP_URL;
    } else {
      process.env.NEXT_PUBLIC_APP_URL = previous;
    }
  }
}

function connectBody(organisationId: string) {
  return { organisationId };
}

const connectEndpoints = ["status", "onboard", "continue", "disconnect"] as const;
type ConnectEndpoint = typeof connectEndpoints[number];

async function invokeConnect(
  endpoint: ConnectEndpoint,
  organisationId?: string,
  origin = trustedAppOrigin
) {
  const base = `http://localhost/api/stripe/connect/${endpoint}`;
  if (endpoint === "status") {
    return connectStatus(jsonRequest(
      organisationId ? `${base}?organisationId=${organisationId}` : base
    ));
  }
  const handlers = { onboard: connectOnboard, continue: connectContinue, disconnect: connectDisconnect };
  return handlers[endpoint](jsonRequest(base, organisationId ? connectBody(organisationId) : {}, {
    headers: { origin }
  }));
}

async function expectAllDenied(organisationId: string | undefined, status: number) {
  const before = await prisma.organisation.findMany({ orderBy: { id: "asc" } });
  vi.clearAllMocks();
  for (const endpoint of connectEndpoints) {
    const response = await invokeConnect(endpoint, organisationId);
    expect(response.status, endpoint).toBe(status);
  }
  for (const mock of Object.values(connectMocks)) expect(mock).not.toHaveBeenCalled();
  expect(await prisma.organisation.findMany({ orderBy: { id: "asc" } })).toEqual(before);
}

async function expectAllAllowed(organisationId: string) {
  connectMocks.startOrganisationStripeOnboarding.mockResolvedValue(
    "https://connect.stripe.test/staff"
  );
  connectMocks.continueOrganisationStripeOnboarding.mockResolvedValue(
    "https://connect.stripe.test/staff"
  );
  connectMocks.getOrganisationStripeConnectStatus.mockResolvedValue({
    state: "READY",
    ready: true
  });
  connectMocks.disconnectAccount.mockResolvedValue(undefined);
  for (const endpoint of connectEndpoints) {
    expect((await invokeConnect(endpoint, organisationId)).status, endpoint).toBe(200);
  }
}

describe("Stripe Connect broad capability and tenant isolation", () => {
  test.each(["owner", "admin"] as const)("member-account %s can use every endpoint", async (role) => {
    await withTrustedAppOrigin(async () => {
      const { organisation } = await createOrganisationAccount({ stripeReady: true });
      const user = await createMember();
      await createOrganisationStaff({ organisationId: organisation.id, userId: user.id, role });
      setMockSession({ userId: user.id, email: user.email, accountRole: "member" });
      await expectAllAllowed(organisation.id);
    });
  });

  test("authentication and capability precede malformed or missing targets", async () => {
    await withTrustedAppOrigin(async () => {
      const { organisation } = await createOrganisationAccount();
      clearMockSession();
      for (const target of [organisation.id, "missing-org", undefined]) await expectAllDenied(target, 401);
      const user = await createMember();
      await createOrganisationStaff({ organisationId: organisation.id, userId: user.id, role: "finance_manager" });
      setMockSession({ userId: user.id, email: user.email, accountRole: "member" });
      for (const target of [organisation.id, "missing-org", undefined]) await expectAllDenied(target, 403);
    });
  });

  test("authority elsewhere never grants target access or reveals missing versus unrelated tenants", async () => {
    await withTrustedAppOrigin(async () => {
      const a = await createOrganisationAccount();
      const b = await createOrganisationAccount({ stripeReady: true });
      const user = await createMember();
      await createOrganisationStaff({ organisationId: a.organisation.id, userId: user.id, role: "admin" });
      setMockSession({ userId: user.id, email: user.email, accountRole: "member" });
      await expectAllDenied(undefined, 400);
      await expectAllDenied(b.organisation.id, 404);
      await expectAllDenied("missing-org", 404);
      for (const endpoint of connectEndpoints) {
        expect(await parseJsonResponse(await invokeConnect(endpoint, b.organisation.id))).toEqual(
          await parseJsonResponse(await invokeConnect(endpoint, "missing-org"))
        );
      }
      const staff = await createOrganisationStaff({ organisationId: b.organisation.id, userId: user.id, role: "event_manager" });
      await expectAllDenied(b.organisation.id, 403);
      await prisma.organisationStaff.update({ where: { id: staff.id }, data: { status: "revoked" } });
      await expectAllDenied(b.organisation.id, 404);
      for (const endpoint of connectEndpoints) {
        expect(await parseJsonResponse(await invokeConnect(endpoint, b.organisation.id))).toEqual(
          await parseJsonResponse(await invokeConnect(endpoint, "missing-org"))
        );
      }
    });
  });

  test("legacy ownership survives an unrelated low-privilege membership", async () => {
    await withTrustedAppOrigin(async () => {
      const a = await createOrganisationAccount({ stripeReady: true });
      const b = await createOrganisationAccount();
      await prisma.organisationStaff.deleteMany({ where: { organisationId: a.organisation.id, userId: a.user.id } });
      await createOrganisationStaff({ organisationId: b.organisation.id, userId: a.user.id, role: "check_in_staff" });
      setMockSession({ userId: a.user.id, email: a.user.email, accountRole: "organisation" });
      await expectAllAllowed(a.organisation.id);
      await expectAllDenied(b.organisation.id, 403);
    });
  });

  test.each(["revoked", "invited", "downgraded"] as const)("%s bootstrap staff cannot recover legacy authority", async (change) => {
    await withTrustedAppOrigin(async () => {
      const { user, organisation } = await createOrganisationAccount({ stripeReady: true });
      setMockSession({ userId: user.id, email: user.email, accountRole: "organisation" });
      await expectAllAllowed(organisation.id);
      await prisma.organisationStaff.update({
        where: { organisationId_userId: { organisationId: organisation.id, userId: user.id } },
        data: change === "downgraded" ? { role: "finance_manager" } : { status: change }
      });
      await expectAllDenied(organisation.id, 403);
    });
  });

  test("untrusted origins are rejected before authentication or capability checks", async () => {
    await withTrustedAppOrigin(async () => {
      clearMockSession();
      vi.clearAllMocks();
      for (const endpoint of ["onboard", "continue", "disconnect"] as const) {
        expect((await invokeConnect(endpoint, undefined, "https://untrusted.example")).status).toBe(403);
      }
      for (const mock of Object.values(connectMocks)) expect(mock).not.toHaveBeenCalled();
    });
  });
});

describe("organisation and Stripe Connect disclosure", () => {
  test("public organisation search remains intentionally discoverable", async () => {
    const { organisation } = await createOrganisationAccount({
      name: "Discoverable Society",
      slug: "discoverable-society"
    });
    const member = await createMember();
    setMockSession({ userId: member.id, email: member.email, accountRole: "member" });

    const response = await searchOrganisations(
      jsonRequest("http://localhost/api/orgs/search?q=Discoverable")
    );

    expect(response.status).toBe(200);
    expect(await parseJsonResponse(response)).toEqual({
      organisations: [
        {
          id: organisation.id,
          name: organisation.name,
          slug: organisation.slug,
          joined: false
        }
      ]
    });
  });

  test("private organisation detail missing and cross-tenant slugs return the same safe 404", async () => {
    const owned = await createOrganisationAccount();
    const other = await createOrganisationAccount();
    setMockSession({
      userId: owned.user.id,
      email: owned.user.email,
      accountRole: "organisation"
    });

    const missing = await getOrganisation(
      jsonRequest("http://localhost/api/orgs/missing-org"),
      routeContext({ orgSlug: "missing-org" })
    );
    const crossTenant = await getOrganisation(
      jsonRequest(`http://localhost/api/orgs/${other.organisation.slug}`),
      routeContext({ orgSlug: other.organisation.slug })
    );

    expect(missing.status).toBe(404);
    expect(crossTenant.status).toBe(404);
    expect(await parseJsonResponse(crossTenant)).toEqual(
      await parseJsonResponse(missing)
    );
  });

  test("member join and leave unauthenticated remain unauthorized", async () => {
    const { organisation } = await createOrganisationAccount();

    await withTrustedAppOrigin(async () => {
      clearMockSession();

      const join = await joinOrganisationRoute(
        jsonRequest(`http://localhost/api/orgs/${organisation.slug}/join`, undefined, {
          method: "POST",
          headers: firstPartyHeaders
        }),
        routeContext({ orgSlug: organisation.slug })
      );
      const leave = await leaveOrganisationRoute(
        jsonRequest(`http://localhost/api/orgs/${organisation.slug}/leave`, undefined, {
          method: "POST",
          headers: firstPartyHeaders
        }),
        routeContext({ orgSlug: organisation.slug })
      );

      expect(join.status).toBe(401);
      expect(leave.status).toBe(401);
    });
  });

  test("organisation account join and leave remain forbidden", async () => {
    const { user, organisation } = await createOrganisationAccount();

    await withTrustedAppOrigin(async () => {
      setMockSession({
        userId: user.id,
        email: user.email,
        accountRole: "organisation"
      });

      const join = await joinOrganisationRoute(
        jsonRequest(`http://localhost/api/orgs/${organisation.slug}/join`, undefined, {
          method: "POST",
          headers: firstPartyHeaders
        }),
        routeContext({ orgSlug: organisation.slug })
      );
      const leave = await leaveOrganisationRoute(
        jsonRequest(`http://localhost/api/orgs/${organisation.slug}/leave`, undefined, {
          method: "POST",
          headers: firstPartyHeaders
        }),
        routeContext({ orgSlug: organisation.slug })
      );

      expect(join.status).toBe(403);
      expect(leave.status).toBe(403);
    });
  });

  test("missing organisation slug join and leave return the current safe 404", async () => {
    const member = await createMember();

    await withTrustedAppOrigin(async () => {
      setMockSession({
        userId: member.id,
        email: member.email,
        accountRole: "member"
      });

      const join = await joinOrganisationRoute(
        jsonRequest("http://localhost/api/orgs/missing-org/join", undefined, {
          method: "POST",
          headers: firstPartyHeaders
        }),
        routeContext({ orgSlug: "missing-org" })
      );
      const leave = await leaveOrganisationRoute(
        jsonRequest("http://localhost/api/orgs/missing-org/leave", undefined, {
          method: "POST",
          headers: firstPartyHeaders
        }),
        routeContext({ orgSlug: "missing-org" })
      );

      expect(join.status).toBe(404);
      const joinBody = await parseJsonResponse(join);
      expect(joinBody).toEqual({
        error: {
          code: "NOT_FOUND",
          message: "Organisation was not found",
          details: []
        }
      });
      expect(leave.status).toBe(404);
      expect(await parseJsonResponse(leave)).toEqual(joinBody);
    });
  });

  test("Stripe Connect status unauthenticated and member accounts cannot read private Connect state", async () => {
    const { organisation } = await createOrganisationAccount({ stripeReady: true });

    clearMockSession();
    const unauthenticated = await connectStatus(
      jsonRequest(
        `http://localhost/api/stripe/connect/status?organisationId=${organisation.id}`
      )
    );
    expect(unauthenticated.status).toBe(401);

    const member = await createMember();
    await joinOrganisation(member.id, organisation.id);
    setMockSession({ userId: member.id, email: member.email, accountRole: "member" });
    const memberResponse = await connectStatus(
      jsonRequest(
        `http://localhost/api/stripe/connect/status?organisationId=${organisation.id}`
      )
    );

    expect(memberResponse.status).toBe(403);
    expect(connectMocks.getOrganisationStripeConnectStatus).not.toHaveBeenCalled();
  });

  test("Stripe Connect status missing and cross-tenant organisations return the same safe 404", async () => {
    const owned = await createOrganisationAccount();
    const other = await createOrganisationAccount({ stripeReady: true });
    setMockSession({
      userId: owned.user.id,
      email: owned.user.email,
      accountRole: "organisation"
    });

    const missing = await connectStatus(
      jsonRequest("http://localhost/api/stripe/connect/status?organisationId=missing-org")
    );
    const crossTenant = await connectStatus(
      jsonRequest(
        `http://localhost/api/stripe/connect/status?organisationId=${other.organisation.id}`
      )
    );

    expect(missing.status).toBe(404);
    expect(crossTenant.status).toBe(404);
    expect(await parseJsonResponse(crossTenant)).toEqual(
      await parseJsonResponse(missing)
    );
  });

  test("Stripe Connect status validation and successful response shapes remain unchanged", async () => {
    const notConnected = await createOrganisationAccount();
    const platform = await createOrganisationAccount();
    await prisma.organisation.update({
      where: { id: platform.organisation.id },
      data: { stripeAccountStatus: "PLATFORM_NOT_READY" }
    });
    const connected = await createOrganisationAccount({ stripeReady: true });
    connectMocks.getOrganisationStripeConnectStatus
      .mockResolvedValueOnce({
        accountId: null,
        connected: false,
        state: "NOT_CONNECTED",
        ready: false,
        charges_enabled: false,
        payouts_enabled: false,
        details_submitted: false,
        currently_due: [],
        eventually_due: [],
        disabled_reason: null,
        dashboard_url: null
      })
      .mockResolvedValueOnce({
        accountId: null,
        connected: false,
        state: "PLATFORM_NOT_READY",
        ready: false,
        charges_enabled: false,
        payouts_enabled: false,
        details_submitted: false,
        currently_due: [],
        eventually_due: [],
        disabled_reason: null,
        dashboard_url: null,
        actionUrl:
          "https://dashboard.stripe.com/settings/connect/platform-profile",
        actionRequired: "Complete Stripe Connect platform profile",
        error: "Stripe platform setup incomplete"
      })
      .mockResolvedValueOnce({
        accountId: connected.organisation.stripeAccountId,
        connected: true,
        state: "READY",
        ready: true,
        charges_enabled: true,
        payouts_enabled: true,
        details_submitted: true,
        currently_due: [],
        eventually_due: [],
        disabled_reason: null,
        dashboard_url: "https://dashboard.stripe.test/connect/accounts/acct_test"
      });

    setMockSession({
      userId: notConnected.user.id,
      email: notConnected.user.email,
      accountRole: "organisation"
    });
    const invalid = await connectStatus(
      jsonRequest("http://localhost/api/stripe/connect/status")
    );
    expect(invalid.status).toBe(400);

    const notConnectedResponse = await connectStatus(
      jsonRequest(
        `http://localhost/api/stripe/connect/status?organisationId=${notConnected.organisation.id}`
      )
    );
    expect(notConnectedResponse.status).toBe(200);
    expect(await parseJsonResponse(notConnectedResponse)).toEqual({
      accountId: null,
      connected: false,
      state: "NOT_CONNECTED",
      ready: false,
      charges_enabled: false,
      payouts_enabled: false,
      details_submitted: false,
      currently_due: [],
      eventually_due: [],
      disabled_reason: null,
      dashboard_url: null
    });

    setMockSession({
      userId: platform.user.id,
      email: platform.user.email,
      accountRole: "organisation"
    });
    const platformResponse = await connectStatus(
      jsonRequest(
        `http://localhost/api/stripe/connect/status?organisationId=${platform.organisation.id}`
      )
    );
    expect(platformResponse.status).toBe(200);
    expect(await parseJsonResponse(platformResponse)).toMatchObject({
      accountId: null,
      connected: false,
      state: "PLATFORM_NOT_READY",
      ready: false,
      dashboard_url: null
    });

    setMockSession({
      userId: connected.user.id,
      email: connected.user.email,
      accountRole: "organisation"
    });
    const connectedResponse = await connectStatus(
      jsonRequest(
        `http://localhost/api/stripe/connect/status?organisationId=${connected.organisation.id}`
      )
    );
    expect(connectedResponse.status).toBe(200);
    expect(await parseJsonResponse(connectedResponse)).toEqual({
      accountId: connected.organisation.stripeAccountId,
      connected: true,
      state: "READY",
      ready: true,
      charges_enabled: true,
      payouts_enabled: true,
      details_submitted: true,
      currently_due: [],
      eventually_due: [],
      disabled_reason: null,
      dashboard_url: "https://dashboard.stripe.test/connect/accounts/acct_test"
    });
  });

  test("Stripe Connect status authenticates before organisationId validation", async () => {
    clearMockSession();
    const unauthenticated = await connectStatus(
      jsonRequest("http://localhost/api/stripe/connect/status")
    );
    expect(unauthenticated.status).toBe(401);

    const member = await createMember();
    setMockSession({ userId: member.id, email: member.email, accountRole: "member" });
    const memberResponse = await connectStatus(
      jsonRequest("http://localhost/api/stripe/connect/status")
    );
    expect(memberResponse.status).toBe(403);

    const organisation = await createOrganisationAccount();
    setMockSession({
      userId: organisation.user.id,
      email: organisation.user.email,
      accountRole: "organisation"
    });
    const invalid = await connectStatus(
      jsonRequest("http://localhost/api/stripe/connect/status")
    );
    expect(invalid.status).toBe(400);
  });

  test("Stripe Connect mutations unauthenticated and member accounts remain unauthorized or forbidden", async () => {
    const { organisation } = await createOrganisationAccount();

    await withTrustedAppOrigin(async () => {
      clearMockSession();
      const unauthenticated = await connectOnboard(
        jsonRequest(
          "http://localhost/api/stripe/connect/onboard",
          connectBody(organisation.id),
          { headers: firstPartyHeaders }
        )
      );
      expect(unauthenticated.status).toBe(401);

      const member = await createMember();
      await joinOrganisation(member.id, organisation.id);
      setMockSession({
        userId: member.id,
        email: member.email,
        accountRole: "member"
      });

      for (const [route, request] of [
        ["onboard", connectOnboard],
        ["continue", connectContinue],
        ["disconnect", connectDisconnect]
      ] as const) {
        const response = await request(
          jsonRequest(
            `http://localhost/api/stripe/connect/${route}`,
            connectBody(organisation.id),
            { headers: firstPartyHeaders }
          )
        );
        expect(response.status).toBe(403);
      }
    });
  });

  test("Stripe Connect mutations authenticate before body validation", async () => {
    await withTrustedAppOrigin(async () => {
      clearMockSession();
      const unauthenticated = await connectOnboard(
        jsonRequest("http://localhost/api/stripe/connect/onboard", {}, {
          headers: firstPartyHeaders
        })
      );
      expect(unauthenticated.status).toBe(401);

      const member = await createMember();
      setMockSession({
        userId: member.id,
        email: member.email,
        accountRole: "member"
      });
      const memberResponse = await connectOnboard(
        jsonRequest("http://localhost/api/stripe/connect/onboard", {}, {
          headers: firstPartyHeaders
        })
      );
      expect(memberResponse.status).toBe(403);

      const organisation = await createOrganisationAccount();
      setMockSession({
        userId: organisation.user.id,
        email: organisation.user.email,
        accountRole: "organisation"
      });

      for (const [route, request] of [
        ["onboard", connectOnboard],
        ["continue", connectContinue],
        ["disconnect", connectDisconnect]
      ] as const) {
        const response = await request(
          jsonRequest(`http://localhost/api/stripe/connect/${route}`, {}, {
            headers: firstPartyHeaders
          })
        );
        expect(response.status).toBe(400);
      }
    });
  });

  test("Stripe Connect mutations missing and cross-tenant organisations return the same safe 404", async () => {
    const owned = await createOrganisationAccount();
    const other = await createOrganisationAccount({ stripeReady: true });

    await withTrustedAppOrigin(async () => {
      setMockSession({
        userId: owned.user.id,
        email: owned.user.email,
        accountRole: "organisation"
      });

      for (const [route, request] of [
        ["onboard", connectOnboard],
        ["continue", connectContinue],
        ["disconnect", connectDisconnect]
      ] as const) {
        const missing = await request(
          jsonRequest(
            `http://localhost/api/stripe/connect/${route}`,
            connectBody("missing-org"),
            { headers: firstPartyHeaders }
          )
        );
        const crossTenant = await request(
          jsonRequest(
            `http://localhost/api/stripe/connect/${route}`,
            connectBody(other.organisation.id),
            { headers: firstPartyHeaders }
          )
        );

        expect(missing.status).toBe(404);
        expect(crossTenant.status).toBe(404);
        expect(await parseJsonResponse(crossTenant)).toEqual(
          await parseJsonResponse(missing)
        );
      }
    });

    expect(connectMocks.startOrganisationStripeOnboarding).not.toHaveBeenCalled();
    expect(connectMocks.continueOrganisationStripeOnboarding).not.toHaveBeenCalled();
    expect(connectMocks.disconnectAccount).not.toHaveBeenCalled();
  });

  test("Stripe Connect mutation success payloads remain unchanged", async () => {
    const { user, organisation } = await createOrganisationAccount({
      stripeReady: true
    });
    connectMocks.startOrganisationStripeOnboarding.mockResolvedValueOnce(
      "https://connect.stripe.test/onboard"
    );
    connectMocks.continueOrganisationStripeOnboarding.mockResolvedValueOnce(
      "https://connect.stripe.test/continue"
    );
    connectMocks.disconnectAccount.mockResolvedValueOnce(undefined);

    await withTrustedAppOrigin(async () => {
      setMockSession({ userId: user.id, email: user.email, accountRole: "organisation" });

      const onboard = await connectOnboard(
        jsonRequest(
          "http://localhost/api/stripe/connect/onboard",
          connectBody(organisation.id),
          { headers: firstPartyHeaders }
        )
      );
      expect(onboard.status).toBe(200);
      expect(await parseJsonResponse(onboard)).toEqual({
        url: "https://connect.stripe.test/onboard"
      });

      const resume = await connectContinue(
        jsonRequest(
          "http://localhost/api/stripe/connect/continue",
          connectBody(organisation.id),
          { headers: firstPartyHeaders }
        )
      );
      expect(resume.status).toBe(200);
      expect(await parseJsonResponse(resume)).toEqual({
        url: "https://connect.stripe.test/continue"
      });

      const disconnect = await connectDisconnect(
        jsonRequest(
          "http://localhost/api/stripe/connect/disconnect",
          connectBody(organisation.id),
          { headers: firstPartyHeaders }
        )
      );
      expect(disconnect.status).toBe(200);
      expect(await parseJsonResponse(disconnect)).toEqual({
        disconnected: true,
        status: {
          accountId: null,
          connected: false,
          state: "NOT_CONNECTED",
          ready: false,
          charges_enabled: false,
          payouts_enabled: false,
          details_submitted: false,
          currently_due: [],
          eventually_due: [],
          disabled_reason: null,
          dashboard_url: null
        }
      });
    });
  });
});
