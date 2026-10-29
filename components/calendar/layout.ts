import { addDays } from "@/lib/analytics/range";
import type { CalendarEvent, MembershipEnd } from "@/lib/events/calendar";
import { formatCalendarDay, formatCalendarMonth, formatClock } from "@/lib/format";
import { offsetAt, toZonedInput, zoneAbbreviation, zonedCandidates } from "@/lib/zoned-time";

// Pure layout for the calendar views: local days, lanes and labels in the
// society's zone. Weeks start on Monday (design round C1).

const hourMs = 3_600_000;
export const localDay = (date: Date, timeZone: string) => toZonedInput(date, timeZone).slice(0, 10);
export const localMinutes = (date: Date, timeZone: string) => {
  const [hour, minute] = toZonedInput(date, timeZone).slice(11).split(":").map(Number);
  return hour * 60 + minute;
};
const noonUtc = (date: string) => new Date(`${date}T12:00:00Z`);
const weekday = (date: string) => (noonUtc(date).getUTCDay() + 6) % 7;
export const mondayOf = (date: string) => addDays(date, -weekday(date));
export const daysFrom = (first: string, count: number) => Array.from({ length: count }, (_, index) => addDays(first, index));

// "6:00 pm"; inside the hour that happens twice when clocks go back, "2:30 am AEDT".
export function formatTime(date: Date, timeZone: string) {
  const text = formatClock(date, timeZone);
  return zonedCandidates(toZonedInput(date, timeZone), timeZone).length > 1 ? `${text} ${zoneAbbreviation(timeZone, date).split(",")[0]}` : text;
}
// "Fri 30 Oct", or "Friday 30 October 2026" with `long`.
export const formatDay = formatCalendarDay;
export const shortWeekday = (date: string) => formatDay(date).split(" ")[0];
export const monthTitle = formatCalendarMonth;

export type CalendarItem =
  | { kind: "event"; key: string; event: CalendarEvent; firstDay: string; lastDay: string; multiDay: boolean }
  | { kind: "term"; key: string; end: MembershipEnd; firstDay: string; lastDay: string; multiDay: false }
  | { kind: "clock"; key: string; label: string; firstDay: string; lastDay: string; multiDay: false };

// The small hours belong to the night before: an event ending by 6 am doesn't
// reach that day (design round C1: "an event past midnight shows where it starts").
const nightEndsMinutes = 6 * 60;

// The last day an event really covers. Shorter than a day, even past midnight,
// it sits on the day it starts (as Google Calendar and Outlook do); longer, it
// spans every day it reaches beyond the small hours.
function lastDayOf(event: CalendarEvent, firstDay: string, timeZone: string) {
  if (event.endTime.getTime() - event.startTime.getTime() < 24 * hourMs) return firstDay;
  const endDay = localDay(new Date(event.endTime.getTime() - 1), timeZone);
  const lastDay = localMinutes(event.endTime, timeZone) <= nightEndsMinutes && localDay(event.endTime, timeZone) === endDay ? addDays(endDay, -1) : endDay;
  return lastDay < firstDay ? firstDay : lastDay;
}

export function calendarItems(events: CalendarEvent[], ends: MembershipEnd[], timeZone: string, clocks = new Map<string, string>()): CalendarItem[] {
  return [
    ...[...clocks].map(([day, label]) => ({ kind: "clock" as const, key: `clock/${day}`, label, firstDay: day, lastDay: day, multiDay: false as const })),
    ...events.map((event) => {
      const firstDay = localDay(event.startTime, timeZone);
      const lastDay = lastDayOf(event, firstDay, timeZone);
      return { kind: "event" as const, key: event.id, event, firstDay, lastDay, multiDay: lastDay !== firstDay };
    }),
    ...ends.map((end) => ({ kind: "term" as const, key: `${end.planId}/${end.lastDay}`, end, firstDay: end.lastDay, lastDay: end.lastDay, multiDay: false as const }))
  ];
}

export type Segment = { item: CalendarItem; start: number; end: number; lane: number; before: boolean; after: boolean };

// The pieces of each item inside a run of days, stacked into the lowest free
// lane: earlier first, then longer first.
export function laneSegments(days: string[], items: CalendarItem[]): Segment[] {
  const first = days[0];
  const last = days[days.length - 1];
  const pieces = items
    .filter((item) => item.firstDay <= last && item.lastDay >= first)
    .map((item) => ({ item, start: Math.max(0, days.indexOf(item.firstDay)), end: item.lastDay > last ? days.length - 1 : days.indexOf(item.lastDay), before: item.firstDay < first, after: item.lastDay > last }))
    .sort((a, b) => a.start - b.start || b.end - a.end || startOf(a.item) - startOf(b.item));
  const lanes: number[] = [];
  return pieces.map((piece) => {
    let lane = lanes.findIndex((freeFrom) => freeFrom <= piece.start);
    if (lane === -1) lane = lanes.length;
    lanes[lane] = piece.end + 1;
    return { ...piece, lane };
  });
}
const startOf = (item: CalendarItem) => (item.kind === "event" ? item.event.startTime.getTime() : 0);

export type Placed = { event: CalendarEvent; top: number; bottom: number; column: number; columns: number; clipped: boolean };

// Timed events of one day by local minutes, overlapping ones side by side.
export function placeDay(events: CalendarEvent[], timeZone: string): Placed[] {
  const placed = events
    .map((event) => {
      const top = localMinutes(event.startTime, timeZone);
      const sameDay = localDay(event.endTime, timeZone) === localDay(event.startTime, timeZone);
      return { event, top, bottom: sameDay ? Math.max(top + 30, localMinutes(event.endTime, timeZone)) : 24 * 60, clipped: !sameDay, column: 0, columns: 1 };
    })
    .sort((a, b) => a.top - b.top || b.bottom - a.bottom);
  let cluster: typeof placed = [];
  let clusterEnd = -1;
  const close = () => cluster.forEach((entry) => (entry.columns = Math.max(...cluster.map((other) => other.column)) + 1));
  for (const entry of placed) {
    if (entry.top >= clusterEnd) {
      close();
      cluster = [];
    }
    const taken = new Set(cluster.filter((other) => other.bottom > entry.top).map((other) => other.column));
    while (taken.has(entry.column)) entry.column += 1;
    cluster.push(entry);
    clusterEnd = Math.max(clusterEnd, entry.bottom);
  }
  close();
  return placed;
}

// Days in the list on which the clocks change: "Clocks go forward at 2 am".
export function clockChanges(days: string[], timeZone: string) {
  const changes = new Map<string, string>();
  for (const day of days) {
    let low = zonedCandidates(`${addDays(day, -1)}T12:00`, timeZone)[0];
    let high = zonedCandidates(`${day}T12:00`, timeZone)[0];
    const before = offsetAt(low, timeZone);
    const after = offsetAt(high, timeZone);
    if (before === after) continue;
    while (high.getTime() - low.getTime() > 60_000) {
      const middle = new Date(low.getTime() + Math.floor((high.getTime() - low.getTime()) / 120_000) * 60_000);
      if (offsetAt(middle, timeZone) === before) low = middle;
      else high = middle;
    }
    const wall = new Date(high.getTime() + before);
    const at = formatClock(wall, "UTC");
    changes.set(day, `Clocks go ${after > before ? "forward" : "back"} at ${at}`);
  }
  return changes;
}
