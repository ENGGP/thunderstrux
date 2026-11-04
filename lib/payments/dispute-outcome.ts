import type { OrderDisputeStatus } from "@prisma/client";
import type Stripe from "stripe";

// Stripe's dispute status as an order sees it. Kept apart from purchase-disputes.ts
// so the reversal worker can read it without importing the reconcilers.

// The card network's kind of case: a prevented dispute is the society's only
// when it was blocked (`block`); a `resolution` refunded the cardholder (N4).
export const caseTypeOf = (dispute: Stripe.Dispute) => dispute.payment_method_details?.card?.case_type ?? null;

// warning_closed is an inquiry that never became a chargeback: the society kept
// the money. A prevented dispute counts as won only when blocked; a resolution,
// or a case type Stripe didn't give, stays open until a person confirms it in
// Stripe, so the fence and the payout hold fail closed. An appeal stays open:
// Stripe hasn't published where it falls (PAY-068).
export const outcomeOf = (status: string, caseType?: string | null): OrderDisputeStatus =>
  status === "lost" ? "lost"
    : status === "won" || status === "warning_closed" || (status === "prevented" && caseType === "block") ? "won"
      : "open";

// PAY-037: an inquiry (warning_*) is a bank's question before any chargeback;
// no money moves, so it doesn't fence refunds or put tickets under review.
export const isInquiry = (status: string) => status.startsWith("warning_");

// A charge can carry more than one dispute; the order shows the worst, so one
// won dispute can't release another's fence or payout hold (SEC-024). Inquiries
// don't count, so a charge with only inquiries has no dispute status.
export const worstOutcome = (rows: Array<{ providerStatus: string; caseType?: string | null }>): OrderDisputeStatus | null => {
  const outcomes = rows.filter((row) => !isInquiry(row.providerStatus)).map((row) => outcomeOf(row.providerStatus, row.caseType));
  if (outcomes.length === 0) return null;
  return outcomes.includes("lost") ? "lost" : outcomes.includes("open") ? "open" : "won";
};
