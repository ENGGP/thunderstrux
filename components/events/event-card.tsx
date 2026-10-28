import Link from "next/link";
import { DateRail } from "@/components/events/date-rail";
import { StatusBadge } from "@/components/ui/status-badge";
import type { ListingAvailability } from "@/lib/events/public-events";
import { formatDateTime, listingPriceLabel } from "@/lib/format";

type EventCardProps = {
  id: string;
  title: string;
  startTime: Date;
  location: string;
  timeZone: string;
  heroAssetId?: string | null;
  // Set when another card in the same list has an image, so every card gets a
  // 16:9 area and the grid stays even. Phones show one column, so they skip it.
  media?: boolean;
  availability?: ListingAvailability | null;
  // Omitted on a society's own page, where the host is already the page subject.
  society?: { name: string; slug: string };
};

// Date rail first: day and month in the hosting society's timezone. An event
// image, when the society added one, sits above at 16:9; the price or selling
// state comes last.
export function EventCard({
  id,
  title,
  startTime,
  location,
  timeZone,
  heroAssetId,
  media = false,
  availability,
  society
}: EventCardProps) {
  return (
    <article className="relative flex flex-wrap content-start gap-4 overflow-hidden rounded-card border border-line bg-surface p-5 hover:shadow-card">
      {heroAssetId ? (
        // Decorative: the title link names the event.
        <img alt="" className="-mx-5 -mt-5 aspect-video w-[calc(100%+2.5rem)] max-w-none object-cover" src={`/api/public/assets/${heroAssetId}`} />
      ) : media ? (
        <div aria-hidden="true" className="-mx-5 -mt-5 hidden aspect-video w-[calc(100%+2.5rem)] max-w-none bg-brand-tint sm:block bg-[repeating-linear-gradient(135deg,transparent_0_15px,color-mix(in_srgb,var(--ts-brand)_9%,transparent)_15px_16px)]" />
      ) : null}
      <DateRail date={startTime} timeZone={timeZone} />
      <div className="grid min-w-0 flex-1 content-start gap-1">
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
        {availability?.state === "on_sale" ? (
          <p className="mt-1 font-semibold tabular-nums text-ink">{listingPriceLabel(availability.prices)}</p>
        ) : availability?.state === "sales_closed" || availability?.state === "sold_out" ? (
          <span className="mt-1">
            <StatusBadge status={availability.state === "sold_out" ? "sold-out" : "sales-closed"} />
          </span>
        ) : availability?.state === "paid_unavailable" ? (
          <p className="mt-1 text-sm text-ink-soft">Paid tickets unavailable right now</p>
        ) : null}
      </div>
    </article>
  );
}
