import Link from "next/link";
import { PublicTicketPurchase, type BuyBoxViewer } from "@/components/events/public-ticket-purchase";
import { Icon } from "@/components/ui/icon";
import type { PublicEventDetail } from "@/lib/events/public-events";
import { formatDateRange, formatDateTime } from "@/lib/format";
import { zoneCity } from "@/lib/zoned-time";

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
          alt=""
          className="aspect-video max-h-[460px] w-full rounded-card border border-line object-cover"
          src={preview ? `/api/orgs/${organisation.slug}/assets/${event.heroAssetId}` : `/api/public/assets/${event.heroAssetId}`}
        />
      ) : null}

      <div className="grid gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:items-start">
        <article className="grid gap-6">
          <header className="grid gap-2">
            <Link className="w-fit text-sm font-semibold text-brand underline underline-offset-4" href={`/societies/${organisation.slug}`}>
              {organisation.name}
            </Link>
            <h1 className="font-display text-3xl font-semibold text-ink [overflow-wrap:anywhere] md:text-5xl">{event.title}</h1>
            {event.membersOnly ? (
              <p className="inline-flex items-start gap-2 text-sm text-ink-soft">
                <Icon className="mt-0.5 text-brand" name="badge" />
                <span>
                  <span className="font-semibold text-ink">Members only.</span>{" "}
                  {preview
                    ? "Only members whose membership unlocks members-only events see this page; anyone else with the link sees only that it's a members-only event of your society."
                    : `You can see this because your ${organisation.name} membership includes members-only events.`}
                </span>
              </p>
            ) : null}
          </header>

          <div className="grid gap-2 text-ink-soft sm:flex sm:flex-wrap sm:gap-x-8">
            <span className="inline-flex items-start gap-2">
              <Icon className="mt-1" name="calendar" />
              <span>
                {formatDateRange(event.startTime, event.endTime, timeZone)}
                <span className="block text-sm text-ink-muted">{zoneCity(timeZone)}</span>
              </span>
            </span>
            <span className="inline-flex items-start gap-2 [overflow-wrap:anywhere]">
              <Icon className="mt-1" name="pin" />
              {event.location}
            </span>
          </div>

          <section>
            <h2 className="text-2xl font-semibold text-ink">About</h2>
            <p className="mt-3 max-w-[70ch] whitespace-pre-wrap text-ink-soft [overflow-wrap:anywhere]">{event.description}</p>
          </section>

          <section className="grid gap-2 border-t border-line pt-5">
            <h2 className="text-lg font-semibold text-ink">
              Hosted by{" "}
              <Link className="text-brand underline underline-offset-4" href={`/societies/${organisation.slug}`}>
                {organisation.name}
              </Link>
            </h2>
            {organisation.supportEmail || organisation.refundPolicy ? (
              <dl className="grid gap-x-3 gap-y-1 text-[15px] sm:grid-cols-[6rem_1fr]">
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
        </article>

        <div className="lg:sticky lg:top-24">
          <PublicTicketPurchase
            eventId={event.id}
            memberPlan={memberPlan}
            preview={preview}
            societySlug={organisation.slug}
            salesCloseLabel={event.salesCloseAt ? formatDateTime(event.salesCloseAt, { timeZone }) : undefined}
            salesOpen={event.salesOpen ?? true}
            society={organisation.name}
            ticketTypes={event.ticketTypes}
            viewer={viewer}
          />
        </div>
      </div>
    </div>
  );
}
