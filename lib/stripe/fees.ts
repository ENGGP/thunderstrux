const PLATFORM_FEE_RATE = 0.1;
// Recorded on each order with its fee; change it whenever the rate or rounding changes.
export const PLATFORM_FEE_POLICY_VERSION = "platform_fee_10_percent_v1";

export function calculatePlatformFee(totalAmount: number) {
  if (!Number.isInteger(totalAmount) || totalAmount <= 0) {
    throw new Error("totalAmount must be a positive integer amount in cents");
  }

  const fee = Math.round(totalAmount * PLATFORM_FEE_RATE);

  return Math.min(fee, totalAmount);
}
