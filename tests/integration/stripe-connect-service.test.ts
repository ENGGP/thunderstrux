import Stripe from "stripe";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { POST as accountsWebhook } from "@/app/api/stripe/accounts/webhook/route";
import { POST as connectWebhook } from "@/app/api/stripe/connect/webhook/route";
import { prisma } from "@/lib/db";
import { GET as statusRoute } from "@/app/api/stripe/connect/status/route";
import { createTestRateLimitBackend, setRateLimitTestBackend, setRateLimitTestEnabled } from "@/lib/security/rate-limit";
import { setMockSession } from "@/tests/helpers/auth";
import {
  continueOrganisationStripeOnboarding,
  createExpressAccount,
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
  retrieveAccount: vi.fn(),
  balanceSettings: vi.fn(),
  updateBalanceSettings: vi.fn()
}));

const connectSecret = "whsec_connect_service";
const accountsSecret = "whsec_accounts_service";
vi.mock("@/lib/stripe", async () => {
  const { default: RealStripe } = await vi.importActual<typeof import("stripe")>("stripe");
  class StripeConfigurationError extends Error {}

  return {
    StripeConfigurationError,
    getAppUrl: () => "http://localhost:3000",
    isLiveStripeKey: () => false,
    getStripeConnectWebhookSecret: () => "whsec_connect_service",
    getStripeAccountsWebhookSecret: () => "whsec_accounts_service",
    getStripe: () => {
      const real = new RealStripe("sk_test_connect_service");
      return {
        // PAY-023: accounts are created and read through Accounts v2.
        v2: { core: { accounts: { create: stripeMocks.createAccount, retrieve: stripeMocks.retrieveAccount } } },
        accountLinks: { create: stripeMocks.createAccountLink },
        balanceSettings: { retrieve: stripeMocks.balanceSettings, update: stripeMocks.updateBalanceSettings },
        webhooks: real.webhooks,
        parseEventNotification: real.parseEventNotification.bind(real)
      };
    }
  };
});

// A v2 account as Stripe returns it with the app's includes: card_payments (on_behalf_of)
// and stripe_transfers (destination charges), requirements the society owes, and the
// terms of service, accepted at the end of Stripe's hosted onboarding.
type Status = "active" | "restricted" | "pending" | "unsupported";
function v2Account(id: string, { submitted = true, card = "active" as Status, transfers = "active" as Status, payouts = "active" as Status, due = [] as string[], eventually = [] as string[], deadline = null as string | null, reason = "requirements_past_due" } = {}) {
  const capability = (status: Status) => ({ status, status_details: status === "active" ? [] : [{ code: reason, resolution: "provide_info" }] });
  const entry = (description: string, status: string, from = "user") => ({ description, awaiting_action_from: from, minimum_deadline: { status }, errors: [], impact: { restricts_capabilities: [] }, requested_reasons: [] });
  return {
    id,
    object: "v2.core.account",
    identity: { attestations: { terms_of_service: { account: submitted ? { date: "2026-10-01T00:00:00.000Z", ip: null, user_agent: null } : null } } },
    configuration: {
      merchant: { applied: true, capabilities: { card_payments: capability(card), stripe_balance: { payouts: capability(payouts) } } },
      recipient: { applied: true, capabilities: { stripe_balance: { stripe_transfers: capability(transfers), payouts: capability(payouts) } } }
    },
    requirements: {
      // What Stripe itself is checking isn't the society's to send.
      entries: [...due.map((name) => entry(name, "past_due")), ...eventually.map((name) => entry(name, "eventually_due")), entry("identity.individual.verification.document", "currently_due", "stripe")],
      summary: deadline ? { minimum_deadline: { status: "currently_due", time: deadline } } : null
    }
  };
}

function signedConnectEvent(event: Record<string, unknown>) {
  const body = JSON.stringify({ object: "event", livemode: false, created: Math.floor(Date.now() / 1000), ...event });
  const signature = new Stripe("sk_test_connect_service").webhooks.generateTestHeaderString({ payload: body, secret: connectSecret });
  return connectWebhook(new Request("http://localhost:3000/api/stripe/connect/webhook", { method: "POST", headers: { "stripe-signature": signature }, body }));
}

