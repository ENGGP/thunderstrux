import { expect, test, vi } from "vitest";
import sharp from "sharp";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { prisma } from "@/lib/db";
import {
  createMember,
  createOrganisationAccount,
  createUser,
} from "@/tests/helpers/test-data";
import { bootstrapOrganisation } from "@/lib/organisations/bootstrap";
import { profileSchema, updateProfile } from "@/lib/organisations/profile";
import { publicOrganisation } from "@/lib/organisations/public-organisations";
import { uploadAsset, deleteAsset } from "@/lib/assets/service";
import { maintainAssets } from "@/lib/assets/maintenance";
import { GET as publicImage } from "@/app/api/public/assets/[assetId]/route";
import { GET, PATCH } from "@/app/api/orgs/[orgSlug]/profile/route";
import { POST as createOrganisation } from "@/app/api/orgs/route";
import { setMockSession } from "@/tests/helpers/auth";
import { jsonRequest, routeContext } from "@/tests/helpers/http";
import {
  setRateLimitTestBackendFailure,
  setRateLimitTestEnabled,
} from "@/lib/security/rate-limit";
const input = (name = "Society") => ({
  name,
  description: "A welcoming society",
  supportEmail: "hello@example.com",
  refundPolicy: "",
  pickupPolicy: "",
  timeZone: "Australia/Brisbane",
  logoAssetId: null,
  coverAssetId: null,
  expectedProfileVersion: 1,
});

