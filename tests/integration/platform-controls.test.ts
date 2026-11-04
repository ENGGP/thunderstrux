import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST as adminAction } from "@/app/api/admin/actions/route";
import { proxy } from "@/proxy";
import { prisma } from "@/lib/db";
import { describe as describeEntry, readHistory } from "@/lib/audit/history";
import { publishPlan } from "@/lib/memberships/plans";
import { createCommerceCheckout } from "@/lib/commerce/checkout";
import { getPublishedEventDetail, getPublishedEvents, listingAvailability } from "@/lib/events/public-events";
import { setOrganisationEventPublication, setOrganisationEventSaleState } from "@/lib/events/event-lifecycle";
import { createEventCheckout } from "@/lib/payments/checkout-creation";
import { processPayoutBatch } from "@/lib/payouts/payouts";
import { changeAccount } from "@/lib/platform/accounts";
import { PlatformAccessError, PlatformRefusal, requirePlatformOperator } from "@/lib/platform/authority";
import { revokeOperatorFromWeb, runIntegrityAudit, setWorkerPaused } from "@/lib/platform/operations";
import { grantPlatformOperator, revokePlatformOperator } from "@/lib/platform/operators";
import { readNeeds } from "@/lib/platform/overview";
import { cancelRecovery, completeRecovery, readRecoveryRequest, recoveryDelayMs, requestRecovery } from "@/lib/platform/recovery";
import { changeSociety } from "@/lib/platform/societies";
import { createTestRateLimitBackend, setRateLimitTestBackend, setRateLimitTestEnabled } from "@/lib/security/rate-limit";
import { totpCode } from "@/lib/security/staff-mfa";
import { continueOrganisationStripeOnboarding, createOrganisationDashboardLink, disconnectAccount, startOrganisationStripeOnboarding, StripeDisconnectBlockedError } from "@/lib/stripe/connect";
import { setMockSession } from "@/tests/helpers/auth";
import { jsonRequest, parseJsonResponse } from "@/tests/helpers/http";
import { enrolStaffMfa } from "@/tests/helpers/mfa";
import { createEvent, createMember, createOrganisationAccount, createOrganisationStaff, unique } from "@/tests/helpers/test-data";

// T55: every change an operator makes. Each needs its permission, a fresh code
// and a reason, writes its trail row in the same transaction, and a refusal
// changes and records nothing.

vi.mock("next/navigation", () => ({
  redirect: (path: string) => { throw new Error(`REDIRECT:${path}`); },
  notFound: () => { throw new Error("NOT_FOUND"); }
}));
// Stripe is never reached by a refused change; a payout attempt fails inside the batch's own try.
vi.mock("@/lib/stripe", () => ({
  StripeConfigurationError: class StripeConfigurationError extends Error {},
  getAppUrl: () => "http://localhost:3000",
  isLiveStripeKey: () => false,
  getStripeWebhookSecret: () => "whsec_test",
  getStripe: () => ({})
}));
vi.mock("@/lib/commerce/families", async () => {
  const { z } = await vi.importActual<typeof import("zod")>("zod");
  return { commerceFamilies: { merchandise: {
    selection: z.object({ quantity: z.number().int() }).strict(), guests: false,
    quote: async () => ({ lines: [{ quantity: 1, unitAmount: 0, name: "Free sticker", variant: "One" }] }),
    lock: async () => undefined, fulfil: async () => ({ fulfilled: true })
  } } };
});

beforeEach(() => {
  vi.stubEnv("ADMIN_PORTAL_ENABLED", "true");
  // The admin process trusts its own sign-in origin (AUTH_URL), not the public app URL.
  vi.stubEnv("AUTH_URL", "http://localhost:3000");
  vi.stubEnv("RATE_LIMIT_ENABLED", "true");
  setRateLimitTestEnabled(true);
  setRateLimitTestBackend(createTestRateLimitBackend());
});
afterEach(() => { setRateLimitTestEnabled(null); setRateLimitTestBackend(null); });

