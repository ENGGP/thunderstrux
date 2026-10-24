// T46 (founder decision, 2026-10-24): priced just under Humanitix's Standard
// plan (4% + $0.99 per ticket plus GST). Card processing, which Stripe charges
// the platform on destination charges, and any GST are inside it; the society
// absorbs it, so buyers pay the price shown.
const PLATFORM_FEE_RATE = 0.0375;
const PLATFORM_FEE_PER_ITEM = 89;
// Recorded on each order with its fee; change it whenever the rate or rounding changes.
export const PLATFORM_FEE_POLICY_VERSION = "platform_fee_3_75_percent_89c_v2";

// `items`: the tickets in a ticket order; a membership or merchandise order is one.
// The percentage is rounded once per order, and the fee never exceeds the price.
export function calculatePlatformFee(totalAmount: number, items = 1) {
  if (!Number.isInteger(totalAmount) || totalAmount <= 0) {
    throw new Error("totalAmount must be a positive integer amount in cents");
  }
  if (!Number.isInteger(items) || items <= 0) {
    throw new Error("items must be a positive integer");
  }

  return Math.min(Math.round(totalAmount * PLATFORM_FEE_RATE) + PLATFORM_FEE_PER_ITEM * items, totalAmount);
}

// Stripe's smallest AUD card payment. A paid price between 1 and 49 cents could be
// listed but never paid, because Stripe refuses the Checkout Session.
export const minPaidPrice = 50;
export const paidPriceMinimum = "Paid prices start at $0.50, Stripe's smallest card payment.";

export function isBelowStripeMinimum(amount: number) {
  return amount > 0 && amount < minPaidPrice;
}
