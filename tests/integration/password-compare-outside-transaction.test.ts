import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, test, vi } from "vitest";
import { prisma } from "@/lib/db";
import { accountTokenDigest, changePassword, consumeVerification, lockAccount, AccountTokenError } from "@/lib/auth/account-lifecycle";
import { createUser } from "@/tests/helpers/test-data";

// SEC-077: a password compare waits on a small worker pool, so it must never run while a
// transaction holds a pooled connection and the account's row lock. While the compare is
// paused here, an independent transaction must lock the same account at once.
const gate = vi.hoisted(() => ({ paused: null as null | { started: () => void; release: Promise<void> } }));
vi.mock("@/lib/auth/password-hash", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/password-hash")>();
  return { ...actual, comparePassword: async (password: string, digest: string) => {
    const paused = gate.paused;
    if (paused) { paused.started(); await paused.release; }
    return actual.comparePassword(password, digest);
  } };
});
afterEach(() => { gate.paused = null; });

function pauseCompare() {
  let started!: () => void; let release!: () => void;
  const begun = new Promise<void>(resolve => { started = resolve; });
  gate.paused = { started, release: new Promise<void>(resolve => { release = resolve; }) };
  return { begun, release };
}
// Resolves "free" when the account row can be locked within a second.
async function accountLockState(userId: string) {
  const locking = prisma.$transaction(tx => lockAccount(tx, userId), { timeout: 10_000, maxWait: 5_000 }).then(() => "free" as const);
  return Promise.race([locking, new Promise<"held">(resolve => setTimeout(() => resolve("held"), 1_000))]);
}
async function unverifiedWithToken() {
  const user = await prisma.user.update({ where: { id: (await createUser()).id }, data: { emailVerifiedAt: null } });
  const raw = randomBytes(32).toString("base64url");
  await prisma.authToken.create({ data: { userId: user.id, tokenHash: accountTokenDigest(raw), purpose: "verify_account", email: user.email,
    authVersion: user.authVersion, expiresAt: new Date(Date.now() + 3_600_000) } });
  return { user, raw };
}

describe("password compares run outside transactions (SEC-077)", () => {
  test("verifying an email holds no row lock while its password is checked", async () => {
    const { user, raw } = await unverifiedWithToken();
    const { begun, release } = pauseCompare();
    const consuming = consumeVerification(raw, "password123");
    await begun;
    expect(await accountLockState(user.id)).toBe("free");
    release();
    expect(await consuming).toMatchObject({ verified: true });
  });

  test("changing a password holds no row lock while the current one is checked", async () => {
    const user = await createUser();
    const { begun, release } = pauseCompare();
    const changing = changePassword({ id: user.id, authVersion: 0 }, "password123", "replacement123");
    await begun;
    expect(await accountLockState(user.id)).toBe("free");
    release();
    await changing;
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).authVersion).toBe(1);
  });

  test("a password that changes while it is being checked refuses the stale check", async () => {
    const { user, raw } = await unverifiedWithToken();
    const other = await createUser();
    const replaced = (await prisma.user.findUniqueOrThrow({ where: { id: other.id } })).password;

    let paused = pauseCompare();
    const consuming = consumeVerification(raw, "password123");
    await paused.begun;
    await prisma.user.update({ where: { id: user.id }, data: { password: replaced } });
    paused.release();
    await expect(consuming).rejects.toBeInstanceOf(AccountTokenError);
    expect((await prisma.authToken.findFirstOrThrow({ where: { userId: user.id } })).consumedAt).toBeNull();

    const member = await createUser();
    paused = pauseCompare();
    const changing = changePassword({ id: member.id, authVersion: 0 }, "password123", "replacement123");
    await paused.begun;
    await prisma.user.update({ where: { id: member.id }, data: { password: replaced } });
    paused.release();
    await expect(changing).rejects.toMatchObject({ kind: "invalid_password" });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: member.id } })).authVersion).toBe(0);
  });
});
