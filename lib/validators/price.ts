import { z } from "zod";
import { isBelowPaidMinimum, paidPriceMinimum } from "@/lib/stripe/fees";

// A price in cents: free, or from $2.00 (minPaidPrice, so the society keeps more
// than half after the fee) to Stripe's largest AUD card payment ($999,999.99).
export const priceAmountSchema = z
  .number()
  .int()
  .min(0)
  .max(99_999_999)
  .refine((value) => !isBelowPaidMinimum(value), paidPriceMinimum);
