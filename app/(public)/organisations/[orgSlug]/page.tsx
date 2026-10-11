import Link from "next/link";
import { notFound } from "next/navigation";
import { publicOrganisation } from "@/lib/organisations/public-organisations";
import {
  AuthenticationRequiredError,
  requireAuthenticatedUser,
} from "@/lib/auth/access";
import { prisma } from "@/lib/db";
import {
  SocietyJoin,
  type JoinState,
} from "@/components/organisations/society-join";
export const dynamic = "force-dynamic";
export default async function OrganisationDetailsPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const organisation = await publicOrganisation((await params).orgSlug);
  if (!organisation) notFound();
  let joinState: JoinState = "anonymous";
  try {
    const user = await requireAuthenticatedUser();
    if (user.accountRole === "organisation") joinState = "organisation";
    else {
      const joined = await prisma.organisationMember.findUnique({
        where: {
          userId_organisationId: {
            userId: user.id,
            organisationId: organisation.id,
          },
        },
        select: { id: true },
      });
      joinState = joined
        ? "joined"
        : user.emailVerifiedAt
          ? "available"
          : "verify";
    }
  } catch (error) {
    if (!(error instanceof AuthenticationRequiredError)) throw error;
  }
  const formatDate = (value: Date) =>
    new Intl.DateTimeFormat("en-AU", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: organisation.timeZone,
    }).format(value);
  return (
    <main className="society-surface min-h-screen px-4 py-8 sm:px-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <section className="society-panel overflow-hidden">
          {organisation.coverAssetId && (
            <img
              src={`/api/public/assets/${organisation.coverAssetId}`}
              alt=""
              className="max-h-72 w-full object-cover"
            />
          )}
          <div className="space-y-4 p-6">
            {organisation.logoAssetId && (
              <img
                src={`/api/public/assets/${organisation.logoAssetId}`}
                alt={`${organisation.name} logo`}
                className="h-24 w-24 object-contain"
              />
            )}
            <p className="text-sm">Society</p>
            <h1 className="text-3xl font-semibold">{organisation.name}</h1>
            <p className="whitespace-pre-wrap">
              {organisation.description ||
                "This society is getting its profile ready."}
            </p>
            {organisation.supportEmail && (
              <a href={`mailto:${organisation.supportEmail}`}>
                {organisation.supportEmail}
              </a>
            )}
            <SocietyJoin slug={organisation.slug} state={joinState} />
          </div>
        </section>
        <nav aria-label="Society sections" className="flex gap-6 border-b pb-3">
          <a href="#overview">Overview</a>
          <a href="#events">Events</a>
        </nav>
        <section id="overview" className="society-panel space-y-4 p-6">
          <h2 className="text-xl font-semibold">About this society</h2>
          <p>Times are shown in {organisation.timeZone}.</p>
          {organisation.refundPolicy && (
            <div>
              <h3 className="font-semibold">Refund policy</h3>
              <p className="whitespace-pre-wrap">{organisation.refundPolicy}</p>
            </div>
          )}
          {organisation.pickupPolicy && (
            <div>
              <h3 className="font-semibold">Pickup policy</h3>
              <p className="whitespace-pre-wrap">{organisation.pickupPolicy}</p>
            </div>
          )}
        </section>
        <section id="events" className="society-panel p-6">
          <h2 className="mb-4 text-xl font-semibold">Upcoming events</h2>
          {!organisation.events.length ? (
            <p>No upcoming events.</p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {organisation.events.map((event) => (
                <article key={event.id} className="rounded-lg border p-4">
                  <h3 className="font-semibold">{event.title}</h3>
                  <dl className="mt-3 space-y-2">
                    <div>
                      <dt className="font-medium">Date</dt>
                      <dd>{formatDate(event.startTime)}</dd>
                    </div>
                    <div>
                      <dt className="font-medium">Location</dt>
                      <dd>{event.location}</dd>
                    </div>
                  </dl>
                  <Link
                    className="society-link mt-4 inline-block"
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
