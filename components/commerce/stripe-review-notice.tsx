import type { OrderDisputeStatus, OrderRefundStatus } from "@prisma/client";
import { OrderReviewActions } from "@/components/orders/order-review-actions";
import { Notice } from "@/components/ui/notice";
import { formatDate, formatMoney } from "@/lib/format";
import { isLiveStripeKey } from "@/lib/stripe";

type Review = {
  disputeStatus: OrderDisputeStatus | null;
  externalRefundedAmount: number;
  externalRefundReviewedAt: Date | null;
  totalAmount: number;
  refundStatus: OrderRefundStatus | null;
  dispute: { stripeDisputeId: string; amount: number; providerStatus: string; evidenceDueBy: Date | null; createdAt: Date; closedAt: Date | null } | null;
};

// What Stripe reported about a membership or merchandise payment that
// Thunderstrux didn't do (PAY-003), in the words the ticket order page uses.
export function StripeReviewNotice({ orderId, kind, review, canAct, timeZone }: { orderId: string; kind: "membership" | "merchandise"; review: Review; canAct: boolean; timeZone?: string }) {
  const { dispute } = review;
  const date = (value: Date) => formatDate(value, timeZone);
  const link = dispute ? (
    <a className="inline-flex min-h-11 items-center font-semibold text-brand underline underline-offset-4" href={`https://dashboard.stripe.com/${isLiveStripeKey() ? "" : "test/"}disputes/${dispute.stripeDisputeId}`} rel="noreferrer" target="_blank">
      Open the dispute in Stripe
    </a>
  ) : null;
  const ended = kind === "membership" ? "The membership has ended." : "There's nothing to hand over.";
  if (review.disputeStatus === "open" && dispute) {
    return (
      <Notice title="The buyer has disputed this payment" tone="warning">
        <p>
          Their bank opened a dispute for {formatMoney(dispute.amount)} on {date(dispute.createdAt)}.
          {dispute.evidenceDueBy ? ` Respond in Stripe by ${date(dispute.evidenceDueBy)}.` : ""} Until it&apos;s resolved, refunds are paused
          {kind === "merchandise" ? " and the order can't be handed over." : ". The membership stays active unless the buyer wins."}
        </p>
        {link}
      </Notice>
    );
  }
  if (review.disputeStatus === "lost" && dispute) {
    return (
      <Notice title="The buyer won the dispute" tone="danger">
        <p>Their bank returned {formatMoney(dispute.amount)} to them{dispute.closedAt ? ` on ${date(dispute.closedAt)}` : ""}. {ended}</p>
        {link}
      </Notice>
    );
  }
  if (!review.disputeStatus && dispute?.closedAt && dispute.providerStatus !== "lost") {
    return (
      <Notice title="Stripe closed the dispute in the society's favour">
        <p>The dispute closed on {date(dispute.closedAt)}{review.refundStatus ? "." : " and the society kept the payment. Nothing else changed."}</p>
        {link}
      </Notice>
    );
  }
  if (!review.externalRefundedAmount) return null;
  if (review.refundStatus === "refunded" && review.externalRefundedAmount >= review.totalAmount) {
    return (
      <Notice title="Fully refunded in Stripe">
        <p>{formatMoney(review.externalRefundedAmount)} was refunded from the Stripe dashboard. {kind === "membership" ? "The membership has ended." : "Any pickup not yet collected was cancelled."}</p>
      </Notice>
    );
  }
  if (review.refundStatus) return null;
  const part = `${formatMoney(review.externalRefundedAmount)} of ${formatMoney(review.totalAmount)} was refunded from the Stripe dashboard.`;
  return review.externalRefundReviewedAt ? (
    <Notice title="Partly refunded in Stripe">
      <p>{part} Reviewed on {date(review.externalRefundReviewedAt)}; the order stands.</p>
    </Notice>
  ) : (
    <Notice action={canAct ? <OrderReviewActions action="mark_reviewed" orderId={orderId} /> : undefined} title="Partly refunded in Stripe: needs review" tone="warning">
      <p>{part} The {kind === "membership" ? "membership stays active" : "order stands"} until you decide. Refund the rest below, or mark it as reviewed.</p>
    </Notice>
  );
}
