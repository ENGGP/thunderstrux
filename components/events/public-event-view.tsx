import Link from "next/link";
import { PublicTicketPurchase, type BuyBoxViewer } from "@/components/events/public-ticket-purchase";
import { Icon } from "@/components/ui/icon";
import { StatusBadge } from "@/components/ui/status-badge";
import type { PublicEventDetail } from "@/lib/events/public-events";
import { formatDateRange, formatDateTime } from "@/lib/format";
import { zoneCity } from "@/lib/zoned-time";
import { appUrl } from "@/lib/app-url";

// Google Calendar takes UTC times as 20270305T110000Z.
const calendarTime = (date: Date) => date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

// An "Add to calendar" link for the event page: no file to download, and it opens in any browser.
function googleCalendarHref(event: PublicEventDetail) {
  const page = appUrl() ? new URL(`/events/${event.id}`, appUrl()).toString() : "";
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: event.title,
    dates: `${calendarTime(event.startTime)}/${calendarTime(event.endTime)}`,
    location: event.location,
    details: [event.description.slice(0, 500), page].filter(Boolean).join("\n\n")
  });
  return `https://calendar.google.com/calendar/render?${params}`;
}

// The public event page body, shared by /events/[eventId] and the organiser's
// draft preview so the preview is exactly what buyers will see.
export function PublicEventView({
  event,
  viewer,
  memberPlan = null,
  preview = false
}: {
  // The viewer's membership plan giving member prices, if any (T24b).
  memberPlan?: string | null;
  event: PublicEventDetail;
  viewer: BuyBoxViewer;
  preview?: boolean;
}) {
  const { organisation } = event;
  const timeZone = organisation.timeZone;

  return (
    <div className="mx-auto grid max-w-page gap-8 px-4 py-10 md:px-8">
      {event.heroAssetId ? (
        <img
          // The society's description when it gave one; otherwise decoration, as the title names the event.
          alt={event.heroAlt ?? ""}
          className="aspect-video max-h-[460px] w-full rounded-card border border-line object-cover"
          src={preview ? `/api/orgs/${organisation.slug}/assets/${event.heroAssetId}` : `/api/public/assets/${event.heroAssetId}`}
        />
      ) : null}

      <div className="grid gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:grid-rows-[auto_1fr] lg:items-start">
        <article className="grid gap-6">
          <header className="grid gap-2">
            <Link className="w-fit text-sm font-semibold text-brand underline underline-offset-4" href={`/societies/${organisation.slug}`}>
              {organisation.name}
            </Link>
            <h1 className="font-display text-3xl font-semibold text-ink [overflow-wrap:anywhere] md:text-5xl">{event.title}</h1>
            {event.cancelled ? <StatusBadge label="Event cancelled" status="cancelled" /> : null}
            {event.membersOnly ? (
              <p className="inline-flex w-fit items-center gap-1.5 text-sm font-semibold text-ink-soft">
                <Icon className="text-brand" name="lock" size={16} />
                Members only
              </p>
            ) : null}
          </header>

          <div className="grid gap-2 text-ink-soft sm:flex sm:flex-wrap sm:gap-x-8">
            <span className="inline-flex items-start gap-2">
              <Icon className="mt-1" name="calendar" />
              <span>
                {formatDateRange(event.startTime, event.endTime, timeZone)}
                <span className="block text-sm text-ink-muted">{zoneCity(timeZone)}</span>
                {preview || event.cancelled ? null : (
                  <a className="block text-sm font-semibold text-brand underline underline-offset-4" href={googleCalendarHref(event)} rel="noopener noreferrer" target="_blank">
                    Add to Google Calendar
                  </a>
                )}
              </span>
            </span>
            <span className="inline-flex items-start gap-2 [overflow-wrap:anywhere]">
              <Icon className="mt-1" name="pin" />
              <span>
                {event.location}
                <a
                  className="block text-sm font-semibold text-brand underline underline-offset-4"
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.location)}`}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  Open in Maps
                </a>
              </span>
            </span>
          </div>
          {event.membersOnly ? (
            <p className="max-w-[70ch] text-sm text-ink-soft">
              {preview
                ? "Only members whose membership unlocks members-only events see this page. Anyone else with the link sees only that it's a members-only event of your society."
                : `You can see this because your ${organisation.name} membership includes members-only events.`}
            </p>
          ) : null}

          <section>
            <h2 className="text-2xl font-semibold text-ink">About</h2>
            <p className="mt-3 max-w-[70ch] whitespace-pre-wrap text-ink-soft [overflow-wrap:anywhere]">{event.description}</p>
          </section>


        </article>

        <div className="lg:sticky lg:top-24 lg:col-start-2 lg:row-span-2 lg:row-start-1">
          <PublicTicketPurchase
            eventId={event.id}
            memberPlan={memberPlan}
            preview={preview}
            societySlug={organisation.slug}
            salesCloseLabel={event.salesCloseAt ? formatDateTime(event.salesCloseAt, { timeZone }) : undefined}
            salesOpen={event.salesOpen ?? true}
            cancelled={event.cancelled}
            society={organisation.name}
            ticketTypes={event.ticketTypes}
            viewer={viewer}
          />
        </div>

        {/* After the ticket box on phones, under About on desktop. */}
        <section className="grid gap-2 border-t border-line pt-5 lg:col-start-1">
          <h2 className="text-2xl font-semibold text-ink">
            Hosted by{" "}
            <Link className="text-brand underline underline-offset-4" href={`/societies/${organisation.slug}`}>
              {organisation.name}
            </Link>
          </h2>
          {organisation.supportEmail || organisation.refundPolicy ? (
            <dl className="grid gap-x-3 gap-y-1 text-ui sm:grid-cols-[6rem_1fr]">
              {organisation.supportEmail ? (
                <>
                  <dt className="text-ink-soft">Questions</dt>
                  <dd className="[overflow-wrap:anywhere]">
                    <a className="text-brand underline underline-offset-4" href={`mailto:${organisation.supportEmail}`}>
                      {organisation.supportEmail}
                    </a>
                  </dd>
                </>
              ) : null}
              {organisation.refundPolicy ? (
                <>
                  <dt className="text-ink-soft">Refunds</dt>
                  <dd className="whitespace-pre-wrap text-ink-soft [overflow-wrap:anywhere]">{organisation.refundPolicy}</dd>
                </>
              ) : null}
            </dl>
          ) : null}
        </section>
      </div>
    </div>
  );
}
