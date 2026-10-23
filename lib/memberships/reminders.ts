import { prisma } from "@/lib/db";
import { enqueueNotification } from "@/lib/email/notification-outbox";
import { formatDate, membershipLabel } from "@/lib/format";
import { zoneCity } from "@/lib/zoned-time";
import { appUrl } from "@/lib/app-url";

// Membership renewal reminders and expiry notices (T30, readiness plan §5).
// The notification worker runs this every minute, so a late or missed run
// catches up; each grant gets at most one of each (the outbox key). Neither
// extends a term: memberships never renew on their own.
//
// - The reminder goes seven days before a membership ends, if the member
//   held it at that point, still wants reminders (Account settings) and has
//   no later membership with the society. It is the only optional mail.
// - The expiry notice goes once it has ended, within a week, unless it was
//   revoked (that sent its own notice) or a later membership follows.

const day = 86_400_000;
export const renewalLeadMs = 7 * day;
const expiryLookbackMs = 7 * day;

type Due = { id: string; kind: "renewal" | "expired" };

async function dueGrants(now: Date, limit: number) {
  const soon = new Date(now.getTime() + renewalLeadMs);
  const since = new Date(now.getTime() - expiryLookbackMs);
  return prisma.$queryRaw<Due[]>`
    SELECT g."id", CASE WHEN g."endsAt" > ${now} THEN 'renewal' ELSE 'expired' END AS "kind"
    FROM "MembershipGrant" g JOIN "User" u ON u."id" = g."userId"
    WHERE g."revokedAt" IS NULL AND u."closedAt" IS NULL AND u."disabledAt" IS NULL
      AND (
        (g."endsAt" > ${now} AND g."endsAt" <= ${soon} AND g."startsAt" <= ${now}
          AND g."grantedAt" <= g."endsAt" - interval '7 days' AND u."renewalReminders"
          AND NOT EXISTS (SELECT 1 FROM "NotificationOutbox" o WHERE o."eventKey" = 'membership-renewal/' || g."id"))
        OR (g."endsAt" <= ${now} AND g."endsAt" > ${since}
          AND NOT EXISTS (SELECT 1 FROM "NotificationOutbox" o WHERE o."eventKey" = 'membership-expired/' || g."id"))
      )
      AND NOT EXISTS (
        SELECT 1 FROM "MembershipGrant" n
        WHERE n."userId" = g."userId" AND n."organisationId" = g."organisationId" AND n."revokedAt" IS NULL AND n."endsAt" > g."endsAt"
      )
    ORDER BY g."endsAt", g."id"
    LIMIT ${limit}
  `;
}

export async function queueMembershipNotices(now = new Date(), limit = 100) {
  let queued = 0;
  for (const due of await dueGrants(now, limit)) {
    await prisma.$transaction(async (tx) => {
      const grant = await tx.membershipGrant.findUniqueOrThrow({
        where: { id: due.id },
        select: {
          id: true, organisationId: true, endsAt: true, userId: true,
          user: { select: { email: true } },
          product: { select: { name: true } },
          organisation: { select: { name: true, timeZone: true } }
        }
      });
      // The society's next plan on sale that starts once this one ends, as My memberships offers it.
      const next = await tx.membershipProduct.findFirst({
        where: { organisationId: grant.organisationId, status: "published", startsAt: { gte: grant.endsAt }, endsAt: { gt: now } },
        orderBy: [{ startsAt: "asc" }, { id: "asc" }],
        select: { name: true }
      });
      const { name: society, timeZone } = grant.organisation;
      const label = membershipLabel(grant.product.name);
      const lastDay = `${formatDate(new Date(grant.endsAt.getTime() - 1), timeZone)} (${zoneCity(timeZone)})`;
      const offer = next ? ` ${society} has ${membershipLabel(next.name)} on sale now; get it from My memberships.` : "";
      const { enqueued } = await enqueueNotification(tx, {
        eventKey: `membership-${due.kind}/${grant.id}`, recipient: grant.user.email, userId: grant.userId, template: "business_notice", organisationId: grant.organisationId,
        payload: due.kind === "renewal"
          ? {
              subject: `Your ${label} ends soon`.slice(0, 200),
              message: `Your ${label} with ${society} ends after ${lastDay}. Memberships don't renew automatically.${offer || ` ${society} hasn't put its next membership on sale yet.`} You can turn off renewal reminders in Account settings.`,
              link: new URL("/memberships", appUrl()).toString()
            }
          : {
              subject: `Your ${label} has ended`.slice(0, 200),
              message: `Your ${label} with ${society} ended after ${lastDay}, so its member benefits have stopped.${offer}`,
              link: new URL("/memberships", appUrl()).toString()
            }
      });
      if (enqueued) queued += 1;
    });
  }
  return queued;
}
