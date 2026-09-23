import { describe, expect, test, vi } from "vitest";
import { prisma } from "@/lib/db";
import { setMockSession } from "@/tests/helpers/auth";
import { createMember, createOrganisationAccount, createOrganisationStaff } from "@/tests/helpers/test-data";
import { requireAnyOrganisationPermission, requireCurrentOrganisationAccount, requireOrganisationPermission, StaffMfaRequiredError } from "@/lib/auth/access";
import { mfaGrantDigest } from "@/lib/security/csrf";
import { beginStaffMfaEnrollment, confirmStaffMfaEnrollment, requireStaffMfa,
  totpCode, verifyStaffMfa, MfaRequiredError, assertStaffMfaConfiguration,
  assertStaffMfaMutationConfiguration, mfaEnforcementMode, deleteExpiredMfaGrants } from "@/lib/security/staff-mfa";

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
});
