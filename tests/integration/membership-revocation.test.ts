import { beforeEach, describe, expect, test, vi } from "vitest";
import { POST as cancelRoute } from "@/app/api/orgs/[orgSlug]/memberships/members/[grantId]/cancel/route";
import { POST as revokeRoute } from "@/app/api/orgs/[orgSlug]/memberships/members/[grantId]/revoke/route";
import { createCommerceOrder } from "@/lib/commerce/orders";
import { prisma } from "@/lib/db";
import { grantState } from "@/lib/memberships/grants";
import { cancelFreeMembership } from "@/lib/memberships/revocation";
import { setSocietyJoin } from "@/lib/organisations/join";
import { setMockSession } from "@/tests/helpers/auth";
import { jsonRequest, parseJsonResponse, routeContext } from "@/tests/helpers/http";
import { createMember, createOrganisationAccount, createOrganisationStaff, joinOrganisation } from "@/tests/helpers/test-data";

beforeEach(() => { vi.stubEnv("MFA_ENFORCEMENT_MODE", "off"); });

const day = 86_400_000;
const reason = "Transferred to another club.";

// A society, a member and one membership of the given kind, as fulfilment leaves it.
async function membership({ paid = false, endsAt = new Date(Date.now() + 100 * day) } = {}) {
  const society = await createOrganisationAccount({ stripeReady: true });
  const member = await createMember();
  const term = { startsAt: new Date(Date.now() - day), endsAt };
  const plan = await prisma.membershipProduct.create({ data: { organisationId: society.organisation.id, name: "Semester 2", priceAmount: paid ? 1500 : 0, ...term, entitlements: ["member_prices"], status: "published", publishedAt: new Date() } });
  const order = await prisma.$transaction((tx) => createCommerceOrder(tx, {
    organisationId: society.organisation.id, kind: "membership", buyer: { userId: member.id }, buyerEmail: member.email, paymentKind: paid ? "stripe" : "free", feeAmount: paid ? 150 : 0, source: "checkout",
    lines: [{ quantity: 1, unitAmount: plan.priceAmount, name: plan.name, termStartsAt: term.startsAt, termEndsAt: term.endsAt, membershipProductId: plan.id }]
  }));
  await prisma.commerceOrder.update({ where: { id: order.id }, data: { status: "paid", paidAt: new Date(), fulfilledAt: new Date() } });
  const line = await prisma.commerceOrderLine.findFirstOrThrow({ where: { orderId: order.id } });
  const grant = await prisma.membershipGrant.create({ data: { userId: member.id, organisationId: society.organisation.id, membershipProductId: plan.id, commerceOrderLineId: line.id, ...term, entitlements: plan.entitlements, entitlementVersion: 1 } });
  setMockSession({ userId: society.user.id, email: society.user.email, accountRole: "organisation" });
  return { society, member, order, grant };
}

async function end(action: "revoke" | "cancel", slug: string, grantId: string, body: Record<string, string> = { reason }) {
  const route = action === "revoke" ? revokeRoute : cancelRoute;
  const response = await route(jsonRequest(`http://localhost:3000/api/orgs/${slug}/memberships/members/${grantId}/${action}`, body), routeContext({ orgSlug: slug, grantId }));
  return { status: response.status, body: await parseJsonResponse(response) };
}

