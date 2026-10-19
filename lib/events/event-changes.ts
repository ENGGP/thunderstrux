import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { enqueueNotification } from "@/lib/email/notification-outbox";
import { formatDateRange } from "@/lib/format";
import { buyerIdentitySelect, retainedBuyerIdentity } from "@/lib/orders/buyer-identity";
import { zoneCity } from "@/lib/zoned-time";

// Material event changes (T30, readiness plan §5): a new time or place for an
// event with issued tickets emails each valid holder once. The edit records
// the change in its own transaction; the notification worker fans it out in
// pages of orders after the change's cursor, so a stopped run resumes where it
// left off and a repeated page queues nothing twice (the outbox key is the
// event version, purchase and recipient).

type Schedule = { startTime: Date; endTime: Date; location: string };

// Holders hear about an edit after this pause, so a quick correction or undo
// sends one email, or none, instead of two.
export const eventChangeDelayMs = 5 * 60_000;
const pageSize = 100;

const sameTime = (a: Schedule, b: Schedule) => a.startTime.getTime() === b.startTime.getTime() && a.endTime.getTime() === b.endTime.getTime();
const samePlace = (a: Schedule, b: Schedule) => a.location.trim() === b.location.trim();

// Inside the event edit's transaction, with the Event row locked.
export async function recordEventChange(
  tx: Prisma.TransactionClient,
  input: { eventId: string; organisationId: string; eventVersion: number; actorUserId?: string | null; before: Schedule; after: Schedule },
  now = new Date()
) {
  if (sameTime(input.before, input.after) && samePlace(input.before, input.after)) return null;
  if (!(await tx.ticket.findFirst({ where: { eventId: input.eventId, validity: "active" }, select: { id: true } }))) return null;
  let before = input.before;
  // A newer edit replaces a change nobody has been emailed about yet and keeps
  // its original "was". One the worker has started stays and finishes.
  const unsent = await tx.eventChange.findFirst({ where: { eventId: input.eventId, completedAt: null, cursor: null }, orderBy: { createdAt: "desc" } });
  if (unsent) {
    const replaced = await tx.eventChange.updateMany({ where: { id: unsent.id, completedAt: null, cursor: null }, data: { completedAt: now, outcome: "superseded" } });
    if (replaced.count === 1) {
      before = { startTime: unsent.previousStartTime, endTime: unsent.previousEndTime, location: unsent.previousLocation };
      // Changed back before anyone heard: nothing to tell.
      if (sameTime(before, input.after) && samePlace(before, input.after)) return null;
    }
  }
  return tx.eventChange.create({
    data: {
      eventId: input.eventId, organisationId: input.organisationId, eventVersion: input.eventVersion, actorUserId: input.actorUserId ?? null,
      previousStartTime: before.startTime, previousEndTime: before.endTime, previousLocation: before.location,
      startTime: input.after.startTime, endTime: input.after.endTime, location: input.after.location
    }
  });
}

function changeMessage(change: Schedule & { previousStartTime: Date; previousEndTime: Date; previousLocation: string }, title: string, seller: string, timeZone: string) {
  const was = { startTime: change.previousStartTime, endTime: change.previousEndTime, location: change.previousLocation };
  const when = (schedule: Schedule) => `${formatDateRange(schedule.startTime, schedule.endTime, timeZone)} (${zoneCity(timeZone)} time)`;
  return [
    `${seller} changed ${sameTime(was, change) ? "the place" : samePlace(was, change) ? "the time" : "the time and place"} of ${title}.`,
    sameTime(was, change) ? `When: ${when(change)}, unchanged.` : `When: now ${when(change)}. It was ${when(was)}.`,
    samePlace(was, change) ? `Where: ${change.location}, unchanged.` : `Where: now ${change.location}. It was ${was.location}.`,
    `Your tickets are still valid. If you can no longer go, contact ${seller}.`
  ].join(" ");
}

// One page of the oldest due change. Null when none is due.
async function fanOutPage(now: Date) {
  return prisma.$transaction(async (tx) => {
    const [due] = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "EventChange"
      WHERE "completedAt" IS NULL AND "createdAt" <= ${new Date(now.getTime() - eventChangeDelayMs)}
      ORDER BY "createdAt", "id" FOR UPDATE SKIP LOCKED LIMIT 1
    `;
    if (!due) return null;
    const change = await tx.eventChange.findUniqueOrThrow({
      where: { id: due.id },
      include: { event: { select: { title: true, organisation: { select: { name: true, timeZone: true } } } } }
    });
    const orders = await tx.order.findMany({
      where: {
        eventId: change.eventId, status: "paid", fulfilledAt: { not: null }, tickets: { some: { validity: "active" } },
        ...(change.cursor ? { id: { gt: change.cursor } } : {})
      },
      orderBy: { id: "asc" },
      take: pageSize,
      select: { id: true, sellerName: true, ...buyerIdentitySelect, user: { select: { email: true, firstName: true, lastName: true, displayName: true } } }
    });
    const { title, organisation } = change.event;
    let queued = 0;
    for (const order of orders) {
      const recipient = retainedBuyerIdentity(order)?.email;
      if (!recipient) continue;
      const seller = order.sellerName ?? organisation.name;
      const { enqueued } = await enqueueNotification(tx, {
        eventKey: `event-change/${change.eventId}/${change.eventVersion}/${order.id}`, recipient, template: "business_notice", organisationId: change.organisationId,
        payload: {
          subject: `Change to ${title}`.slice(0, 200),
          message: changeMessage(change, title, seller, organisation.timeZone),
          ...(order.user ? { link: new URL("/tickets", process.env.NEXT_PUBLIC_APP_URL).toString() } : {})
        }
      });
      if (enqueued) queued += 1;
    }
    await tx.eventChange.update({
      where: { id: change.id },
      data: {
        cursor: orders.at(-1)?.id ?? change.cursor,
        notifiedCount: { increment: queued },
        ...(orders.length < pageSize ? { completedAt: now, outcome: "sent" } : {})
      }
    });
    return queued;
  });
}

// Bounded per worker run: at most `pages` pages of 100 holders.
export async function fanOutEventChanges(now = new Date(), pages = 5) {
  let queued = 0;
  for (let page = 0; page < pages; page += 1) {
    const count = await fanOutPage(now);
    if (count === null) break;
    queued += count;
  }
  return queued;
}
