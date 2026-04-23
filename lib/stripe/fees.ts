const PLATFORM_FEE_RATE = 0.1;

export function calculatePlatformFee(totalAmount: number) {
  if (!Number.isInteger(totalAmount) || totalAmount <= 0) {
    throw new Error("totalAmount must be a positive integer amount in cents");
  }

  const fee = Math.round(totalAmount * PLATFORM_FEE_RATE);

  return Math.min(fee, totalAmount);
}
