import { describe, expect, test, vi } from "vitest";
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

vi.mock("@/lib/stripe", () => {
  class StripeConfigurationError extends Error {}

  return {
    StripeConfigurationError,
    getAppUrl: () => "http://localhost:3000",
    getStripe: () => ({
      accounts: {
        create: stripeMocks.createAccount,
        retrieve: stripeMocks.retrieveAccount
      },
      accountLinks: { create: stripeMocks.createAccountLink }
    })
  };
});

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
    const { organisation } = await createOrganisationAccount({
      stripeReady: true
    });
    stripeMocks.createAccountLink.mockResolvedValue({
      url: "https://connect.stripe.test/application-service"
    });

    await expect(
      startOrganisationStripeOnboarding(organisation.id)
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

  test("distinguishes a missing organisation from an unconnected one", async () => {
    const { organisation } = await createOrganisationAccount();

    await expect(
      getOrganisationStripeConnectStatus("missing-organisation")
    ).rejects.toBeInstanceOf(OrganisationStripeConnectNotFoundError);
    await expect(
      continueOrganisationStripeOnboarding(organisation.id)
    ).rejects.toBeInstanceOf(OrganisationStripeConnectValidationError);
  });
});
