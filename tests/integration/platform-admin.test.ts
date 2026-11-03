import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";
import { prisma } from "@/lib/db";
import { authorizeCredentials } from "@/lib/auth/credentials";
import { adminPathFor } from "@/lib/ops/alerts";
import { recordPlatformSearch, recordPlatformView, searchDigest } from "@/lib/platform/audit";
import { landsInAdmin, PlatformUnavailableError, requirePlatformPage } from "@/lib/platform/authority";
import { adminHostAllowed } from "@/lib/platform/mode";
import { grantPlatformOperator, PlatformOperatorError, revokePlatformOperator } from "@/lib/platform/operators";
import { readCounts, readHealth, readNeeds } from "@/lib/platform/overview";
import { readOrderRecord, readSocietyRecord, readUserRecord } from "@/lib/platform/records";
import { searchPlatform } from "@/lib/platform/search";
import { createTestRateLimitBackend, setRateLimitTestBackend, setRateLimitTestEnabled } from "@/lib/security/rate-limit";
import { cleanUpExpiredTokens } from "@/lib/security/token-cleanup";
import { acceptOrganisationStaffInvite, createOrganisationStaffInvite, StaffInviteError } from "@/lib/staff/invites";
import { setMockSession } from "@/tests/helpers/auth";
import { enrolStaffMfa } from "@/tests/helpers/mfa";
import { readStaffInviteToken } from "@/tests/helpers/staff-invites";
import { createEvent, createMember, createMembershipGrant, createOrder, createOrganisationAccount, createOrganisationStaff } from "@/tests/helpers/test-data";

vi.mock("next/navigation", () => ({
  redirect: (path: string) => { throw new Error(`REDIRECT:${path}`); },
  notFound: () => { throw new Error("NOT_FOUND"); }
}));

beforeEach(() => {
  vi.stubEnv("ADMIN_PORTAL_ENABLED", "true");
  vi.stubEnv("RATE_LIMIT_ENABLED", "true");
  setRateLimitTestEnabled(true);
  setRateLimitTestBackend(createTestRateLimitBackend());
});
afterEach(() => { setRateLimitTestEnabled(null); setRateLimitTestBackend(null); });

// An enrolled, verified operator with a mock session on this login.
async function operator(role: "admin" | "support" = "admin") {
  const user = await createMember();
  await grantPlatformOperator({ email: user.email, role, note: "Integration test operator", by: "cli:test" });
  await enrolStaffMfa(user);
  setMockSession({ userId: user.id, email: user.email, accountRole: "member" });
  return user;
}