// An enrolled operator and a clock whose every step has a fresh, single-use code.
async function operator(role: "admin" | "support" = "admin") {
  const user = await createMember();
  await grantPlatformOperator({ email: user.email, role, note: "Integration test operator", by: "cli:test" });
  const { secret } = await enrolStaffMfa(user);
  setMockSession({ userId: user.id, email: user.email, accountRole: "member" });
  const actor = await requirePlatformOperator("platform:monitor", new Date(), { freshCode: true });
  const base = Math.floor(Date.now() / 30_000);
  let steps = 0;
  let offset = 0;
  const next = (reason = "Integration test change") => {
    steps += 1;
    const now = new Date((base + steps) * 30_000 + offset + 1_000);
    return { now, input: { reason, code: totpCode(secret, Math.floor(now.getTime() / 30_000)) } };
  };
  return { user, actor, next, advance: (ms: number) => { offset += ms; } };
}

const trail = (action: string) => prisma.platformAuditLog.findMany({ where: { action } });
// The notices a recovery request sent, accepted by the provider (completion waits for them).
const deliver = () => prisma.notificationOutbox.updateMany({ where: { acceptedAt: null }, data: { status: "sent", acceptedAt: new Date() } });
const notices = (template: string) => prisma.notificationOutbox.findMany({ where: { template }, select: { recipient: true, privacy: true, organisationId: true } });

describe("every change needs the permission, a fresh code and a reason", () => {
  test("a wrong, replayed or missing code, or a short reason, is refused and changes and records nothing", async () => {
    const { actor, next } = await operator();
    const target = await createMember();
    const step = next();
    await expect(changeAccount(actor, "disable_account", target.id, { ...step.input, code: "000000" }, step.now)).rejects.toThrow("didn't work");
    await changeAccount(actor, "sign_out_everywhere", target.id, step.input, step.now);
    await expect(changeAccount(actor, "disable_account", target.id, step.input, step.now)).rejects.toThrow("already used");
    const later = next();
    await expect(changeAccount(actor, "disable_account", target.id, { ...later.input, code: "12" }, later.now)).rejects.toThrow("6-digit");
    await expect(changeAccount(actor, "disable_account", target.id, { ...later.input, reason: "short" }, later.now)).rejects.toThrow("8 to 500");
    expect((await prisma.user.findUniqueOrThrow({ where: { id: target.id } })).disabledAt).toBeNull();
    expect(await trail("platform.account_disabled")).toHaveLength(0);
    // The refused code wasn't used up: the same one still works for a change that applies.
    await changeAccount(actor, "disable_account", target.id, later.input, later.now);
    expect(await trail("platform.account_disabled")).toHaveLength(1);
  });

  test("support can assist but not disable; a revoked operator or a stale session is refused like a missing page", async () => {
    const support = await operator("support");
    const target = await createMember();
    await prisma.user.update({ where: { id: target.id }, data: { emailVerifiedAt: null } });
    const ok = support.next();
    await changeAccount(support.actor, "resend_verification", target.id, ok.input, ok.now);
    expect(await prisma.authToken.count({ where: { userId: target.id, purpose: "verify_account" } })).toBe(1);
    const no = support.next();
    await expect(changeAccount(support.actor, "disable_account", target.id, no.input, no.now)).rejects.toBeInstanceOf(PlatformAccessError);

    const admin = await operator();
    await prisma.user.update({ where: { id: admin.user.id }, data: { authVersion: { increment: 1 } } });
    const stale = admin.next();
    await expect(changeAccount(admin.actor, "sign_out_everywhere", target.id, stale.input, stale.now)).rejects.toBeInstanceOf(PlatformAccessError);
    const revoked = await operator();
    await revokePlatformOperator({ email: revoked.user.email, reason: "Integration test revoke", by: "cli:test" });
    const gone = revoked.next();
    await expect(changeAccount(revoked.actor, "sign_out_everywhere", target.id, gone.input, gone.now)).rejects.toBeInstanceOf(PlatformAccessError);
    expect(await trail("platform.signed_out_everywhere")).toHaveLength(0);
  });

  test("operators, yourself and closed accounts can't be changed from the portal", async () => {
    const { actor, next, user } = await operator();
    const other = await operator();
    const closed = await createMember();
    await prisma.user.update({ where: { id: closed.id }, data: { closedAt: new Date(), disabledAt: new Date() } });
    for (const [id, message] of [[user.id, "your own"], [other.user.id, "pnpm ops:operator"], [closed.id, "Closed accounts"]] as const) {
      const step = next();
      await expect(changeAccount(actor, "disable_account", id, step.input, step.now)).rejects.toThrow(message);
    }
  });
});