test("bootstrap is atomic, handles slug races and blocks retired-pointer active staff", async () => {
  const user = await createUser({ accountRole: "organisation" });
  const results = await Promise.allSettled([
    bootstrapOrganisation(user, { name: "Race" }),
    bootstrapOrganisation(user, { name: "Race" }),
  ]);
  expect(
    results.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  const org = await prisma.organisation.findUniqueOrThrow({
    where: { accountUserId: user.id },
  });
  expect(
    await prisma.organisationStaff.count({
      where: {
        organisationId: org.id,
        userId: user.id,
        role: "owner",
        status: "active",
      },
    }),
  ).toBe(1);
  expect(
    await prisma.organisationMember.count({
      where: { organisationId: org.id, userId: user.id, role: "org_owner" },
    }),
  ).toBe(1);
  expect(
    await prisma.auditLog.count({
      where: { targetId: org.id, action: "organisation.created" },
    }),
  ).toBe(1);
  await prisma.organisation.update({
    where: { id: org.id },
    data: { accountUserId: null },
  });
  await prisma.organisationStaff.updateMany({
    where: { organisationId: org.id, userId: user.id },
    data: { role: "admin" },
  });
  await expect(bootstrapOrganisation(user, { name: "Second" })).rejects.toThrow(
    "already has",
  );
  await prisma.organisationStaff.updateMany({
    where: { organisationId: org.id, userId: user.id },
    data: { status: "revoked" },
  });
  expect(
    (await bootstrapOrganisation(user, { name: "New primary" })).id,
  ).not.toBe(org.id);
  const users = await Promise.all([
    createUser({ accountRole: "organisation" }),
    createUser({ accountRole: "organisation" }),
  ]);
  const slugs = await Promise.all(
    users.map((actor) => bootstrapOrganisation(actor, { name: "Same slug" })),
  );
  expect(new Set(slugs.map((row) => row.slug)).size).toBe(2);
  await expect(
    bootstrapOrganisation(
      { ...users[0], authVersion: users[0].authVersion - 1 },
      { name: "Stale" },
    ),
  ).rejects.toThrow();
  const exhausted = await createUser({ accountRole: "organisation" });
  await prisma.organisation.createMany({
    data: Array.from({ length: 100 }, (_, index) => ({
      name: "Occupied",
      slug: index ? `occupied-${index + 1}` : "occupied",
    })),
  });
  setMockSession({ ...exhausted, userId: exhausted.id });
  expect(
    (
      await createOrganisation(
        jsonRequest("http://localhost/api/orgs", { name: "Occupied" }),
      )
    ).status,
  ).toBe(400);
});
test("profiles use optimistic versions, derive completion and preserve private/payment identity", async () => {
  const own = await createOrganisationAccount({ stripeReady: true });
  const results = await Promise.allSettled([
    updateProfile(own.user, own.organisation.id, input()),
    updateProfile(own.user, own.organisation.id, input("Other editor")),
  ]);
  expect(
    results.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  const current = await prisma.organisation.findUniqueOrThrow({
    where: { id: own.organisation.id },
  });
  expect(current.profileVersion).toBe(2);
  expect(current.onboardingCompletedAt).not.toBeNull();
  expect(current.slug).toBe(own.organisation.slug);
  expect(current.accountUserId).toBe(own.user.id);
  expect(current.stripeAccountId).toBe(own.organisation.stripeAccountId);
  await updateProfile(own.user, own.organisation.id, {
    ...input(),
    description: "",
    expectedProfileVersion: 2,
  });
  expect(
    (
      await prisma.organisation.findUniqueOrThrow({
        where: { id: own.organisation.id },
      })
    ).onboardingCompletedAt,
  ).toBeNull();
  expect(await publicOrganisation(own.organisation.slug)).not.toHaveProperty(
    "stripeAccountId",
  );
  expect(await publicOrganisation(own.organisation.slug)).not.toHaveProperty(
    "accountUserId",
  );
  for (const invalid of [
    { ...input(), description: "a".repeat(5001) },
    { ...input(), timeZone: "+10:00" },
    { ...input(), supportEmail: "bad" },
    { ...input(), slug: "overwrite" },
  ])
    expect(profileSchema.safeParse(invalid).success).toBe(false);
});
test("only ready same-tenant slot images attach; public bytes and references survive cleanup", async () => {
  const own = await createOrganisationAccount();
  const foreign = await createOrganisationAccount();
  const bytes = await sharp({
    create: { width: 8, height: 6, channels: 3, background: "red" },
  })
    .png()
    .toBuffer();
  const logo = await uploadAsset(own.user, own.organisation.id, "logo", {
    bytes,
    type: "image/png",
  });
  const other = await uploadAsset(
    foreign.user,
    foreign.organisation.id,
    "logo",
    { bytes, type: "image/png" },
  );
  await expect(
    updateProfile(own.user, own.organisation.id, {
      ...input(),
      logoAssetId: other.id,
    }),
  ).rejects.toThrow("ready image");
  await expect(
    updateProfile(own.user, own.organisation.id, {
      ...input(),
      coverAssetId: logo.id,
    }),
  ).rejects.toThrow("ready image");
  await updateProfile(own.user, own.organisation.id, {
    ...input(),
    logoAssetId: logo.id,
  });
  await expect(
    deleteAsset(own.user, own.organisation.id, logo.id),
  ).rejects.toThrow("Remove");
  const response = await publicImage(new Request("http://localhost"), {
    params: Promise.resolve({ assetId: logo.id }),
  });
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("image/webp");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(response.headers.get("cache-control")).toContain("max-age=300");
  // A revalidation and a HEAD are answered from the row; storage is never read (SEC-021).
  const send = vi.spyOn(S3Client.prototype, "send");
  const params = { params: Promise.resolve({ assetId: logo.id }) };
  const revalidated = await publicImage(new Request("http://localhost", { headers: { "If-None-Match": response.headers.get("etag")! } }), params);
  expect(revalidated.status).toBe(304);
  expect(revalidated.headers.get("etag")).toBe(response.headers.get("etag"));
  const head = await publicImage(new Request("http://localhost", { method: "HEAD" }), params);
  expect(head.status).toBe(200);
  expect(head.headers.get("content-length")).toBe(String(logo.byteSize));
  expect(await head.text()).toBe("");
  expect(send.mock.calls.filter(([command]) => command instanceof GetObjectCommand)).toHaveLength(0);
  send.mockRestore();
  await maintainAssets({
    dryRun: false,
    now: new Date(Date.now() + 2 * 86400000),
  });
  expect(
    (await prisma.asset.findUniqueOrThrow({ where: { id: logo.id } })).status,
  ).toBe("ready");
  const detached = await updateProfile(own.user, own.organisation.id, {
    ...input(),
    expectedProfileVersion: 2,
  });
  expect(detached.logoAssetId).toBeNull();
  expect(
    (await prisma.asset.findUniqueOrThrow({ where: { id: logo.id } }))
      .unreferencedAt,
  ).not.toBeNull();
  expect(
    (
      await publicImage(new Request("http://localhost"), {
        params: Promise.resolve({ assetId: logo.id }),
      })
    ).status,
  ).toBe(404);
  await expect(
    prisma.organisation.update({
      where: { id: own.organisation.id },
      data: { logoAssetId: other.id },
    }),
  ).rejects.toThrow();
});
test("profile transport preserves member/tenant, CSRF, strict input and fail-closed Redis denials", async () => {
  const own = await createOrganisationAccount();
  const member = await createMember();
  setMockSession({ ...member, userId: member.id });
  expect(
    (
      await GET(
        jsonRequest("http://localhost"),
        routeContext({ orgSlug: own.organisation.slug }),
      )
    ).status,
  ).toBe(404);
  setMockSession({ ...own.user, userId: own.user.id });
  expect(
    (
      await PATCH(
        jsonRequest("http://localhost", input(), {
          method: "PATCH",
          headers: { origin: "https://foreign.example" },
        }),
        routeContext({ orgSlug: own.organisation.slug }),
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await PATCH(
        jsonRequest(
          "http://localhost",
          { ...input(), stripeAccountId: "bad" },
          { method: "PATCH" },
        ),
        routeContext({ orgSlug: own.organisation.slug }),
      )
    ).status,
  ).toBe(400);
  expect(
    (
      await PATCH(
        jsonRequest(
          "http://localhost",
          { ...input(), description: "x".repeat(80_000) },
          { method: "PATCH" },
        ),
        routeContext({ orgSlug: own.organisation.slug }),
      )
    ).status,
  ).toBe(413);
  setRateLimitTestEnabled(true);
  setRateLimitTestBackendFailure(new Error("synthetic Redis outage"));
  vi.stubEnv("RATE_LIMIT_ENABLED", "true");
  expect(
    (
      await PATCH(
        jsonRequest("http://localhost", input(), { method: "PATCH" }),
        routeContext({ orgSlug: own.organisation.slug }),
      )
    ).status,
  ).toBe(503);
});
