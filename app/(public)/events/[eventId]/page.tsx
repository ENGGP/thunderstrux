import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getLiveSession } from "@/lib/auth/live-session";
import { PublicTicketPurchase } from "@/components/events/public-ticket-purchase";
import { getPublishedEventDetail } from "@/lib/events/public-events";
import { formatDateTime } from "@/lib/format";

type PublicEventPageProps = {
  params: Promise<{
    eventId: string;
  }>;
};

export default async function PublicEventPage({ params }: PublicEventPageProps) {
  const { eventId } = await params;
  const session = await getLiveSession();

  if (session?.user?.accountRole === "organisation") {
    redirect(`/dashboard/events/${eventId}`);
  }

  const event = await getPublishedEventDetail(eventId);

  if (!event) {
    notFound();
  }

  const timeZone = event.organisation.timeZone;

  return (
    <main className="bg-paper">
      <div className="mx-auto grid max-w-page gap-8 px-4 py-10 md:px-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:items-start">
        <article className="grid gap-6">
          <header className="grid gap-2">
            <p className="text-sm text-ink-muted">
              Hosted by{" "}
              <Link
                className="font-semibold text-brand underline"
                href={`/societies/${event.organisation.slug}`}
              >
                {event.organisation.name}
              </Link>
            </p>
            <h1 className="font-display text-3xl font-semibold text-ink [overflow-wrap:anywhere] md:text-5xl">
              {event.title}
            </h1>
          </header>

          <dl className="grid gap-4 rounded-card border border-line bg-surface p-5 text-sm sm:grid-cols-2">
            <div>
              <dt className="font-semibold text-ink">Starts</dt>
              <dd className="mt-1 text-ink-soft">
                {formatDateTime(event.startTime, { dateStyle: "full", timeZone })}
              </dd>
            </div>
            <div>
              <dt className="font-semibold text-ink">Ends</dt>
              <dd className="mt-1 text-ink-soft">
                {formatDateTime(event.endTime, { dateStyle: "full", timeZone })}
              </dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="font-semibold text-ink">Location</dt>
              <dd className="mt-1 text-ink-soft [overflow-wrap:anywhere]">
                {event.location}
              </dd>
            </div>
            <p className="text-ink-muted sm:col-span-2">
              Times are shown in {timeZone}.
            </p>
          </dl>

          <section>
            <h2 className="text-2xl font-semibold text-ink">About this event</h2>
            <p className="mt-3 max-w-[70ch] whitespace-pre-wrap text-ink-soft [overflow-wrap:anywhere]">
              {event.description}
            </p>
          </section>
        </article>

        <div className="lg:sticky lg:top-24">
          <PublicTicketPurchase
            eventId={event.id}
            ticketTypes={event.ticketTypes}
          />
        </div>
      </div>
    </main>
  );
}