describe("account changes", () => {
  test("disable signs out, tells the person and each society they staff, and re-enable undoes it; all in one transaction with the trail", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { actor, next } = await operator();
    const { organisation } = await createOrganisationAccount();
    const person = await createMember();
    await createOrganisationStaff({ organisationId: organisation.id, userId: person.id, role: "finance_manager" });
    await prisma.mfaGrant.create({ data: { sessionDigest: unique("digest"), userId: person.id, verifiedAt: new Date(), expiresAt: new Date(Date.now() + 3_600_000) } });
    const step = next("Account reported compromised: ticket 42");
    await changeAccount(actor, "disable_account", person.id, step.input, step.now);
    const disabled = await prisma.user.findUniqueOrThrow({ where: { id: person.id } });
    expect(disabled.disabledAt).toEqual(step.now);
    expect(disabled.authVersion).toBe(1);
    expect(await prisma.mfaGrant.count({ where: { userId: person.id } })).toBe(0);
    expect(await prisma.accountSecurityEvent.findMany({ where: { userId: person.id }, select: { type: true } })).toEqual([{ type: "support_disabled" }]);
    expect(await notices("account_disabled")).toEqual([{ recipient: person.email, privacy: "security", organisationId: null }]);
    const [history] = await prisma.auditLog.findMany({ where: { organisationId: organisation.id, action: "platform.member_disabled" } });
    expect(history).toMatchObject({ actorUserId: null, targetId: person.id });
    const [row] = await trail("platform.account_disabled");
    expect(row).toMatchObject({ actorUserId: actor.user.id, operatorRole: "admin", targetType: "User", targetId: person.id, reason: "Account reported compromised: ticket 42" });
    expect(error.mock.calls.map(([line]) => JSON.parse(String(line))).find((entry) => entry.event === "platform_admin_action"))
      .toMatchObject({ action: "platform.account_disabled", targetId: person.id, operatorUserId: actor.user.id });

    // Society History names support, never the operator.
    const entry = describeEntry({ ...history, actor: null }, { events: new Map(), orders: new Map(), commerce: new Map(), grants: new Map(), plans: new Map(), products: new Map(), staff: new Map(), invites: new Map(), tickets: new Map(), ticketTypes: new Map(), assets: new Map() }, "Australia/Brisbane");
    expect(entry.actor.name).toBe("Thunderstrux support");
    expect(entry.sentence.join("")).toContain("Test Member's account");

    const again = next();
    await expect(changeAccount(actor, "disable_account", person.id, again.input, again.now)).rejects.toThrow("already disabled");
    await changeAccount(actor, "enable_account", person.id, again.input, again.now);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: person.id } })).disabledAt).toBeNull();
    expect(await prisma.auditLog.count({ where: { organisationId: organisation.id, action: "platform.member_reenabled" } })).toBe(1);
    expect(await notices("account_reenabled")).toHaveLength(1);
  });

  test("password reset and sign out everywhere", async () => {
    const { actor, next } = await operator();
    const person = await createMember();
    const reset = next();
    await changeAccount(actor, "send_password_reset", person.id, reset.input, reset.now);
    expect(await prisma.authToken.count({ where: { userId: person.id, purpose: "reset_password" } })).toBe(1);
    const verify = next();
    await expect(changeAccount(actor, "resend_verification", person.id, verify.input, verify.now)).rejects.toThrow("already verified");
    await changeAccount(actor, "sign_out_everywhere", person.id, verify.input, verify.now);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: person.id } })).authVersion).toBe(1);
    expect(await notices("account_signed_out_by_support")).toHaveLength(1);
    expect((await trail("platform.password_reset_sent")).length + (await trail("platform.signed_out_everywhere")).length).toBe(2);
  });
});

