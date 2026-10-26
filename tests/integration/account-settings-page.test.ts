import { describe, expect, test, vi } from "vitest";
import { PATCH as updateProfile } from "@/app/api/me/profile/route";
import AccountSettingsPage from "@/app/account/settings/page";
import { prisma } from "@/lib/db";
import { setMockSession } from "@/tests/helpers/auth";
import { jsonRequest } from "@/tests/helpers/http";
import { renderPage } from "@/tests/helpers/render";
import {
  createMember,
  createOrganisationAccount,
  createOrganisationStaff
} from "@/tests/helpers/test-data";

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  usePathname: () => "/account/settings",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() })
}));

vi.mock("next-auth/react", () => ({
  signOut: vi.fn(),
  useSession: () => ({ status: "authenticated", data: null, update: vi.fn() })
}));

describe("account settings page", () => {
  test("offers the authenticator only to people who could use it", async () => {
    const member = await createMember();
    setMockSession({ userId: member.id, email: member.email, accountRole: "member" });
    const plain = await renderPage(await AccountSettingsPage());
    expect(plain).toContain("Password and security");
    expect(plain).not.toContain("Authenticator app");

    const { organisation } = await createOrganisationAccount();
    await createOrganisationStaff({ organisationId: organisation.id, userId: member.id });
    const staff = await renderPage(await AccountSettingsPage());
    expect(staff).toContain("Authenticator app");
    expect(staff).toContain("/mfa?callbackUrl=/account/settings");
  });
});

describe("profile route", () => {
  const save = (body: unknown) => updateProfile(jsonRequest("http://localhost:3000/api/me/profile", body, { method: "PATCH" }));

  test("a member saves their details and blanks clear the optional ones; a society account, a stale session and a missing name are refused", async () => {
    const member = await createMember();
    setMockSession({ userId: member.id, email: member.email, accountRole: "member" });
    const saved = await save({ firstName: " Ada ", lastName: "Lovelace", displayName: "", phone: "0400 000 000", studentNumber: "" });
    expect(saved.status).toBe(200);
    expect((await saved.json()).user).toMatchObject({ id: member.id, firstName: "Ada", lastName: "Lovelace", displayName: null, phone: "0400 000 000", studentNumber: null, onboardingCompletedAt: expect.any(String) });

    expect((await save({ firstName: "", lastName: "Lovelace" })).status).toBe(400);
    setMockSession({ userId: member.id, email: member.email, accountRole: "member", authVersion: 1 });
    expect((await save({ firstName: "Grace", lastName: "Hopper" })).status).toBe(401);
    const society = await createOrganisationAccount();
    setMockSession({ userId: society.user.id, email: society.user.email, accountRole: "organisation" });
    expect((await save({ firstName: "Grace", lastName: "Hopper" })).status).toBe(403);
    expect(await prisma.user.findUniqueOrThrow({ where: { id: member.id }, select: { firstName: true } })).toEqual({ firstName: "Ada" });
  });
});
