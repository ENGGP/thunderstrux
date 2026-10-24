import type { MembershipEntitlement, MembershipProduct, Prisma } from "@prisma/client";
import { z } from "zod";
import type { ApiErrorDetail } from "@/lib/api/errors";
import type { AccountActor } from "@/lib/auth/account-lifecycle";
import { prisma } from "@/lib/db";
import { formatDate } from "@/lib/format";
import { lockOrganisationActor } from "@/lib/organisations/authority";
import { isOrganisationStripeReady } from "@/lib/stripe/connect";
import { priceAmountSchema } from "@/lib/validators/price";
import { toZonedInput, zonedCandidates } from "@/lib/zoned-time";

// Membership plans (T22, database spec 8.1): a fixed term [startsAt, endsAt)
// sold by one society. Staff enter a first and last day; the term runs from the
// start of the first day to the end of the last day in the society's zone.
// Every change holds User -> Organisation -> plan locks, so publish checks and
// edits of published plans never race each other (one plan per period), and
// T23 checkout, which locks the Organisation before reading a plan, never
// quotes a plan mid-edit.

export const membershipEntitlements = ["member_prices", "members_only_events"] as const satisfies readonly MembershipEntitlement[];

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const day = z
  .string()
  .regex(DAY_PATTERN, "Enter a date.")
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().startsWith(value), "Enter a real date.");
const expectedVersion = z.number().int().min(1).max(2147483646);

export const planFieldsSchema = z
  .object({
    name: z.string().trim().min(1, "Give the plan a name.").max(120),
    description: z.string().trim().max(2000),
    priceAmount: priceAmountSchema,
    firstDay: day,
    lastDay: day,
    entitlements: z.array(z.enum(membershipEntitlements)).max(membershipEntitlements.length)
  })
  .strict();
export const updatePlanSchema = planFieldsSchema.extend({ expectedVersion }).strict();
export const planVersionSchema = z.object({ expectedVersion }).strict();
export type PlanFields = z.infer<typeof planFieldsSchema>;

export class MembershipPlanError extends Error {
  constructor(
    readonly status: 400 | 404 | 409,
    message: string,
    readonly details: ApiErrorDetail[] = []
  ) {
    super(message);
    this.name = "MembershipPlanError";
  }
}

const notFound = () => new MembershipPlanError(404, "Membership plan not found");

function nextDay(value: string) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

// Midnight starting that day in the zone; null in the rare zones whose clocks skip midnight.
function startOfDay(value: string, timeZone: string) {
  return zonedCandidates(`${value}T00:00`, timeZone)[0] ?? null;
}

export function termFromDays(firstDay: string, lastDay: string, timeZone: string) {
  if (lastDay < firstDay) {
    throw new MembershipPlanError(400, "The last day must be on or after the first day.", [
      { path: ["lastDay"], message: "The last day must be on or after the first day." }
    ]);
  }
  const startsAt = startOfDay(firstDay, timeZone);
  const endsAt = startOfDay(nextDay(lastDay), timeZone);
  if (!startsAt || !endsAt) {
    const field = startsAt ? "lastDay" : "firstDay";
    throw new MembershipPlanError(400, "That day has no midnight in the society's time zone. Choose another day.", [
      { path: [field], message: "That day has no midnight in the society's time zone. Choose another day." }
    ]);
  }
  return { startsAt, endsAt };
}

// New dates have to end in the future; an ended plan keeps its old ones.
function requireFuture(endsAt: Date, now = new Date()) {
  if (endsAt <= now) {
    throw new MembershipPlanError(400, "This date has passed. A plan has to end in the future.", [
      { path: ["lastDay"], message: "This date has passed. A plan has to end in the future." }
    ]);
  }
}

export function daysFromTerm(startsAt: Date, endsAt: Date, timeZone: string) {
  return {
    firstDay: toZonedInput(startsAt, timeZone).slice(0, 10),
    lastDay: toZonedInput(new Date(endsAt.getTime() - 1), timeZone).slice(0, 10)
  };
}