describe("restricting a society and holding its payouts", () => {
  test("restriction stops every checkout family, publishing, reopening, listings, Connect changes and payouts; lifting restores them", async () => {
    const { actor, next } = await operator();
    const owner = await createOrganisationAccount({ stripeReady: true });
    const event = await createEvent({ organisationId: owner.organisation.id, status: "published", ticketTypes: [{ name: "Free entry", price: 0, quantity: 10 }] });
    const draft = await createEvent({ organisationId: owner.organisation.id, status: "draft", ticketTypes: [{ name: "Free entry", price: 0, quantity: 10 }] });
    const step = next("Suspected scam event: report 7");
    await changeSociety(actor, "restrict_society", owner.organisation.id, step.input, step.now);
    expect(await prisma.auditLog.count({ where: { organisationId: owner.organisation.id, action: "platform.society_restricted", actorUserId: null } })).toBe(1);
    expect(await notices("society_restricted")).toEqual([{ recipient: owner.user.email, privacy: "business", organisationId: owner.organisation.id }]);

    const buyer = await createMember();
    setMockSession({ userId: buyer.id, email: buyer.email, accountRole: "member" });
    await expect(createEventCheckout({ userId: buyer.id, eventId: event.id, ticketTypeId: event.ticketTypes[0].id, quantity: 1, expectedUnitPrice: 0, idempotencyKey: unique("key-0000") }))
      .rejects.toMatchObject({ kind: "sales_closed" });
    await expect(createCommerceCheckout({ family: "merchandise", organisationId: owner.organisation.id, buyer: { userId: buyer.id }, selection: { quantity: 1 }, expectedTotal: 0, idempotencyKey: unique("commerce-key-0000") }))
      .rejects.toMatchObject({ kind: "unavailable" });
    expect(await prisma.order.count({ where: { eventId: event.id } })).toBe(0);
    await expect(setOrganisationEventPublication(owner.organisation.id, draft.id, { targetStatus: "published", version: draft.version })).rejects.toThrow("not ready to publish");
    // Closing sales still works; reopening them doesn't.
    const other = await createEvent({ organisationId: owner.organisation.id, status: "published", ticketTypes: [{ name: "Free entry", price: 0, quantity: 10 }] });
    await setOrganisationEventSaleState(owner.organisation.id, other.id, { saleState: "closed", version: other.version });
    await expect(setOrganisationEventSaleState(owner.organisation.id, other.id, { saleState: "open", version: other.version + 1 })).rejects.toThrow("restricted");
    expect((await getPublishedEvents()).events.map((row) => row.id)).not.toContain(event.id);
    expect((await listingAvailability([event.id])).get(event.id)).toEqual({ state: "sales_closed" });
    expect((await getPublishedEventDetail(event.id))?.salesOpen).toBe(false);
    await expect(createOrganisationDashboardLink(owner.organisation.id, { actor: { id: owner.user.id } })).rejects.toThrow("restricted");
    // Onboarding collects the payout bank account, so it stops too.
    await expect(startOrganisationStripeOnboarding(owner.organisation.id, { actor: { id: owner.user.id } })).rejects.toThrow("restricted");
    await expect(continueOrganisationStripeOnboarding(owner.organisation.id, { actor: { id: owner.user.id } })).rejects.toThrow("restricted");
    await expect(disconnectAccount(owner.organisation.id, { actor: { id: owner.user.id } })).rejects.toBeInstanceOf(StripeDisconnectBlockedError);
    expect((await prisma.organisation.findUniqueOrThrow({ where: { id: owner.organisation.id } })).stripeAccountId).not.toBeNull();
    expect(await processPayoutBatch(25, step.now)).toEqual({ processed: 0, results: [] });
    const plan = await prisma.membershipProduct.create({ data: { organisationId: owner.organisation.id, name: "2027 membership", priceAmount: 0, startsAt: new Date(), endsAt: new Date(Date.now() + 100 * 86_400_000), entitlements: ["member_prices"] } });
    await expect(publishPlan({ id: owner.user.id, authVersion: 0 }, owner.organisation.id, plan.id, { expectedVersion: plan.version })).rejects.toThrow("restricted");
    // History tells it as Thunderstrux support, under the Thunderstrux filter too.
    expect((await readHistory(owner.organisation.id, { who: "thunderstrux" }, "Australia/Brisbane")).entries.map((entry) => entry.actor.name)).toContain("Thunderstrux support");

    const lift = next();
    await changeSociety(actor, "lift_restriction", owner.organisation.id, lift.input, lift.now);
    expect((await getPublishedEvents()).events.map((row) => row.id)).toContain(event.id);
    await expect(createEventCheckout({ userId: buyer.id, eventId: event.id, ticketTypeId: event.ticketTypes[0].id, quantity: 1, expectedUnitPrice: 0, idempotencyKey: unique("key-0001") }))
      .resolves.toMatchObject({ status: "fulfilled" });
    expect(await prisma.auditLog.count({ where: { organisationId: owner.organisation.id, action: "platform.society_unrestricted" } })).toBe(1);
  });

  test("a payout hold stops payouts until its end date or a release, and a past end date pays again", async () => {
    const { actor, next } = await operator();
    const owner = await createOrganisationAccount({ stripeReady: true });
    const step = next("Dispute or fraud under review");
    await expect(changeSociety(actor, "hold_payouts", owner.organisation.id, { ...step.input, heldUntil: new Date(step.now.getTime() - 1000) }, step.now)).rejects.toThrow("future");
    await changeSociety(actor, "hold_payouts", owner.organisation.id, { ...step.input, heldUntil: new Date(step.now.getTime() + 86_400_000) }, step.now);
    expect(await processPayoutBatch(25, step.now)).toEqual({ processed: 0, results: [] });
    // PAY-070, PAY-071: the society can't route the held money out through Stripe either.
    await expect(disconnectAccount(owner.organisation.id, { actor: { id: owner.user.id } })).rejects.toThrow("holding this society's payouts");
    await expect(createOrganisationDashboardLink(owner.organisation.id, { actor: { id: owner.user.id } })).rejects.toThrow("holding this society's payouts");
    // After the end date, the worker takes it again (its Stripe call fails inside the batch here).
    expect((await processPayoutBatch(25, new Date(step.now.getTime() + 2 * 86_400_000))).processed).toBe(1);
    const release = next();
    await changeSociety(actor, "release_payouts", owner.organisation.id, release.input, release.now);
    const again = next();
    await expect(changeSociety(actor, "release_payouts", owner.organisation.id, again.input, again.now)).rejects.toThrow("aren't held");
    expect((await prisma.organisation.findUniqueOrThrow({ where: { id: owner.organisation.id } })).payoutsHeldAt).toBeNull();
    expect(await prisma.auditLog.count({ where: { organisationId: owner.organisation.id, action: { in: ["platform.payouts_held", "platform.payouts_released"] } } })).toBe(2);
  });
});

