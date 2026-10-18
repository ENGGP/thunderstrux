import { shortMonths } from "@/lib/format";

// Day and month of an event in its society's time zone. Decorative: the
// full date is always written out next to it.
export function DateRail({
  date,
  timeZone,
  size = "lg"
}: {
  date: Date;
  timeZone: string;
  size?: "md" | "lg";
}) {
  const parts = new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "short",
    timeZone
  }).formatToParts(date);
  const part = (type: string) =>
    shortMonths(parts.find((entry) => entry.type === type)?.value ?? "");

  return (
    <div
      aria-hidden="true"
      className={`flex shrink-0 flex-col items-center justify-center rounded-control bg-brand-tint text-brand-ink ${
        size === "lg" ? "h-[68px] w-[68px]" : "h-14 w-14"
      }`}
    >
      <span className={`font-display font-semibold leading-none ${size === "lg" ? "text-2xl" : "text-xl"}`}>
        {part("day")}
      </span>
      <span className="mt-1 text-xs font-semibold uppercase">{part("month")}</span>
    </div>
  );
}
