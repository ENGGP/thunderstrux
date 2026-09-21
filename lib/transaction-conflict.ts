export function isTransactionConflict(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return false;
  }
  if (error.code === "P2034") return true;

  // Prisma raw queries preserve PostgreSQL SQLSTATE in P2010 metadata.
  if (error.code !== "P2010" || !("meta" in error)) return false;
  const meta = error.meta;
  return (
    typeof meta === "object" &&
    meta !== null &&
    "code" in meta &&
    (meta.code === "40001" || meta.code === "40P01")
  );
}
