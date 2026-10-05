import type { Prisma } from "@prisma/client";
// Database-only primitive: workers must not load HTTP auth/CSRF configuration.
export async function lockAccount(tx: Prisma.TransactionClient, userId: string) {
  await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
  return tx.user.findUnique({ where: { id: userId } });
}
