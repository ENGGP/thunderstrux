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
    salesCloseAt: z.coerce.date().optional(),
    // A ready `event` image uploaded for this society; null removes it.
    heroAssetId: z.string().trim().min(1).max(64).nullable().optional()
  })
  .refine((data) => data.endTime > data.startTime, {
    message: "endTime must be after startTime",
    path: ["endTime"]
  })
  .refine((data) => !data.salesCloseAt || data.salesCloseAt <= data.endTime, {
    message: "Ticket sales must close before the event ends",
    path: ["salesCloseAt"]
  });

// What a member with the member_prices right pays (T24b): optional, never above the price.
const memberPrice = z.number().int().min(0).nullable().optional();
const withinPrice = (ticketType: { price: number; memberPrice?: number | null }) => ticketType.memberPrice == null || ticketType.memberPrice <= ticketType.price;
const withinPriceError = { message: "The member price can't be more than the price", path: ["memberPrice"] };

const createTicketTypeFieldsSchema = z.object({
  name: z.string().trim().min(1).max(120),
  price: z.number().int().min(0),
  memberPrice,
  quantity: z.number().int().min(1)
});
export const createTicketTypeSchema = createTicketTypeFieldsSchema.refine(withinPrice, withinPriceError);

const updateTicketTypeFieldsSchema = z.object({
  name: z.string().trim().min(1).max(120),
  price: z.number().int().min(0),
  memberPrice,
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
  .refine(withinPrice, withinPriceError)
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

export const createScopedTicketTypeSchema = createTicketTypeFieldsSchema.extend({
  organisationId: z.string().trim().min(1)
}).refine(withinPrice, withinPriceError);
