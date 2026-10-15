import { z } from "zod";

export const maxTicketsPerOrder = 10;

export const createEventCheckoutSchema = z.object({
  eventId: z.string().trim().min(1),
  ticketTypeId: z.string().trim().min(1),
  quantity: z.number().int().min(1).max(maxTicketsPerOrder),
  // The unit price the buyer was shown; a different locked price is a 409 quote change.
  expectedUnitPrice: z.number().int().min(0)
});
