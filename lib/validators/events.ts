import { z } from "zod";
import { priceAmountSchema } from "@/lib/validators/price";

const eventFieldsSchema = z
  .object({
    organisationId: z.string().trim().min(1),
    title: z.string().trim().min(1).max(180),
    // A draft may be saved half-done; publishing (eventReadiness) and editing a
    // published event both need a description and location.
    description: z.string().trim().max(5000),
    startTime: z.coerce.date(),
    endTime: z.coerce.date(),
    location: z.string().trim().max(240),
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
// Prices follow priceAmountSchema (free, or $2.00 to $999,999.99) and stock stops
// at a million, so totals stay inside a 32-bit integer (T39).
const maxQuantity = 1_000_000;
// An unbounded array let one request validate millions of items before authentication.
export const MAX_TICKET_TYPES = 50;
const ticketTypeCountError = `Up to ${MAX_TICKET_TYPES} ticket types.`;
const memberPrice = priceAmountSchema.nullable().optional();
const withinPrice = (ticketType: { price: number; memberPrice?: number | null }) => ticketType.memberPrice == null || ticketType.memberPrice <= ticketType.price;
const withinPriceError = { message: "The member price can't be more than the price", path: ["memberPrice"] };

const createTicketTypeFieldsSchema = z.object({
  name: z.string().trim().min(1).max(120),
  price: priceAmountSchema,
  memberPrice,
  quantity: z.number().int().min(1).max(maxQuantity)
});
export const createTicketTypeSchema = createTicketTypeFieldsSchema.refine(withinPrice, withinPriceError);

const updateTicketTypeFieldsSchema = z.object({
  name: z.string().trim().min(1).max(120),
  price: priceAmountSchema,
  memberPrice,
  quantity: z.number().int().min(0).max(maxQuantity)
});

// Events are always created as drafts; publishing is a separate, checked transition.
// A payment that can't become tickets is refunded automatically unless the society
// asks to review it, as commerce orders are and as ticketing platforms do.
export const createEventSchema = eventFieldsSchema.extend({
  compensationRefundMode: z.enum(["manual_review", "automatic_full"]).default("automatic_full"),
  ticketTypes: z.array(createTicketTypeSchema).max(MAX_TICKET_TYPES, ticketTypeCountError).optional().default([])
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
  ticketTypes: z.array(updateTicketTypeSchema).max(MAX_TICKET_TYPES, ticketTypeCountError).optional().default([])
});

export const eventPublicationSchema = z.object({
  targetStatus: z.enum(["draft", "published"]),
  version: versionSchema
});

export const eventSaleStateSchema = z.object({
  saleState: z.enum(["open", "closed"]),
  version: versionSchema
});
