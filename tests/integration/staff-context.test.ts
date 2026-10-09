import { describe, expect, test } from "vitest";
import { prisma } from "@/lib/db";
import { readAccountContext } from "@/lib/auth/context";
import { encodeContext, decodeContext } from "@/lib/auth/context-cookie";
import { POST } from "@/app/api/me/context/route";
import { setMockSession, selectMockContext } from "@/tests/helpers/auth";
import { createMember, createOrganisationAccount, createOrganisationStaff, createEvent } from "@/tests/helpers/test-data";
import { jsonRequest } from "@/tests/helpers/http";
import { getOrganisationEventAnalytics, getOrganisationEventRevenueSeries } from "@/lib/events/event-analytics";
import { getOrganisationEventTickets } from "@/lib/tickets/check-in";
import { updateOrganisationStaff } from "@/lib/staff/management";

describe("explicit staff context and capabilities", () => {
  test("bootstrap defaults stay on the owned tenant and never switch after its revocation", async () => {
    const { user, organisation } = await createOrganisationAccount();
    const second = await createOrganisationAccount();
    await createOrganisationStaff({ organisationId: second.organisation.id, userId: user.id });
    setMockSession({ userId: user.id, email: user.email, accountRole: "organisation" });
    expect((await readAccountContext()).selected?.id).toBe(organisation.id);
    await prisma.organisationStaff.updateMany({ where: { userId: user.id, organisationId: organisation.id }, data: { status: "revoked" } });
    expect((await readAccountContext()).selected).toBeNull();
    globalThis.__THUNDERSTRUX_TEST_CONTEXT__ = "tampered";
    expect((await readAccountContext()).selected).toBeNull();
  });
  test("member login is personal; tenant selection is live and never falls through on revocation", async () => {
    const { organisation } = await createOrganisationAccount();
    const member = await createMember();
    const staff = await createOrganisationStaff({ organisationId: organisation.id, userId: member.id });
    const second = await createOrganisationAccount();
    await createOrganisationStaff({ organisationId: second.organisation.id, userId: member.id });
    setMockSession({ userId: member.id, email: member.email, accountRole: "member" });
    expect((await readAccountContext()).selected).toBeNull();
    selectMockContext({ mode: "staff", organisationId: organisation.id });
    expect((await readAccountContext()).selected?.id).toBe(organisation.id);
    await prisma.organisationStaff.update({ where: { id: staff.id }, data: { status: "revoked" } });
    expect((await readAccountContext()).selected).toBeNull();
    selectMockContext({ mode: "personal" });
    expect((await readAccountContext()).selected).toBeNull();
  });
  test("preferences bind user, auth version and login, and reject tampering", () => {
    const identity = { id: "user", authVersion: 2, mfaSessionId: "login1" };
    const token = encodeContext({ mode: "staff", organisationId: "org" }, identity);
    expect(decodeContext(token, identity)).toEqual({ mode: "staff", organisationId: "org" });
    for (const changed of [{ ...identity, id: "other" }, { ...identity, authVersion: 3 }, { ...identity, mfaSessionId: "login2" }])
      expect(decodeContext(token, changed)).toBeNull();
    expect(decodeContext(token + "x", identity)).toBeNull();
  });
  test("context mutation rejects foreign tenants and untrusted origins", async () => {
    const { organisation } = await createOrganisationAccount();
    const member = await createMember();
    setMockSession({ userId: member.id, email: member.email, accountRole: "member" });
    expect((await POST(jsonRequest("http://localhost/api/me/context", { mode: "staff", organisationId: organisation.id }))).status).toBe(403);
    expect((await POST(jsonRequest("http://localhost/api/me/context", { mode: "personal" }, { headers: { origin: "https://foreign.invalid" } }))).status).toBe(403);
    delete globalThis.__THUNDERSTRUX_TEST_SESSION__!.user.staffMfaSessionId;
    expect((await POST(jsonRequest("http://localhost/api/me/context", { mode: "personal" }))).status).toBe(403);
  });
  test("event managers get attendance without money and check-in staff cannot read drafts", async () => {
    const { organisation } = await createOrganisationAccount();
    const member = await createMember();
    const staff = await createOrganisationStaff({ organisationId: organisation.id, userId: member.id });
    const event = await createEvent({ organisationId: organisation.id, status: "draft" });
    setMockSession({ userId: member.id, email: member.email, accountRole: "member" });
    const analytics = await getOrganisationEventAnalytics(organisation.id, event.id);
    expect(analytics.totals.revenue).toBeNull();
    expect(analytics.ticketTypes.every(row => row.revenue === null)).toBe(true);
    await expect(getOrganisationEventRevenueSeries(organisation.id, event.id)).rejects.toThrow("Insufficient staff permissions");
    await prisma.organisationStaff.update({ where: { id: staff.id }, data: { role: "check_in_staff" } });
    await expect(getOrganisationEventTickets(organisation.id, event.id)).rejects.toThrow("Event not found");
    await prisma.event.update({ where: { id: event.id }, data: { status: "published" } });
    expect((await getOrganisationEventTickets(organisation.id, event.id)).event.id).toBe(event.id);
  });
  test("admins cannot grant or remove owner authority", async () => {
    const { user: owner, organisation } = await createOrganisationAccount();
    const admin = await createMember();
    const target = await createMember();
    await createOrganisationStaff({ organisationId: organisation.id, userId: admin.id, role: "admin" });
    const targetStaff = await createOrganisationStaff({ organisationId: organisation.id, userId: target.id });
    const actor = { id: admin.id, authVersion: admin.authVersion };
    await expect(updateOrganisationStaff(actor, organisation.id, targetStaff.id, { role: "owner" })).rejects.toThrow("Only owners");
    const ownerStaff = await prisma.organisationStaff.findUniqueOrThrow({ where: { organisationId_userId: { organisationId: organisation.id, userId: owner.id } } });
    await expect(updateOrganisationStaff(actor, organisation.id, ownerStaff.id, { status: "revoked" })).rejects.toThrow("Only owners");
    expect(await prisma.auditLog.count({ where: { action: "staff.updated" } })).toBe(0);
  });
});
