import { z } from "zod";
import { isBelowStripeMinimum, paidPriceMinimum } from "@/lib/stripe/fees";

// A price in cents: free, or from Stripe's smallest AUD card payment ($0.50) to
// its largest ($999,999.99).
export const priceAmountSchema = z
  .number()
  .int()
  .min(0)
  .max(99_999_999)
  .refine((value) => !isBelowStripeMinimum(value), paidPriceMinimum);
