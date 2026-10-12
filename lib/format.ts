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

export function formatDate(value: Date | string, timeZone = defaultTimeZone) {
  return new Intl.DateTimeFormat("en-AU", {
    dateStyle: "medium",
    timeZone
  }).format(new Date(value));
}
