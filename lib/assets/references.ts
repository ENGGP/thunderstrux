import type { Prisma } from "@prisma/client";

// Public delivery: a society's logo or cover, or the image of an event the
// public can open (published and not members-only).
export async function assetPublicReferenced(
  tx: Prisma.TransactionClient,
  id: string,
) {
  return !!(
    (await tx.organisation.findFirst({
      where: { OR: [{ logoAssetId: id }, { coverAssetId: id }] },
      select: { id: true },
    })) ||
    (await tx.event.findFirst({
      where: { heroAssetId: id, status: "published", visibility: { not: "members_only" } },
      select: { id: true },
    }))
  );
}
// Any reference, public or not, keeps an image from deletion and cleanup.
export async function assetReferenced(
  tx: Prisma.TransactionClient,
  id: string,
) {
  return (
    (await assetPublicReferenced(tx, id)) ||
    !!(await tx.event.findFirst({ where: { heroAssetId: id }, select: { id: true } }))
  );
}
