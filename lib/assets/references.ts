import type { Prisma } from "@prisma/client";

export async function assetPublicReferenced(
  tx: Prisma.TransactionClient,
  id: string,
) {
  return !!(await tx.organisation.findFirst({
    where: { OR: [{ logoAssetId: id }, { coverAssetId: id }] },
    select: { id: true },
  }));
}
export async function assetReferenced(
  tx: Prisma.TransactionClient,
  id: string,
) {
  // Future private content must extend this predicate without widening public delivery.
  return assetPublicReferenced(tx, id);
}