describe("who reaches the admin portal", () => {
  test("an enrolled, recently verified operator reaches a page; MFA is required even with the staff mode off", async () => {
    const user = await operator();
    expect(process.env.MFA_ENFORCEMENT_MODE).toBe("off");
    await expect(requirePlatformPage("platform:monitor", "/admin")).resolves.toMatchObject({ role: "admin", user: { id: user.id } });
    expect(await landsInAdmin(user)).toBe(true);
  });

  test("the portal switched off in this process is a 404 even for an operator", async () => {
    await operator();
    vi.stubEnv("ADMIN_PORTAL_ENABLED", undefined);
    await expect(requirePlatformPage("platform:monitor", "/admin")).rejects.toThrow("NOT_FOUND");
  });

  test("anonymous goes to sign-in; a non-operator, a revoked one and a disabled one get the same 404", async () => {
    await expect(requirePlatformPage("platform:monitor", "/admin/users")).rejects.toThrow("REDIRECT:/login?callbackUrl=%2Fadmin%2Fusers");
    const member = await createMember();
    setMockSession({ userId: member.id, email: member.email, accountRole: "member" });
    await expect(requirePlatformPage("platform:monitor", "/admin")).rejects.toThrow("NOT_FOUND");
    const user = await operator();
    await revokePlatformOperator({ email: user.email, reason: "Integration test revoke", by: "cli:test" });
    await expect(requirePlatformPage("platform:monitor", "/admin")).rejects.toThrow("NOT_FOUND");
    const other = await operator();
    await prisma.user.update({ where: { id: other.id }, data: { disabledAt: new Date() } });
    await expect(requirePlatformPage("platform:monitor", "/admin")).rejects.toThrow("REDIRECT:/login");
  });

  test("no authenticator, or a verification older than 60 minutes, sends the operator to /mfa", async () => {
    const fresh = await createMember();
    await grantPlatformOperator({ email: fresh.email, role: "admin", note: "Integration test operator", by: "cli:test" });
    setMockSession({ userId: fresh.id, email: fresh.email, accountRole: "member" });
    await expect(requirePlatformPage("platform:monitor", "/admin")).rejects.toThrow("REDIRECT:/mfa?callbackUrl=%2Fadmin");
    await operator();
    await prisma.mfaGrant.updateMany({ data: { verifiedAt: new Date(Date.now() - 61 * 60_000) } });
    await expect(requirePlatformPage("platform:read", "/admin/users")).rejects.toThrow("REDIRECT:/mfa?callbackUrl=%2Fadmin%2Fusers");
  });

  test("support can't open admin-only pages, and missing MFA settings stop the portal", async () => {
    await operator("support");
    await expect(requirePlatformPage("platform:read", "/admin/users")).resolves.toMatchObject({ role: "support" });
    await expect(requirePlatformPage("platform:audit_read", "/admin/audit")).rejects.toThrow("NOT_FOUND");
    vi.stubEnv("RATE_LIMIT_ENABLED", "false");
    await expect(requirePlatformPage("platform:read", "/admin/users")).rejects.toBeInstanceOf(PlatformUnavailableError);
  });

  test("the proxy answers 404 for /admin outside admin mode and to a foreign host", async () => {
    vi.stubEnv("AUTH_URL", "http://localhost:3091");
    vi.stubEnv("ADMIN_PORTAL_ENABLED", undefined);
    for (const path of ["/admin", "/admin/users"]) {
      expect((await proxy(new NextRequest(`http://localhost:3091${path}`))).status).toBe(404);
    }
    vi.stubEnv("ADMIN_PORTAL_ENABLED", "true");
    expect((await proxy(new NextRequest("http://localhost:3091/admin", { headers: { host: "evil.example:3091" } }))).status).toBe(404);
    const signIn = await proxy(new NextRequest("http://localhost:3091/admin", { headers: { host: "localhost:3091" } }));
    expect(signIn.status).toBe(307);
    expect(signIn.headers.get("location")).toContain("/login?callbackUrl=%2Fadmin");
    // Society pages never answer the admin 404.
    expect((await proxy(new NextRequest("http://localhost:3091/dashboard", { headers: { host: "evil.example:3091" } }))).status).toBe(307);
  });

  test("only the sign-in host may reach the portal (DNS rebinding)", () => {
    vi.stubEnv("AUTH_URL", "http://localhost:3091");
    expect(adminHostAllowed("localhost:3091")).toBe(true);
    expect(adminHostAllowed("127.0.0.1:3091")).toBe(true);
    expect(adminHostAllowed("localhost:3090")).toBe(false);
    expect(adminHostAllowed("evil.example:3091")).toBe(false);
    expect(adminHostAllowed("localhost.evil.example:3091")).toBe(false);
    expect(adminHostAllowed(null)).toBe(false);
  });
});

