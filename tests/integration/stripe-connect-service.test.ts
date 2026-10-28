import Stripe from "stripe";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { POST as connectWebhook } from "@/app/api/stripe/connect/webhook/route";
import { prisma } from "@/lib/db";
import {
  continueOrganisationStripeOnboarding,
  getOrganisationStripeConnectStatus,
  OrganisationStripeConnectNotFoundError,
  OrganisationStripeConnectValidationError,
  startOrganisationStripeOnboarding
} from "@/lib/stripe/connect";
import { MfaInputError } from "@/lib/security/staff-mfa";
import { createOrganisationAccount, createOrganisationStaff, createUser, unique } from "@/tests/helpers/test-data";

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

// Both capabilities destination charges need (card_payments for on_behalf_of, transfers to pay the society).
const active = { card_payments: "active", transfers: "active" } as const;

function signedConnectEvent(event: Record<string, unknown>) {
  const body = JSON.stringify({ object: "event", livemode: false, created: Math.floor(Date.now() / 1000), ...event });
  const signature = new Stripe("sk_test_connect_service").webhooks.generateTestHeaderString({ payload: body, secret: connectSecret });
  return connectWebhook(new Request("http://localhost:3000/api/stripe/connect/webhook", { method: "POST", headers: { "stripe-signature": signature }, body }));
}

function accountUpdated(account: Record<string, unknown>) {
  return signedConnectEvent({ id: `evt_${account.id}`, type: "account.updated", data: { object: account } });
}

