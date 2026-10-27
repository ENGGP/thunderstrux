export const defaultTimeZone = "Australia/Brisbane";

// The short order reference buyers and staff quote, as shown in the dashboard.
export const orderReference = (orderId: string) => orderId.slice(-6).toUpperCase();
// The short reference on a ticket, its email and the door console; door search matches it inside the id.
export const ticketReference = (ticketId: string) => ticketId.slice(-6).toUpperCase();

export function formatMoney(cents: number) {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD"
  }).format(cents / 100);
}

// A ticket price or order total: "Free" for zero, otherwise money. Revenue and
// other sums keep formatMoney, so $0.00 still reads as an amount.
export function formatPrice(cents: number) {
  return cents === 0 ? "Free" : formatMoney(cents);
}

// An event card's prices on sale, distinct and lowest first: "Free", "$12.00",
// "From $12.00", "Free or $12.00" or "Free or from $12.00".
export function listingPriceLabel(prices: number[]) {
  const [lowest, next] = prices;
  if (lowest > 0) return `${prices.length > 1 ? "From " : ""}${formatMoney(lowest)}`;
  if (next === undefined) return "Free";
  return `Free or ${prices.length > 2 ? "from " : ""}${formatMoney(next)}`;
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

// en-AU writes some short months long ("June", "July", "Sept"); the design
// uses three letters for every month.
export function shortMonths(text: string) {
  return text.replace(/\b(June|July|Sept)\b/g, (month) => month.slice(0, 3));
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

  const text = new Intl.DateTimeFormat("en-AU", {
    dateStyle,
    timeStyle: "short",
    timeZone
  }).format(date);
  return dateStyle === "medium" ? shortMonths(text) : text;
}

// "23 Oct 2026, 6:00 pm – 9:00 pm"; the end date repeats only when it differs.
export function formatDateRange(start: Date, end: Date, timeZone = defaultTimeZone) {
  return shortMonths(new Intl.DateTimeFormat("en-AU", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone
  }).formatRange(start, end));
}

// "Semester 2 2026 membership", but "2027 membership" stays as it is.
export function membershipLabel(planName: string) {
  return /\bmembership$/i.test(planName.trim()) ? planName.trim() : `${planName.trim()} membership`;
}

// "Renew for 2027" rather than "Renew for 2027 membership".
export function renewLabel(planName: string) {
  return `Renew for ${planName.trim().replace(/\s+membership$/i, "")}`;
}

// "1 Jul to 31 Dec 2026", or "1 Dec 2026 to 31 Jan 2027" across years.
export function joinDays(first: string, last: string) {
  return `${first.slice(-4) === last.slice(-4) ? first.slice(0, -5) : first} to ${last}`;
}

// A membership term by its first and last day; `endsAt` is exclusive.
export function formatTerm(startsAt: Date, endsAt: Date, timeZone = defaultTimeZone) {
  return joinDays(formatDate(startsAt, timeZone), formatDate(new Date(endsAt.getTime() - 1), timeZone));
}

export function formatDate(value: Date | string, timeZone = defaultTimeZone) {
  return shortMonths(new Intl.DateTimeFormat("en-AU", {
    dateStyle: "medium",
    timeZone
  }).format(new Date(value)));
}
