import { notFound } from "next/navigation";
import { PublicTicketPurchase } from "@/components/events/public-ticket-purchase";
import { getAppUrl } from "@/lib/stripe";

type PublicEventPageProps = {
  params: Promise<{
    eventId: string;
  }>;
};

type PublicEvent = {
  id: string;
  title: string;
  description: string;
  startTime: string;
  endTime: string;
  location: string;
  organisation: {
    name: string;
    slug: string;
  };
  ticketTypes: Array<{
    id: string;
    name: string;
    price: number;
    quantity: number;
  }>;
};

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "full",
    timeStyle: "short"
  }).format(new Date(value));
}

export default async function PublicEventPage({ params }: PublicEventPageProps) {
  const { eventId } = await params;
  const response = await fetch(`${getAppUrl()}/api/public/events/${eventId}`, {
    cache: "no-store"
  });

  if (response.status === 404) {
    notFound();
  }

  if (!response.ok) {
    throw new Error("Unable to load event");
  }

  const { event } = (await response.json()) as { event: PublicEvent };

  return (
    <main className="min-h-screen bg-neutral-50 px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto grid max-w-3xl gap-6">
        <section className="rounded-lg border border-neutral-200 bg-white p-6 shadow-sm sm:p-8">
          <p className="text-sm font-medium text-neutral-500">
            {event.organisation.name}
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-normal text-neutral-950 sm:text-4xl">
            {event.title}
          </h1>

          <div className="mt-6 grid gap-4 text-sm text-neutral-700 sm:grid-cols-2">
            <div>
              <p className="font-medium text-neutral-950">Starts</p>
              <p className="mt-1">{formatDateTime(event.startTime)}</p>
            </div>
            <div>
              <p className="font-medium text-neutral-950">Ends</p>
              <p className="mt-1">{formatDateTime(event.endTime)}</p>
            </div>
            <div className="sm:col-span-2">
              <p className="font-medium text-neutral-950">Location</p>
              <p className="mt-1">{event.location}</p>
            </div>
          </div>

          <div className="mt-6 border-t border-neutral-200 pt-6">
            <h2 className="text-lg font-semibold text-neutral-950">About this event</h2>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-neutral-700">
              {event.description}
            </p>
          </div>
        </section>

        <PublicTicketPurchase
          eventId={event.id}
          ticketTypes={event.ticketTypes}
        />
      </div>
    </main>
  );
}
