import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { publicOrganisation } from "@/lib/organisations/public-organisations";
import { EventCard } from "@/components/events/event-card";
import { SocietyHeader } from "@/components/organisations/society-header";
import { SocietyJoin } from "@/components/organisations/society-join";
import { membershipOffers } from "@/lib/memberships/offers";
import { hasShop } from "@/lib/merchandise/shop";
import { societyViewer } from "./viewer";
export const dynamic = "force-dynamic";
export async function generateMetadata({ params }: { params: Promise<{ orgSlug: string }> }): Promise<Metadata> {
  const organisation = await publicOrganisation((await params).orgSlug);
  return organisation ? { title: organisation.name } : {};
}
export default async function OrganisationDetailsPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const organisation = await publicOrganisation((await params).orgSlug);
  if (!organisation) notFound();
  const { joinState, memberId } = await societyViewer(organisation.id);
  const [{ offers, memberUntil }, hasMerchandise] = await Promise.all([membershipOffers(organisation.id, memberId), hasShop(organisation.id)]);
  return (
    <main id="main" tabIndex={-1} className="bg-paper pb-14">
      <div className="mx-auto max-w-page px-4 md:px-8">
        <SocietyHeader
          current="overview"
          hasMemberships={offers.length > 0}
          hasMerchandise={hasMerchandise}
          joined={joinState === "joined"}
          memberUntil={memberUntil}
          organisation={organisation}
        />

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
