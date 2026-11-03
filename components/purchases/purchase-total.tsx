import { formatPrice } from "@/lib/format";
import { buyerPurchaseBadge, ticketOrderProjection } from "@/lib/purchases/projection";

type Payable = Parameters<typeof buyerPurchaseBadge>[0] & { paymentKind: "free" | "stripe" | "legacy"; totalAmount: number };

// What the buyer paid, in the words that fit the order's state. Money that went
// back is struck through wherever it was returned: a refund, a refund made in
// Stripe, or a dispute the buyer's bank won. The row's badge names it, so the
// word after the amount is for screen readers only. A partial refund keeps its
// total, with the part that went back under it.
export function PurchaseTotal({ order }: { order: Payable }) {
  const projection = ticketOrderProjection(order);
  if (projection === "failed" || projection === "expired") return <span className="text-ink-soft">Not charged</span>;
  if (order.paymentKind === "free") return <span>Free</span>;
  const badge = buyerPurchaseBadge(order);
  if (badge.status === "refunded" && badge.label !== "Partly refunded") {
    return (
      <span>
        <s className="text-ink-muted">{formatPrice(order.totalAmount)}</s>
        <span className="sr-only"> refunded</span>
      </span>
    );
  }
  return (
    <span>
      {formatPrice(order.totalAmount)}
      {order.externalRefundedAmount ? <span className="block text-xs font-normal text-ink-soft">{formatPrice(order.externalRefundedAmount)} refunded</span> : null}
    </span>
  );
}
