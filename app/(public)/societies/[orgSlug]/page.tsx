import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { publicOrganisation } from "@/lib/organisations/public-organisations";
import { EventCard } from "@/components/events/event-card";
import { ProductTile } from "@/components/merchandise/product-tile";
import { SocietyHeader } from "@/components/organisations/society-header";
import { SocietyJoinCard } from "@/components/organisations/society-join-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { listingAvailability } from "@/lib/events/public-events";
import { formatPrice, formatTerm } from "@/lib/format";
import { membershipOffers } from "@/lib/memberships/offers";
import { shopProducts } from "@/lib/merchandise/shop";
import { zoneCity } from "@/lib/zoned-time";
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
  const [{ offers, memberUntil }, products, availability] = await Promise.all([
    membershipOffers(organisation.id, memberId),
    shopProducts(organisation.id),
    listingAvailability(organisation.events.map((event) => event.id))
  ]);
  // PUB-05: the soonest membership still to end and the four newest products.
  const offer = offers[0];
  const heading = "border-l-[3px] border-brand pl-3 text-2xl font-semibold text-ink";
  const more = "text-sm font-semibold text-brand underline underline-offset-4";
  return (
    <main id="main" tabIndex={-1} className="bg-paper pb-14">
      <div className="mx-auto max-w-page px-4 md:px-8">
        <SocietyHeader
          current="overview"
          hasMemberships={offers.length > 0}
          hasMerchandise={products.length > 0}
          joined={joinState === "joined"}
          memberUntil={memberUntil}
          organisation={organisation}
        />

        <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <section className="grid content-start gap-5" id="overview">
            <h2 className="text-2xl font-semibold text-ink">About this society</h2>
            <p className="max-w-[70ch] whitespace-pre-wrap text-ink-soft [overflow-wrap:anywhere]">
              {organisation.description || "This society hasn't added a description yet."}
            </p>
          </section>

          <SocietyJoinCard joinState={joinState} organisation={organisation} />
        </div>

        <section className="mt-12 grid gap-5" id="events">
          <h2 className={heading}>Upcoming events</h2>
          {!organisation.events.length ? (
            <p className="text-ink-soft">No upcoming events.</p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {organisation.events.map((event) => (
                <EventCard
                  availability={availability.get(event.id)}
                  id={event.id}
                  key={event.id}
                  location={event.location}
                  media={organisation.events.some((item) => item.heroAssetId)}
                  heroAssetId={event.heroAssetId}
                  startTime={event.startTime}
                  timeZone={organisation.timeZone}
                  title={event.title}
                />
              ))}
            </div>
          )}
        </section>

        {offer ? (
          <section aria-labelledby="membership-heading" className="mt-12 grid gap-5" id="membership">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <h2 className={heading} id="membership-heading">
                Membership
              </h2>
              <Link className={more} href={`/societies/${organisation.slug}/memberships`}>
                {offers.length > 1 ? "See all memberships" : "See membership details"}
              </Link>
            </div>
            <article className="grid gap-3 rounded-card border border-line bg-surface p-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:p-6">
              <div className="grid gap-1">
                <div className="flex flex-wrap items-center gap-3">
                  <h3 className="text-xl font-semibold text-ink [overflow-wrap:anywhere]">{offer.name}</h3>
                  {offer.state.kind === "held" ? <StatusBadge status={offer.state.grant.state === "upcoming" ? "upcoming" : "active"} /> : null}
                </div>
                <p className="text-ui text-ink-soft">
                  {formatTerm(offer.startsAt, offer.endsAt, organisation.timeZone)}, {zoneCity(organisation.timeZone)}. No automatic renewal.
                </p>
              </div>
              <p className="font-display text-2xl font-semibold tabular-nums text-ink">{formatPrice(offer.priceAmount)}</p>
            </article>
          </section>
        ) : null}

        {products.length ? (
          <section aria-labelledby="merchandise-heading" className="mt-12 grid gap-5" id="merchandise">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="flex flex-wrap items-center gap-3">
                <h2 className={heading} id="merchandise-heading">
                  Merchandise
                </h2>
                <span className="rounded-tag border border-neutral-border bg-neutral-bg px-2 py-0.5 text-xs font-semibold text-neutral">Pickup only</span>
              </div>
              <Link className={more} href={`/societies/${organisation.slug}/merchandise`}>
                {products.length > 4 ? "See all merchandise" : "Go to the shop"}
              </Link>
            </div>
            <ul className="grid grid-cols-2 gap-x-4 gap-y-7 md:grid-cols-4 lg:gap-x-6">
              {products.slice(0, 4).map((product) => (
                <li key={product.id}>
                  <ProductTile product={product} society={organisation.slug} />
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {/* Reference reading, so it comes after what's on: on a phone, events used to start a screen and a half down. */}
        {organisation.refundPolicy || organisation.pickupPolicy ? (
          <section aria-labelledby="policies-heading" className="mt-12 grid gap-5" id="policies">
            <h2 className={heading} id="policies-heading">Policies</h2>
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
        ) : null}
      </div>
    </main>
  );
}