describe("delayed recovery", () => {
  test("an authenticator reset tells the person and their co-owners, waits 72 hours, then removes the authenticator", async () => {
    const { actor, next, advance } = await operator();
    const owner = await createOrganisationAccount();
    const coOwner = await createMember();
    await createOrganisationStaff({ organisationId: owner.organisation.id, userId: coOwner.id, role: "admin" });
    await enrolStaffMfa(owner.user, "target-session");
    const step = next("Lost their phone; support email 3 Nov");
    const { requestId } = await requestRecovery(actor, { ...step.input, kind: "mfa_reset", userId: owner.user.id, evidence: "Wrote from the account's own address" }, step.now);
    expect((await notices("mfa_reset_requested")).map((row) => row.recipient).sort()).toEqual([owner.user.email, coOwner.email].sort());
    const twice = next();
    await expect(requestRecovery(actor, { ...twice.input, kind: "mfa_reset", userId: owner.user.id, evidence: "Wrote from the account's own address" }, twice.now)).rejects.toThrow("already open");

    const early = next();
    await expect(completeRecovery(actor, requestId, early.input, early.now)).rejects.toThrow("Not ready yet");
    expect(await prisma.userMfa.count({ where: { userId: owner.user.id } })).toBe(1);
    advance(recoveryDelayMs);
    const ready = next();
    expect((await readNeeds(ready.now)).find((need) => need.href === `/admin/recovery/${requestId}`)).toMatchObject({ level: "hot", title: "Recovery ready to complete" });
    // Nobody heard yet: the 72 hours protect only people who were told (#42).
    await expect(completeRecovery(actor, requestId, ready.input, ready.now)).rejects.toThrow("everyone it names has been told");
    await deliver();
    await completeRecovery(actor, requestId, ready.input, ready.now);
    expect(await prisma.userMfa.count({ where: { userId: owner.user.id } })).toBe(0);
    expect(await prisma.mfaRecoveryCode.count({ where: { userId: owner.user.id } })).toBe(0);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: owner.user.id } })).authVersion).toBe(1);
    expect(await notices("mfa_reset_completed")).toHaveLength(2);
    const after = next();
    await expect(completeRecovery(actor, requestId, after.input, after.now)).rejects.toThrow("already completed");
    expect((await trail("platform.mfa_reset_completed"))[0]).toMatchObject({ targetType: "Recovery", targetId: requestId });
  });

  test("a request completed after its target changed, or after a cancel, is refused", async () => {
    const { actor, next, advance } = await operator();
    const owner = await createOrganisationAccount();
    await enrolStaffMfa(owner.user, "target-session");
    const step = next();
    const { requestId } = await requestRecovery(actor, { ...step.input, kind: "mfa_reset", userId: owner.user.id, evidence: "Showed ID on a call" }, step.now);
    advance(recoveryDelayMs);
    await prisma.user.update({ where: { id: owner.user.id }, data: { disabledAt: new Date() } });
    const changed = next();
    await expect(completeRecovery(actor, requestId, changed.input, changed.now)).rejects.toThrow("changed since it was made");
    expect((await readRecoveryRequest(requestId))?.checks.map((check) => check.ok)).toEqual([false, true, true, true, true, false]);
    const cancel = next("Someone objected");
    await cancelRecovery(actor, requestId, cancel.input, cancel.now);
    expect(await notices("recovery_cancelled")).toHaveLength(1);
    await prisma.user.update({ where: { id: owner.user.id }, data: { disabledAt: null } });
    const late = next();
    await expect(completeRecovery(actor, requestId, late.input, late.now)).rejects.toThrow("already cancelled");
    expect(await prisma.userMfa.count({ where: { userId: owner.user.id } })).toBe(1);
  });

  test("ownership recovery promotes an existing verified account after 72 hours and holds payouts 7 days", async () => {
    const { actor, next, advance } = await operator();
    const owner = await createOrganisationAccount({ stripeReady: true });
    await prisma.organisation.update({ where: { id: owner.organisation.id }, data: { supportEmail: "club@example.com" } });
    const helper = await createMember();
    await createOrganisationStaff({ organisationId: owner.organisation.id, userId: helper.id, role: "event_manager" });
    const president = await createMember();
    const unverified = await createMember();
    await prisma.user.update({ where: { id: unverified.id }, data: { emailVerifiedAt: null } });
    const bad = next();
    await expect(requestRecovery(actor, { ...bad.input, kind: "ownership", userId: unverified.id, organisationId: owner.organisation.id, evidence: "Club register lists them" }, bad.now)).rejects.toThrow("verified, enabled");

    const step = next("Owner graduated; new president asked");
    const { requestId } = await requestRecovery(actor, { ...step.input, kind: "ownership", userId: president.id, organisationId: owner.organisation.id, evidence: "Club register lists them" }, step.now);
    expect((await notices("ownership_recovery_requested")).map((row) => row.recipient).sort()).toEqual([owner.user.email, helper.email, "club@example.com", president.email].sort());
    expect(await prisma.auditLog.count({ where: { organisationId: owner.organisation.id, action: "platform.ownership_recovery_requested" } })).toBe(1);
    const other = await createMember();
    const second = next();
    await expect(requestRecovery(actor, { ...second.input, kind: "ownership", userId: other.id, organisationId: owner.organisation.id, evidence: "Club register lists them" }, second.now)).rejects.toThrow("already open");

    advance(recoveryDelayMs);
    await deliver();
    const ready = next();
    await completeRecovery(actor, requestId, ready.input, ready.now);
    expect(await prisma.organisationStaff.findUnique({ where: { organisationId_userId: { organisationId: owner.organisation.id, userId: president.id } }, select: { role: true, status: true } }))
      .toEqual({ role: "owner", status: "active" });
    // Nobody else's role changed.
    expect(await prisma.organisationStaff.count({ where: { organisationId: owner.organisation.id, status: "active" } })).toBe(3);
    const society = await prisma.organisation.findUniqueOrThrow({ where: { id: owner.organisation.id } });
    expect(society.payoutsHeldUntil).toEqual(new Date(ready.now.getTime() + 7 * 86_400_000));
    expect(await processPayoutBatch(25, ready.now)).toEqual({ processed: 0, results: [] });
    expect(await prisma.auditLog.count({ where: { organisationId: owner.organisation.id, action: "platform.ownership_recovered" } })).toBe(1);
    expect(await notices("ownership_recovered")).toHaveLength(4);
  });
});

