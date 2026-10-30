import { HoldCountdown } from "@/components/purchases/hold-countdown";
import type { ReactNode } from "react";
import Link from "next/link";
import { formatTime } from "@/components/calendar/layout";
import { UnpaidOrderActions } from "@/components/purchases/unpaid-order-actions";
import { Notice } from "@/components/ui/notice";
import type { PendingCheckout } from "@/lib/purchases/pending-checkout";

// An order Stripe hasn't been paid for, in the buyer's words (design round E1):
// waiting (with Return to payment and Cancel order), confirming once Stripe has
// the payment, or a hold that ended before payment.
export function UnpaidOrderNotice({ checkout, cancelUrl, held, title, backHref, timeZone, confirming, guestCsrf, stacked }: {
  checkout: PendingCheckout;
  cancelUrl: string;
  // What is held, and whether it reads as one thing or several: { what: "1 ticket", many: false }.
  held: { what: string; many: boolean; event: string };
  title?: string;
  backHref: string;
  timeZone: string;
  confirming: ReactNode;
  guestCsrf?: string;
  stacked?: boolean;
}) {
  if (checkout.state === "confirming") return confirming;
  const back = <Link className="font-semibold text-brand underline underline-offset-4" href={backHref}>Back to {held.event}</Link>;
  if (checkout.state === "ended") {
    return (
      <Notice title="This checkout didn't complete">
        <p>The hold ended before payment, so nothing was charged and {held.many ? "they're" : "it's"} back on sale. {back}</p>
      </Notice>
    );
  }
  return (
    <Notice title={title ?? "You haven't paid yet"} tone="warning">
      <p>
        We&apos;re holding {held.what} for you until {formatTime(checkout.holdEndsAt, timeZone)}: <HoldCountdown endsAt={checkout.holdEndsAt.toISOString()} /> Pay on Stripe to get {held.many ? "them" : "it"}, or cancel and {held.many ? "they go" : "it goes"} back on sale. Nothing has been charged.
      </p>
      <div className="mt-3">
        <UnpaidOrderActions cancelUrl={cancelUrl} guestCsrf={guestCsrf} confirmText={`The ${held.what} you're holding for ${held.event} ${held.many ? "go" : "goes"} back on sale.`} paymentUrl={checkout.paymentUrl} stacked={stacked} title="Cancel this order?" />
      </div>
    </Notice>
  );
}
