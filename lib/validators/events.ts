import { z } from "zod";

const eventFieldsSchema = z
  .object({
    organisationId: z.string().trim().min(1),
    title: z.string().trim().min(1).max(180),
    description: z.string().trim().min(1).max(5000),
    startTime: z.coerce.date(),
    endTime: z.coerce.date(),
    location: z.string().trim().min(1).max(240)
  })
  .refine((data) => data.endTime > data.startTime, {
    message: "endTime must be after startTime",
    path: ["endTime"]
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

export const createEventSchema = eventFieldsSchema.extend({
  status: z.enum(["draft", "published"]).default("draft"),
  ticketTypes: z.array(createTicketTypeSchema).optional().default([])
});

export const updateTicketTypeSchema = updateTicketTypeFieldsSchema.extend({
  id: z.string().trim().min(1).optional()
});

export const updateEventSchema = eventFieldsSchema.extend({
  ticketTypes: z.array(updateTicketTypeSchema).optional().default([])
});

export const createScopedTicketTypeSchema = createTicketTypeSchema.extend({
  organisationId: z.string().trim().min(1)
});
