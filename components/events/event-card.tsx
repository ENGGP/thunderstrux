import Link from "next/link";
import { formatDateTime } from "@/lib/format";

type EventCardProps = {
  id: string;
  title: string;
  startTime: Date;
  location: string;
  timeZone: string;
  // Omitted on a society's own page, where the host is already the page subject.
  society?: { name: string; slug: string };
};

// Date rail first: day and month in the hosting society's timezone. Price and
// artwork are added when the event model carries them; nothing is invented here.
export function EventCard({
  id,
  title,
  startTime,
  location,
  timeZone,
  society
}: EventCardProps) {
  const parts = new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "short",
    timeZone
  }).formatToParts(startTime);
  const part = (type: string) =>
    parts.find((entry) => entry.type === type)?.value ?? "";

  return (
    <article className="relative flex gap-4 rounded-card border border-line bg-surface p-5 transition-shadow duration-150 hover:shadow-card">
      <div
        aria-hidden="true"
        className="flex h-[68px] w-[68px] shrink-0 flex-col items-center justify-center rounded-control bg-brand-tint text-brand-ink"
      >
        <span className="font-display text-2xl font-semibold leading-none">
          {part("day")}
        </span>
        <span className="mt-1 text-xs font-semibold">{part("month")}</span>
      </div>
      <div className="grid min-w-0 content-start gap-1">
        {society ? (
          <Link
            className="relative z-10 w-fit text-sm text-ink-muted underline-offset-4 hover:text-brand hover:underline"
            href={`/societies/${society.slug}`}
          >
            {society.name}
          </Link>
        ) : null}
        <h3 className="font-sans text-lg font-semibold text-ink [overflow-wrap:anywhere]">
          {/* The title link covers the whole card, so there is one event link per card. */}
          <Link className="after:absolute after:inset-0" href={`/events/${id}`}>
            {title}
          </Link>
        </h3>
        <p className="text-sm text-ink-soft">
          {formatDateTime(startTime, { timeZone, fallback: "Date unavailable" })}
        </p>
        <p className="text-sm text-ink-soft [overflow-wrap:anywhere]">
          {location}
        </p>
      </div>
    </article>
  );
}
