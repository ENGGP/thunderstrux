import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { POST as dashboardLink } from "@/app/api/stripe/connect/dashboard/route";
import { prisma } from "@/lib/db";
import { getOrganisationStripeConnectStatus } from "@/lib/stripe/connect";
import { selectMockContext, setMockSession } from "@/tests/helpers/auth";
import { jsonRequest, parseJsonResponse } from "@/tests/helpers/http";
import { createMember, createOrganisationAccount, createOrganisationStaff } from "@/tests/helpers/test-data";

// "Open Stripe dashboard" signs a society's payments staff in to the society's
// own Express Dashboard with a single-use link made on click, never the
// platform's view of the account (which only its owner can open).

const stripe = vi.hoisted(() => ({ createLoginLink: vi.fn() }));
vi.mock("@/lib/stripe", () => ({
  StripeConfigurationError: class StripeConfigurationError extends Error {},
  getAppUrl: () => "http://localhost:3000",
  isLiveStripeKey: () => false,
  getStripe: () => ({ accounts: { createLoginLink: stripe.createLoginLink } })
}));

beforeEach(() => {
  vi.stubEnv("MFA_ENFORCEMENT_MODE", "off");
  stripe.createLoginLink.mockImplementation(async (accountId: string) => ({ object: "login_link", url: `https://connect.stripe.com/express/${accountId}/session` }));
});
afterEach(() => stripe.createLoginLink.mockReset());

const ask = (organisationId: string, headers?: Record<string, string>) =>
  dashboardLink(jsonRequest("http://localhost:3000/api/stripe/connect/dashboard", { organisationId }, headers ? { headers } : undefined));

async function asStaff(organisationId: string, role: "owner" | "admin" | "event_manager" | "finance_manager" | "check_in_staff") {
  const person = await createMember();
  await createOrganisationStaff({ organisationId, userId: person.id, role });
  setMockSession({ userId: person.id, email: person.email, accountRole: "member" });
  selectMockContext({ mode: "staff", organisationId });
  return person;
}

describe("Stripe Express dashboard link", () => {
  test("staff who manage payments get a fresh sign-in link to their society's own account, one per click", async () => {
    const { organisation } = await createOrganisationAccount({ stripeReady: true });
    const openers: string[] = [];
    for (const role of ["owner", "admin"] as const) {
      openers.push((await asStaff(organisation.id, role)).id);
      const response = await ask(organisation.id);
      expect(response.status).toBe(200);
      expect(await parseJsonResponse(response)).toEqual({ url: `https://connect.stripe.com/express/${organisation.stripeAccountId}/session` });
    }
    expect(stripe.createLoginLink).toHaveBeenCalledTimes(2);
    expect(stripe.createLoginLink).toHaveBeenCalledWith(organisation.stripeAccountId);
    // Each opening names who opened it in History.
    const opened = await prisma.auditLog.findMany({ where: { organisationId: organisation.id, action: "stripe_connect.dashboard_opened" }, orderBy: { createdAt: "asc" } });
    expect(opened.map((row) => [row.actorUserId, row.targetId])).toEqual(openers.map((id) => [id, organisation.id]));
    // The page is told a dashboard exists, never handed a platform dashboard address.
    const status = await getOrganisationStripeConnectStatus(organisation.id);
    expect(status).toMatchObject({ dashboard_available: true });
    expect(JSON.stringify(status)).not.toContain("dashboard.stripe.com");
  });

  test("staff without stripe:manage, another society, an unfinished setup and an untrusted origin get no link and Stripe is never asked", async () => {
    const { organisation } = await createOrganisationAccount({ stripeReady: true });
    for (const role of ["event_manager", "finance_manager", "check_in_staff"] as const) {
      await asStaff(organisation.id, role);
      expect((await ask(organisation.id)).status, role).toBeGreaterThanOrEqual(403);
    }

    const other = await createOrganisationAccount({ stripeReady: true });
    await asStaff(other.organisation.id, "owner");
    expect((await ask(organisation.id)).status).toBeGreaterThanOrEqual(403);

    const unfinished = await createOrganisationAccount();
    await prisma.organisation.update({ where: { id: unfinished.organisation.id }, data: { stripeAccountId: "acct_unfinished", stripeAccountStatus: "CONNECTED_INCOMPLETE" } });
    await asStaff(unfinished.organisation.id, "owner");
    const incomplete = await ask(unfinished.organisation.id);
    expect(incomplete.status).toBe(400);

    await asStaff(organisation.id, "owner");
    expect((await ask(organisation.id, { origin: "https://evil.example" })).status).toBe(403);

    expect(stripe.createLoginLink).not.toHaveBeenCalled();
    expect(await prisma.auditLog.count({ where: { action: "stripe_connect.dashboard_opened" } })).toBe(0);
  });
});
