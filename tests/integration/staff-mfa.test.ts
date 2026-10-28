import { describe, expect, onTestFinished, test, vi } from "vitest";
import { POST as confirmRoute } from "@/app/api/me/mfa/confirm/route";
import { POST as recoveryCodesRoute } from "@/app/api/me/mfa/recovery-codes/route";
import { POST as setupRoute } from "@/app/api/me/mfa/setup/route";
import { POST as verifyRoute } from "@/app/api/me/mfa/verify/route";
import { prisma } from "@/lib/db";
import { setMockSession } from "@/tests/helpers/auth";
import { jsonRequest, parseJsonResponse } from "@/tests/helpers/http";
import { createMember, createOrganisationAccount, createOrganisationStaff } from "@/tests/helpers/test-data";
import { requireAnyOrganisationPermission, requireCurrentOrganisationAccount, requireOrganisationPermission, StaffMfaRequiredError } from "@/lib/auth/access";
import { mfaGrantDigest } from "@/lib/security/csrf";
import { createTestRateLimitBackend, setRateLimitTestBackend } from "@/lib/security/rate-limit";
import { lockOrganisationActor } from "@/lib/organisations/authority";
import { updateOrganisationStaff } from "@/lib/staff/management";
import { beginStaffMfaEnrollment, confirmStaffMfaEnrollment, requireStaffMfa,
  totpCode, verifyStaffMfa, MfaRequiredError, assertStaffMfaConfiguration,
  assertStaffMfaMutationConfiguration, mfaEnforcementMode, deleteExpiredMfaGrants, replaceRecoveryCodes } from "@/lib/security/staff-mfa";

const encryptionKey = Buffer.alloc(32, 7).toString("base64");
const now = new Date(Math.floor(Date.now() / 30_000) * 30_000);
const sessionA = "mfa-session-a";
const sessionB = "mfa-session-b";

function configureMfa(mode: "enroll" | "enforce" = "enforce") {
  vi.stubEnv("MFA_ENFORCEMENT_MODE", mode);
  vi.stubEnv("MFA_ENCRYPTION_KEY", encryptionKey);
  vi.stubEnv("RATE_LIMIT_ENABLED", "true");
}

