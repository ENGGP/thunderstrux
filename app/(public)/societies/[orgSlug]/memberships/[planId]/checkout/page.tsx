import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CheckoutShell } from "@/components/layout/checkout-shell";
import { MembershipCheckoutAction } from "@/components/memberships/membership-checkout-action";
import { MoneySummary } from "@/components/purchases/money-summary";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { Notice } from "@/components/ui/notice";
import { getLiveSession } from "@/lib/auth/live-session";
import { formatDate, formatMoney, formatTerm } from "@/lib/format";
import { membershipOffer } from "@/lib/memberships/offers";
import { publicOrganisation } from "@/lib/organisations/public-organisations";
import { zoneCity } from "@/lib/zoned-time";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Review your membership" };

// BUY-05 (T24a, design round B1): the membership review. A verified member
// account only, never a guest; checkout re-checks the plan, price and dates
// under locks.
export default async function MembershipCheckoutPage({ params }: { params: Promise<{ orgSlug: string; planId: string }> }) {
  const { orgSlug, planId } = await params;
  const back = `/societies/${orgSlug}/memberships`;
  const self = `${back}/${planId}/checkout`;
  const session = await getLiveSession();
  if (!session) redirect(`/login?callbackUrl=${encodeURIComponent(self)}`);
  if (session.user.accountRole !== "member") redirect(back);
  const organisation = await publicOrganisation(orgSlug);
  if (!organisation) notFound();
  const found = await membershipOffer(organisation.id, planId, session.user.id);
  if (!found) redirect(back);
  const { offer, current } = found;
  const zone = organisation.timeZone;
  const day = (date: Date) => formatDate(date, zone);
  const lastDay = (endsAt: Date) => formatDate(new Date(endsAt.getTime() - 1), zone);
  const free = offer.priceAmount === 0;
  const verified = Boolean(session.user.emailVerifiedAt);
  const buyer = [session.user.firstName, session.user.lastName].filter(Boolean).join(" ") || session.user.email;
  const unlockWords = { member_prices: `member prices on ${organisation.name} tickets`, members_only_events: "booking members-only events" } as const;
  const unlocks = offer.entitlements.map((key) => unlockWords[key]);
  const label = free ? "Confirm free membership" : `Pay ${formatMoney(offer.priceAmount)}`;
  const blocked =
    offer.state.kind === "held" || offer.state.kind === "covered"
      ? "You already have a membership for these dates"
      : offer.state.kind === "pending"
        ? "A checkout for these dates is already in progress"
        : null;

  return (
    <CheckoutShell
      aside={
        <Card>
          <div className="grid gap-4">
            <div className="flex items-center gap-3">
              {organisation.logoAssetId ? (
                <img alt="" className="size-12 shrink-0 rounded-control border border-line bg-surface object-contain" height={48} src={`/api/public/assets/${organisation.logoAssetId}`} width={48} />
              ) : (
                <span aria-hidden="true" className="flex size-12 shrink-0 items-center justify-center rounded-control border border-line font-display text-xl font-semibold text-brand-ink">
                  {organisation.name.trim().charAt(0).toUpperCase()}
                </span>
              )}
              <div className="grid min-w-0">
                <h2 className="text-lg font-semibold text-ink [overflow-wrap:anywhere]">{offer.name}</h2>
                <p className="text-sm text-ink-soft [overflow-wrap:anywhere]">{organisation.name}</p>
              </div>
            </div>
            <p className="text-sm text-ink-soft">{formatTerm(offer.startsAt, offer.endsAt, zone)}</p>
            <div className="flex items-baseline justify-between border-t border-line pt-3">
              <span className="font-semibold text-ink">Total</span>
              <span className="text-lg font-semibold tabular-nums text-ink">{free ? "Free" : formatMoney(offer.priceAmount)}</span>
            </div>
            {blocked ? (
              <Notice title={blocked} tone="warning">
                <p className="mt-0.5">Nothing has been charged.</p>
                <Link className="inline-flex min-h-11 items-center font-semibold text-brand underline underline-offset-4" href="/memberships">
                  View my memberships
                </Link>
              </Notice>
            ) : verified ? (
              <MembershipCheckoutAction backHref={back} label={label} organisationId={organisation.id} planId={offer.id} total={offer.priceAmount} />
            ) : (
              <Notice title="Verify your email to continue">
                <p>We need to know your address works.</p>
                <Link className="mt-1 inline-flex min-h-11 items-center font-semibold text-brand underline underline-offset-4" href={`/verify-email?callbackUrl=${encodeURIComponent(self)}`}>
                  Verify email
                </Link>
              </Notice>
            )}
            {free ? (
              <p className="text-caption text-ink-muted">Nothing to pay.</p>
            ) : (
              <p className="flex items-start gap-2 text-caption text-ink-muted">
                <Icon className="mt-0.5" name="lock" size={16} />
                You pay on Stripe&apos;s secure page, then come back here.
              </p>
            )}
          </div>
        </Card>
      }
      backHref={back}
      backLabel="Back to memberships"
      current={0}
      society={organisation.name}
      steps={free ? ["Review", "Membership"] : ["Review", "Pay with Stripe", "Membership"]}
      title={free ? "Confirm your membership" : "Review your membership"}
    >
      <Card>
        <div className="grid gap-4">
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="text-lg font-semibold text-ink [overflow-wrap:anywhere]">{offer.name}</h2>
            <span className="inline-flex h-6 items-center rounded-tag border border-line bg-surface-subtle px-2 text-xs font-semibold text-ink-soft">No automatic renewal</span>
          </div>
          <dl className="grid gap-x-6 gap-y-2 text-ui sm:grid-cols-[max-content_1fr]">
            <dt className="text-ink-soft">Society</dt>
            <dd className="[overflow-wrap:anywhere]">{organisation.name}</dd>
            <dt className="text-ink-soft">Runs</dt>
            <dd>
              {formatTerm(offer.startsAt, offer.endsAt, zone)}, {zoneCity(zone)}
            </dd>
            <dt className="text-ink-soft">Unlocks</dt>
            <dd>{unlocks.length ? unlocks.join("; ").replace(/^./, (first) => first.toUpperCase()) : "No extra benefits on Thunderstrux"}</dd>
          </dl>
          <MoneySummary lines={[{ label: offer.name, quantity: 1, unitPrice: offer.priceAmount }]} note={free ? "No payment needed." : "No booking fee. You pay the price shown."} />
        </div>
      </Card>
      {current ? (
        <Card>
          <div className="grid gap-3">
            <h2 className="text-lg font-semibold text-ink">Your cover</h2>
            <dl className="grid gap-x-6 gap-y-2 text-ui sm:grid-cols-[max-content_1fr]">
              <dt className="text-ink-soft">Now</dt>
              <dd>
                {current.name}, until {lastDay(current.endsAt)}
              </dd>
              <dt className="text-ink-soft">After this</dt>
              <dd className="font-semibold">
                Covered {formatTerm(offer.startsAt, offer.endsAt, zone)}
              </dd>
            </dl>
            {current.endsAt.getTime() === offer.startsAt.getTime() ? (
              <p className="text-sm text-ink-soft">The new membership starts the moment your current one ends, so there&apos;s no gap and no overlap.</p>
            ) : null}
          </div>
        </Card>
      ) : null}
      <Card>
        <div className="grid gap-2">
          <h2 className="text-lg font-semibold text-ink">Before you {free ? "confirm" : "pay"}</h2>
          <ul className="grid list-disc gap-1.5 pl-5 text-ui text-ink-soft">
            <li className="[overflow-wrap:anywhere]">
              The membership is for you only: {buyer}, {session.user.email}.
            </li>
            {offer.startsAt > new Date() ? <li>Benefits start on {day(offer.startsAt)}, not when you {free ? "confirm" : "pay"}.</li> : null}
            {organisation.refundPolicy ? <li className="[overflow-wrap:anywhere]">Refund policy: {organisation.refundPolicy}</li> : null}
            {organisation.supportEmail ? (
              <li className="[overflow-wrap:anywhere]">
                Questions:{" "}
                <a className="font-semibold text-brand underline" href={`mailto:${organisation.supportEmail}`}>
                  {organisation.supportEmail}
                </a>
              </li>
            ) : null}
          </ul>
        </div>
      </Card>
    </CheckoutShell>
  );
}