export type PlanBlocker = { code: "term_past" | "overlap" | "payments_unavailable"; field: string; message: string };

// The one place that decides whether a plan may be on sale. Publishing, and
// saving a published plan, refuse while any blocker remains.
export function planReadiness(
  plan: Pick<MembershipProduct, "priceAmount" | "endsAt">,
  {
    chargesReady,
    overlapping,
    timeZone,
    now = new Date()
  }: {
    chargesReady: boolean;
    overlapping: Pick<MembershipProduct, "name" | "startsAt" | "endsAt"> | null;
    timeZone: string;
    now?: Date;
  }
) {
  const blockers: PlanBlocker[] = [];
  if (plan.endsAt <= now) {
    blockers.push({ code: "term_past", field: "lastDay", message: "This plan's last day has passed. Plans have to end in the future." });
  }
  if (overlapping) {
    const { firstDay, lastDay } = daysFromTerm(overlapping.startsAt, overlapping.endsAt, timeZone);
    const range = `${formatDay(firstDay)} to ${formatDay(lastDay)}`;
    blockers.push({
      code: "overlap",
      field: "firstDay",
      message: `Overlaps ${overlapping.name} (published), ${range}. Change the dates or archive that plan.`
    });
  }
  if (plan.priceAmount > 0 && !chargesReady) {
    blockers.push({ code: "payments_unavailable", field: "priceAmount", message: "Set up payments to sell a paid plan. A free plan can publish without them." });
  }
  return blockers;
}

// "1 Jan 2027" for a calendar day, independent of any zone.
export function formatDay(value: string) {
  return formatDate(`${value}T12:00:00Z`, "UTC");
}

function overlappingPlan(tx: Prisma.TransactionClient, plan: Pick<MembershipProduct, "id" | "organisationId" | "startsAt" | "endsAt">) {
  return tx.membershipProduct.findFirst({
    where: {
      organisationId: plan.organisationId,
      status: "published",
      id: { not: plan.id },
      startsAt: { lt: plan.endsAt },
      endsAt: { gt: plan.startsAt }
    },
    orderBy: [{ startsAt: "asc" }, { id: "asc" }],
    select: { name: true, startsAt: true, endsAt: true }
  });
}

function isSold(tx: Prisma.TransactionClient, planId: string) {
  // A grant always has a line, so lines cover every sale, pending or not.
  return tx.commerceOrderLine.count({ where: { membershipProductId: planId } }).then((count) => count > 0);
}

async function lockPlan(tx: Prisma.TransactionClient, actor: AccountActor, organisationId: string, planId: string) {
  const organisation = await lockOrganisationActor(tx, actor, organisationId, "memberships:manage");
  await tx.$queryRaw`SELECT "id" FROM "MembershipProduct" WHERE "id" = ${planId} AND "organisationId" = ${organisationId} FOR UPDATE`;
  const plan = await tx.membershipProduct.findFirst({ where: { id: planId, organisationId } });
  if (!plan) throw notFound();
  return { organisation, plan };
}

function checkVersion(plan: MembershipProduct, version: number) {
  if (plan.version !== version) throw new MembershipPlanError(409, "This plan changed since you opened it. Reload it to see the latest version.");
}

async function refuseBlockers(tx: Prisma.TransactionClient, organisation: { timeZone: string; stripeAccountId: string | null; stripeChargesEnabled: boolean }, plan: MembershipProduct) {
  const blockers = planReadiness(plan, {
    chargesReady: isOrganisationStripeReady(organisation),
    overlapping: await overlappingPlan(tx, plan),
    timeZone: organisation.timeZone
  });
  if (blockers.length) {
    throw new MembershipPlanError(409, blockers[0].message, blockers.map((blocker) => ({ path: [blocker.field], message: blocker.message, reason: blocker.code })));
  }
}

