// Wall-clock times in a society's time zone, independent of the browser's zone.
// The builder shows and edits local times; the API only ever receives instants.

const MINUTE_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const DAY = 24 * 60 * 60 * 1000;

function parts(date: Date, timeZone: string) {
  const values = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  })
    .formatToParts(date)
    .reduce<Record<string, string>>((all, part) => ({ ...all, [part.type]: part.value }), {});
  return values;
}

// The `datetime-local` value ("2026-10-23T18:00") for an instant in that zone.
export function toZonedInput(date: Date, timeZone: string) {
  const { year, month, day, hour, minute } = parts(date, timeZone);
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

// Milliseconds the zone is ahead of UTC at that instant.
export function offsetAt(date: Date, timeZone: string) {
  return Date.parse(`${toZonedInput(date, timeZone)}:00Z`) - Math.floor(date.getTime() / 60_000) * 60_000;
}

// Every instant that shows this wall-clock time in the zone: none inside a
// daylight-saving gap, two inside an overlap, otherwise one. Earliest first.
export function zonedCandidates(local: string, timeZone: string): Date[] {
  const asUtc = MINUTE_PATTERN.test(local) ? Date.parse(`${local}:00Z`) : Number.NaN;
  if (Number.isNaN(asUtc)) return [];

  // An offset changes at most once in two days, so the offsets either side cover it.
  const offsets = new Set([offsetAt(new Date(asUtc - DAY), timeZone), offsetAt(new Date(asUtc + DAY), timeZone)]);
  return [...offsets]
    .map((offset) => new Date(asUtc - offset))
    .filter((candidate) => toZonedInput(candidate, timeZone) === local)
    .sort((a, b) => a.getTime() - b.getTime());
}

function zoneName(timeZone: string, at: Date, timeZoneName: "short" | "shortOffset") {
  return new Intl.DateTimeFormat("en-AU", { timeZone, timeZoneName })
    .formatToParts(at)
    .find((part) => part.type === "timeZoneName")?.value ?? "";
}

// "AEST, UTC+10", or "UTC+5:30" where the zone has no common abbreviation.
export function zoneAbbreviation(timeZone: string, at: Date) {
  const offset = zoneName(timeZone, at, "shortOffset").replace("GMT", "UTC");
  const short = zoneName(timeZone, at, "short");
  return short && !/^(GMT|UTC)/.test(short) ? `${short}, ${offset}` : offset;
}

// "Brisbane time".
export function zoneCity(timeZone: string) {
  return `${(timeZone.split("/").pop() ?? timeZone).replaceAll("_", " ")} time`;
}

// "Brisbane time (AEST, UTC+10)".
export function zoneLabel(timeZone: string, at: Date) {
  return `${zoneCity(timeZone)} (${zoneAbbreviation(timeZone, at)})`;
}
