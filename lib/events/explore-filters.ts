import { defaultTimeZone } from "@/lib/format";
import { toZonedInput, zonedCandidates } from "@/lib/zoned-time";

// Explore events filters, read from the URL. Presets run in the platform's
// time zone so one link means the same dates for everyone.

export const whenOptions = [
  { value: "upcoming", label: "Upcoming" },
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
  { value: "custom", label: "Choose dates" }
] as const;

export type ExploreWhen = (typeof whenOptions)[number]["value"];

export type ExploreFilters = {
  q: string;
  when: ExploreWhen;
  from: string;
  to: string;
  society: string;
};

export type ExploreErrors = Partial<Record<keyof ExploreFilters, string>>;

// startTime bounds; ended events are always excluded by the query itself.
export type ExploreRange = { startFrom?: Date; startBefore?: Date };

export const maxSearchLength = 100;
const maxRangeDays = 366;
const DAY = 24 * 60 * 60 * 1000;

function isCalendarDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(`${value}T00:00Z`).toISOString().startsWith(value);
}

function addDays(date: string, days: number) {
  return new Date(Date.parse(`${date}T00:00Z`) + days * DAY).toISOString().slice(0, 10);
}

// Midnight at the start of that calendar day in the platform zone.
function startOfDay(date: string) {
  return zonedCandidates(`${date}T00:00`, defaultTimeZone)[0];
}

export function parseExploreFilters(params: Record<string, string | undefined>, now = new Date()) {
  const filters: ExploreFilters = {
    q: (params.q ?? "").trim(),
    when: whenOptions.some((option) => option.value === params.when) ? (params.when as ExploreWhen) : "upcoming",
    from: params.from ?? "",
    to: params.to ?? "",
    society: params.society ?? ""
  };
  const errors: ExploreErrors = {};
  const range: ExploreRange = {};
  const today = toZonedInput(now, defaultTimeZone).slice(0, 10);

  if (params.when && filters.when !== params.when) errors.when = "Choose when from the list.";
  if (filters.q.length > maxSearchLength) errors.q = `Search for up to ${maxSearchLength} characters.`;

  if (filters.when === "week") {
    // The coming Sunday, inclusive: up to the start of next Monday.
    const weekday = new Date(`${today}T00:00Z`).getUTCDay();
    range.startBefore = startOfDay(addDays(today, (8 - weekday) % 7 || 7));
  } else if (filters.when === "month") {
    const [year, month] = today.split("-").map(Number);
    range.startBefore = startOfDay(new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10));
  } else if (filters.when === "custom") {
    if (!isCalendarDate(filters.from)) errors.from = filters.from ? "Enter a real date." : "Choose a start date.";
    if (!isCalendarDate(filters.to)) errors.to = filters.to ? "Enter a real date." : "Choose an end date.";
    if (!errors.from && !errors.to) {
      const days = (Date.parse(filters.to) - Date.parse(filters.from)) / DAY + 1;
      if (days < 1) errors.to = "The end date must be on or after the start date.";
      else if (days > maxRangeDays) errors.to = `Choose a range of ${maxRangeDays} days or less.`;
      else {
        range.startFrom = startOfDay(filters.from);
        range.startBefore = startOfDay(addDays(filters.to, 1));
      }
    }
  }

  return { filters, errors, range };
}
