import { readStaffInviteToken } from "@/tests/helpers/staff-invites";
import { beforeEach, afterEach, test, expect, vi } from "vitest";
import { compare } from "bcryptjs";
import { prisma } from "@/lib/db";
import { closeAccount, readAccountClosureEligibility, closureAcknowledgement } from "@/lib/auth/account-closure";
import { requestPasswordReset, signupAccount, lockVerifiedAccount } from "@/lib/auth/account-lifecycle";
import { getSessionIdentity } from "@/lib/auth/session-identity";
import { requireAuthenticatedUser } from "@/lib/auth/access";
import { readAccountSettings } from "@/lib/auth/account-settings";
import { createMember, createOrganisationAccount, createUser, createEvent, createOrder, createOrganisationStaff, joinOrganisation } from "@/tests/helpers/test-data";
import { createOrganisationStaffInvite, acceptOrganisationStaffInvite } from "@/lib/staff/invites";
import { updateOrganisationStaff } from "@/lib/staff/management";
import { getOrganisationOrderDetail } from "@/lib/orders/order-detail";
import { getGroupedOrganisationOrdersWithContext } from "@/lib/orders/grouped-orders";
import { getOrganisationEventTickets } from "@/lib/tickets/check-in";
import { loadTicketDeliveryOrder, renderTicketEmail } from "@/lib/email/ticket-delivery";
import { reconcileCompletedCheckoutSession } from "@/lib/payments/checkout-reconciliation";
import { checkoutSession } from "@/tests/helpers/stripe-mocks";
import { mfaGrantDigest } from "@/lib/security/csrf";
import { beginStaffMfaEnrollment, confirmStaffMfaEnrollment, verifyStaffMfa, totpCode } from "@/lib/security/staff-mfa";
import * as notifications from "@/lib/email/notification-outbox";
import { decryptNotification } from "@/lib/email/notification-crypto";
import { setMockSession } from "@/tests/helpers/auth";
import { jsonRequest } from "@/tests/helpers/http";
import { GET, POST } from "@/app/api/me/account/closure/route";
import { POST as join } from "@/app/api/orgs/[orgSlug]/join/route";
import { POST as bootstrap } from "@/app/api/orgs/route";
import { createEventCheckout } from "@/lib/payments/checkout-creation";
import { createTestRateLimitBackend, setRateLimitTestBackend, setRateLimitTestEnabled, setRateLimitTestBackendFailure } from "@/lib/security/rate-limit";
const stripe = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@/lib/stripe", () => ({ StripeConfigurationError: class extends Error {}, getAppUrl: () => "http://localhost:3000", getStripe: () => ({ checkout: { sessions: { create: stripe.create } } }) }));
beforeEach(() => { setRateLimitTestEnabled(true); setRateLimitTestBackend(createTestRateLimitBackend()); setRateLimitTestBackendFailure(null); });
afterEach(() => { setRateLimitTestEnabled(null); setRateLimitTestBackend(null); setRateLimitTestBackendFailure(null); });
const actorFor = (user: { id: string; authVersion: number }) => ({ id: user.id, authVersion: user.authVersion });
const close = (user: { id: string; authVersion: number }) => closeAccount(actorFor(user), "password123", closureAcknowledgement);
async function purchase(userId: string, status: "pending" | "paid" | "expired" = "pending", unitPrice = 1200) {
  const society = await createOrganisationAccount({ stripeReady: true }); const event = await createEvent({ organisationId: society.organisation.id, status: "published" });
  const order = await createOrder({ organisationId: society.organisation.id, eventId: event.id, ticketTypeId: event.ticketTypes[0].id, userId, status, unitPrice, paidAt: status === "paid" ? new Date() : undefined });
  if (status === "paid" && unitPrice > 0) await prisma.event.update({ where: { id: event.id }, data: { startTime: new Date(0), endTime: new Date(1000) } });
  return { ...society, event, order };
}
test("ownership blocks closure even with another owner or legacy access denied", async () => {
  vi.stubEnv("LEGACY_ORGANISATION_ACCESS_MODE", "deny");
  const society = await createOrganisationAccount(); const other = await createMember();
  await createOrganisationStaff({ organisationId: society.organisation.id, userId: other.id, role: "owner" });
  await expect(close(society.user)).rejects.toMatchObject({ kind: "blocked" });
  await expect(close(other)).rejects.toMatchObject({ kind: "blocked" });
  await prisma.organisationStaff.updateMany({ where: { userId: society.user.id }, data: { status: "revoked" } });
  expect((await readAccountClosureEligibility(actorFor(society.user))).eligible).toBe(false);
  await prisma.organisation.update({ where: { id: society.organisation.id }, data: { accountUserId: other.id } });
  await close(society.user);
});
test("pending, unresolved compensation and upcoming paid purchases block; manual refund markers do not bypass", async () => {
  const user = await createMember(); const { order, event } = await purchase(user.id);
  await expect(close(user)).rejects.toMatchObject({ kind: "blocked" });
  await prisma.order.update({ where: { id: order.id }, data: { status: "paid", paidAt: new Date(), isManuallyRefunded: true } });
  expect((await readAccountClosureEligibility(actorFor(user))).blockers.join(" ")).toContain("upcoming paid");
  await prisma.event.update({ where: { id: event.id }, data: { startTime: new Date(0), endTime: new Date(1000) } });
  await prisma.order.update({ where: { id: order.id }, data: { requiresCompensationReview: true } });
  await expect(close(user)).rejects.toMatchObject({ kind: "blocked" });
  await prisma.order.update({ where: { id: order.id }, data: { requiresCompensationReview: false } });
  const job = await prisma.compensationRefundJob.create({ data: { orderId: order.id, amount: 1200, state: "review_required" } });
  await expect(close(user)).rejects.toMatchObject({ kind: "blocked" });
  await prisma.compensationRefundJob.update({ where: { id: job.id }, data: { state: "refunded", resolvedAt: new Date() } });
  await close(user);
});
test("closure anonymises profile, revokes credentials/staff/joins and tokens, retains business records and private notice", async () => {
  const user = await createMember(); const { order, event, organisation, user: owner } = await purchase(user.id, "paid");
  await prisma.user.update({ where: { id: user.id }, data: { displayName: "Retained buyer", phone: "123", studentNumber: "456" } });
  await joinOrganisation(user.id, organisation.id); await createOrganisationStaff({ organisationId: organisation.id, userId: user.id });
  const invite = await createOrganisationStaffInvite({ organisationId: organisation.id, actor: { id: owner.id, authVersion: owner.authVersion }, email: user.email, role: "admin" });
  const ticket = await prisma.ticket.create({ data: { orderId: order.id, eventId: event.id, ticketTypeId: event.ticketTypes[0].id, organisationId: organisation.id, checkedInAt: new Date() } });
  await prisma.mfaGrant.create({ data: { userId: user.id, sessionDigest: "discard", verifiedAt: new Date(), expiresAt: new Date(Date.now() + 60000) } });
  await requestPasswordReset(user.email); const queued = await prisma.notificationOutbox.findFirstOrThrow({ where: { userId: user.id, authTokenId: { not: null } } });
  await close(user); const closed = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  expect(closed).toMatchObject({ authVersion: 1, firstName: null, lastName: null, displayName: null, phone: null, studentNumber: null, emailVerifiedAt: null, onboardingCompletedAt: null });
  expect(closed.email).toMatch(/@closed\.invalid$/); expect(closed.closedAt).not.toBeNull(); expect(closed.disabledAt).not.toBeNull(); expect(await compare("password123", closed.password)).toBe(false);
  expect(await prisma.authToken.count({ where: { userId: user.id } })).toBe(0); expect(await prisma.mfaGrant.count({ where: { userId: user.id } })).toBe(0);
  expect(await prisma.organisationMember.count({ where: { userId: user.id } })).toBe(0); expect(await prisma.organisationStaff.count({ where: { userId: user.id, status: "active" } })).toBe(0);
  expect((await prisma.organisationStaffInvite.findUniqueOrThrow({ where: { id: invite.invite.id } })).revokedAt).not.toBeNull();
  expect(await prisma.notificationOutbox.count({ where: { staffInviteId: invite.invite.id, status: "cancelled" } })).toBe(1);
  expect((await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).checkedInAt).not.toBeNull();
  expect((await prisma.notificationOutbox.findUniqueOrThrow({ where: { id: queued.id } })).status).toBe("cancelled");
  const retained = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
  expect(retained).toMatchObject({ userId: user.id, buyerEmailSnapshot: user.email, buyerDisplayNameSnapshot: "Retained buyer", buyerIdentityProvenance: "current_account_at_capture" });
  const notice = await prisma.notificationOutbox.findFirstOrThrow({ where: { userId: user.id, template: "account_closed" } });
  expect(notice.recipient).toBe(user.email); expect(notice.organisationId).toBeNull(); expect(notice.privacy).toBe("security");
  expect(JSON.stringify(decryptNotification(notice.encryptedPayload, notice.id))).toContain("retained");
});
test("parallel closure commits once and database constraints prevent reopening or rewriting buyer identity", async () => {
  const user = await createMember(); const { order } = await purchase(user.id, "expired");
  const outcomes = await Promise.allSettled([close(user), close(user)]); expect(outcomes.filter(result => result.status === "fulfilled")).toHaveLength(1);
  expect(await prisma.accountSecurityEvent.count({ where: { userId: user.id, type: "account_closed" } })).toBe(1);
  expect(await prisma.notificationOutbox.count({ where: { userId: user.id, template: "account_closed" } })).toBe(1);
  for (const data of [{ closedAt: null }, { disabledAt: null }, { closedAt: new Date(0) }]) await expect(prisma.user.update({ where: { id: user.id }, data })).rejects.toThrow();
  await expect(prisma.order.update({ where: { id: order.id }, data: { buyerEmailSnapshot: "rewritten@example.com" } })).rejects.toThrow();
});
test("password, enrolled MFA even in off mode, explicit acknowledgement and stale version are mandatory", async () => {
  vi.stubEnv("MFA_ENFORCEMENT_MODE", "off"); const user = await createMember(); const actor = { ...actorFor(user), mfaSessionId: "enrolled-login" };
  await expect(closeAccount(actor, "password123", "yes")).rejects.toMatchObject({ kind: "acknowledgement" });
  await expect(closeAccount(actor, "wrong", closureAcknowledgement)).rejects.toMatchObject({ kind: "invalid_password" });
  await prisma.userMfa.create({ data: { userId: user.id, enabledAt: new Date(), encryptedSecret: "discard-secret" } });
  await prisma.mfaRecoveryCode.create({ data: { userId: user.id, codeHash: "discard-code" } });
  await expect(closeAccount(actor, "password123", closureAcknowledgement)).rejects.toMatchObject({ kind: "mfa_required" });
  await prisma.mfaGrant.create({ data: { userId: user.id, sessionDigest: mfaGrantDigest(actor.mfaSessionId)!, verifiedAt: new Date(), expiresAt: new Date(Date.now() + 60000) } });
  await closeAccount(actor, "password123", closureAcknowledgement);
  expect(await prisma.userMfa.count({ where: { userId: user.id } })).toBe(0); expect(await prisma.mfaRecoveryCode.count({ where: { userId: user.id } })).toBe(0);
  await expect(close(user)).rejects.toMatchObject({ kind: "stale_session" });
});
test("enqueue failure rolls back anonymisation, snapshots, joins, staff, MFA and token cancellation", async () => {
  const user = await createMember(); const { order, organisation } = await purchase(user.id, "expired");
  await joinOrganisation(user.id, organisation.id); await createOrganisationStaff({ organisationId: organisation.id, userId: user.id }); await requestPasswordReset(user.email);
  const original = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  await prisma.userMfa.create({ data: { userId: user.id, pendingEncryptedSecret: "pending-secret", pendingExpiresAt: new Date(Date.now() + 60000) } });
  await prisma.mfaRecoveryCode.create({ data: { userId: user.id, codeHash: "rollback-recovery" } });
  await prisma.mfaGrant.create({ data: { userId: user.id, sessionDigest: "rollback-grant", verifiedAt: new Date(), expiresAt: new Date(Date.now() + 60000) } });
  const spy = vi.spyOn(notifications, "enqueueNotification").mockRejectedValue(new Error("synthetic closure enqueue failure"));
  await expect(close(user)).rejects.toThrow("synthetic closure enqueue failure"); spy.mockRestore();
  expect(await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).toEqual(original);
  expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).buyerIdentityCapturedAt).toBeNull();
  expect(await prisma.organisationMember.count({ where: { userId: user.id } })).toBe(1); expect(await prisma.organisationStaff.count({ where: { userId: user.id, status: "active" } })).toBe(1);
  expect(await prisma.authToken.count({ where: { userId: user.id, invalidatedAt: null } })).toBe(1); expect(await prisma.accountSecurityEvent.count({ where: { userId: user.id, type: "account_closed" } })).toBe(0);
  expect((await prisma.userMfa.findUniqueOrThrow({ where: { userId: user.id } })).pendingEncryptedSecret).toBe("pending-secret");
  expect(await prisma.mfaRecoveryCode.count({ where: { userId: user.id } })).toBe(1); expect(await prisma.mfaGrant.count({ where: { userId: user.id } })).toBe(1);
});
test("retained buyers appear in scoped details/search/pagination/check-in and ticket delivery, with honest provenance", async () => {
  const user = await createMember(); const { user: staffOwner, order, event, organisation } = await purchase(user.id, "paid");
  await prisma.ticket.create({ data: { orderId: order.id, eventId: event.id, ticketTypeId: event.ticketTypes[0].id, organisationId: organisation.id } });
  const another = await createOrder({ organisationId: organisation.id, eventId: event.id, ticketTypeId: event.ticketTypes[0].id, userId: user.id, status: "paid", unitPrice: 1200, paidAt: new Date() });
  const foreign = await createOrganisationAccount(); await close(user);
  const detail = await getOrganisationOrderDetail(organisation.id, order.id); expect(detail.user?.email).toBe(user.email); expect(detail.user?.firstName).toBe("Test"); expect(detail.buyerIdentityProvenance).toBe("current_account_at_capture");
  const first = await getGroupedOrganisationOrdersWithContext(organisation.id, "all", undefined, { search: user.email, limit: 1 });
  expect(first.groups[0].orders[0].buyerEmail).toBe(user.email);
  const next = await getGroupedOrganisationOrdersWithContext(organisation.id, "all", undefined, { search: user.email, limit: 1, cursor: first.pageInfo.nextCursor! });
  expect(next.groups[0].orders[0].buyerEmail).toBe(user.email); expect(new Set([first.groups[0].orders[0].id, next.groups[0].orders[0].id])).toEqual(new Set([order.id, another.id]));
  setMockSession({ userId: staffOwner.id, email: staffOwner.email, accountRole: "organisation" });
  expect((await getOrganisationEventTickets(organisation.id, event.id)).tickets[0].buyerEmail).toBe(user.email);
  const mail = await loadTicketDeliveryOrder(order.id); expect(mail.user?.email).toBe(user.email); expect(renderTicketEmail(mail).text).toContain("Test Member");
  await expect(getOrganisationOrderDetail(foreign.organisation.id, order.id)).rejects.toThrow("access denied");
  expect((await getGroupedOrganisationOrdersWithContext(foreign.organisation.id, "all", undefined, { search: user.email })).groups).toEqual([]);
});
test("closed identities cannot authenticate, read settings, recover or attach historical records through a new signup", async () => {
  const user = await createMember(); const { order } = await purchase(user.id, "expired"); await close(user);
  expect(await getSessionIdentity(user.id, 0)).toBeNull(); expect(await getSessionIdentity(user.id, 1)).toBeNull();
  setMockSession({ userId: user.id, email: user.email, accountRole: "member", authVersion: 1 });
  await expect(requireAuthenticatedUser()).rejects.toThrow("Authentication required"); await expect(readAccountSettings({ id: user.id, authVersion: 1 })).rejects.toMatchObject({ kind: "stale_session" });
  await requestPasswordReset(user.email); expect(await prisma.authToken.count({ where: { userId: user.id } })).toBe(0);
  await signupAccount({ email: user.email, password: "password123", accountRole: "member" });
  const replacement = await prisma.user.findUniqueOrThrow({ where: { email: user.email } }); expect(replacement.id).not.toBe(user.id); expect(replacement.emailVerifiedAt).toBeNull();
  expect(await prisma.order.count({ where: { userId: replacement.id } })).toBe(0); expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).userId).toBe(user.id);
});
test("closure HTTP preserves private reads, origin/CSRF, strict input, Redis failure and final blocker recheck", async () => {
  const user = await createMember(); setMockSession({ userId: user.id, email: user.email, accountRole: "member" });
  const path = "http://localhost:3000/api/me/account/closure"; const body = { currentPassword: "password123", acknowledgement: closureAcknowledgement };
  const response = await GET(); expect(response.headers.get("Cache-Control")).toBe("private, no-store"); expect(await response.json()).toEqual({ eligible: true, blockers: [] });
  expect((await POST(jsonRequest(path, body, { headers: { Origin: "https://evil.example" } }))).status).toBe(403);
  expect((await POST(jsonRequest(path, body, { headers: { cookie: "authjs.session-token=synthetic" } }))).status).toBe(403);
  expect((await POST(jsonRequest(path, { ...body, userId: user.id }))).status).toBe(400);
  setRateLimitTestBackendFailure(new Error("synthetic Redis failure")); expect((await POST(jsonRequest(path, body))).status).toBe(503); setRateLimitTestBackendFailure(null);
  await purchase(user.id); expect((await POST(jsonRequest(path, body))).status).toBe(409);
  await prisma.user.update({ where: { id: user.id }, data: { authVersion: 1 } }); expect((await GET()).status).toBe(401); expect((await POST(jsonRequest(path, body))).status).toBe(401);
});
test("closure and owner promotion serialize; closed accounts cannot be reactivated as staff", async () => {
  const user = await createMember(); const society = await createOrganisationAccount(); const staff = await createOrganisationStaff({ organisationId: society.organisation.id, userId: user.id });
  const results = await Promise.allSettled([close(user), updateOrganisationStaff(actorFor(society.user), society.organisation.id, staff.id, { role: "owner", status: "active" })]);
  const closed = await prisma.user.findUniqueOrThrow({ where: { id: user.id } }); const liveStaff = await prisma.organisationStaff.findUniqueOrThrow({ where: { id: staff.id } });
  if (closed.closedAt) { expect(liveStaff.status).toBe("revoked"); await expect(updateOrganisationStaff(actorFor(society.user), society.organisation.id, staff.id, { status: "active" })).rejects.toMatchObject({ kind: "conflict" }); }
  else { expect(liveStaff).toMatchObject({ status: "active", role: "owner" }); expect(results[0].status).toBe("rejected"); }
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
});
test("racing invite acceptance and closure cannot leave live authority on a closed account", async () => {
  const user = await createMember(); const society = await createOrganisationAccount(); const invite = await createOrganisationStaffInvite({ organisationId: society.organisation.id, actor: { id: society.user.id, authVersion: society.user.authVersion }, email: user.email, role: "owner" });
  const token = await readStaffInviteToken(invite.invite.id);
  const results = await Promise.allSettled([close(user), acceptOrganisationStaffInvite({ token, actor: { id: user.id, authVersion: user.authVersion } })]);
  const closed = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  if (closed.closedAt) expect(await prisma.organisationStaff.count({ where: { userId: user.id, status: "active" } })).toBe(0);
  else expect((await readAccountClosureEligibility(actorFor(user))).eligible).toBe(false);
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
});
test("racing joins are removed and racing organisation bootstrap either blocks closure or is denied", async () => {
  const user = await createMember(); const society = await createOrganisationAccount(); setMockSession({ userId: user.id, email: user.email, accountRole: "member" });
  await Promise.allSettled([close(user), join(jsonRequest("http://localhost:3000/api/orgs/x/join", {}), { params: Promise.resolve({ orgSlug: society.organisation.slug }) })]);
  expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).closedAt).not.toBeNull(); expect(await prisma.organisationMember.count({ where: { userId: user.id } })).toBe(0);
  const founder = await createUser({ accountRole: "organisation" }); setMockSession({ userId: founder.id, email: founder.email, accountRole: "organisation" });
  await Promise.allSettled([close(founder), bootstrap(jsonRequest("http://localhost:3000/api/orgs", { name: "Closure race" }))]);
  const closed = await prisma.user.findUniqueOrThrow({ where: { id: founder.id } });
  if (closed.closedAt) expect(await prisma.organisation.count({ where: { accountUserId: founder.id } })).toBe(0);
  else expect((await readAccountClosureEligibility(actorFor(founder))).eligible).toBe(false);
});
test("racing checkout either creates a pending blocker or is denied after closure", async () => {
  const user = await createMember(); const society = await createOrganisationAccount({ stripeReady: true }); const event = await createEvent({ organisationId: society.organisation.id, status: "published" });
  stripe.create.mockResolvedValue({ id: "cs_closure_race", url: "https://checkout.stripe.test/race" });
  await Promise.allSettled([close(user), createEventCheckout({ userId: user.id, eventId: event.id, ticketTypeId: event.ticketTypes[0].id, quantity: 1 })]);
  const closed = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  if (closed.closedAt) expect(await prisma.order.count({ where: { userId: user.id } })).toBe(0);
  else expect((await readAccountClosureEligibility(actorFor(user))).blockers.join(" ")).toContain("pending");
  if (closed.closedAt) await expect(prisma.$transaction(tx => lockVerifiedAccount(tx, closed.id))).rejects.toThrow();
});
test("late provider payments retain closed ownership and compensation truth without reopening", async () => {
  const user = await createMember(); const { order, event, organisation } = await purchase(user.id, "expired"); await close(user);
  const result = await reconcileCompletedCheckoutSession(checkoutSession({ id: order.stripeSessionId!, orderId: order.id, eventId: event.id, organisationId: organisation.id, ticketTypeId: event.ticketTypes[0].id, quantity: 1, amountTotal: 1200 }));
  expect(result.status).toBe("compensation_required");
  const retained = await prisma.order.findUniqueOrThrow({ where: { id: order.id } }); expect(retained).toMatchObject({ userId: user.id, buyerEmailSnapshot: user.email, requiresCompensationReview: true });
  expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).closedAt).not.toBeNull(); expect(await prisma.ticket.count({ where: { orderId: order.id } })).toBe(0);
});

