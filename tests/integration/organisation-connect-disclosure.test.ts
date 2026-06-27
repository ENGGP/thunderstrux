import { describe, expect, test, vi } from "vitest";
import { prisma } from "@/lib/db";
import { clearMockSession, setMockSession } from "@/tests/helpers/auth";
import { jsonRequest, parseJsonResponse, routeContext } from "@/tests/helpers/http";
import {
  createMember,
  createOrganisationAccount,
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
  createExpressAccount: vi.fn(),
  createOnboardingLink: vi.fn(),
  disconnectAccount: vi.fn(),
  getAccountStatus: vi.fn(),
  markAccountStatusError: vi.fn()
}));

vi.mock("@/lib/stripe/connect", () => {
  class StripeConnectPlatformNotReadyError extends Error {
    state = "PLATFORM_NOT_READY" as const;
    actionRequired = "Complete Stripe Connect platform profile";
    actionUrl = "https://dashboard.stripe.com/settings/connect/platform-profile";
  }

  return {
    StripeConnectPlatformNotReadyError,
    createExpressAccount: connectMocks.createExpressAccount,
    createOnboardingLink: connectMocks.createOnboardingLink,
    disconnectAccount: connectMocks.disconnectAccount,
    getAccountStatus: connectMocks.getAccountStatus,
    markAccountStatusError: connectMocks.markAccountStatusError,
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
    expect(connectMocks.getAccountStatus).not.toHaveBeenCalled();
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
    connectMocks.getAccountStatus.mockResolvedValueOnce({
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

    expect(connectMocks.createExpressAccount).not.toHaveBeenCalled();
    expect(connectMocks.createOnboardingLink).not.toHaveBeenCalled();
    expect(connectMocks.disconnectAccount).not.toHaveBeenCalled();
  });

  test("Stripe Connect mutation success payloads remain unchanged", async () => {
    const { user, organisation } = await createOrganisationAccount({
      stripeReady: true
    });
    connectMocks.createExpressAccount.mockResolvedValueOnce({
      accountId: "acct_success",
      orgSlug: organisation.slug
    });
    connectMocks.createOnboardingLink
      .mockResolvedValueOnce("https://connect.stripe.test/onboard")
      .mockResolvedValueOnce("https://connect.stripe.test/continue");
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