describe("ending a membership early", () => {
  test("a revoke ends the membership now, emails the member, is audited and moves no money; repeating it changes nothing", async () => {
    const { society, member, order, grant } = await membership({ paid: true });
    const first = await end("revoke", society.organisation.slug, grant.id);
    expect(first).toMatchObject({ status: 200, body: { status: "revoked" } });
    const revoked = await prisma.membershipGrant.findUniqueOrThrow({ where: { id: grant.id } });
    expect(revoked).toMatchObject({ revokedByUserId: society.user.id, revocationReason: reason });
    expect(grantState(revoked)).toBe("revoked");
    expect(await prisma.notificationOutbox.findFirstOrThrow({ where: { eventKey: `membership-ended/${grant.id}` } })).toMatchObject({ recipient: member.email, organisationId: society.organisation.id });
    expect(await prisma.auditLog.findFirstOrThrow({ where: { action: "membership.revoked", targetId: grant.id } })).toMatchObject({ actorUserId: society.user.id });
    expect(await prisma.commerceOrder.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({ status: "paid", cancelledAt: null });
    expect(await prisma.refundRequest.count()).toBe(0);

    expect((await end("revoke", society.organisation.slug, grant.id, { reason: "A second, different reason." })).body).toMatchObject({ status: "already_revoked" });
    expect((await prisma.membershipGrant.findUniqueOrThrow({ where: { id: grant.id } })).revocationReason).toBe(reason);
    expect(await prisma.notificationOutbox.count({ where: { eventKey: { startsWith: "membership-ended/" } } })).toBe(1);
    // The database keeps the first revocation even against a direct write.
    await expect(prisma.membershipGrant.update({ where: { id: grant.id }, data: { revocationReason: "rewritten" } })).rejects.toThrow();
  });

  test("a free membership is cancelled once: a separate cancellation fact, history, the grant revoked and never a refund", async () => {
    const { society, order, grant } = await membership();
    const results = await Promise.all([
      cancelFreeMembership({ organisationId: society.organisation.id, grantId: grant.id, actor: { id: society.user.id }, reason }),
      cancelFreeMembership({ organisationId: society.organisation.id, grantId: grant.id, actor: { id: society.user.id }, reason })
    ]);
    expect(results.map((result) => result.status).sort()).toEqual(["already_cancelled", "cancelled"]);
    expect(await prisma.commerceOrder.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({ status: "paid", cancelledByUserId: society.user.id, cancellationReason: reason, totalAmount: 0 });
    expect((await prisma.commerceLifecycleEvent.findMany({ where: { commerceOrderId: order.id }, orderBy: { sequence: "asc" }, select: { type: true } })).map((event) => event.type)).toEqual(["order_created", "free_cancelled"]);
    expect(grantState(await prisma.membershipGrant.findUniqueOrThrow({ where: { id: grant.id } }))).toBe("revoked");
    expect(await prisma.refundRequest.count()).toBe(0);
    // A paid order can't take a cancellation fact, even directly.
    const paid = await membership({ paid: true });
    await expect(prisma.commerceOrder.update({ where: { id: paid.order.id }, data: { cancelledAt: new Date(), cancellationReason: reason } })).rejects.toThrow();
  });

  test("the routes refuse the wrong kind, an ended membership, short reasons, missing permission and other societies", async () => {
    const paid = await membership({ paid: true });
    expect(await end("cancel", paid.society.organisation.slug, paid.grant.id)).toMatchObject({ status: 409, body: { error: { details: [{ reason: "not_cancellable" }] } } });
    expect((await end("revoke", paid.society.organisation.slug, paid.grant.id, { reason: "short" })).status).toBe(400);

    const ended = await membership({ endsAt: new Date(Date.now() - 1000) });
    expect(await end("revoke", ended.society.organisation.slug, ended.grant.id)).toMatchObject({ status: 409, body: { error: { details: [{ reason: "not_revocable" }] } } });

    // An event manager has neither permission; a finance manager may cancel but not revoke.
    const eventManager = await createMember();
    await createOrganisationStaff({ organisationId: paid.society.organisation.id, userId: eventManager.id, role: "event_manager" });
    setMockSession({ userId: eventManager.id, email: eventManager.email, accountRole: "member" });
    expect((await end("revoke", paid.society.organisation.slug, paid.grant.id)).status).toBe(403);
    const free = await membership();
    const finance = await createMember();
    await createOrganisationStaff({ organisationId: free.society.organisation.id, userId: finance.id, role: "finance_manager" });
    setMockSession({ userId: finance.id, email: finance.email, accountRole: "member" });
    expect((await end("revoke", free.society.organisation.slug, free.grant.id)).status).toBe(403);
    expect((await end("cancel", free.society.organisation.slug, free.grant.id)).body).toMatchObject({ status: "cancelled" });

    // Another society's owner can't reach the grant through their own slug.
    setMockSession({ userId: free.society.user.id, email: free.society.user.email, accountRole: "organisation" });
    expect((await end("revoke", free.society.organisation.slug, paid.grant.id)).status).toBe(404);
    expect((await prisma.membershipGrant.findUniqueOrThrow({ where: { id: paid.grant.id } })).revokedAt).toBeNull();
  });

  test("with staff MFA on, the routes need a fresh authenticator code before anything changes", async () => {
    const { society, grant } = await membership();
    vi.stubEnv("MFA_ENFORCEMENT_MODE", "enroll");
    vi.stubEnv("MFA_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
    vi.stubEnv("RATE_LIMIT_ENABLED", "true");
    for (const action of ["revoke", "cancel"] as const) {
      const missing = await end(action, society.organisation.slug, grant.id);
      expect(missing.status).toBe(400);
      expect(missing.body.error.details[0].path).toEqual(["mfaCode"]);
    }
    vi.stubEnv("MFA_ENFORCEMENT_MODE", "enforce");
    expect((await end("revoke", society.organisation.slug, grant.id)).status).toBe(403);
    expect((await prisma.membershipGrant.findUniqueOrThrow({ where: { id: grant.id } })).revokedAt).toBeNull();
  });

  test("leaving the society removes only the free join; the membership stays active", async () => {
    const { society, member, grant } = await membership({ paid: true });
    await joinOrganisation(member.id, society.organisation.id);
    const actor = await prisma.user.findUniqueOrThrow({ where: { id: member.id }, select: { id: true, authVersion: true } });
    await setSocietyJoin(actor, society.organisation.slug, false);
    expect(await prisma.organisationMember.count({ where: { userId: member.id, organisationId: society.organisation.id } })).toBe(0);
    expect(grantState(await prisma.membershipGrant.findUniqueOrThrow({ where: { id: grant.id } }))).toBe("active");
  });
});