test("MFA enrollment and verification share the closure fence and cannot recreate credentials afterward", async () => {
  vi.stubEnv("MFA_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
  const user = await createMember(); const society = await createOrganisationAccount(); await createOrganisationStaff({ organisationId: society.organisation.id, userId: user.id });
  const now = new Date(Math.floor(Date.now() / 30000) * 30000);
  const setup = await beginStaffMfaEnrollment(user.id, user.email, now); const session = "closure-mfa-session";
  await confirmStaffMfaEnrollment(user.id, totpCode(setup.secret, Math.floor(now.getTime() / 30000)), mfaGrantDigest(session)!, now);
  const later = new Date(now.getTime() + 30000);
  await Promise.allSettled([closeAccount({ ...actorFor(user), mfaSessionId: session }, "password123", closureAcknowledgement, later), verifyStaffMfa(user.id, totpCode(setup.secret, Math.floor(later.getTime() / 30000)), "racing-grant", later)]);
  expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).closedAt).not.toBeNull();
  expect(await prisma.userMfa.count({ where: { userId: user.id } })).toBe(0); expect(await prisma.mfaGrant.count({ where: { userId: user.id } })).toBe(0);
  await expect(beginStaffMfaEnrollment(user.id, user.email)).rejects.toThrow("Active account");
  await expect(verifyStaffMfa(user.id, "123456", "late-grant")).rejects.toThrow("Active account");
});