// Accounts v2 events are thin: they name the account, which the app re-reads.
function accountChanged(accountId: string, { type = "v2.core.account[requirements].updated", livemode = false, secret = accountsSecret } = {}) {
  const body = JSON.stringify({ id: unique("evt"), object: "v2.core.event", type, livemode, created: new Date().toISOString(), related_object: { id: accountId, type: "v2.core.account", url: `/v2/core/accounts/${accountId}` } });
  const signature = new Stripe("sk_test_connect_service").webhooks.generateTestHeaderString({ payload: body, secret });
  return accountsWebhook(new Request("http://localhost:3000/api/stripe/accounts/webhook", { method: "POST", headers: { "stripe-signature": signature }, body }));
}

describe("Stripe Connect application service", () => {
  // Each test sees only its own Stripe calls.
  beforeEach(() => {
    for (const mock of Object.values(stripeMocks)) mock.mockReset();
    // New accounts start on Stripe's daily schedule.
    stripeMocks.balanceSettings.mockResolvedValue({ payments: { payouts: { schedule: { interval: "daily" } }, debit_negative_balances: true } });
  });

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
    const id = organisation.stripeAccountId as string;
    const cases = [
      { account: v2Account(id, { payouts: "restricted", eventually: ["external_account"] }), state: "READY", currently_due: [], disabled_reason: null, charges_enabled: true, details_submitted: true },
      { account: v2Account(id, { card: "restricted", payouts: "restricted", due: ["identity.individual.id_number"] }), state: "RESTRICTED", currently_due: ["identity.individual.id_number"], disabled_reason: "requirements_past_due", charges_enabled: false, details_submitted: true },
      { account: v2Account(id, { submitted: false, card: "restricted", transfers: "restricted", payouts: "restricted", due: ["defaults.profile.business_url"] }), state: "CONNECTED_INCOMPLETE", currently_due: ["defaults.profile.business_url"], disabled_reason: "requirements_past_due", charges_enabled: false, details_submitted: false }
    ] as const;

    for (const { account, state, currently_due, disabled_reason, ...flags } of cases) {
      stripeMocks.retrieveAccount.mockResolvedValueOnce(account);
      // What the Payments page shows: only a ready account sells, and Stripe's own next steps.
      await expect(
        getOrganisationStripeConnectStatus(organisation.id)
      ).resolves.toMatchObject({
        accountId: organisation.stripeAccountId,
        state,
        ready: state === "READY",
        payouts_enabled: false,
        currently_due,
        disabled_reason,
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

    // Card payments on but transfers not: a destination charge can't pay the society, so it can't sell.
    stripeMocks.retrieveAccount.mockResolvedValueOnce(v2Account(id, { transfers: "pending" }));
    await expect(getOrganisationStripeConnectStatus(organisation.id)).resolves.toMatchObject({ state: "RESTRICTED", ready: false, charges_enabled: false });
    expect(await prisma.organisation.findUniqueOrThrow({ where: { id: organisation.id }, select: { stripeChargesEnabled: true } })).toEqual({ stripeChargesEnabled: false });
    expect(stripeMocks.retrieveAccount).toHaveBeenLastCalledWith(id, { include: ["configuration.merchant", "configuration.recipient", "identity", "requirements"] });
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
    // PAY-023: an Accounts v2 account. The society is the settlement merchant (on_behalf_of),
    // Thunderstrux pays Stripe's fees and owns losses as with v1 Express, and a double click returns the same account.
    expect(stripeMocks.createAccount).toHaveBeenLastCalledWith(
      {
        display_name: organisation.name,
        dashboard: "express",
        identity: { country: "au" },
        defaults: { currency: "aud", responsibilities: { fees_collector: "application", losses_collector: "application" } },
        configuration: {
          merchant: { capabilities: { card_payments: { requested: true } } },
          recipient: { capabilities: { stripe_balance: { stripe_transfers: { requested: true } } } }
        },
        metadata: { organisationId: organisation.id }
      },
      { idempotencyKey: `connect-account:${organisation.id}:0` }
    );
    // PAY-005: then manual payouts, through Balance Settings as the account.
    expect(stripeMocks.updateBalanceSettings).toHaveBeenCalledWith({ payments: { payouts: { schedule: { interval: "manual" } }, debit_negative_balances: true } }, { stripeAccount: "acct_created_audit" });
    expect(await prisma.auditLog.findFirst({ where: { organisationId: organisation.id, action: "stripe_connect.account_created" } })).toMatchObject({
      actorUserId: user.id,
      metadata: { stripeAccountId: "acct_created_audit" }
    });

    // A failure to set manual payouts never strands onboarding; the payouts worker sets it within the hour.
    const next = await createOrganisationAccount();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    stripeMocks.createAccount.mockResolvedValueOnce({ id: "acct_created_no_settings" });
    stripeMocks.balanceSettings.mockRejectedValueOnce(new Error("Stripe unavailable"));
    stripeMocks.createAccountLink.mockResolvedValueOnce({ url: "https://connect.stripe.test/next" });
    await expect(startOrganisationStripeOnboarding(next.organisation.id, { actor: { id: next.user.id } })).resolves.toBe("https://connect.stripe.test/next");
    expect(warn.mock.calls.map(([line]) => String(line)).filter((line) => line.includes('"event":"stripe_connect.manual_payouts_not_set"'))).toHaveLength(1);
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

  test("an Accounts v2 event saves the account as Stripe has it now; the Connect webhook no longer reads accounts", async () => {
    const { organisation } = await createOrganisationAccount();
    const accountId = `acct_${organisation.id}`;
    await prisma.organisation.update({ where: { id: organisation.id }, data: { stripeAccountId: accountId } });
    stripeMocks.retrieveAccount.mockResolvedValueOnce(v2Account(accountId));

    expect((await accountChanged(accountId, { type: "v2.core.account[configuration.merchant].capability_status_updated" })).status).toBe(200);
    expect(stripeMocks.retrieveAccount).toHaveBeenLastCalledWith(accountId, expect.objectContaining({ include: expect.arrayContaining(["requirements"]) }));
    expect(await prisma.organisation.findUniqueOrThrow({ where: { id: organisation.id } })).toMatchObject({ stripeAccountStatus: "READY", stripeChargesEnabled: true, stripePayoutsEnabled: true });

    // If Stripe can't answer, nothing changes and the error makes Stripe retry.
    stripeMocks.retrieveAccount.mockRejectedValueOnce(new Error("Stripe unavailable"));
    await expect(accountChanged(accountId)).rejects.toThrow("Stripe unavailable");
    expect((await prisma.organisation.findUniqueOrThrow({ where: { id: organisation.id } })).stripeChargesEnabled).toBe(true);

    // An account no society uses, another event type, a bad signature or the wrong mode change nothing.
    stripeMocks.retrieveAccount.mockClear();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect((await accountChanged("acct_not_ours")).status).toBe(200);
    expect((await accountChanged(accountId, { type: "v2.core.account_person.updated" })).status).toBe(200);
    expect((await accountChanged(accountId, { secret: "whsec_someone_else" })).status).toBe(400);
    expect(await (await accountChanged(accountId, { livemode: true })).json()).toEqual({ received: true, ignored: "mode_mismatch" });
    // v1 account.updated still reaches the Connect endpoint if it is subscribed; it is no longer read.
    expect((await signedConnectEvent({ id: unique("evt"), type: "account.updated", account: accountId, data: { object: { id: accountId, object: "account" } } })).status).toBe(200);
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
    const deadline = new Date(Date.UTC(2026, 11, 1)).toISOString();
    const account = (charges: boolean, due: string[] = [], current_deadline: string | null = null) =>
      v2Account(accountId, { card: charges ? "active" : "restricted", due, deadline: current_deadline });

    // A deadline while still selling: one notice per deadline, shown on Payments too.
    stripeMocks.retrieveAccount.mockResolvedValue(account(true, ["identity.individual.id_number"], deadline));
    await expect(getOrganisationStripeConnectStatus(organisation.id)).resolves.toMatchObject({ state: "READY", current_deadline: deadline });
    await accountChanged(accountId);
    expect(await notices("stripe-deadline/")).toEqual([{ recipient: user.email }]);

    // Stripe pauses card payments: the webhook sees it first, the refresh after it adds nothing.
    stripeMocks.retrieveAccount.mockResolvedValue(account(false, ["identity.individual.id_number"]));
    await accountChanged(accountId);
    await getOrganisationStripeConnectStatus(organisation.id);
    expect(await notices("stripe-charges-paused/")).toEqual([{ recipient: user.email }]);
    expect(alerts()).toEqual([expect.objectContaining({ organisationId: organisation.id, disabledReason: "requirements_past_due" })]);

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

  // SEC-034: two onboarding requests at once, the second reading after the first committed.
  test("two account creations at once link one account; the other is logged as an orphan", async () => {
    const { organisation, user } = await createOrganisationAccount();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    stripeMocks.createAccount.mockResolvedValueOnce({ id: "acct_race_first" }).mockResolvedValueOnce({ id: "acct_race_second" });
    const results = await Promise.all([createExpressAccount(organisation.id, user.id), createExpressAccount(organisation.id, user.id)]);
    const linked = (await prisma.organisation.findUniqueOrThrow({ where: { id: organisation.id } })).stripeAccountId;
    expect(results.map((result) => result.accountId)).toEqual([linked, linked]);
    expect(await prisma.auditLog.count({ where: { organisationId: organisation.id, action: "stripe_connect.account_created" } })).toBe(1);
    expect(warn.mock.calls.map(([line]) => String(line)).filter((line) => line.includes('"event":"stripe_connect.account_orphaned"'))).toHaveLength(1);
  });

  // SEC-035: two societies on one account would each hold back only their own money.
  test("one Stripe account can't be linked to two societies", async () => {
    const first = await createOrganisationAccount({ stripeReady: true });
    const second = await createOrganisationAccount();
    await expect(prisma.organisation.update({ where: { id: second.organisation.id }, data: { stripeAccountId: first.organisation.stripeAccountId } })).rejects.toMatchObject({ code: "P2002" });
  });

  // PAY-034: an account this platform can no longer reach stops selling, and the webhook stops retrying.
  test("an account Stripe no longer lets us reach is taken off sale and alerted once", async () => {
    const { organisation } = await createOrganisationAccount({ stripeReady: true });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    stripeMocks.retrieveAccount.mockRejectedValue(Object.assign(new Error("Permission denied. API Key does not have permission to access account acct_1T**********xMX2."), { type: "StripePermissionError", code: "forbidden" }));
    await expect(getOrganisationStripeConnectStatus(organisation.id)).resolves.toMatchObject({ state: "ERROR", charges_enabled: false, payouts_enabled: false });
    expect(await prisma.organisation.findUniqueOrThrow({ where: { id: organisation.id } })).toMatchObject({ stripeChargesEnabled: false, stripePayoutsEnabled: false, stripeAccountStatus: "ERROR" });
    expect((await accountChanged(organisation.stripeAccountId as string)).status).toBe(200);
    expect(error.mock.calls.map(([line]) => String(line)).filter((line) => line.includes('"event":"society_account_unreachable"'))).toHaveLength(1);
  });

  // PAY-041: payouts that worked and stopped.
  test("staff who manage Stripe hear when Stripe pauses payouts", async () => {
    const { organisation, user } = await createOrganisationAccount({ stripeReady: true });
    await prisma.organisation.update({ where: { id: organisation.id }, data: { stripePayoutsEnabled: true } });
    stripeMocks.retrieveAccount.mockResolvedValue(v2Account(organisation.stripeAccountId as string, { payouts: "restricted" }));
    await accountChanged(organisation.stripeAccountId as string);
    await accountChanged(organisation.stripeAccountId as string);
    expect(await prisma.notificationOutbox.findMany({ where: { organisationId: organisation.id, eventKey: { startsWith: "stripe-payouts-paused/" } }, select: { recipient: true } })).toEqual([{ recipient: user.email }]);
  });

  // SEC-037: each status read asks Stripe; the page no longer refreshes on every focus.
  test("the status endpoint is rate limited per society", async () => {
    const { organisation, user } = await createOrganisationAccount({ stripeReady: true });
    setRateLimitTestEnabled(true);
    setRateLimitTestBackend(createTestRateLimitBackend());
    try {
      setMockSession({ userId: user.id, email: user.email, accountRole: "organisation" });
      stripeMocks.retrieveAccount.mockResolvedValue(v2Account(organisation.stripeAccountId as string));
      const read = () => statusRoute(new Request(`http://localhost:3000/api/stripe/connect/status?organisationId=${organisation.id}`));
      const statuses: number[] = [];
      for (let n = 0; n < 31; n++) statuses.push((await read()).status);
      expect(statuses.slice(0, 30).every((status) => status === 200)).toBe(true);
      expect(statuses[30]).toBe(429);
    } finally {
      setRateLimitTestEnabled(null);
      setRateLimitTestBackend(null);
    }
  });
});
