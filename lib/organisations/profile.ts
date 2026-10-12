import { z } from "zod";
import { prisma } from "@/lib/db";
import type { AccountActor } from "@/lib/auth/account-lifecycle";
import { lockOrganisationActor } from "./authority";
import { AssetError } from "@/lib/assets/image";
import { assetReferenced } from "@/lib/assets/references";

export const profileSchema = z
  .object({
    expectedProfileVersion: z.number().int().min(1).max(2147483646),
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(5000),
    supportEmail: z.union([z.literal(""), z.email().max(254)]),
    refundPolicy: z.string().trim().max(5000),
    pickupPolicy: z.string().trim().max(5000),
    timeZone: z
      .string()
      .trim()
      .max(64)
      .refine((value) => {
        if (value !== "UTC" && !value.includes("/")) return false;
        try {
          new Intl.DateTimeFormat("en-AU", { timeZone: value });
          return true;
        } catch {
          return false;
        }
      }, "Choose an IANA timezone, for example Australia/Brisbane"),
    logoAssetId: z.string().min(1).max(100).nullable(),
    coverAssetId: z.string().min(1).max(100).nullable(),
  })
  .strict();
export type ProfileInput = z.infer<typeof profileSchema>;
export const profileSelect = {
  id: true,
  slug: true,
  name: true,
  description: true,
  supportEmail: true,
  refundPolicy: true,
  pickupPolicy: true,
  timeZone: true,
  logoAssetId: true,
  coverAssetId: true,
  onboardingCompletedAt: true,
  profileVersion: true,
} as const;

export async function readProfile(organisationId: string) {
  return prisma.organisation.findUnique({
    where: { id: organisationId },
    select: profileSelect,
  });
}

export async function updateProfile(
  actor: AccountActor,
  organisationId: string,
  input: ProfileInput,
) {
  const { expectedProfileVersion, ...values } = profileSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    const current = await lockOrganisationActor(
      tx,
      actor,
      organisationId,
      "organisation:settings",
    );
    if (current.profileVersion !== expectedProfileVersion)
      throw new AssetError(
        409,
        "This profile changed. Reload the latest version before saving.",
      );
    const ids = [
      ...new Set(
        [
          current.logoAssetId,
          current.coverAssetId,
          values.logoAssetId,
          values.coverAssetId,
        ].filter((id): id is string => !!id),
      ),
    ].sort();
    for (const id of ids)
      await tx.$queryRaw`SELECT "id" FROM "Asset" WHERE "id" = ${id} FOR UPDATE`;
    for (const kind of ["logo", "cover"] as const) {
      const id = values[`${kind}AssetId`];
      if (!id) continue;
      const asset = await tx.asset.findFirst({
        where: { id, organisationId, kind, status: "ready", deletedAt: null },
      });
      if (!asset)
        throw new AssetError(
          400,
          "Choose a ready image uploaded for this society and image type",
        );
    }
    const complete = !!(
      values.name &&
      values.description &&
      values.supportEmail
    );
    const profile = await tx.organisation.update({
      where: { id: organisationId },
      data: {
        ...values,
        profileVersion: { increment: 1 },
        onboardingCompletedAt: complete
          ? (current.onboardingCompletedAt ?? new Date())
          : null,
      },
      select: profileSelect,
    });
    for (const id of ids)
      await tx.asset.update({
        where: { id },
        data: {
          unreferencedAt: (await assetReferenced(tx, id)) ? null : new Date(),
        },
      });
    await tx.auditLog.create({
      data: {
        organisationId,
        actorUserId: actor.id,
        action: "organisation.profile_updated",
        targetType: "Organisation",
        targetId: organisationId,
        metadata: {
          profileVersion: profile.profileVersion,
          changedFields: Object.keys(values).filter(
            (key) =>
              current[key as keyof typeof values] !==
              values[key as keyof typeof values],
          ),
        },
      },
    });
    return profile;
  });
}
