import { prisma } from "@/lib/db";
import { validateIntegrationDatabaseUrl } from "../../scripts/integration-test-guards.mjs";

export function assertTestDatabaseUrl() {
  validateIntegrationDatabaseUrl(process.env.DATABASE_URL);
}

const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;

const listTables = async () =>
  (await prisma.$queryRaw<Array<{ name: string }>>`
    SELECT tablename AS name FROM pg_tables WHERE schemaname = current_schema() AND tablename <> '_prisma_migrations'
  `).map((row) => row.name);

// The statements that empty every application table, read from the
// database's own foreign keys once per run, so a new table is covered without
// a list to keep up to date. Tables go children before parents, so no ON
// DELETE SET NULL or CASCADE action fires and the append-only and snapshot
// triggers (which guard UPDATE) never see a write. A cycle of keys (an
// organisation's logo points at its asset, which points back at the
// organisation) is broken first by clearing the nullable key columns that
// close it. Null when a cycle has no nullable column to clear.
let resetStatements: Promise<string[] | null> | null = null;

async function planReset() {
  const tables = await listTables();
  let keys = await prisma.$queryRaw<Array<{ name: string; child: string; parent: string; nullable: string[] }>>`
    SELECT key.conname AS name, child.relname AS child, parent.relname AS parent,
      coalesce(array_agg(att.attname::text) FILTER (WHERE NOT att.attnotnull), '{}') AS nullable
    FROM pg_constraint key
    JOIN pg_class child ON child.oid = key.conrelid
    JOIN pg_class parent ON parent.oid = key.confrelid
    JOIN pg_attribute att ON att.attrelid = key.conrelid AND att.attnum = ANY (key.conkey)
    WHERE key.contype = 'f' AND key.connamespace = current_schema()::regnamespace AND child.oid <> parent.oid
    GROUP BY key.conname, child.relname, parent.relname
  `;
  const breaks: string[] = [];
  const deletes: string[] = [];
  const pending = new Set(tables);
  while (pending.size > 0) {
    // A table can go once nothing still pending references it.
    const ready = [...pending].filter((table) => !keys.some((key) => key.parent === table && pending.has(key.child)));
    if (ready.length > 0) {
      for (const table of ready.sort()) {
        deletes.push(`DELETE FROM ${quote(table)};`);
        pending.delete(table);
      }
      continue;
    }
    const closing = keys.filter((key) => pending.has(key.child) && pending.has(key.parent) && key.nullable.length > 0);
    if (closing.length === 0) return null;
    for (const key of closing) {
      // A key with a null column is not checked (MATCH SIMPLE), so the row no longer holds its parent.
      breaks.push(`UPDATE ${quote(key.child)} SET ${key.nullable.map((column) => `${quote(column)} = NULL`).join(", ")} WHERE ${key.nullable.map((column) => `${quote(column)} IS NOT NULL`).join(" OR ")};`);
    }
    keys = keys.filter((key) => !closing.includes(key));
  }
  return [...breaks, ...deletes];
}

// The fast children-first reset (PR #93) is kept but switched off: set
// THUNDERSTRUX_FAST_TEST_RESET=1 to use it. By default the suite uses the
// original TRUNCATE reset below. See Development Workflow, "Integration test speed".
export const fastTestReset = () => process.env.THUNDERSTRUX_FAST_TEST_RESET === "1";

// Empties the disposable test database before each test.
export async function resetTestDatabase() {
  assertTestDatabaseUrl();
  if (!fastTestReset()) {
    // The original reset: one TRUNCATE of every table, about half a second per test.
    await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "NotificationOutbox",
      "OrderLifecycleEvent",
      "AuditLog",
      "Asset",
      "OrganisationStaffInvite",
      "OrganisationStaff",
      "Ticket",
      "TicketReservation",
      "CheckoutAttempt",
      "MembershipGrant",
      "MerchandiseReturn",
      "CommerceLifecycleEvent",
      "CommerceOrderLine",
      "CommerceOrder",
      "MembershipProduct",
      "MerchandiseProductImage",
      "MerchandiseVariant",
      "MerchandiseProduct",
      "RefundRequest",
      "PurchaseDispute",
      "Order",
      "GuestAccessGrant",
      "GuestIdentity",
      "TicketType",
      "Event",
      "OrganisationMember",
      "Organisation",
      "User"
    RESTART IDENTITY CASCADE
  `);
    return;
  }
  // Fast reset: DELETE on a few small tables costs a few milliseconds.
  const statements = await (resetStatements ??= planReset());
  if (statements) {
    await prisma.$executeRawUnsafe(`DO $$ BEGIN ${statements.join(" ")} END $$`);
    return;
  }
  // A cycle with nothing nullable to clear: truncate everything at once.
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${(await listTables()).map(quote).join(", ")} RESTART IDENTITY CASCADE`);
}