function audit(tx: Prisma.TransactionClient, actor: AccountActor, plan: MembershipProduct, action: string, metadata: Prisma.InputJsonObject = {}) {
  return tx.auditLog.create({
    data: {
      organisationId: plan.organisationId,
      actorUserId: actor.id,
      action: `membership_plan.${action}`,
      targetType: "MembershipProduct",
      targetId: plan.id,
      metadata: { version: plan.version, status: plan.status, ...metadata }
    }
  });
}

const sorted = (entitlements: readonly MembershipEntitlement[]) => [...new Set(entitlements)].sort();

export async function createPlan(actor: AccountActor, organisationId: string, input: PlanFields) {
  const fields = planFieldsSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    const organisation = await lockOrganisationActor(tx, actor, organisationId, "memberships:manage");
    const term = termFromDays(fields.firstDay, fields.lastDay, organisation.timeZone);
    requireFuture(term.endsAt);
    const plan = await tx.membershipProduct.create({
      data: {
        organisationId,
        name: fields.name,
        description: fields.description,
        priceAmount: fields.priceAmount,
        entitlements: sorted(fields.entitlements),
        ...term
      }
    });
    await audit(tx, actor, plan, "created");
    return plan;
  });
}

export async function updatePlan(actor: AccountActor, organisationId: string, planId: string, input: z.infer<typeof updatePlanSchema>) {
  const { expectedVersion: version, ...fields } = updatePlanSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    const { organisation, plan } = await lockPlan(tx, actor, organisationId, planId);
    checkVersion(plan, version);
    if (plan.status === "archived") throw new MembershipPlanError(409, "Archived plans can't be changed.");

    const term = termFromDays(fields.firstDay, fields.lastDay, organisation.timeZone);
    const next = { name: fields.name, description: fields.description, priceAmount: fields.priceAmount, entitlements: sorted(fields.entitlements), ...term };
    const changed = (Object.keys(next) as Array<keyof typeof next>).filter((key) =>
      key === "startsAt" || key === "endsAt"
        ? next[key].getTime() !== plan[key].getTime()
        : JSON.stringify(next[key]) !== JSON.stringify(key === "entitlements" ? sorted(plan.entitlements) : plan[key])
    );
    if (changed.some((key) => key !== "description") && (await isSold(tx, plan.id))) {
      throw new MembershipPlanError(409, "Someone has this plan, so its name, dates, price and unlocks are locked. You can still edit the description.");
    }
    if (!changed.length) return plan;
    if (changed.includes("startsAt") || changed.includes("endsAt")) requireFuture(term.endsAt);

    const updated = await tx.membershipProduct.update({ where: { id: plan.id }, data: { ...next, version: { increment: 1 } } });
    // A description edit never takes a plan off sale; anything else must still pass.
    if (updated.status === "published" && changed.some((key) => key !== "description")) await refuseBlockers(tx, organisation, updated);
    await audit(tx, actor, updated, "updated", { changedFields: changed });
    return updated;
  });
}

// Publishing a published plan again returns it unchanged.
export async function publishPlan(actor: AccountActor, organisationId: string, planId: string, input: z.infer<typeof planVersionSchema>) {
  const { expectedVersion: version } = planVersionSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    const { organisation, plan } = await lockPlan(tx, actor, organisationId, planId);
    if (plan.status === "published") return plan;
    checkVersion(plan, version);
    if (plan.status === "archived") throw new MembershipPlanError(409, "An archived plan can't go back on sale. Create a new plan instead.");
    await refuseBlockers(tx, organisation, plan);
    const published = await tx.membershipProduct.update({
      where: { id: plan.id },
      data: { status: "published", publishedAt: new Date(), version: { increment: 1 } }
    });
    await audit(tx, actor, published, "published");
    return published;
  });
}

