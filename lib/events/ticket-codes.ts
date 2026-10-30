import type { Prisma } from "@prisma/client";
import { headers } from "next/headers";
import type { z } from "zod";
import { prisma } from "@/lib/db";
import { scopedByOrganisation } from "@/lib/db/organisation-scope";
import { EventLifecycleNotFoundError, EventLifecycleValidationError } from "@/lib/events/event-lifecycle";
import { lockEventInventory } from "@/lib/events/inventory";
import { formatMoney } from "@/lib/format";
import { enforceRateLimit, getRateLimitClientIp } from "@/lib/security/rate-limit";
import { isBelowPaidMinimum, minPaidPrice } from "@/lib/stripe/fees";
import type { ticketCodeSchema, ticketCodeUpdateSchema } from "@/lib/validators/events";

// Discount, access and comp codes (product decision 2026-10-30, after Eventbrite,
// Humanitix and Luma): one code per order, for one ticket type or every visible
// one; percent or dollars off, or none for a pure access code; 100% off is a comp.
// A limit counts tickets, and a ticket stops counting once void, so a refund or a
// cancellation gives its use back, as its place goes back on sale (PAY-043).

type Db = Pick<Prisma.TransactionClient, "ticketCode" | "ticket" | "ticketReservation">;

export type CodeTerms = { ticketTypeId: string | null; percentOff: number | null; amountOff: number | null };

const codeSelect = { id: true, code: true, ticketTypeId: true, percentOff: true, amountOff: true, maxUses: true, endsAt: true, disabledAt: true } as const;

export function normaliseTicketCode(input: string | null | undefined) {
  const code = input?.trim().toUpperCase() ?? "";
  return /^[A-Z0-9-]{3,30}$/.test(code) ? code : null;
}

// Per ticket, so an order's total stays unit price × quantity; percent rounds to the cent.
export function priceWithCode(price: number, code: CodeTerms) {
  if (code.percentOff !== null) return price - Math.round((price * code.percentOff) / 100);
  if (code.amountOff !== null) return Math.max(0, price - code.amountOff);
  return price;
}

// A code for every type never reaches a hidden one; an access code names it.
export function codeAppliesTo(code: CodeTerms, ticketType: { id: string; hidden: boolean }) {
  return code.ticketTypeId === null ? !ticketType.hidden : code.ticketTypeId === ticketType.id;
}

export function describeCode(code: CodeTerms, ticketTypeName?: string | null) {
  const off = code.percentOff === 100 ? "free" : code.percentOff !== null ? `${code.percentOff}% off` : code.amountOff !== null ? `${formatMoney(code.amountOff)} off` : null;
  const target = ticketTypeName ?? (code.ticketTypeId ? "one ticket type" : "every ticket");
  return off ? `${off} ${target}` : `unlocks ${target}`;
}

// Tickets a code has given: those not void on its orders, plus live holds. The
// caller's event lock (every checkout of the event takes it) makes this exact.
export async function ticketCodeUses(db: Db, codeId: string, now: Date) {
  const [tickets, held] = await Promise.all([
    db.ticket.count({ where: { validity: { not: "void" }, order: { ticketCodeId: codeId } } }),
    db.ticketReservation.aggregate({ _sum: { quantity: true }, where: { status: "active", expiresAt: { gt: now }, order: { ticketCodeId: codeId } } })
  ]);
  return tickets + (held._sum.quantity ?? 0);
}

export type CodeRefusal = "unknown" | "off" | "ended" | "used_up";
export const codeRefusalMessage: Record<CodeRefusal, string> = {
  unknown: "We don't recognise that code for this event.",
  off: "That code has been turned off.",
  ended: "That code has expired.",
  used_up: "That code has been used up."
};

export type UsableCode = CodeTerms & { id: string; code: string; remaining: number | null };
export type CodeLookup = { ok: true; code: UsableCode } | { ok: false; reason: CodeRefusal; terms: (CodeTerms & { id: string; code: string }) | null };

