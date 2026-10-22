// Typed dates for the house date picker: values are local days written
// YYYY-MM-DD; people see and may type "22 Oct 2026", "22/10/2026" or the
// value itself. Days carry no time zone of their own.

const shortMonths = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (value: number) => String(value).padStart(2, "0");

export const isoDay = (year: number, month: number, day: number) => `${year}-${pad(month)}-${pad(day)}`;

// A real day as YYYY-MM-DD, or null.
function realDay(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return year >= 1000 && date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? isoDay(year, month, day) : null;
}

// "" for nothing, the day for anything readable, null for anything else.
export function parseDayInput(text: string): string | null {
  const value = text.trim().replace(/,/g, " ").replace(/\s+/g, " ");
  if (!value) return "";
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value);
  if (match) return realDay(+match[1], +match[2], +match[3]);
  match = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(value);
  if (match) return realDay(+match[3], +match[2], +match[1]);
  match = /^(?:[a-z]+ )?(\d{1,2}) ([a-z]+) (\d{4})$/i.exec(value);
  if (match) {
    const month = shortMonths.findIndex((name) => match![2].toLowerCase().startsWith(name.toLowerCase())) + 1;
    return month ? realDay(+match[3], month, +match[1]) : null;
  }
  return null;
}

// "22 Oct 2026".
export function formatDayInput(day: string) {
  if (!day) return "";
  const [year, month, date] = day.split("-").map(Number);
  return `${date} ${shortMonths[month - 1]} ${year}`;
}

export function shiftDay(day: string, days: number) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// The same day of another month, held to that month's last day.
export function shiftMonth(day: string, months: number) {
  const [year, month, date] = day.split("-").map(Number);
  const first = new Date(Date.UTC(year, month - 1 + months, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return isoDay(first.getUTCFullYear(), first.getUTCMonth() + 1, Math.min(date, last));
}

// Monday-to-Sunday weeks covering the day's month.
export function monthWeeks(day: string) {
  const first = `${day.slice(0, 7)}-01`;
  const start = shiftDay(first, -((new Date(`${first}T12:00:00Z`).getUTCDay() + 6) % 7));
  const weeks: string[][] = [];
  for (let cursor = start; weeks.length === 0 || cursor.slice(0, 7) === day.slice(0, 7); ) {
    weeks.push(Array.from({ length: 7 }, (_, index) => shiftDay(cursor, index)));
    cursor = shiftDay(cursor, 7);
  }
  return weeks;
}

export function localTodayInBrowser(now = new Date()) {
  return isoDay(now.getFullYear(), now.getMonth() + 1, now.getDate());
}
