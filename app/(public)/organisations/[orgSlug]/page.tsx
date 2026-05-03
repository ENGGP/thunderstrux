import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";

type OrganisationDetailsPageProps = {
  params: Promise<{
    orgSlug: string;
  }>;
};

function formatDateTime(value: Date) {
  return new Intl.DateTimeFormat("en-AU", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Australia/Brisbane"
  }).format(value);
}

export default async function OrganisationDetailsPage({
  params
}: OrganisationDetailsPageProps) {
  const { orgSlug } = await params;
  const organisation = await prisma.organisation.findUnique({
    where: { slug: orgSlug },
    select: {
      id: true,
      name: true,
      slug: true
    }
  });

  if (!organisation) {
    notFound();
  }

  const upcomingEvents = await prisma.event.findMany({
    where: {
      organisationId: organisation.id,
      status: "published",
      startTime: {
        gte: new Date()
      }
    },
    orderBy: {
      startTime: "asc"
    },
    select: {
      id: true,
      title: true,
      startTime: true,
      location: true
    }
  });

  return (
    <main className="min-h-screen bg-neutral-50 px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <section className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
          <p className="text-sm text-neutral-500">Organisation</p>
          <h1 className="mt-2 text-3xl font-semibold text-neutral-950">
            {organisation.name}
          </h1>
          <p className="mt-2 text-sm text-neutral-500">{organisation.slug}</p>
        </section>

        <section className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-neutral-950">
              Upcoming events
            </h2>
            <p className="mt-1 text-sm text-neutral-500">
              Published events from {organisation.name}.
            </p>
          </div>

          {upcomingEvents.length === 0 ? (
            <p className="text-sm text-neutral-600">
              No upcoming events.
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {upcomingEvents.map((event) => (
                <article
                  className="rounded-lg border border-neutral-200 p-4"
                  key={event.id}
                >
                  <h3 className="font-medium text-neutral-950">{event.title}</h3>
                  <dl className="mt-3 grid gap-2 text-sm text-neutral-700">
                    <div>
                      <dt className="font-medium text-neutral-950">Date</dt>
                      <dd className="mt-1">{formatDateTime(event.startTime)}</dd>
                    </div>
                    <div>
                      <dt className="font-medium text-neutral-950">Location</dt>
                      <dd className="mt-1">{event.location}</dd>
                    </div>
                  </dl>
                  <Link
                    className="mt-4 inline-flex h-9 items-center justify-center rounded-md bg-neutral-900 px-3 text-sm font-medium text-white transition hover:bg-neutral-700"
                    href={`/events/${event.id}`}
                  >
                    View event
                  </Link>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
