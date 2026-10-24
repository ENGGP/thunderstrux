import { describe, expect, test, vi } from "vitest";
import { authorizeCredentials } from "@/lib/auth/credentials";
import { prisma } from "@/lib/db";
import { createMember } from "@/tests/helpers/test-data";

// DEF-035: signing in takes the same bcrypt work whether or not the address has
// an account, so its timing doesn't tell anyone which addresses do.
const bcrypt = vi.hoisted(() => ({ compare: null as unknown as ReturnType<typeof vi.fn> }));
vi.mock("bcryptjs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("bcryptjs")>();
  bcrypt.compare = vi.fn(actual.compare);
  return { ...actual, default: { ...actual, compare: bcrypt.compare }, compare: bcrypt.compare };
});

describe("password sign-in", () => {
  test("an unknown or disabled address does the same password check as a real one, and is refused", async () => {
    const member = await createMember();
    const closed = await createMember();
    await prisma.user.update({ where: { id: closed.id }, data: { disabledAt: new Date() } });
    bcrypt.compare.mockClear();

    expect(await authorizeCredentials({ email: "nobody@example.com", password: "password123" })).toBeNull();
    expect(bcrypt.compare).toHaveBeenCalledTimes(1);
    expect(await authorizeCredentials({ email: closed.email, password: "password123" })).toBeNull();
    expect(bcrypt.compare).toHaveBeenCalledTimes(2);

    expect(await authorizeCredentials({ email: member.email, password: "wrong-password" })).toBeNull();
    expect(await authorizeCredentials({ email: ` ${member.email.toUpperCase()} `, password: "password123" })).toMatchObject({ id: member.id, email: member.email });
    expect(bcrypt.compare).toHaveBeenCalledTimes(4);
    // Nothing to check without both fields.
    expect(await authorizeCredentials({ email: member.email })).toBeNull();
    expect(bcrypt.compare).toHaveBeenCalledTimes(4);
  });
});