describe("recovery needs its requester's standing", () => {
  test("a request can't be completed once its operator was revoked, demoted or disabled; it can still be cancelled (SEC-047)", async () => {
    const asker = await operator();
    const completer = await operator();
    const owner = await createOrganisationAccount();
    await enrolStaffMfa(owner.user, "target-session");
    const step = asker.next();
    const { requestId } = await requestRecovery(asker.actor, { ...step.input, kind: "mfa_reset", userId: owner.user.id, evidence: "Wrote from the account's own address" }, step.now);
    await deliver();
    completer.advance(recoveryDelayMs);
    await revokePlatformOperator({ email: asker.user.email, reason: "Integration test revoke", by: "cli:test" });
    const revoked = completer.next();
    await expect(completeRecovery(completer.actor, requestId, revoked.input, revoked.now)).rejects.toThrow("can no longer do recoveries");
    expect((await readRecoveryRequest(requestId))?.checks.map((check) => check.ok)).toEqual([true, true, true, true, false, true]);
    await grantPlatformOperator({ email: asker.user.email, role: "support", note: "Back as support only", by: "cli:test" });
    const demoted = completer.next();
    await expect(completeRecovery(completer.actor, requestId, demoted.input, demoted.now)).rejects.toThrow("can no longer do recoveries");
    await grantPlatformOperator({ email: asker.user.email, role: "admin", note: "Back as an admin again", by: "cli:test" });
    await prisma.user.update({ where: { id: asker.user.id }, data: { disabledAt: new Date() } });
    const disabled = completer.next();
    await expect(completeRecovery(completer.actor, requestId, disabled.input, disabled.now)).rejects.toThrow("can no longer do recoveries");
    expect(await prisma.userMfa.count({ where: { userId: owner.user.id } })).toBe(1);
    const cancel = completer.next("The asker left the support team");
    await cancelRecovery(completer.actor, requestId, cancel.input, cancel.now);
    expect((await prisma.platformRecoveryRequest.findUniqueOrThrow({ where: { id: requestId } })).status).toBe("cancelled");
  });

  test("an authenticator reset on any staff member tells their society's owners and admins (#43)", async () => {
    const { actor, next } = await operator();
    const owner = await createOrganisationAccount();
    const manager = await createMember();
    await createOrganisationStaff({ organisationId: owner.organisation.id, userId: manager.id, role: "event_manager" });
    await enrolStaffMfa(manager, "target-session");
    const step = next();
    await requestRecovery(actor, { ...step.input, kind: "mfa_reset", userId: manager.id, evidence: "Wrote from the account's own address" }, step.now);
    expect((await notices("mfa_reset_requested")).map((row) => row.recipient).sort()).toEqual([manager.email, owner.user.email].sort());
  });
});

