export const defaultTimeZone = "Australia/Brisbane";

export function formatMoney(cents: number) {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD"
  }).format(cents / 100);
}

type DateTimeOptions = {
  timeZone?: string;
  dateStyle?: "medium" | "full";
  fallback?: string;
};

// Missing and unparseable values render as `fallback` instead of throwing.
export function formatDateTime(
  value: Date | string | null,
  {
    timeZone = defaultTimeZone,
    dateStyle = "medium",
    fallback = "Not available"
  }: DateTimeOptions = {}
) {
  const date = value === null ? null : new Date(value);

  if (!date || Number.isNaN(date.getTime())) {
    return fallback;
  }

  return new Intl.DateTimeFormat("en-AU", {
    dateStyle,
    timeStyle: "short",
    timeZone
  }).format(date);
}

// "23 Oct 2026, 6:00 pm – 9:00 pm"; the end date repeats only when it differs.
export function formatDateRange(start: Date, end: Date, timeZone = defaultTimeZone) {
  return new Intl.DateTimeFormat("en-AU", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone
  }).formatRange(start, end);
}

export function formatDate(value: Date | string, timeZone = defaultTimeZone) {
  return new Intl.DateTimeFormat("en-AU", {
    dateStyle: "medium",
    timeZone
  }).format(new Date(value));
}