export async function readTicketCode(db: Db, eventId: string, code: string, now: Date): Promise<CodeLookup> {
  const row = await db.ticketCode.findUnique({ where: { eventId_code: { eventId, code } }, select: codeSelect });
  if (!row) return { ok: false, reason: "unknown", terms: null };
  const refused = (reason: CodeRefusal): CodeLookup => ({ ok: false, reason, terms: row });
  if (row.disabledAt) return refused("off");
  if (row.endsAt && row.endsAt <= now) return refused("ended");
  const remaining = row.maxUses === null ? null : row.maxUses - (await ticketCodeUses(db, row.id, now));
  if (remaining !== null && remaining <= 0) return refused("used_up");
  return { ok: true, code: { ...row, remaining } };
}

export type BuyerCode = { text: string; code: UsableCode | null; message: string | null };

// The code a buyer typed or followed a link with, for the event page and checkout.
// Advisory: checkout decides again under the event lock. Limited per address and
// event, so short codes can't be guessed by trying them.
export async function codeForBuyer(eventId: string, input: string | undefined): Promise<BuyerCode | null> {
  if (!input?.trim()) return null;
  const text = input.trim().toUpperCase().slice(0, 30);
  const request = new Request("http://thunderstrux.invalid/", { headers: await headers() });
  if (await enforceRateLimit({ policy: "ticket_code_check", request, keyParts: [getRateLimitClientIp(request), eventId] })) {
    return { text, code: null, message: "Too many code attempts. Wait a few minutes, then try again." };
  }
  const code = normaliseTicketCode(text);
  const found = code ? await readTicketCode(prisma, eventId, code, new Date()) : null;
  return found?.ok ? { text, code: found.code, message: null } : { text, code: null, message: codeRefusalMessage[found?.reason ?? "unknown"] };
}

// Staff list: each code with the tickets it has given (valid, held or under review).
export async function listEventTicketCodes(organisationId: string, eventId: string) {
  const now = new Date();
  const codes = await prisma.ticketCode.findMany({
    where: { eventId, event: { organisationId } },
    orderBy: { createdAt: "asc" },
    select: { ...codeSelect, createdAt: true, ticketType: { select: { name: true } } }
  });
  return Promise.all(codes.map(async ({ ticketType, ...code }) => ({ ...code, ticketTypeName: ticketType?.name ?? null, used: await ticketCodeUses(prisma, code.id, now) })));
}

type CodeInput = z.infer<typeof ticketCodeSchema>;
type CodeUpdate = z.infer<typeof ticketCodeUpdateSchema>;

// Every code change takes the event lock first, as checkout and edits do, so a
// limit, a price and the uses counted against it never interleave.
async function lockedEvent(tx: Prisma.TransactionClient, organisationId: string, eventId: string) {
  if (!(await lockEventInventory(tx, eventId))) throw new EventLifecycleNotFoundError();
  const event = await tx.event.findFirst({
    where: scopedByOrganisation(organisationId, { id: eventId }),
    select: { id: true, cancelledAt: true, ticketTypes: { select: { id: true, name: true, price: true, memberPrice: true, hidden: true } } }
  });
  if (!event) throw new EventLifecycleNotFoundError();
  if (event.cancelledAt) throw new EventLifecycleValidationError("This event was cancelled", [{ path: ["eventId"], message: "A cancelled event sells nothing, so it takes no codes" }]);
  return event;
}

