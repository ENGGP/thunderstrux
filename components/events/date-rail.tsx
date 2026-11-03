import { formatDayMonth } from "@/lib/format";

// Day and month of an event in its society's time zone, on a night violet tile:
// the one mark every event card and list row repeats. Decorative: the full date
// is always written out next to it. A cancelled event's tile goes grey (`off`).
export function DateRail({
  date,
  timeZone,
  size = "lg",
  off = false
}: {
  date: Date;
  timeZone: string;
  size?: "md" | "lg";
  off?: boolean;
}) {
  const [day, month] = formatDayMonth(date, timeZone).split(" ");

  return (
    <div
      aria-hidden="true"
      className={`flex shrink-0 flex-col items-center justify-center rounded-control ${
        off ? "bg-neutral-bg text-ink-soft ring-1 ring-inset ring-line" : "bg-night text-white"
      } ${size === "lg" ? "h-[68px] w-[68px]" : "h-14 w-14"}`}
    >
      <span className={`font-display font-semibold leading-none ${size === "lg" ? "text-2xl" : "text-xl"}`}>
        {day}
      </span>
      <span className={`mt-1 text-xs font-semibold uppercase ${off ? "text-ink-muted" : "text-glow"}`}>{month}</span>
    </div>
  );
}
