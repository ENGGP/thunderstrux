import type { CommerceKind, Prisma } from "@prisma/client";
import type { z } from "zod";
import type { CommerceLineInput } from "@/lib/commerce/orders";
import { merchandiseFamily } from "@/lib/merchandise/sale";
import { membershipFamily } from "@/lib/memberships/grants";

// What a commerce family (memberships T23, merchandise T25-T27) plugs into
// checkout and fulfilment (T21). Every hook runs inside the caller's
// transaction; Stripe is never called from a hook.
//
// Lock order: the family's own resources first (membership: member then
// society; merchandise: variants in ascending id), then the commerce order.
export type CommerceBuyer = { userId: string } | { guestIdentityId: string };

export type CommerceOrderForHooks = { id: string; organisationId: string; kind: CommerceKind; userId: string | null; guestIdentityId: string | null };

export type CommerceFamilyAdapter<Selection = unknown> = {
  // Validates a checkout request body's `selection` before any lock.
  selection: z.ZodType<Selection>;
  // Merchandise may be bought by a verified guest; memberships never.
  guests: boolean;
  // Takes the family's locks, then reads the clock, since the queue for them can
  // be long. Under them: validate the selection against live products, place
  // any hold, and return the lines to buy at today's prices.
  quote(tx: Prisma.TransactionClient, input: { organisationId: string; buyer: CommerceBuyer; selection: Selection }): Promise<{ lines: CommerceLineInput[] }>;
  // Takes the family's locks for an existing order, before the order lock.
  lock(tx: Prisma.TransactionClient, order: CommerceOrderForHooks): Promise<void>;
  // Under the order lock, after the payment is verified: grant the membership
  // or commit the stock. `false` when it can no longer be honoured (the term
  // overlaps, the hold is gone): the paid order goes to compensation review.
  fulfil(tx: Prisma.TransactionClient, order: CommerceOrderForHooks, now: Date): Promise<{ fulfilled: true } | { fulfilled: false; reason: string }>;
  // Under the order lock: the order failed or expired, so release any hold.
  release(tx: Prisma.TransactionClient, order: CommerceOrderForHooks, reason: string): Promise<void>;
};

// Filled by the family tasks (memberships T23, merchandise T27). Until a
// family is registered its checkout route answers 404 and a paid webhook for
// it goes to compensation review.
export const commerceFamilies: Partial<Record<CommerceKind, CommerceFamilyAdapter>> = {
  membership: membershipFamily as CommerceFamilyAdapter,
  merchandise: merchandiseFamily as CommerceFamilyAdapter
};
