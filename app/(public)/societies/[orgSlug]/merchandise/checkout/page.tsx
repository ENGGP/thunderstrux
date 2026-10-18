import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { CheckoutShell } from "@/components/layout/checkout-shell";
import { MerchandiseCheckout } from "@/components/merchandise/checkout";
import { Notice } from "@/components/ui/notice";
import { getLiveSession } from "@/lib/auth/live-session";
import { guestCookieName, readGuestSession } from "@/lib/guest/guest-access";
import { guestCsrfToken } from "@/lib/guest/guest-csrf";
import { publicOrganisation } from "@/lib/organisations/public-organisations";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Review your order", robots: { index: false, follow: false } };

// BUY-07 (T27b, design round B2): checkout for one society's merchandise
// basket. A verified member buys signed in; anyone else confirms an email
// and buys as a guest (or signs in from the email step and comes back).
export default async function MerchandiseCheckoutPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const [{ orgSlug }, session, cookieStore] = await Promise.all([params, getLiveSession(), cookies()]);
  const organisation = await publicOrganisation(orgSlug);
  if (!organisation) notFound();
  const self = `/societies/${organisation.slug}/merchandise/checkout`;
  const basket = `/societies/${organisation.slug}/merchandise/basket`;
  if (session && session.user.accountRole !== "member") redirect(basket);
  const guestSessionId = session ? undefined : cookieStore.get(guestCookieName)?.value;
  const guest = guestSessionId ? await readGuestSession(guestSessionId) : null;
  const guestCheckout = guest?.purpose === "checkout" ? guest : null;

  if (session && !session.user.emailVerifiedAt) {
    return (
      <CheckoutShell backHref={basket} backLabel="Back to basket" current={0} society={organisation.name} steps={["Review", "Pay with Stripe", "Pickup"]} title="Review your order">
        <Notice title="Verify your email to continue">
          <p className="mt-0.5">We email receipts and pickup notices, so we need to know the address works.</p>
          <Link className="inline-flex min-h-11 items-center font-semibold text-brand underline underline-offset-4" href={`/verify-email?callbackUrl=${encodeURIComponent(self)}`}>
            Verify email
          </Link>
        </Notice>
      </CheckoutShell>
    );
  }

  const buyer = session
    ? { name: [session.user.firstName, session.user.lastName].filter(Boolean).join(" ") || null, email: session.user.email, guest: false }
    : guestCheckout
      ? { name: null, email: guestCheckout.email, guest: true }
      : null;
  return (
    <MerchandiseCheckout
      buyer={buyer}
      callbackUrl={self}
      guestCsrf={guestCheckout && guestSessionId ? guestCsrfToken(guestSessionId) : undefined}
      logoAssetId={organisation.logoAssetId}
      organisationId={organisation.id}
      society={{ slug: organisation.slug, name: organisation.name }}
    />
  );
}