test("buyer capture requires complete provenance and preserves an existing immutable capture", async () => {
  const user = await createMember(); const { order } = await purchase(user.id, "expired");
  await expect(prisma.order.update({ where: { id: order.id }, data: { buyerEmailSnapshot: user.email, buyerIdentityCapturedAt: new Date() } })).rejects.toThrow();
  const capturedAt = new Date(1000);
  await prisma.order.update({ where: { id: order.id }, data: { buyerEmailSnapshot: "previous@example.com", buyerIdentityCapturedAt: capturedAt, buyerIdentityProvenance: "current_account_at_capture" } });
  await close(user);
  expect(await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({ buyerEmailSnapshot: "previous@example.com", buyerIdentityCapturedAt: capturedAt });
});

test("concurrent owner demotions retain one active owner and the scoped atomic audit trail", async () => {
  const society = await createOrganisationAccount(); const other = await createMember(); const second = await createOrganisationStaff({ organisationId: society.organisation.id, userId: other.id, role: "owner" });
  const first = await prisma.organisationStaff.findUniqueOrThrow({ where: { organisationId_userId: { organisationId: society.organisation.id, userId: society.user.id } } });
  const results = await Promise.allSettled([updateOrganisationStaff(actorFor(society.user), society.organisation.id, second.id, { role: "admin" }), updateOrganisationStaff(actorFor(other), society.organisation.id, first.id, { role: "admin" })]);
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
  expect(await prisma.organisationStaff.count({ where: { organisationId: society.organisation.id, role: "owner", status: "active" } })).toBe(1);
  expect(await prisma.auditLog.count({ where: { organisationId: society.organisation.id, action: "staff.updated" } })).toBe(1);
});

test("existing zero-value future tickets are retained while free joins are removed", async () => {
  // Synthetic legacy/future free-order fixture; free checkout remains T13.
  const user = await createMember(); const { order, event, organisation } = await purchase(user.id, "paid", 0);
  const ticket = await prisma.ticket.create({ data: { orderId: order.id, eventId: event.id, ticketTypeId: event.ticketTypes[0].id, organisationId: organisation.id } });
  await joinOrganisation(user.id, organisation.id); await close(user);
  expect(await prisma.ticket.findUnique({ where: { id: ticket.id } })).not.toBeNull();
  expect(await prisma.organisationMember.count({ where: { userId: user.id } })).toBe(0);
});
