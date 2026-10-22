import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SocietyHeader } from "@/components/organisations/society-header";
import { SocietyJoin } from "@/components/organisations/society-join";
import { buttonClasses } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Notice } from "@/components/ui/notice";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatDate, formatPrice, formatTerm, renewLabel } from "@/lib/format";
import { membershipOffers, type Offer } from "@/lib/memberships/offers";
import { hasShop } from "@/lib/merchandise/shop";
import { publicOrganisation } from "@/lib/organisations/public-organisations";
import { zoneCity } from "@/lib/zoned-time";
import { societyViewer } from "../viewer";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Memberships" };


// PUB-06 (T24a, design round B1): a society's fixed-term memberships, each
// with the viewer's own standing. Buying happens on the review page; nothing
// here charges or grants anything.
export default async function SocietyMembershipsPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const organisation = await publicOrganisation((await params).orgSlug);
  if (!organisation) notFound();
  const viewer = await societyViewer(organisation.id);
  const [{ offers, memberUntil }, hasMerchandise] = await Promise.all([membershipOffers(organisation.id, viewer.memberId), hasShop(organisation.id)]);
  const zone = organisation.timeZone;
  const day = (date: Date) => formatDate(date, zone);
  const lastDay = (endsAt: Date) => formatDate(new Date(endsAt.getTime() - 1), zone);
  const unlockWords = { member_prices: `Member prices on ${organisation.name} tickets`, members_only_events: "Booking members-only events" } as const;
  const rights = new Set(offers.flatMap((offer) => offer.entitlements));
  const perks = [rights.has("member_prices") ? `get member prices on ${organisation.name} tickets` : null, rights.has("members_only_events") ? "can book members-only events" : null].filter(Boolean);
  const reviewHref = (offer: Offer) => `/societies/${organisation.slug}/memberships/${offer.id}/checkout`;

  function action(offer: Offer) {
    const { state } = offer;
    if (state.kind === "held") {
      return (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line pt-3.5">
          <p className="font-semibold text-ink">
            {state.grant.state === "upcoming" ? `You already have this membership. It starts ${day(state.grant.startsAt)}.` : `You're a member until ${lastDay(state.grant.endsAt)}.`}
          </p>
          <Link className="inline-flex min-h-11 items-center font-semibold text-brand underline underline-offset-4" href="/memberships">
            View in My memberships
          </Link>
        </div>
      );
    }
    if (state.kind === "covered") return <p className="border-t border-line pt-3.5 text-ink-soft">Your {state.by} membership already covers these dates, so you can&apos;t buy this one too.</p>;
    if (state.kind === "pending") return <p className="border-t border-line pt-3.5 text-ink-soft">Your checkout for these dates is still being confirmed. Nothing more to do.</p>;
    if (viewer.joinState === "organisation") return <p className="text-sm text-ink-soft">Memberships are bought with a member account.</p>;
    if (!viewer.memberId) {
      return (
        <div className="grid gap-2">
          <Link className={buttonClasses({ size: "lg" })} href={`/login?callbackUrl=${encodeURIComponent(reviewHref(offer))}`}>
            Sign in to buy membership
          </Link>
          <p className="text-sm text-ink-soft">Memberships need a Thunderstrux account with a verified email.</p>
        </div>
      );
    }
    if (!viewer.verified) return null;
    return (
      <div className="grid gap-2">
        <Link className={buttonClasses({ size: "lg" })} href={reviewHref(offer)}>
          {state.renew ? renewLabel(offer.name) : offer.priceAmount === 0 ? "Get free membership" : "Buy membership"}
        </Link>
        <p className="text-sm text-ink-soft">
          {state.renew
            ? "Starts the day after your current membership ends. No automatic renewal."
            : "Not the same as joining: a membership has dates and unlocks member benefits."}
        </p>
      </div>
    );
  }

  return (
    <main id="main" tabIndex={-1} className="bg-paper pb-14">
      <div className="mx-auto max-w-page px-4 md:px-8">
        <SocietyHeader current="memberships" hasMemberships={offers.length > 0} hasMerchandise={hasMerchandise} joined={viewer.joinState === "joined"} memberUntil={memberUntil} organisation={organisation} />

        <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <section aria-labelledby="memberships-heading" className="grid content-start gap-5">
            <div className="grid gap-1.5">
              <h2 className="font-display text-2xl font-semibold text-ink" id="memberships-heading">
                Memberships
              </h2>
              <p className="max-w-[64ch] text-ink-soft">
                Each membership covers fixed dates and doesn&apos;t renew automatically.{perks.length ? ` Members ${perks.join(" and ")}.` : ""}
              </p>
            </div>
            {viewer.memberId && !viewer.verified && offers.length ? (
              <Notice title="Verify your email to buy a membership">
                <p>
                  We need to know your address works.{" "}
                  <Link className="font-semibold text-brand underline underline-offset-4" href={`/verify-email?callbackUrl=${encodeURIComponent(`/societies/${organisation.slug}/memberships`)}`}>
                    Verify email
                  </Link>
                </p>
              </Notice>
            ) : null}
            {offers.length === 0 ? (
              <section className="grid gap-2 rounded-card border border-line bg-surface p-6">
                <h3 className="font-display text-lg font-semibold text-ink">No memberships on sale</h3>
                <p className="text-ink-soft">{organisation.name} isn&apos;t selling a membership right now. You can still join for free to follow its events.</p>
              </section>
            ) : (
              offers.map((offer) => {
                const header = (
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h3 className="font-display text-xl font-semibold text-ink [overflow-wrap:anywhere]" id={`offer-${offer.id}`}>
                      {offer.name}
                    </h3>
                    {offer.state.kind === "held" ? (
                      <StatusBadge status={offer.state.grant.state === "upcoming" ? "upcoming" : "active"} />
                    ) : offer.startsAt > new Date() ? (
                      <StatusBadge label={`Starts ${day(offer.startsAt)}`} status="upcoming" />
                    ) : null}
                  </div>
                );
                // A plan the viewer holds is a short reminder; anything else is an offer.
                if (offer.state.kind === "held") {
                  return (
                    <article aria-labelledby={`offer-${offer.id}`} className="grid gap-4 rounded-card border border-line bg-surface p-5 sm:p-6" key={offer.id}>
                      {header}
                      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-[15px]">
                        <dt className="text-ink-soft">Runs</dt>
                        <dd className="font-semibold text-ink">{formatTerm(offer.startsAt, offer.endsAt, zone)}, {zoneCity(zone)}</dd>
                        <dt className="text-ink-soft">Price</dt>
                        <dd className="font-semibold tabular-nums text-ink">{formatPrice(offer.priceAmount)}</dd>
                      </dl>
                      {action(offer)}
                    </article>
                  );
                }
                return (
                  <article aria-labelledby={`offer-${offer.id}`} className="grid gap-5 rounded-card border border-line bg-surface p-5 sm:p-6 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]" key={offer.id}>
                    <div className="grid content-start gap-4">
                      {header}
                      {offer.description ? <p className="whitespace-pre-wrap text-ink-soft [overflow-wrap:anywhere]">{offer.description}</p> : null}
                      {offer.entitlements.length ? (
                        <div className="grid gap-2">
                          <h4 className="text-[15px] font-semibold text-ink">What it unlocks</h4>
                          <ul className="grid gap-1.5 text-[15px]">
                            {offer.entitlements.map((key) => (
                              <li className="flex items-start gap-2" key={key}>
                                <Icon className="mt-0.5 text-success" name="success" size={18} />
                                {unlockWords[key]}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                    </div>
                    <div className="grid content-start gap-3 rounded-control bg-surface-subtle p-5">
                      <p className="text-[15px] text-ink">
                        {formatTerm(offer.startsAt, offer.endsAt, zone)}, {zoneCity(zone)}
                      </p>
                      <p className="font-display text-3xl font-semibold tabular-nums text-ink">{formatPrice(offer.priceAmount)}</p>
                      {action(offer)}
                    </div>
                  </article>
                );
              })
            )}
            {organisation.refundPolicy && offers.length ? (
              <div>
                <h3 className="font-semibold text-ink">Refunds</h3>
                <p className="mt-1 max-w-[70ch] whitespace-pre-wrap text-ink-soft [overflow-wrap:anywhere]">{organisation.refundPolicy}</p>
              </div>
            ) : null}
          </section>

          <aside className="grid content-start gap-3.5 self-start rounded-card border border-line bg-surface p-5 sm:p-6">
            {viewer.joinState === "joined" ? (
              <>
                <h2 className="text-lg font-semibold text-ink [overflow-wrap:anywhere]">You&apos;ve joined {organisation.name}</h2>
                <p className="text-[15px] text-ink-soft">Joining is free: you follow the society&apos;s events from your dashboard. It&apos;s separate from a membership, and leaving doesn&apos;t cancel one.</p>
                <Link className="w-fit text-[15px] font-semibold text-brand underline underline-offset-4" href="/dashboard/organisations">
                  Manage in My societies
                </Link>
              </>
            ) : (
              <>
                <SocietyJoin slug={organisation.slug} state={viewer.joinState} />
                <p className="text-sm text-ink-soft">Joining is free and follows the society&apos;s events. It&apos;s separate from a membership, and leaving doesn&apos;t cancel one.</p>
              </>
            )}
            {organisation.supportEmail ? (
              <div className="grid gap-1 border-t border-line pt-3.5 text-sm">
                <span className="font-semibold text-ink">Contact</span>
                <a className="w-fit text-brand underline underline-offset-4 [overflow-wrap:anywhere]" href={`mailto:${organisation.supportEmail}`}>
                  {organisation.supportEmail}
                </a>
              </div>
            ) : null}
          </aside>
        </div>
      </div>
    </main>
  );
}