// One way: an archived plan stops selling and never returns. Holders keep their terms.
export async function archivePlan(actor: AccountActor, organisationId: string, planId: string, input: z.infer<typeof planVersionSchema>) {
  const { expectedVersion: version } = planVersionSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    const { plan } = await lockPlan(tx, actor, organisationId, planId);
    if (plan.status === "archived") return plan;
    checkVersion(plan, version);
    const archived = await tx.membershipProduct.update({
      where: { id: plan.id },
      data: { status: "archived", archivedAt: new Date(), version: { increment: 1 } }
    });
    await audit(tx, actor, archived, "archived");
    return archived;
  });
}

export type PlanStanding = "draft" | "published" | "ended" | "archived";

export function planStanding(plan: Pick<MembershipProduct, "status" | "endsAt">, now = new Date()): PlanStanding {
  return plan.status === "published" && plan.endsAt <= now ? "ended" : plan.status;
}

// Staff view of one plan: the editor's values, whether it has sold, and what
// stands between it and sale.
export async function readPlan(organisationId: string, planId: string, now = new Date()) {
  const organisation = await prisma.organisation.findUniqueOrThrow({
    where: { id: organisationId },
    select: { timeZone: true, stripeAccountId: true, stripeChargesEnabled: true }
  });
  const plan = await prisma.membershipProduct.findFirst({ where: { id: planId, organisationId } });
  if (!plan) return null;
  const [sold, overlapping, holders] = await Promise.all([
    isSold(prisma, plan.id),
    overlappingPlan(prisma, plan),
    prisma.membershipGrant.count({ where: { membershipProductId: plan.id, revokedAt: null } })
  ]);
  return {
    plan: staffPlan(plan, organisation.timeZone, now),
    sold,
    holders,
    timeZone: organisation.timeZone,
    chargesReady: isOrganisationStripeReady(organisation),
    blockers: plan.status === "archived" ? [] : planReadiness(plan, { chargesReady: isOrganisationStripeReady(organisation), overlapping, timeZone: organisation.timeZone, now })
  };
}

function staffPlan(plan: MembershipProduct, timeZone: string, now: Date) {
  return {
    id: plan.id,
    name: plan.name,
    description: plan.description,
    priceAmount: plan.priceAmount,
    entitlements: sorted(plan.entitlements),
    ...daysFromTerm(plan.startsAt, plan.endsAt, timeZone),
    startsAt: plan.startsAt.toISOString(),
    endsAt: plan.endsAt.toISOString(),
    status: plan.status,
    standing: planStanding(plan, now),
    version: plan.version
  };
}
export type StaffPlan = ReturnType<typeof staffPlan>;

// Every plan of the society, newest term first, with how many hold each one.
export async function listPlans(organisationId: string, now = new Date()) {
  const { timeZone } = await prisma.organisation.findUniqueOrThrow({ where: { id: organisationId }, select: { timeZone: true } });
  const [plans, holders] = await Promise.all([
    prisma.membershipProduct.findMany({ where: { organisationId }, orderBy: [{ startsAt: "desc" }, { id: "desc" }], take: 200 }),
    prisma.membershipGrant.groupBy({ by: ["membershipProductId"], where: { organisationId, revokedAt: null }, _count: { _all: true } })
  ]);
  const counts = new Map(holders.map((row) => [row.membershipProductId, row._count._all]));
  return { timeZone, plans: plans.map((plan) => ({ ...staffPlan(plan, timeZone, now), holders: counts.get(plan.id) ?? 0 })) };
}

// What anyone may see: published plans that have not ended. No counts, no
// drafts, no archive (T24a shows these on the society page).
export async function publicPlans(organisationId: string, now = new Date()) {
  return prisma.membershipProduct.findMany({
    where: { organisationId, status: "published", endsAt: { gt: now } },
    orderBy: [{ startsAt: "asc" }, { id: "asc" }],
    select: { id: true, name: true, description: true, priceAmount: true, currency: true, startsAt: true, endsAt: true, entitlements: true }
  });
}
