export const defaultTimeZone = "Australia/Brisbane";

export function formatMoney(cents: number) {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD"
  }).format(cents / 100);
}

// "15.00" for 1500 cents: the value of a "$" price input.
export function formatMoneyInput(cents: number) {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

// "15", "15.5", "$15.50" to cents without floating point; null when it is not a price.
export function parseMoneyInput(value: string) {
  const match = /^\s*\$?\s*(\d{1,7})(?:\.(\d{1,2}))?\s*$/.exec(value);
  return match ? Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0")) : null;
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
