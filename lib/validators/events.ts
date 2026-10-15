import { z } from "zod";

const eventFieldsSchema = z
  .object({
    organisationId: z.string().trim().min(1),
    title: z.string().trim().min(1).max(180),
    description: z.string().trim().min(1).max(5000),
    startTime: z.coerce.date(),
    endTime: z.coerce.date(),
    location: z.string().trim().min(1).max(240),
    // Optional event-wide ceiling; null clears it.
    capacity: z.number().int().positive().max(1_000_000).nullable().optional(),
    visibility: z.enum(["public", "unlisted", "members_only"]).optional(),
    // Defaults to the start time when omitted.
    salesCloseAt: z.coerce.date().optional()
  })
  .refine((data) => data.endTime > data.startTime, {
    message: "endTime must be after startTime",
    path: ["endTime"]
  })
  .refine((data) => !data.salesCloseAt || data.salesCloseAt <= data.endTime, {
    message: "Ticket sales must close before the event ends",
    path: ["salesCloseAt"]
  });

export const createTicketTypeSchema = z.object({
  name: z.string().trim().min(1).max(120),
  price: z.number().int().min(0),
  quantity: z.number().int().min(1)
});

const updateTicketTypeFieldsSchema = z.object({
  name: z.string().trim().min(1).max(120),
  price: z.number().int().min(0),
  quantity: z.number().int().min(0)
});

// Events are always created as drafts; publishing is a separate, checked transition.
export const createEventSchema = eventFieldsSchema.extend({
  compensationRefundMode: z.enum(["manual_review", "automatic_full"]).default("manual_review"),
  ticketTypes: z.array(createTicketTypeSchema).optional().default([])
});

// An existing type also sends the remaining quantity the editor loaded, so a
// save cannot overwrite stock that sales changed meanwhile.
export const updateTicketTypeSchema = updateTicketTypeFieldsSchema
  .extend({
    id: z.string().trim().min(1).optional(),
    expectedQuantity: z.number().int().min(0).optional()
  })
  .refine((ticketType) => !ticketType.id || ticketType.expectedQuantity !== undefined, {
    message: "Send the quantity you loaded for an existing ticket type",
    path: ["expectedQuantity"]
  });

const versionSchema = z.number().int().positive();

export const updateEventSchema = eventFieldsSchema.extend({
  version: versionSchema,
  compensationRefundMode: z.enum(["manual_review", "automatic_full"]).optional(),
  ticketTypes: z.array(updateTicketTypeSchema).optional().default([])
});

export const eventPublicationSchema = z.object({
  targetStatus: z.enum(["draft", "published"]),
  version: versionSchema
});

export const eventSaleStateSchema = z.object({
  saleState: z.enum(["open", "closed"]),
  version: versionSchema
});

export const createScopedTicketTypeSchema = createTicketTypeSchema.extend({
  organisationId: z.string().trim().min(1)
});
