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

// The lowest round price where the society keeps more than half (fee 97c, society
// $1.03). Below 93c the capped fee took the whole price; Stripe's own floor is 50c.
export const minPaidPrice = 200;
export const paidPriceMinimum = "Paid prices start at $2.00, so your society keeps more than half after the Thunderstrux fee.";

export function isBelowPaidMinimum(amount: number) {
  return amount > 0 && amount < minPaidPrice;
}
