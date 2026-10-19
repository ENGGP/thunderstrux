import { Prisma } from "@prisma/client";
import { toZonedInput } from "@/lib/zoned-time";

// An analytics range (readiness plan §6): whole local days in the society's
// zone, at most 366 of them, bucketed by day, week (from Monday) or month.
// Bounds and buckets are computed in SQL from the zone, so a day is a local
// day across daylight saving changes.

export const analyticsBuckets = ["day", "week", "month"] as const;
export type AnalyticsBucket = (typeof analyticsBuckets)[number];
export type AnalyticsRange = { from: string; to: string; bucket: AnalyticsBucket; timeZone: string };

export const maxRangeDays = 366;
const day = 86_400_000;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

export class AnalyticsRangeError extends Error {}

const utc = (date: string) => Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const addDays = (date: string, days: number) => iso(utc(date) + days * day);
export const localToday = (timeZone: string, now = new Date()) => toZonedInput(now, timeZone).slice(0, 10);

// From query input; the default is the last 30 days by day.
export function analyticsRange(input: { from?: string; to?: string; bucket?: string }, timeZone: string, now = new Date()): AnalyticsRange {
  const to = input.to || localToday(timeZone, now);
  const from = input.from || addDays(to, -29);
  const bucket = analyticsBuckets.find((name) => name === (input.bucket || "day"));
  if (!datePattern.test(from) || !datePattern.test(to) || iso(utc(from)) !== from || iso(utc(to)) !== to) throw new AnalyticsRangeError("Dates must be real days written YYYY-MM-DD");
  if (from > to) throw new AnalyticsRangeError("The range must start on or before its end");
  if ((utc(to) - utc(from)) / day + 1 > maxRangeDays) throw new AnalyticsRangeError(`A range can cover at most ${maxRangeDays} days`);
  if (!bucket) throw new AnalyticsRangeError("Group by day, week or month");
  return { from, to, bucket, timeZone };
}

// Every bucket start in the range, as a local date, for zero fill.
export function bucketStarts({ from, to, bucket }: AnalyticsRange) {
  const first = new Date(utc(from));
  if (bucket === "week") first.setUTCDate(first.getUTCDate() - ((first.getUTCDay() + 6) % 7));
  if (bucket === "month") first.setUTCDate(1);
  const starts: string[] = [];
  for (const at = first; iso(at.getTime()) <= to; ) {
    starts.push(iso(at.getTime()));
    if (bucket === "month") at.setUTCMonth(at.getUTCMonth() + 1);
    else at.setUTCDate(at.getUTCDate() + (bucket === "week" ? 7 : 1));
  }
  return starts;
}

// SQL pieces. Columns are UTC timestamps without a zone.
export const startOf = (range: AnalyticsRange) => Prisma.sql`(((${range.from}::date)::timestamp AT TIME ZONE ${range.timeZone}) AT TIME ZONE 'UTC')`;
export const endOf = (range: AnalyticsRange) => Prisma.sql`(((${addDays(range.to, 1)}::date)::timestamp AT TIME ZONE ${range.timeZone}) AT TIME ZONE 'UTC')`;
export const within = (column: Prisma.Sql, range: AnalyticsRange) => Prisma.sql`${column} >= ${startOf(range)} AND ${column} < ${endOf(range)}`;
export const bucketOf = (column: Prisma.Sql, range: AnalyticsRange) =>
  Prisma.sql`to_char(date_trunc(${range.bucket}, (${column} AT TIME ZONE 'UTC') AT TIME ZONE ${range.timeZone}), 'YYYY-MM-DD')`;

// Rows keyed by bucket, filled to every bucket with zeros.
export function zeroFill<Key extends string>(range: AnalyticsRange, rows: Array<{ bucket: string } & Partial<Record<Key, unknown>>>, keys: readonly Key[]) {
  const found = new Map(rows.map((row) => [row.bucket, row]));
  return bucketStarts(range).map((start) => {
    const row = found.get(start);
    return { start, ...Object.fromEntries(keys.map((key) => [key, Number(row?.[key] ?? 0)])) } as { start: string } & Record<Key, number>;
  });
}