describe("operators are granted only by the CLI, to dedicated accounts", () => {
  test("a grant needs a verified member account with no society roles, and is recorded without a web actor", async () => {
    const unverified = await prisma.user.create({ data: { email: "unverified-op@example.com", password: "x", accountRole: "member" } });
    await expect(grantPlatformOperator({ email: unverified.email, role: "admin", note: "Integration test", by: "cli:test" })).rejects.toThrow("isn't verified");
    const { user: societyLogin, organisation } = await createOrganisationAccount();
    await expect(grantPlatformOperator({ email: societyLogin.email, role: "admin", note: "Integration test", by: "cli:test" })).rejects.toThrow("society login");
    const staff = await createMember();
    await createOrganisationStaff({ organisationId: organisation.id, userId: staff.id });
    await expect(grantPlatformOperator({ email: staff.email, role: "admin", note: "Integration test", by: "cli:test" })).rejects.toThrow(PlatformOperatorError);
    const member = await createMember();
    await expect(grantPlatformOperator({ email: member.email, role: "owner", note: "Integration test", by: "cli:test" })).rejects.toThrow("--role");
    await expect(grantPlatformOperator({ email: member.email, role: "support", note: "short", by: "cli:test" })).rejects.toThrow("--note");
    await grantPlatformOperator({ email: member.email, role: "support", note: "Integration test", by: "cli:test" });
    expect(await grantPlatformOperator({ email: member.email, role: "support", note: "Integration test", by: "cli:test" })).toMatchObject({ changed: false });
    await grantPlatformOperator({ email: member.email, role: "admin", note: "Integration test promote", by: "cli:test" });
    const rows = await prisma.platformAuditLog.findMany({ where: { targetId: member.id }, orderBy: { createdAt: "asc" } });
    expect(rows.map((row) => [row.action, row.actorUserId])).toEqual([["platform.operator_granted", null], ["platform.operator_role_changed", null]]);
    expect(rows[1].metadata).toMatchObject({ via: "cli", by: "cli:test", from: "support" });
  });

  test("an operator can't accept a staff invitation", async () => {
    const { user: owner, organisation } = await createOrganisationAccount();
    const member = await createMember();
    const invite = await createOrganisationStaffInvite({ organisationId: organisation.id, actor: { id: owner.id, authVersion: owner.authVersion, mfaSessionId: "integration-session" }, email: member.email, role: "event_manager" });
    await grantPlatformOperator({ email: member.email, role: "support", note: "Integration test", by: "cli:test" });
    const token = await readStaffInviteToken(invite.invite.id);
    await expect(acceptOrganisationStaffInvite({ token, actor: { id: member.id, authVersion: member.authVersion } })).rejects.toBeInstanceOf(StaffInviteError);
    expect(await prisma.organisationStaff.count({ where: { userId: member.id } })).toBe(0);
  });

  test("an operator's verification goes to the platform trail, not to any society", async () => {
    const user = await operator();
    const rows = await prisma.platformAuditLog.findMany({ where: { actorUserId: user.id }, select: { action: true } });
    expect(rows.map((row) => row.action)).toContain("platform.mfa_enabled");
    expect(await prisma.auditLog.count({ where: { actorUserId: user.id } })).toBe(0);
  });
});

describe("the trail", () => {
  test("rows can't be edited, and only views and searches over two years old can be deleted", async () => {
    const user = await operator();
    const actor = await requirePlatformPage("platform:read", "/admin/users");
    await recordPlatformView(actor, { type: "User", id: user.id });
    const view = await prisma.platformAuditLog.findFirstOrThrow({ where: { action: "platform.viewed" } });
    await expect(prisma.platformAuditLog.update({ where: { id: view.id }, data: { reason: "Edited after the fact" } })).rejects.toThrow();
    await expect(prisma.platformAuditLog.delete({ where: { id: view.id } })).rejects.toThrow();
    const old = await prisma.platformAuditLog.create({ data: { actorUserId: user.id, action: "platform.viewed", targetType: "User", targetId: user.id, createdAt: new Date(Date.now() - 800 * 86_400_000) } });
    const oldChange = await prisma.platformAuditLog.create({ data: { action: "platform.operator_granted", targetType: "User", targetId: user.id, createdAt: new Date(Date.now() - 800 * 86_400_000) } });
    const cleaned = await cleanUpExpiredTokens();
    expect(cleaned.platformAccessRows).toBe(1);
    expect(await prisma.platformAuditLog.findUnique({ where: { id: old.id } })).toBeNull();
    expect(await prisma.platformAuditLog.findUnique({ where: { id: oldChange.id } })).not.toBeNull();
    expect(await prisma.platformAuditLog.findUnique({ where: { id: view.id } })).not.toBeNull();
  });

  test("a search keeps a digest of what was typed, never the text", async () => {
    await operator();
    const actor = await requirePlatformPage("platform:read", "/admin/search");
    await recordPlatformSearch(actor, " Buyer@Example.com ", 1);
    const row = await prisma.platformAuditLog.findFirstOrThrow({ where: { action: "platform.searched" } });
    expect(JSON.stringify(row)).not.toContain("buyer@example.com");
    expect(row.metadata).toEqual({ queryDigest: searchDigest("buyer@example.com"), results: 1 });
  });
});