describe("staff MFA", () => {
  test("production mode and active abuse protection are required before enforcement", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("MFA_ENFORCEMENT_MODE", "");
    expect(() => mfaEnforcementMode()).toThrow("must be set");
    vi.stubEnv("MFA_ENFORCEMENT_MODE", "enforce");
    vi.stubEnv("MFA_ENCRYPTION_KEY", encryptionKey);
    vi.stubEnv("RATE_LIMIT_ENABLED", "false");
    expect(() => assertStaffMfaConfiguration()).toThrow("RATE_LIMIT_ENABLED");
    expect(() => assertStaffMfaMutationConfiguration()).toThrow("RATE_LIMIT_ENABLED");
  });

  test("enforcement gates live staff and legacy owner access until enrollment and session verification", async () => {
    vi.stubEnv("LEGACY_ORGANISATION_ACCESS_MODE", "allow");
    configureMfa();
    const { user, organisation } = await createOrganisationAccount();
    setMockSession({ userId: user.id, email: user.email, accountRole: "organisation",
      mfaSessionId: sessionA });
    await expect(requireCurrentOrganisationAccount()).rejects.toBeInstanceOf(StaffMfaRequiredError);
    await expect(requireOrganisationPermission(organisation.id, "events:manage"))
      .rejects.toBeInstanceOf(StaffMfaRequiredError);

    const setup = await beginStaffMfaEnrollment(user.id, user.email, now);
    expect(setup.otpauthUrl).toContain("otpauth://totp/");
    const digestA = mfaGrantDigest(sessionA)!;
    const code = totpCode(setup.secret, Math.floor(now.getTime() / 30_000));
    const { recoveryCodes } = await confirmStaffMfaEnrollment(user.id, code, digestA, now);
    expect(recoveryCodes).toHaveLength(10);
    await expect(requireStaffMfa(user.id, digestA, now)).resolves.toBeUndefined();
    await expect(requireCurrentOrganisationAccount()).resolves.toMatchObject({ id: organisation.id });
    setMockSession({ userId: user.id, email: user.email, accountRole: "organisation",
      mfaSessionId: sessionB });
    await expect(requireCurrentOrganisationAccount()).rejects.toBeInstanceOf(StaffMfaRequiredError);
    const next = new Date(now.getTime() + 30_000);
    await verifyStaffMfa(user.id, totpCode(setup.secret, Math.floor(next.getTime() / 30_000)),
      mfaGrantDigest(sessionB)!, next);
    await expect(requireStaffMfa(user.id, mfaGrantDigest(sessionB)!, next))
      .resolves.toBeUndefined();
    // Each society the person works for keeps the record.
    expect((await prisma.auditLog.findMany({ where: { targetId: user.id, action: { startsWith: "staff_mfa." } }, orderBy: { createdAt: "asc" } }))
      .map((row) => [row.action, row.actorUserId, row.organisationId])).toEqual([
      ["staff_mfa.enabled", user.id, organisation.id], ["staff_mfa.verified", user.id, organisation.id]
    ]);
    await expect(requireStaffMfa(user.id, mfaGrantDigest(sessionB)!,
      new Date(next.getTime() + 13 * 60 * 60_000))).rejects.toBeInstanceOf(MfaRequiredError);
    await prisma.organisationStaff.delete({ where: { organisationId_userId: {
      organisationId: organisation.id, userId: user.id
    } } });
    await expect(requireCurrentOrganisationAccount()).resolves.toMatchObject({ id: organisation.id });
  });

  test("recovery codes are single-use and TOTP steps cannot be replayed", async () => {
    configureMfa();
    const { user } = await createOrganisationAccount();
    const setup = await beginStaffMfaEnrollment(user.id, user.email, now);
    const code = totpCode(setup.secret, Math.floor(now.getTime() / 30_000));
    const { recoveryCodes } = await confirmStaffMfaEnrollment(user.id, code, mfaGrantDigest(sessionA)!, now);
    await expect(verifyStaffMfa(user.id, code, mfaGrantDigest(sessionB)!, now)).rejects.toThrow();
    await verifyStaffMfa(user.id, recoveryCodes[0], mfaGrantDigest(sessionB)!, now);
    await expect(verifyStaffMfa(user.id, recoveryCodes[0], mfaGrantDigest(sessionB)!, now))
      .rejects.toThrow("Invalid MFA");
    await expect(prisma.mfaRecoveryCode.count({ where: { userId: user.id } })).resolves.toBe(9);
    expect(await prisma.auditLog.count({ where: { targetId: user.id, actorUserId: user.id, action: "staff_mfa.recovery_used" } })).toBe(1);
  });

  // UI-018: a new set replaces every unused code, only with the password and a fresh authenticator code.
  test("replacing recovery codes needs the password and a fresh authenticator code, and retires every old code", async () => {
    configureMfa();
    const { user } = await createOrganisationAccount();
    const stepNow = Math.floor(now.getTime() / 30_000);
    await expect(replaceRecoveryCodes(user.id, "password123", "123456", now)).rejects.toThrow("Set up an authenticator app first");
    const setup = await beginStaffMfaEnrollment(user.id, user.email, now);
    const { recoveryCodes: old } = await confirmStaffMfaEnrollment(user.id, totpCode(setup.secret, stepNow), mfaGrantDigest(sessionA)!, now);
    await verifyStaffMfa(user.id, old[0], mfaGrantDigest(sessionA)!, now);
    const later = new Date(now.getTime() + 30_000);
    const fresh = totpCode(setup.secret, stepNow + 1);

    await expect(replaceRecoveryCodes(user.id, "not-the-password", fresh, later)).rejects.toThrow("Your password is incorrect");
    // Without the phone, a password guess is never checked: the code fails first.
    await expect(replaceRecoveryCodes(user.id, "not-the-password", "000000", later)).rejects.toThrow("Invalid authenticator code");
    await expect(replaceRecoveryCodes(user.id, "password123", "000000", later)).rejects.toThrow("Invalid authenticator code");
    // A recovery code can't stand in for the authenticator, and a step already used can't be replayed.
    await expect(replaceRecoveryCodes(user.id, "password123", old[1], later)).rejects.toThrow("6-digit code");
    await expect(replaceRecoveryCodes(user.id, "password123", totpCode(setup.secret, stepNow), later)).rejects.toThrow("Invalid authenticator code");
    expect(await prisma.mfaRecoveryCode.count({ where: { userId: user.id } })).toBe(9);

    const { recoveryCodes } = await replaceRecoveryCodes(user.id, "password123", fresh, later);
    expect(recoveryCodes).toHaveLength(10);
    expect(new Set(recoveryCodes).size).toBe(10);
    expect(await prisma.mfaRecoveryCode.count({ where: { userId: user.id } })).toBe(10);
    await expect(replaceRecoveryCodes(user.id, "password123", fresh, later)).rejects.toThrow();
    await expect(verifyStaffMfa(user.id, old[1], mfaGrantDigest(sessionB)!, later)).rejects.toThrow("Invalid MFA");
    await verifyStaffMfa(user.id, recoveryCodes[0], mfaGrantDigest(sessionB)!, later);
    expect(await prisma.auditLog.count({ where: { targetId: user.id, action: "staff_mfa.recovery_codes_replaced" } })).toBe(1);
  });

  test("a permitted staff action keeps the MFA challenge when other permissions are denied", async () => {
    configureMfa();
    const { organisation } = await createOrganisationAccount();
    const staff = await createMember();
    await createOrganisationStaff({ organisationId: organisation.id, userId: staff.id,
      role: "event_manager" });
    setMockSession({ userId: staff.id, email: staff.email, accountRole: "member",
      mfaSessionId: sessionA });
    await expect(requireAnyOrganisationPermission(organisation.id,
      ["events:manage", "staff:manage"]))
      .rejects.toBeInstanceOf(StaffMfaRequiredError);
  });

  test("enrollment stage allows unenrolled staff; revocation still removes management authority", async () => {
    configureMfa("enroll");
    const { organisation } = await createOrganisationAccount();
    const staff = await createMember();
    await createOrganisationStaff({ organisationId: organisation.id, userId: staff.id,
      role: "event_manager" });
    setMockSession({ userId: staff.id, email: staff.email, accountRole: "member" });
    await expect(requireOrganisationPermission(organisation.id, "events:manage"))
      .resolves.toMatchObject({ id: organisation.id });
    await prisma.organisationStaff.update({ where: {
      organisationId_userId: { organisationId: organisation.id, userId: staff.id }
    }, data: { status: "revoked", revokedAt: new Date() } });
    await expect(requireOrganisationPermission(organisation.id, "events:manage"))
      .rejects.toThrow("access denied");
  });

  test("scheduled cleanup deletes only bounded expired grants", async () => {
    const { user } = await createOrganisationAccount();
    const past = new Date(now.getTime() - 1000);
    const future = new Date(now.getTime() + 60_000);
    await prisma.mfaGrant.createMany({ data: [
      { userId: user.id, sessionDigest: "expired-a", verifiedAt: past, expiresAt: past },
      { userId: user.id, sessionDigest: "expired-b", verifiedAt: past, expiresAt: past },
      { userId: user.id, sessionDigest: "active-c", verifiedAt: now, expiresAt: future }
    ] });
    expect(await deleteExpiredMfaGrants(now, 500, true)).toBe(0);
    expect(await prisma.mfaGrant.count({ where: { userId: user.id } })).toBe(3);
    expect(await deleteExpiredMfaGrants(now, 1)).toBe(1);
    expect(await deleteExpiredMfaGrants(now, 1)).toBe(1);
    expect(await deleteExpiredMfaGrants(now, 1)).toBe(0);
    expect(await prisma.mfaGrant.count({ where: { userId: user.id } })).toBe(1);
  });

  // Failure paths and the full route flow (2026-10-26 test audit).
  test("bad codes, an expired or finished setup, and a wrong or rotated key are refused", async () => {
    configureMfa();
    const { user } = await createOrganisationAccount();
    const step = Math.floor(now.getTime() / 30_000);
    const digestA = mfaGrantDigest(sessionA)!;
    await expect(verifyStaffMfa(user.id, "123456", digestA, now)).rejects.toThrow("Staff MFA enrollment required");

    const expiring = await beginStaffMfaEnrollment(user.id, user.email, now);
    await expect(confirmStaffMfaEnrollment(user.id, "12345", digestA, now)).rejects.toThrow("Invalid authenticator code");
    await expect(confirmStaffMfaEnrollment(user.id, totpCode(expiring.secret, step + 10), digestA, now)).rejects.toThrow("Invalid authenticator code");
    const late = new Date(now.getTime() + 10 * 60_000);
    await expect(confirmStaffMfaEnrollment(user.id, totpCode(expiring.secret, Math.floor(late.getTime() / 30_000)), digestA, late))
      .rejects.toThrow("MFA setup expired; start again");

    const setup = await beginStaffMfaEnrollment(user.id, user.email, now);
    await confirmStaffMfaEnrollment(user.id, totpCode(setup.secret, step), digestA, now);
    await expect(beginStaffMfaEnrollment(user.id, user.email, now)).rejects.toThrow("MFA is already enabled");
    await expect(confirmStaffMfaEnrollment(user.id, totpCode(setup.secret, step + 1), digestA, now)).rejects.toThrow("MFA setup expired; start again");
    await expect(verifyStaffMfa(user.id, "not-a-code", mfaGrantDigest(sessionB)!, now)).rejects.toThrow("Invalid MFA or recovery code");

    // A secret stored under another key never verifies.
    vi.stubEnv("MFA_ENCRYPTION_KEY", Buffer.alloc(32, 3).toString("base64"));
    await expect(verifyStaffMfa(user.id, totpCode(setup.secret, step + 1), mfaGrantDigest(sessionB)!, new Date(now.getTime() + 30_000))).rejects.toThrow();
    expect(await prisma.mfaGrant.count({ where: { sessionDigest: mfaGrantDigest(sessionB)! } })).toBe(0);

    for (const key of ["", "c2hvcnQ=", encryptionKey.replace(/=+$/, "")]) {
      vi.stubEnv("MFA_ENCRYPTION_KEY", key);
      expect(() => assertStaffMfaMutationConfiguration()).toThrow("MFA_ENCRYPTION_KEY must be a base64-encoded 32-byte key");
    }
    vi.stubEnv("MFA_ENFORCEMENT_MODE", "sometimes");
    expect(() => mfaEnforcementMode()).toThrow("must be set to off, enroll, or enforce");
  });

  test("a code another request accepted while this one was checking is refused under the lock", async () => {
    configureMfa();
    const { user } = await createOrganisationAccount();
    const step = Math.floor(now.getTime() / 30_000);
    const setup = await beginStaffMfaEnrollment(user.id, user.email, now);
    await confirmStaffMfaEnrollment(user.id, totpCode(setup.secret, step), mfaGrantDigest(sessionA)!, now);
    const before = await prisma.userMfa.findUniqueOrThrow({ where: { userId: user.id } });
    const next = new Date(now.getTime() + 30_000);
    const code = totpCode(setup.secret, step + 1);
    await verifyStaffMfa(user.id, code, mfaGrantDigest(sessionB)!, next);

    // The second request read the enrollment before the first committed.
    vi.spyOn(prisma.userMfa, "findUnique").mockResolvedValueOnce(before as never).mockResolvedValueOnce(before as never);
    await expect(verifyStaffMfa(user.id, code, mfaGrantDigest("mfa-session-c")!, next)).rejects.toThrow("Authenticator code was already used");
    expect(await prisma.mfaGrant.count({ where: { sessionDigest: mfaGrantDigest("mfa-session-c")! } })).toBe(0);
  });

  test("staff changes and organisation locks re-check the session's MFA grant under the lock", async () => {
    configureMfa("enroll");
    const { user, organisation } = await createOrganisationAccount();
    const other = await createMember();
    const target = await createOrganisationStaff({ organisationId: organisation.id, userId: other.id, role: "event_manager" });
    const actor = (mfaSessionId?: string) => ({ id: user.id, authVersion: user.authVersion, mfaSessionId });
    const lock = (mfaSessionId?: string) => prisma.$transaction((tx) => lockOrganisationActor(tx, actor(mfaSessionId), organisation.id, "staff:manage"));
    const update = (mfaSessionId: string | undefined, role: "admin" | "event_manager") => updateOrganisationStaff(actor(mfaSessionId), organisation.id, target.id, { role });

    // Enrolment stage: not enrolled yet is allowed; enforced, it is not.
    await expect(lock(sessionA)).resolves.toMatchObject({ id: organisation.id });
    vi.stubEnv("MFA_ENFORCEMENT_MODE", "enforce");
    await expect(update(sessionA, "admin")).rejects.toMatchObject({ kind: "authority", message: "Staff authenticator verification required" });
    await expect(lock(sessionA)).rejects.toBeInstanceOf(StaffMfaRequiredError);

    const setup = await beginStaffMfaEnrollment(user.id, user.email, now);
    await confirmStaffMfaEnrollment(user.id, totpCode(setup.secret, Math.floor(now.getTime() / 30_000)), mfaGrantDigest(sessionA)!, now);
    await expect(update(sessionA, "admin")).resolves.toMatchObject({ role: "admin" });
    await expect(lock(sessionA)).resolves.toMatchObject({ id: organisation.id });

    // Another session, or none, has no grant.
    for (const session of [sessionB, undefined]) {
      await expect(update(session, "event_manager")).rejects.toMatchObject({ kind: "authority" });
      await expect(lock(session)).rejects.toBeInstanceOf(StaffMfaRequiredError);
    }
    // A grant that expired after the request's own check no longer counts.
    await prisma.mfaGrant.updateMany({ where: { userId: user.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await expect(update(sessionA, "event_manager")).rejects.toMatchObject({ kind: "authority" });
    await expect(lock(sessionA)).rejects.toBeInstanceOf(StaffMfaRequiredError);
    expect((await prisma.organisationStaff.findUniqueOrThrow({ where: { id: target.id } })).role).toBe("admin");
  });

  test("through the routes: set up, confirm and verify with real codes; a wrong code is a 400 and missing abuse protection a 503", async () => {
    configureMfa();
    setRateLimitTestBackend(createTestRateLimitBackend());
    onTestFinished(() => setRateLimitTestBackend(null));
    const { user, organisation } = await createOrganisationAccount();
    setMockSession({ userId: user.id, email: user.email, accountRole: "organisation", mfaSessionId: sessionA });
    const call = (route: (request: Request) => Promise<Response>, path: string, body?: unknown) =>
      route(jsonRequest(`http://localhost:3000/api/me/mfa/${path}`, body, { method: "POST" }));

    // A session alone can't enrol a phone: setup asks for the account password.
    expect((await call(setupRoute, "setup")).status).toBe(400);
    expect((await call(setupRoute, "setup", { password: "not-the-password" })).status).toBe(403);
    expect(await prisma.userMfa.findUnique({ where: { userId: user.id } })).toBeNull();
    const started = await call(setupRoute, "setup", { password: "password123" });
    expect(started.status).toBe(200);
    const { secret } = await parseJsonResponse(started);
    const step = Math.floor(Date.now() / 30_000);
    // SEC-028: bodies are bounded and strict before any code is checked.
    for (const [route, path] of [[confirmRoute, "confirm"], [verifyRoute, "verify"]] as const) {
      expect((await call(route, path, { code: totpCode(secret, step), padding: "x".repeat(100_001) })).status).toBe(400);
      expect((await call(route, path, { code: totpCode(secret, step), extra: true })).status).toBe(400);
    }
    expect((await call(confirmRoute, "confirm", { code: totpCode(secret, step + 10) })).status).toBe(400);
    const confirmed = await call(confirmRoute, "confirm", { code: totpCode(secret, step) });
    expect(confirmed.status).toBe(200);
    expect((await parseJsonResponse(confirmed)).recoveryCodes).toHaveLength(10);
    await expect(requireCurrentOrganisationAccount()).resolves.toMatchObject({ id: organisation.id });

    setMockSession({ userId: user.id, email: user.email, accountRole: "organisation", mfaSessionId: sessionB });
    await expect(requireCurrentOrganisationAccount()).rejects.toBeInstanceOf(StaffMfaRequiredError);
    const verified = await call(verifyRoute, "verify", { code: totpCode(secret, step + 1) });
    expect(verified.status).toBe(200);
    expect(await parseJsonResponse(verified)).toEqual({ verified: true });
    await expect(requireCurrentOrganisationAccount()).resolves.toMatchObject({ id: organisation.id });
    expect((await call(verifyRoute, "verify", { code: totpCode(secret, step + 1) })).status).toBe(400);

    // UI-018: new recovery codes through the route, with a strict body (its own count on the verify limit).
    setRateLimitTestBackend(createTestRateLimitBackend());
    // Codes from now on are within the window but at or below the step verify used, so start again just before it.
    await prisma.userMfa.update({ where: { userId: user.id }, data: { lastAcceptedStep: BigInt(step - 2) } });
    const current = () => totpCode(secret, Math.floor(Date.now() / 30_000));
    expect((await call(recoveryCodesRoute, "recovery-codes", { password: "password123", code: current(), extra: true })).status).toBe(400);
    expect((await call(recoveryCodesRoute, "recovery-codes", { password: "not-the-password", code: current() })).status).toBe(400);
    const replaced = await call(recoveryCodesRoute, "recovery-codes", { password: "password123", code: current() });
    expect(replaced.status).toBe(200);
    expect(replaced.headers.get("Cache-Control")).toBe("no-store");
    expect((await parseJsonResponse(replaced)).recoveryCodes).toHaveLength(10);

    vi.stubEnv("RATE_LIMIT_ENABLED", "false");
    expect((await call(verifyRoute, "verify", { code: totpCode(secret, step + 3) })).status).toBe(503);
    expect((await call(recoveryCodesRoute, "recovery-codes", { password: "password123", code: totpCode(secret, step + 3) })).status).toBe(503);
  });
});
