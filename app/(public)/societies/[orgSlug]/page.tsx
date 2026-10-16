import { notFound } from "next/navigation";
import { publicOrganisation } from "@/lib/organisations/public-organisations";
import {
  AuthenticationRequiredError,
  requireAuthenticatedUser,
} from "@/lib/auth/access";
import { EventCard } from "@/components/events/event-card";
import { joinedOrganisationIds } from "@/lib/organisations/join";
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
      const joined = (
        await joinedOrganisationIds(user.id, [organisation.id])
      ).has(organisation.id);
      joinState = joined
        ? "joined"
        : user.emailVerifiedAt
          ? "available"
          : "verify";
    }
  } catch (error) {
    if (!(error instanceof AuthenticationRequiredError)) throw error;
  }
  return (
    <main className="bg-paper pb-14">
      <div className="mx-auto max-w-page px-4 md:px-8">
        <header>
          {organisation.coverAssetId ? (
            <img
              alt=""
              className="aspect-video w-full rounded-b-feature object-cover md:aspect-[3/1]"
              src={`/api/public/assets/${organisation.coverAssetId}`}
            />
          ) : (
            <div
              aria-hidden="true"
              className="h-32 rounded-b-feature bg-brand-tint md:h-48"
            />
          )}
          <div className="-mt-9 flex flex-wrap items-end gap-4 px-2 md:px-6">
            {organisation.logoAssetId ? (
              <img
                alt={`${organisation.name} logo`}
                className="h-[72px] w-[72px] rounded-card border border-line bg-surface object-contain"
                height={72}
                src={`/api/public/assets/${organisation.logoAssetId}`}
                width={72}
              />
            ) : (
              <div
                aria-hidden="true"
                className="flex h-[72px] w-[72px] items-center justify-center rounded-card border border-line bg-surface font-display text-3xl font-semibold text-brand-ink"
              >
                {organisation.name.trim().charAt(0).toUpperCase()}
              </div>
            )}
            <div className="min-w-0 flex-1 pt-10">
              <p className="text-sm text-ink-muted">Society</p>
              <h1 className="font-display text-3xl font-semibold text-ink [overflow-wrap:anywhere] md:text-5xl">
                {organisation.name}
              </h1>
            </div>
          </div>
        </header>

        <nav
          aria-label="Society sections"
          className="mt-8 flex gap-6 border-b border-line text-sm font-semibold"
        >
          <a className="border-b-[3px] border-brand pb-3 text-ink" href="#overview">
            Overview
          </a>
          <a
            className="border-b-[3px] border-transparent pb-3 text-ink-soft hover:text-brand"
            href="#events"
          >
            Events
          </a>
        </nav>

        <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <section className="grid content-start gap-5" id="overview">
            <h2 className="text-2xl font-semibold text-ink">About this society</h2>
            <p className="max-w-[70ch] whitespace-pre-wrap text-ink-soft [overflow-wrap:anywhere]">
              {organisation.description ||
                "This society is getting its profile ready."}
            </p>
            {organisation.refundPolicy && (
              <div>
                <h3 className="font-semibold text-ink">Refund policy</h3>
                <p className="mt-1 max-w-[70ch] whitespace-pre-wrap text-ink-soft [overflow-wrap:anywhere]">
                  {organisation.refundPolicy}
                </p>
              </div>
            )}
            {organisation.pickupPolicy && (
              <div>
                <h3 className="font-semibold text-ink">Pickup policy</h3>
                <p className="mt-1 max-w-[70ch] whitespace-pre-wrap text-ink-soft [overflow-wrap:anywhere]">
                  {organisation.pickupPolicy}
                </p>
              </div>
            )}
          </section>

          <aside className="grid content-start gap-4 rounded-card border border-line bg-surface p-5">
            <SocietyJoin slug={organisation.slug} state={joinState} />
            {organisation.supportEmail && (
              <p className="text-sm text-ink-soft">
                Contact{" "}
                <a
                  className="text-brand underline [overflow-wrap:anywhere]"
                  href={`mailto:${organisation.supportEmail}`}
                >
                  {organisation.supportEmail}
                </a>
              </p>
            )}
            <p className="text-sm text-ink-muted">
              Times are shown in {organisation.timeZone}.
            </p>
          </aside>
        </div>

        <section className="mt-12 grid gap-5" id="events">
          <h2 className="border-l-[3px] border-brand pl-3 text-2xl font-semibold text-ink">
            Upcoming events
          </h2>
          {!organisation.events.length ? (
            <p className="text-ink-soft">No upcoming events.</p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {organisation.events.map((event) => (
                <EventCard
                  id={event.id}
                  key={event.id}
                  location={event.location}
                  heroAssetId={event.heroAssetId}
                  startTime={event.startTime}
                  timeZone={organisation.timeZone}
                  title={event.title}
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
