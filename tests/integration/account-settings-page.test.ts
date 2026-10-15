import { describe, expect, test, vi } from "vitest";
import AccountSettingsPage from "@/app/account/settings/page";
import { setMockSession } from "@/tests/helpers/auth";
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
