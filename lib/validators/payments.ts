import { z } from "zod";

export const createEventCheckoutSchema = z.object({
  eventId: z.string().trim().min(1),
  ticketTypeId: z.string().trim().min(1),
  quantity: z.number().int().min(1)
});