export async function createEventTicketCode(organisationId: string, eventId: string, input: CodeInput, actorUserId: string) {
  const terms = { ticketTypeId: input.ticketTypeId, percentOff: input.percentOff ?? null, amountOff: input.amountOff ?? null };
  return prisma.$transaction(async (tx) => {
    const event = await lockedEvent(tx, organisationId, eventId);
    const named = terms.ticketTypeId ? event.ticketTypes.find((type) => type.id === terms.ticketTypeId) : null;
    if (terms.ticketTypeId && !named) throw new EventLifecycleValidationError("Choose a ticket type of this event", [{ path: ["ticketTypeId"], message: "Choose a ticket type of this event" }]);
    if (named && !named.hidden && terms.percentOff === null && terms.amountOff === null) {
      throw new EventLifecycleValidationError("Add a discount", [{ path: ["percentOff"], message: `Everyone can already buy ${named.name}, so this code needs a discount. To keep it for code holders, hide the ticket type.` }]);
    }
    // A paid price under $2.00 is refused at checkout, so refuse the code that would make one now.
    for (const type of event.ticketTypes.filter((ticketType) => codeAppliesTo(terms, ticketType))) {
      for (const price of [type.price, type.memberPrice].filter((value): value is number => value !== null)) {
        const left = priceWithCode(price, terms);
        if (isBelowPaidMinimum(left)) {
          throw new EventLifecycleValidationError("A code can't leave a price under the paid minimum", [{
            path: [terms.percentOff !== null ? "percentOff" : "amountOff"],
            message: `This leaves ${type.name} at ${formatMoney(left)}, under the ${formatMoney(minPaidPrice)} paid minimum. Take less off, or make it free with 100% off.`
          }]);
        }
      }
    }
    if (await tx.ticketCode.findUnique({ where: { eventId_code: { eventId, code: input.code } }, select: { id: true } })) {
      throw new EventLifecycleValidationError("This event already has that code", [{ path: ["code"], message: "This event already has that code. Choose another." }]);
    }
    const code = await tx.ticketCode.create({
      data: { eventId, code: input.code, ...terms, maxUses: input.maxUses ?? null, endsAt: input.endsAt ?? null },
      select: codeSelect
    });
    await tx.auditLog.create({
      data: {
        organisationId,
        actorUserId,
        action: "event.code_created",
        targetType: "Event",
        targetId: eventId,
        metadata: { code: code.code, does: describeCode(terms, named?.name), maxUses: code.maxUses, endsAt: code.endsAt?.toISOString() ?? null }
      }
    });
    return code;
  });
}

// Terms stay as sold (orders keep their price); the limit, end and on/off can change.
export async function updateEventTicketCode(organisationId: string, eventId: string, codeId: string, input: CodeUpdate, actorUserId: string) {
  return prisma.$transaction(async (tx) => {
    await lockedEvent(tx, organisationId, eventId);
    const before = await tx.ticketCode.findFirst({ where: { id: codeId, eventId }, select: codeSelect });
    if (!before) throw new EventLifecycleNotFoundError("Code was not found for this event");
    const disabledAt = input.disabled === undefined ? before.disabledAt : input.disabled ? (before.disabledAt ?? new Date()) : null;
    const code = await tx.ticketCode.update({
      where: { id: codeId },
      data: { maxUses: input.maxUses === undefined ? before.maxUses : input.maxUses, endsAt: input.endsAt === undefined ? before.endsAt : input.endsAt, disabledAt },
      select: codeSelect
    });
    const changes = {
      ...(code.maxUses !== before.maxUses ? { maxUses: { from: before.maxUses, to: code.maxUses } } : {}),
      ...(code.endsAt?.getTime() !== before.endsAt?.getTime() ? { endsAt: { from: before.endsAt?.toISOString() ?? null, to: code.endsAt?.toISOString() ?? null } } : {}),
      ...(Boolean(code.disabledAt) !== Boolean(before.disabledAt) ? { on: { from: !before.disabledAt, to: !code.disabledAt } } : {})
    };
    if (Object.keys(changes).length > 0) {
      await tx.auditLog.create({
        data: { organisationId, actorUserId, action: "event.code_updated", targetType: "Event", targetId: eventId, metadata: { code: code.code, changes } }
      });
    }
    return code;
  });
}
