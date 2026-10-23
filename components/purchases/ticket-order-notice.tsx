import type { ReactNode } from "react";
import Link from "next/link";
import { Notice } from "@/components/ui/notice";
import { formatDate, formatMoney } from "@/lib/format";
import { ticketOrderProjection } from "@/lib/purchases/projection";

type Order = Parameters<typeof ticketOrderProjection>[0] & {
  totalAmount: number;
  externalRefundedAmount?: number;
  event: { id: string; organisation: { name: string } };
  refundRequests: Array<{ amount: number; resolvedAt: Date | null }>;
};

// Where a ticket order stands, in the buyer's words. Shared by a member's
// purchase page and a guest's order page (T44a), which differ only in how a
// payment still being confirmed is shown: `processing`.
export function TicketOrderNotice({ order, processing }: { order: Order; processing: ReactNode }) {
  const projection = ticketOrderProjection(order);
  const society = order.event.organisation.name;
  const refund = order.refundRequests[0];
  if (projection === "processing") return processing;
  if (projection === "failed" || projection === "expired") {
    return <Notice title="This checkout didn't complete"><p>Nothing was charged. <Link className="font-semibold text-brand underline underline-offset-4" href={`/events/${order.event.id}`}>Back to the event</Link></p></Notice>;
  }
  if (projection === "refunded") {
    return (
      <Notice title="Refunded">
        <p>
          {refund ? `${formatMoney(refund.amount)} was refunded to your card${refund.resolvedAt ? ` on ${formatDate(refund.resolvedAt)}` : ""}.` : "This order was refunded in full."} Banks usually take 5 to 10 business days. The tickets are no longer valid.
        </p>
      </Notice>
    );
  }
  if (projection === "refund-processing") return <Notice role="status" title="Refund processing"><p>{society} has started a refund. Banks usually take 5 to 10 business days once it goes through.</p></Notice>;
  if (projection === "cancelled") return <Notice title="Cancelled by the society"><p>{society} cancelled this free registration. Nothing was charged, so there is nothing to refund, and the tickets are no longer valid.</p></Notice>;
  if (projection === "disputed") return <Notice title="Payment disputed" tone="warning"><p>Your bank has disputed this payment, so the tickets are under review. Contact {society} before the event.</p></Notice>;
  if (projection === "review") {
    return order.requiresCompensationReview ? (
      <Notice title="Payment received, tickets not issued" tone="warning"><p>We couldn&apos;t issue your tickets after your payment went through. {society} will sort it out; contact them if you haven&apos;t heard back.</p></Notice>
    ) : (
      <Notice title="Partly refunded"><p>{formatMoney(order.externalRefundedAmount ?? 0)} of {formatMoney(order.totalAmount)} was refunded to your card. Your tickets are still valid.</p></Notice>
    );
  }
  return null;
}
