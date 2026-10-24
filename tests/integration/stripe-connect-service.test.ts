import Stripe from "stripe";
import { describe, expect, test, vi } from "vitest";
import { POST as connectWebhook } from "@/app/api/stripe/connect/webhook/route";
import { prisma } from "@/lib/db";
import {
  continueOrganisationStripeOnboarding,
  getOrganisationStripeConnectStatus,
  OrganisationStripeConnectNotFoundError,
  OrganisationStripeConnectValidationError,
  startOrganisationStripeOnboarding
} from "@/lib/stripe/connect";
import { createOrganisationAccount } from "@/tests/helpers/test-data";

const stripeMocks = vi.hoisted(() => ({
  createAccount: vi.fn(),
  createAccountLink: vi.fn(),
  retrieveAccount: vi.fn()
}));

const connectSecret = "whsec_connect_service";
vi.mock("@/lib/stripe", async () => {
  const { default: RealStripe } = await vi.importActual<typeof import("stripe")>("stripe");
  class StripeConfigurationError extends Error {}

  return {
    StripeConfigurationError,
    getAppUrl: () => "http://localhost:3000",
    isLiveStripeKey: () => false,
    getStripeConnectWebhookSecret: () => "whsec_connect_service",
    getStripe: () => ({
      accounts: {
        create: stripeMocks.createAccount,
        retrieve: stripeMocks.retrieveAccount
      },
      accountLinks: { create: stripeMocks.createAccountLink },
      webhooks: new RealStripe("sk_test_connect_service").webhooks
    })
  };
});

function accountUpdated(account: Record<string, unknown>) {
  const body = JSON.stringify({ id: `evt_${account.id}`, object: "event", type: "account.updated", livemode: false, created: Math.floor(Date.now() / 1000), data: { object: account } });
  const signature = new Stripe("sk_test_connect_service").webhooks.generateTestHeaderString({ payload: body, secret: connectSecret });
  return connectWebhook(new Request("http://localhost:3000/api/stripe/connect/webhook", { method: "POST", headers: { "stripe-signature": signature }, body }));
}

