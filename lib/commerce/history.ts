// What each step of a membership or merchandise order means to staff, for the
// "What happened" list on its staff page. Steps without words stay out of it.
export const commerceHappened: Partial<Record<string, string>> = {
  order_created: "Checkout started",
  payment_fulfilled: "Payment confirmed by Stripe",
  free_fulfilled: "Free order confirmed",
  order_failed: "Checkout didn't complete",
  order_expired: "Checkout expired",
  compensation_required: "Payment held for review",
  free_cancelled: "Cancelled",
  refund_requested: "Refund requested",
  refund_pending: "Refund processing at Stripe",
  refunded: "Refunded",
  refund_failed: "Stripe turned the refund down",
  pickup_ready: "Marked ready to collect",
  pickup_collected: "Handed over",
  return_recorded: "Return recorded",
  dispute_opened: "The buyer disputed the payment",
  dispute_closed: "The bank decided the dispute",
  dispute_funds_recovered: "Lost dispute taken back from the society",
  external_refund_recorded: "Refunded in Stripe",
  external_refund_reviewed: "Refund made in Stripe reviewed"
};