describe("search and records", () => {
  test("an email, a Checkout Session id, an order reference and a name each find their record", async () => {
    const { organisation } = await createOrganisationAccount({ name: "Robotics Society" });
    const event = await createEvent({ organisationId: organisation.id, status: "published" });
    const buyer = await createMember({ email: "buyer@example.com" });
    const ticketType = await prisma.ticketType.findFirstOrThrow({ where: { eventId: event.id } });
    const order = await createOrder({ organisationId: organisation.id, eventId: event.id, ticketTypeId: ticketType.id, userId: buyer.id, stripeSessionId: "cs_test_admin_lookup" });
    expect(await searchPlatform("BUYER@example.com")).toEqual([expect.objectContaining({ kind: "User", id: buyer.id })]);
    expect(await searchPlatform("cs_test_admin_lookup")).toEqual([expect.objectContaining({ kind: "Order", id: order.id, href: `/admin/orders/${order.id}` })]);
    expect((await searchPlatform(order.id.slice(-6).toUpperCase())).map((hit) => hit.id)).toContain(order.id);
    expect((await searchPlatform("robotics")).map((hit) => hit.id)).toContain(organisation.id);
    expect(await searchPlatform("x")).toEqual([]);
  });

  test("a user record never carries the password hash or authenticator secrets", async () => {
    const user = await operator();
    const record = await readUserRecord(user.id);
    const text = JSON.stringify(record);
    expect(text).not.toContain(user.password);
    expect(text).not.toMatch(/encryptedSecret|codeHash|tokenHash|sessionDigest/);
  });

  test("a word without a digit finds names before order references", async () => {
    const jordan = await prisma.user.create({ data: { email: "jordan@example.com", password: "x", emailVerifiedAt: new Date(), firstName: "Jordan", lastName: "Reyes" } });
    expect((await searchPlatform("jordan")).map((hit) => hit.id)).toEqual([jordan.id]);
  });

  test("society, membership order and overview readers run against real rows", async () => {
    const { organisation } = await createOrganisationAccount();
    const member = await createMember();
    const grant = await createMembershipGrant(organisation.id, member.id, member.email);
    const line = await prisma.commerceOrderLine.findUniqueOrThrow({ where: { id: grant.commerceOrderLineId } });
    const society = await readSocietyRecord(organisation.id);
    expect(society?.society.id).toBe(organisation.id);
    expect(society?.society.staff.some((row) => row.role === "owner" && row.status === "active")).toBe(society?.attention.every((item) => item.title !== "No active owner"));
    const commerce = await readOrderRecord(line.orderId);
    expect(commerce).toMatchObject({ family: "commerce", society: { id: organisation.id } });
    expect(commerce?.activity.length).toBeGreaterThan(0);
    expect(await readOrderRecord("cmissingorder00000000000")).toBeNull();
    expect(Array.isArray(await readNeeds())).toBe(true);
    expect((await readCounts()).day.signups).toBeGreaterThan(0);
    expect(await readHealth()).toMatchObject({ stripeMode: "test", rateLimiting: true });
  });

  test("an alert that names a record carries its admin path", () => {
    expect(adminPathFor({ orderId: "o1", organisationId: "s1" })).toBe("/admin/orders/o1");
    expect(adminPathFor({ organisationId: "s1" })).toBe("/admin/societies/s1");
    expect(adminPathFor({ userId: "u1" })).toBe("/admin/users/u1");
    expect(adminPathFor({ reason: "x" })).toBeNull();
  });

  test("a successful sign-in records when; a wrong password doesn't", async () => {
    const user = await createMember();
    await authorizeCredentials({ email: user.email, password: "wrong-password" });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).lastSignInAt).toBeNull();
    await authorizeCredentials({ email: user.email, password: "password123" });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).lastSignInAt).toBeInstanceOf(Date);
  });
});
