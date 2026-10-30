import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { addDays, endOf, startOf, type AnalyticsRange } from "@/lib/analytics/range";
import { hasOrganisationPermission, type OrganisationStaffRole } from "@/lib/permissions";

// The society calendar (T33, design round C1): a projection of Event rows,
// never a copy. A range is whole local days in the society's zone, at most 93
// of them, and holds every event that overlaps it (starts before its end and
// ends after its start), so a camp crossing a month boundary shows in both.
// Drafts need events:manage; membership end dates need members:read.

export const maxCalendarDays = 93;
export const calendarEventCap = 500;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

export class CalendarRangeError extends Error {}

export const isLocalDate = (value: unknown): value is string =>
  typeof value === "string" && datePattern.test(value) && addDays(value, 0) === value;

export function calendarRange(from: unknown, to: unknown) {
  if (!isLocalDate(from) || !isLocalDate(to)) throw new CalendarRangeError("Give from and to as real days written YYYY-MM-DD");
  if (from > to) throw new CalendarRangeError("The range must start on or before its end");
  if ((Date.parse(to) - Date.parse(from)) / 86_400_000 + 1 > maxCalendarDays) throw new CalendarRangeError(`A range can cover at most ${maxCalendarDays} days`);
  return { from, to };
}

export type CalendarEvent = { id: string; title: string; location: string; status: "draft" | "published"; startTime: Date; endTime: Date; cancelledAt: Date | null };
// One plan's members whose term has its last day on `lastDay` (local).
export type MembershipEnd = { planId: string; name: string; lastDay: string; members: number };

export async function readCalendar(organisationId: string, staffRole: OrganisationStaffRole, range: { from: string; to: string }, timeZone: string) {
  const window: AnalyticsRange = { ...range, bucket: "day", timeZone };
  const published = hasOrganisationPermission(staffRole, "events:manage") ? Prisma.empty : Prisma.sql`AND "status" = 'published'`;
  const [events, membershipEnds] = await Promise.all([
    prisma.$queryRaw<CalendarEvent[]>`
      SELECT "id", "title", "location", "status"::text AS "status", "startTime", "endTime", "cancelledAt"
      FROM "Event"
      WHERE "organisationId" = ${organisationId} AND "startTime" < ${endOf(window)} AND "endTime" > ${startOf(window)} ${published}
      ORDER BY "startTime", "id"
      LIMIT ${calendarEventCap + 1}`,
    hasOrganisationPermission(staffRole, "members:read")
      ? prisma.$queryRaw<MembershipEnd[]>`
        SELECT g."membershipProductId" AS "planId", p."name",
          to_char(((g."endsAt" - interval '1 millisecond') AT TIME ZONE 'UTC') AT TIME ZONE ${timeZone}, 'YYYY-MM-DD') AS "lastDay",
          count(DISTINCT g."userId")::int AS "members"
        FROM "MembershipGrant" g
        JOIN "MembershipProduct" p ON p."id" = g."membershipProductId"
        WHERE g."organisationId" = ${organisationId} AND g."revokedAt" IS NULL
          AND g."endsAt" > ${startOf(window)} AND g."endsAt" <= ${endOf(window)}
        GROUP BY 1, 2, 3
        ORDER BY 3, 2`
      : Promise.resolve([])
  ]);
  return { events: events.slice(0, calendarEventCap), truncated: events.length > calendarEventCap, membershipEnds };
}
