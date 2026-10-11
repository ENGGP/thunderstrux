import type { Prisma } from "@prisma/client";

export async function assetReferenced(_tx: Prisma.TransactionClient, _id: string) {
  // New public-content consumers must extend this check before attaching assets.
  return false;
}