describe("Stripe Connect application service", () => {
  // Each test sees only its own Stripe calls.
  beforeEach(() => { for (const mock of Object.values(stripeMocks)) mock.mockReset(); });

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

  test("refreshes and persists readiness: ready, restricted while charges are off, incomplete until details are in", async () => {
    const { organisation } = await createOrganisationAccount({
      stripeReady: true
    });
    const cases = [
      { details_submitted: true, charges_enabled: true, capabilities: active, state: "READY", requirements: { currently_due: [], eventually_due: ["external_account"], disabled_reason: null } },
      { details_submitted: true, charges_enabled: false, capabilities: active, state: "RESTRICTED", requirements: { currently_due: ["individual.verification.document"], eventually_due: [], disabled_reason: "requirements.past_due" } },
      { details_submitted: false, charges_enabled: false, capabilities: active, state: "CONNECTED_INCOMPLETE", requirements: { currently_due: ["business_profile.url"], eventually_due: [], disabled_reason: "requirements.past_due" } }
    ] as const;

    for (const { state, requirements, ...flags } of cases) {
      stripeMocks.retrieveAccount.mockResolvedValueOnce({ id: organisation.stripeAccountId, payouts_enabled: false, requirements, ...flags });
      // What the Payments page shows: only a ready account sells, and Stripe's own next steps.
      await expect(
        getOrganisationStripeConnectStatus(organisation.id)
      ).resolves.toMatchObject({
        accountId: organisation.stripeAccountId,
        state,
        ready: state === "READY",
        payouts_enabled: false,
        currently_due: requirements.currently_due,
        disabled_reason: requirements.disabled_reason,
        dashboard_available: flags.details_submitted
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
        stripeAccountStatus: state,
        stripeChargesEnabled: flags.charges_enabled,
        stripePayoutsEnabled: false,
        stripeDetailsSubmitted: flags.details_submitted
      });
    }

    // Card payments on but transfers inactive: a destination charge can't pay the society, so it can't sell.
    stripeMocks.retrieveAccount.mockResolvedValueOnce({ id: organisation.stripeAccountId, details_submitted: true, charges_enabled: true, payouts_enabled: true, capabilities: { card_payments: "active", transfers: "inactive" }, requirements: { currently_due: [], eventually_due: [], disabled_reason: null } });
    await expect(getOrganisationStripeConnectStatus(organisation.id)).resolves.toMatchObject({ state: "RESTRICTED", ready: false, charges_enabled: false });
    expect(await prisma.organisation.findUniqueOrThrow({ where: { id: organisation.id }, select: { stripeChargesEnabled: true } })).toEqual({ stripeChargesEnabled: false });
  });

  test("a Stripe platform not yet signed up for Connect marks the society as waiting on the platform; other errors aren't mistaken for it", async () => {
    const { organisation, user } = await createOrganisationAccount();
    vi.spyOn(console, "error").mockImplementation(() => {});
    stripeMocks.createAccount.mockRejectedValueOnce(Object.assign(
      new Error("You can only create new accounts if you've signed up for Connect, which you can learn how to do at https://stripe.com/docs/connect."),
      { type: "StripeInvalidRequestError" }
    ));

    await expect(startOrganisationStripeOnboarding(organisation.id, { actor: { id: user.id } })).rejects.toMatchObject({ name: "StripeConnectPlatformNotReadyError", state: "PLATFORM_NOT_READY" });
    expect(await prisma.organisation.findUniqueOrThrow({ where: { id: organisation.id }, select: { stripeAccountId: true, stripeAccountStatus: true, stripeChargesEnabled: true } }))
      .toEqual({ stripeAccountId: null, stripeAccountStatus: "PLATFORM_NOT_READY", stripeChargesEnabled: false });
    expect(stripeMocks.createAccountLink).not.toHaveBeenCalled();
    expect(await prisma.auditLog.count({ where: { organisationId: organisation.id, action: "stripe_connect.account_created" } })).toBe(0);

    stripeMocks.createAccount.mockRejectedValueOnce(new Error("Too many requests"));
    await expect(startOrganisationStripeOnboarding(organisation.id, { actor: { id: user.id } })).rejects.toThrow("Too many requests");

    // A network failure's type is StripeConnectionError: "connect" in its name isn't the platform profile.
    const other = await createOrganisationAccount();
    stripeMocks.createAccount.mockRejectedValueOnce(Object.assign(new Error("An error occurred with our connection to Stripe."), { type: "StripeConnectionError" }));
    await expect(startOrganisationStripeOnboarding(other.organisation.id, { actor: { id: other.user.id } })).rejects.toMatchObject({ type: "StripeConnectionError" });
    expect(await prisma.organisation.findUniqueOrThrow({ where: { id: other.organisation.id }, select: { stripeAccountStatus: true } }))
      .toEqual({ stripeAccountStatus: "NOT_CONNECTED" });
    expect(stripeMocks.createAccountLink).not.toHaveBeenCalled();
  });

  test("composes onboarding for an existing connected account", async () => {
    const { organisation, user } = await createOrganisationAccount({
      stripeReady: true
    });
    stripeMocks.createAccountLink.mockResolvedValue({
      url: "https://connect.stripe.test/application-service"
    });

    await expect(
      startOrganisationStripeOnboarding(organisation.id, { actor: { id: user.id } })
    ).resolves.toBe("https://connect.stripe.test/application-service");
    await expect(
      continueOrganisationStripeOnboarding(organisation.id, { actor: { id: user.id } })
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

    await expect(startOrganisationStripeOnboarding(organisation.id, { actor: { id: user.id } })).resolves.toBe("https://connect.stripe.test/new");
    // The society is the settlement merchant (on_behalf_of), and a double click returns the same account.
    expect(stripeMocks.createAccount).toHaveBeenLastCalledWith(
      { type: "express", capabilities: { card_payments: { requested: true }, transfers: { requested: true } }, settings: { payouts: { schedule: { interval: "manual" }, debit_negative_balances: true } } },
      { idempotencyKey: `connect-account:${organisation.id}:0` }
    );
    expect(await prisma.auditLog.findFirst({ where: { organisationId: organisation.id, action: "stripe_connect.account_created" } })).toMatchObject({
      actorUserId: user.id,
      metadata: { stripeAccountId: "acct_created_audit" }
    });
  });

  test("distinguishes a missing organisation from an unconnected one", async () => {
    const { organisation, user } = await createOrganisationAccount();

    await expect(
      getOrganisationStripeConnectStatus("missing-organisation")
    ).rejects.toBeInstanceOf(OrganisationStripeConnectNotFoundError);
    await expect(
      continueOrganisationStripeOnboarding(organisation.id, { actor: { id: user.id } })
    ).rejects.toBeInstanceOf(OrganisationStripeConnectValidationError);
  });

  test("with staff MFA on, Stripe onboarding needs a fresh authenticator code, because it sets where payouts go", async () => {
    const { organisation, user } = await createOrganisationAccount({ stripeReady: true });
    vi.stubEnv("MFA_ENFORCEMENT_MODE", "enforce");
    vi.stubEnv("MFA_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
    await expect(startOrganisationStripeOnboarding(organisation.id, { actor: { id: user.id } })).rejects.toBeInstanceOf(MfaInputError);
    await expect(continueOrganisationStripeOnboarding(organisation.id, { actor: { id: user.id } })).rejects.toBeInstanceOf(MfaInputError);
    expect(stripeMocks.createAccountLink).not.toHaveBeenCalled();
  });

  test("account.updated saves the account as Stripe has it now, not as the event says", async () => {
    const { organisation } = await createOrganisationAccount();
    const accountId = `acct_${organisation.id}`;
    await prisma.organisation.update({ where: { id: organisation.id }, data: { stripeAccountId: accountId } });
    // A late event says setup is unfinished; Stripe says the account is ready.
    stripeMocks.retrieveAccount.mockResolvedValueOnce({ id: accountId, details_submitted: true, charges_enabled: true, capabilities: active, payouts_enabled: true, requirements: { currently_due: [], eventually_due: [] } });

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

  test("staff who manage Stripe hear once when Stripe pauses card payments, and once per deadline it sets", async () => {
    const { organisation, user } = await createOrganisationAccount({ stripeReady: true });
    const accountId = organisation.stripeAccountId as string;
    const checkIn = await createUser({ email: `${unique("door")}@example.com` });
    await createOrganisationStaff({ organisationId: organisation.id, userId: checkIn.id, role: "check_in_staff" });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const notices = (key: string) => prisma.notificationOutbox.findMany({ where: { organisationId: organisation.id, eventKey: { startsWith: key } }, select: { recipient: true } });
    const alerts = () => error.mock.calls.map(([line]) => { try { return JSON.parse(String(line)); } catch { return {}; } }).filter((entry) => entry.event === "society_charges_paused");
    const deadline = Math.floor(Date.UTC(2026, 11, 1) / 1000);
    const account = (charges: boolean, currently_due: string[] = [], current_deadline: number | null = null) =>
      ({ id: accountId, details_submitted: true, charges_enabled: charges, capabilities: active, payouts_enabled: true, requirements: { currently_due, eventually_due: [], disabled_reason: charges ? null : "requirements.past_due", current_deadline } });

    // A deadline while still selling: one notice per deadline, shown on Payments too.
    stripeMocks.retrieveAccount.mockResolvedValue(account(true, ["individual.id_number"], deadline));
    await expect(getOrganisationStripeConnectStatus(organisation.id)).resolves.toMatchObject({ state: "READY", current_deadline: new Date(deadline * 1000).toISOString() });
    await accountUpdated({ id: accountId, object: "account" });
    expect(await notices("stripe-deadline/")).toEqual([{ recipient: user.email }]);

    // Stripe pauses card payments: the webhook sees it first, the refresh after it adds nothing.
    stripeMocks.retrieveAccount.mockResolvedValue(account(false, ["individual.id_number"]));
    await accountUpdated({ id: accountId, object: "account" });
    await getOrganisationStripeConnectStatus(organisation.id);
    expect(await notices("stripe-charges-paused/")).toEqual([{ recipient: user.email }]);
    expect(alerts()).toEqual([expect.objectContaining({ organisationId: organisation.id, disabledReason: "requirements.past_due" })]);

    // A notice that can't be queued (no sender configured) never undoes the flags saved with it.
    const other = await createOrganisationAccount({ stripeReady: true });
    vi.stubEnv("EMAIL_FROM", "");
    stripeMocks.retrieveAccount.mockResolvedValue({ ...account(false), id: other.organisation.stripeAccountId });
    await expect(getOrganisationStripeConnectStatus(other.organisation.id)).resolves.toMatchObject({ state: "RESTRICTED", charges_enabled: false });
    expect(await prisma.organisation.findUniqueOrThrow({ where: { id: other.organisation.id }, select: { stripeChargesEnabled: true, stripeAccountStatus: true } }))
      .toEqual({ stripeChargesEnabled: false, stripeAccountStatus: "RESTRICTED" });
  });
  // SEC-033: Stripe's own email goes only to whoever onboarded the account.
  test("every staff member who manages Stripe hears once when the payout bank account is added or made the default; other changes say nothing", async () => {
    const { organisation, user } = await createOrganisationAccount({ stripeReady: true });
    const accountId = organisation.stripeAccountId as string;
    const treasurer = await createUser({ email: `${unique("treasurer")}@example.com` });
    await createOrganisationStaff({ organisationId: organisation.id, userId: treasurer.id, role: "admin" });
    const door = await createUser({ email: `${unique("door")}@example.com` });
    await createOrganisationStaff({ organisationId: organisation.id, userId: door.id, role: "check_in_staff" });
    const bank = { id: unique("ba"), object: "bank_account", bank_name: "Westpac", last4: "6789", account: accountId, default_for_currency: true };
    const notices = () => prisma.notificationOutbox.findMany({ where: { organisationId: organisation.id, eventKey: { startsWith: "stripe-payout-account/" } }, select: { recipient: true }, orderBy: { recipient: "asc" } });

    const added = { id: unique("evt"), type: "account.external_account.created", account: accountId, data: { object: bank } };
    expect((await signedConnectEvent(added)).status).toBe(200);
    // Stripe may deliver an event twice.
    await signedConnectEvent(added);
    expect(await notices()).toEqual([user.email, treasurer.email].sort().map((recipient) => ({ recipient })));
    expect(await prisma.auditLog.count({ where: { organisationId: organisation.id, action: "stripe_connect.payout_account_changed" } })).toBe(1);

    // A change that isn't a new default (say, its metadata) says nothing; becoming the default does.
    await signedConnectEvent({ id: unique("evt"), type: "account.external_account.updated", account: accountId, data: { object: bank, previous_attributes: { metadata: {} } } });
    expect(await notices()).toHaveLength(2);
    await signedConnectEvent({ id: unique("evt"), type: "account.external_account.updated", account: accountId, data: { object: bank, previous_attributes: { default_for_currency: false } } });
    expect(await notices()).toHaveLength(4);
    // An account no society uses is ignored.
    expect((await signedConnectEvent({ id: unique("evt"), type: "account.external_account.created", account: "acct_unknown", data: { object: bank } })).status).toBe(200);
    expect(await prisma.auditLog.count({ where: { action: "stripe_connect.payout_account_changed" } })).toBe(2);
  });
});
