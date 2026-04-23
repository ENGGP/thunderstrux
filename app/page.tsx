import Link from "next/link";
import { Suspense } from "react";

type PublicEventListItem = {
  id: string;
  title: string;
  startTime: string;
  location: string;
  organisation: {
    name: string;
  };
};

type EventsState =
  | { status: "loaded"; events: PublicEventListItem[] }
  | { status: "error"; message: string };

function getAppUrl() {
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}

function isPublicEventListItem(value: unknown): value is PublicEventListItem {
  if (!value || typeof value !== "object") {
    return false;
  }

  const event = value as Partial<PublicEventListItem>;

  return (
    typeof event.id === "string" &&
    typeof event.title === "string" &&
    typeof event.startTime === "string" &&
    typeof event.location === "string" &&
    Boolean(event.organisation) &&
    typeof event.organisation?.name === "string"
  );
}

async function fetchPublishedEvents(): Promise<EventsState> {
  try {
    const response = await fetch(`${getAppUrl()}/api/public/events`, {
      cache: "no-store"
    });

    if (!response.ok) {
      console.error("Public events API failed", {
        status: response.status,
        statusText: response.statusText
      });

      return {
        status: "error",
        message: "Unable to load events"
      };
    }

    const data = (await response.json()) as { events?: unknown };
    const events = Array.isArray(data.events)
      ? data.events.filter(isPublicEventListItem)
      : [];

    return { status: "loaded", events };
  } catch (error) {
    console.error("Public events load failed", error);

    return {
      status: "error",
      message: "Unable to load events"
    };
  }
}

function formatDateTime(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Date unavailable";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

function EventsLoading() {
  return (
    <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {[0, 1, 2].map((item) => (
        <article
          className="min-h-56 rounded-lg border border-neutral-200 bg-white p-5 shadow-sm"
          key={item}
        >
          <div className="h-4 w-28 rounded bg-neutral-200" />
          <div className="mt-3 h-7 w-3/4 rounded bg-neutral-200" />
          <div className="mt-6 h-4 w-40 rounded bg-neutral-100" />
          <div className="mt-3 h-4 w-32 rounded bg-neutral-100" />
          <div className="mt-8 h-10 w-full rounded bg-neutral-200" />
        </article>
      ))}
    </section>
  );
}

async function EventsDiscovery() {
  const eventsState = await fetchPublishedEvents();

  if (eventsState.status === "error") {
    return (
      <section className="rounded-lg border border-red-200 bg-red-50 p-5 text-sm text-red-700">
        {eventsState.message}
      </section>
    );
  }

  if (eventsState.events.length === 0) {
    return (
      <section className="rounded-lg border border-neutral-200 bg-white p-6 text-sm text-neutral-600 shadow-sm">
        No events available
      </section>
    );
  }

  return (
    <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {eventsState.events.map((event) => (
        <article
          className="flex min-h-56 flex-col rounded-lg border border-neutral-200 bg-white p-5 shadow-sm"
          key={event.id}
        >
          <div className="flex-1">
            <p className="text-sm font-medium text-neutral-500">
              {event.organisation.name}
            </p>
            <h2 className="mt-2 text-xl font-semibold text-neutral-950">
              {event.title}
            </h2>
            <dl className="mt-4 grid gap-3 text-sm text-neutral-700">
              <div>
                <dt className="font-medium text-neutral-950">Date</dt>
                <dd className="mt-1">{formatDateTime(event.startTime)}</dd>
              </div>
              <div>
                <dt className="font-medium text-neutral-950">Location</dt>
                <dd className="mt-1">{event.location}</dd>
              </div>
            </dl>
          </div>

          <Link
            className="mt-5 inline-flex h-10 items-center justify-center rounded-md bg-neutral-900 px-4 text-sm font-medium text-white hover:bg-neutral-700"
            href={`/events/${event.id}`}
          >
            View Event
          </Link>
        </article>
      ))}
    </section>
  );
}

export default function Home() {
  return (
    <main className="min-h-screen bg-neutral-50 px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl">
        <header className="mb-8">
          <h1 className="text-3xl font-semibold text-neutral-950 sm:text-4xl">
            Discover Events
          </h1>
        </header>

        <Suspense fallback={<EventsLoading />}>
          <EventsDiscovery />
        </Suspense>
      </div>
    </main>
  );
}