describe("Stripe Connect application service", () => {
  test("returns canonical local states without Stripe I/O", async () => {
    const disconnected = await createOrganisationAccount();
    const blocked = await createOrganisationAccount();
    await prisma.organisation.update({
      where: { id: blocked.organisation.id },
      data: { stripeAccountStatus: "PLATFORM_NOT_READY" }
    });

    await expect(
      getOrganisationStripeConnectStatus(disconnected.organisation.id)
    ).resolves.toMatchObject({ state: "NOT_CONNECTED", connected: false });
    await expect(
      getOrganisationStripeConnectStatus(blocked.organisation.id)
    ).resolves.toMatchObject({ state: "PLATFORM_NOT_READY", connected: false });
    expect(stripeMocks.retrieveAccount).not.toHaveBeenCalled();
  });

  test("refreshes and persists connected-account readiness", async () => {
    const { organisation } = await createOrganisationAccount({
      stripeReady: true
    });
    stripeMocks.retrieveAccount.mockResolvedValueOnce({
      id: organisation.stripeAccountId,
      details_submitted: true,
      charges_enabled: true,
      payouts_enabled: false,
      requirements: {
        currently_due: [],
        eventually_due: ["external_account"],
        disabled_reason: null
      }
    });

    await expect(
      getOrganisationStripeConnectStatus(organisation.id)
    ).resolves.toMatchObject({
      accountId: organisation.stripeAccountId,
      state: "READY",
      ready: true,
      payouts_enabled: false
    });
    await expect(
      prisma.organisation.findUniqueOrThrow({
        where: { id: organisation.id },
        select: {
          stripeAccountStatus: true,
          stripeChargesEnabled: true,
          stripePayoutsEnabled: true,
          stripeDetailsSubmitted: true
        }
      })
    ).resolves.toEqual({
      stripeAccountStatus: "READY",
      stripeChargesEnabled: true,
      stripePayoutsEnabled: false,
      stripeDetailsSubmitted: true
    });
  });

  test("composes onboarding for an existing connected account", async () => {
    const { organisation, user } = await createOrganisationAccount({
      stripeReady: true
    });
    stripeMocks.createAccountLink.mockResolvedValue({
      url: "https://connect.stripe.test/application-service"
    });

    await expect(
      startOrganisationStripeOnboarding(organisation.id, user.id)
    ).resolves.toBe("https://connect.stripe.test/application-service");
    await expect(
      continueOrganisationStripeOnboarding(organisation.id)
    ).resolves.toBe("https://connect.stripe.test/application-service");
    expect(stripeMocks.createAccount).not.toHaveBeenCalled();
    expect(stripeMocks.createAccountLink).toHaveBeenCalledWith({
      account: organisation.stripeAccountId,
      refresh_url: "http://localhost:3000/dashboard/settings",
      return_url: "http://localhost:3000/dashboard/settings",
      type: "account_onboarding"
    });
  });

  test("creating the Express account is audited with its actor", async () => {
    const { organisation, user } = await createOrganisationAccount();
    stripeMocks.createAccount.mockResolvedValueOnce({ id: "acct_created_audit" });
    stripeMocks.createAccountLink.mockResolvedValueOnce({ url: "https://connect.stripe.test/new" });

    await expect(startOrganisationStripeOnboarding(organisation.id, user.id)).resolves.toBe("https://connect.stripe.test/new");
    // The society is the settlement merchant (on_behalf_of), and a double click returns the same account.
    expect(stripeMocks.createAccount).toHaveBeenLastCalledWith(
      { type: "express", capabilities: { card_payments: { requested: true }, transfers: { requested: true } } },
      { idempotencyKey: `connect-account:${organisation.id}:0` }
    );
    expect(await prisma.auditLog.findFirst({ where: { organisationId: organisation.id, action: "stripe_connect.account_created" } })).toMatchObject({
      actorUserId: user.id,
      metadata: { stripeAccountId: "acct_created_audit" }
    });
  });

  test("distinguishes a missing organisation from an unconnected one", async () => {
    const { organisation } = await createOrganisationAccount();

    await expect(
      getOrganisationStripeConnectStatus("missing-organisation")
    ).rejects.toBeInstanceOf(OrganisationStripeConnectNotFoundError);
    await expect(
      continueOrganisationStripeOnboarding(organisation.id)
    ).rejects.toBeInstanceOf(OrganisationStripeConnectValidationError);
  });

  test("account.updated saves the account as Stripe has it now, not as the event says", async () => {
    const { organisation } = await createOrganisationAccount();
    const accountId = `acct_${organisation.id}`;
    await prisma.organisation.update({ where: { id: organisation.id }, data: { stripeAccountId: accountId } });
    // A late event says setup is unfinished; Stripe says the account is ready.
    stripeMocks.retrieveAccount.mockResolvedValueOnce({ id: accountId, details_submitted: true, charges_enabled: true, payouts_enabled: true, requirements: { currently_due: [], eventually_due: [] } });

    expect((await accountUpdated({ id: accountId, object: "account", details_submitted: false, charges_enabled: false })).status).toBe(200);
    expect(stripeMocks.retrieveAccount).toHaveBeenLastCalledWith(accountId);
    expect(await prisma.organisation.findUniqueOrThrow({ where: { id: organisation.id } })).toMatchObject({ stripeAccountStatus: "READY", stripeChargesEnabled: true, stripePayoutsEnabled: true });

    // If Stripe can't answer, nothing changes and the error makes Stripe retry.
    stripeMocks.retrieveAccount.mockRejectedValueOnce(new Error("Stripe unavailable"));
    await expect(accountUpdated({ id: accountId, object: "account", charges_enabled: false })).rejects.toThrow("Stripe unavailable");
    expect((await prisma.organisation.findUniqueOrThrow({ where: { id: organisation.id } })).stripeChargesEnabled).toBe(true);

    // An account no society uses is ignored without asking Stripe.
    stripeMocks.retrieveAccount.mockClear();
    expect((await accountUpdated({ id: "acct_not_ours", object: "account", charges_enabled: true })).status).toBe(200);
    expect(stripeMocks.retrieveAccount).not.toHaveBeenCalled();
  });
});