describe("operators and operations", () => {
  test("the web revokes another operator, never itself; a revoked admin can't revoke back, so one admin always remains", async () => {
    const first = await operator();
    const support = await operator("support");
    const self = first.next();
    await expect(revokeOperatorFromWeb(first.actor, first.user.id, self.input, self.now)).rejects.toBeInstanceOf(PlatformRefusal);
    const ok = first.next();
    await revokeOperatorFromWeb(first.actor, support.user.id, ok.input, ok.now);
    expect((await prisma.platformOperator.findUniqueOrThrow({ where: { userId: support.user.id } })).revokedByUserId).toBe(first.user.id);
    expect(await trail("platform.operator_revoked")).toHaveLength(1);
    const second = await operator();
    const out = second.next();
    await revokeOperatorFromWeb(second.actor, first.user.id, out.input, out.now);
    // The revoked admin's authority is read live under lock, so it can't take the last admin with it.
    const back = first.next();
    await expect(revokeOperatorFromWeb(first.actor, second.user.id, back.input, back.now)).rejects.toBeInstanceOf(PlatformAccessError);
    expect(await prisma.platformOperator.count({ where: { status: "active", role: "admin" } })).toBe(1);
  });

  test("pause and resume a worker, and run the integrity audit; each leaves its trail row", async () => {
    const { actor, next } = await operator();
    const pause = next("Deploying e15cb90");
    await setWorkerPaused(actor, "refunds", true, pause.input, pause.now);
    expect(await prisma.workerLease.findUniqueOrThrow({ where: { name: "refunds" } })).toMatchObject({ pauseReason: "Deploying e15cb90" });
    const twice = next();
    await expect(setWorkerPaused(actor, "refunds", true, twice.input, twice.now)).rejects.toThrow("already paused");
    await expect(setWorkerPaused(actor, "nope", true, twice.input, twice.now)).rejects.toThrow("Name a job");
    await setWorkerPaused(actor, "refunds", false, twice.input, twice.now);
    expect((await prisma.workerLease.findUniqueOrThrow({ where: { name: "refunds" } })).pausedAt).toBeNull();
    const audit = next();
    const { checks } = await runIntegrityAudit(actor, audit.input, audit.now);
    expect(checks.length).toBeGreaterThan(10);
    expect(((await trail("platform.integrity_audit_run"))[0].metadata as { checks: unknown[] }).checks).toHaveLength(checks.length);
  });
});

describe("the admin API", () => {
  test("/api/admin answers 404 outside admin mode and to a foreign host", async () => {
    vi.stubEnv("AUTH_URL", "http://localhost:3091");
    vi.stubEnv("ADMIN_PORTAL_ENABLED", undefined);
    expect((await proxy(new NextRequest("http://localhost:3091/api/admin/actions", { method: "POST" }))).status).toBe(404);
    vi.stubEnv("ADMIN_PORTAL_ENABLED", "true");
    expect((await proxy(new NextRequest("http://localhost:3091/api/admin/actions", { method: "POST", headers: { host: "evil.example:3091" } }))).status).toBe(404);
    // No sign-in redirect for the API: the route answers for itself.
    expect((await proxy(new NextRequest("http://localhost:3091/api/admin/actions", { method: "POST", headers: { host: "localhost:3091" } }))).status).toBe(200);
  });

  test("a non-operator gets 404, a foreign origin 403, and an operator's change goes through with its code", async () => {
    const member = await createMember();
    setMockSession({ userId: member.id, email: member.email, accountRole: "member" });
    const body = { action: "sign_out_everywhere", targetId: member.id, reason: "Integration test change", code: "123456" };
    expect((await adminAction(jsonRequest("http://localhost:3000/api/admin/actions", body))).status).toBe(404);
    expect((await adminAction(jsonRequest("http://localhost:3000/api/admin/actions", body, { headers: { origin: "https://evil.example" } }))).status).toBe(403);
    // The public site's own origin isn't trusted by the admin process either (#11).
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example");
    expect((await adminAction(jsonRequest("http://localhost:3000/api/admin/actions", body, { headers: { origin: "https://app.example" } }))).status).toBe(403);
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");

    const user = await createMember();
    await grantPlatformOperator({ email: user.email, role: "support", note: "Integration test operator", by: "cli:test" });
    const mfa = await enrolStaffMfa(user);
    setMockSession({ userId: user.id, email: user.email, accountRole: "member" });
    const refused = await adminAction(jsonRequest("http://localhost:3000/api/admin/actions", { ...body, code: "000000" }));
    expect(refused.status).toBe(409);
    expect((await parseJsonResponse(refused)).error.message).toContain("didn't work");
    const done = await adminAction(jsonRequest("http://localhost:3000/api/admin/actions", { ...body, code: mfa.code(1) }));
    expect(done.status).toBe(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: member.id } })).authVersion).toBe(1);
    // Support lacks the permission: the same 404.
    expect((await adminAction(jsonRequest("http://localhost:3000/api/admin/actions", { ...body, action: "disable_account", code: mfa.code(2) }))).status).toBe(404);
  });
});
