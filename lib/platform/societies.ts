import type { Prisma } from "@prisma/client";
import { formatDateTime } from "@/lib/format";
import { PlatformRefusal, type PlatformActor } from "./authority";
import { notifyPeople, platformWrite, societyHistory, type ChangeInput } from "./changes";

// T55: stopping a bad society (Q5). Restricted stops new checkouts (every
// family, free registration included), publishing and reopening sales, the
// Connect dashboard link and disconnect, and payouts; its events leave public
// listings. Tickets already sold, check-in, refunds and fulfilment of a payment
// Stripe already took are untouched. A payout hold only stops payouts, until
// payoutsHeldUntil or, with none, until released. No refunds or cancellations
// happen from the portal.

export type SocietyAction = "restrict_society" | "lift_restriction" | "hold_payouts" | "release_payouts";

// Locked after the operator's row, before anything inside the society.
export async function lockSociety(tx: Prisma.TransactionClient, organisationId: string) {
  const [row] = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "Organisation" WHERE "id" = ${organisationId} FOR UPDATE`;
  if (!row) throw new PlatformRefusal("That society doesn't exist.");
  return tx.organisation.findUniqueOrThrow({ where: { id: organisationId }, select: societySelect });
}

export const societySelect = {
  id: true, name: true, supportEmail: true, restrictedAt: true, payoutsHeldAt: true, payoutsHeldUntil: true, payoutsHeldReason: true,
  staff: { where: { status: "active" }, select: { role: true, user: { select: { id: true, email: true, firstName: true, lastName: true, displayName: true, disabledAt: true } } } }
} satisfies Prisma.OrganisationSelect;

export async function changeSociety(actor: PlatformActor, action: SocietyAction, organisationId: string, input: ChangeInput & { heldUntil?: Date | null }, now = new Date()) {
  return platformWrite(actor, "platform:society_control", input, async (tx) => {
    const society = await lockSociety(tx, organisationId);
    const target = { targetType: "Organisation" as const, targetId: society.id, organisationId: society.id };
    const owners = society.staff.filter((row) => row.role === "owner" && !row.user.disabledAt).map((row) => ({ email: row.user.email, userId: row.user.id, relation: "owner" }));
    const history = (historyAction: string, metadata: Prisma.InputJsonObject = {}) =>
      societyHistory(tx, [{ organisationId: society.id, action: historyAction, targetType: "Organisation", targetId: society.id, metadata }]);
    if (action === "restrict_society" || action === "lift_restriction") {
      const restrict = action === "restrict_society";
      if (restrict === Boolean(society.restrictedAt)) throw new PlatformRefusal(restrict ? "This society is already restricted." : "This society isn't restricted.");
      await tx.organisation.update({ where: { id: society.id }, data: restrict ? { restrictedAt: now, restrictionReason: input.reason.trim() } : { restrictedAt: null, restrictionReason: null } });
      await history(restrict ? "platform.society_restricted" : "platform.society_unrestricted");
      await notifyPeople(tx, {
        eventKey: `platform/${action}/${society.id}/${now.getTime()}`, template: restrict ? "society_restricted" : "society_unrestricted",
        organisationId: society.id, recipients: owners, linkPath: "/dashboard",
        message: restrict
          ? `Thunderstrux support restricted ${society.name}. New sales, publishing, Stripe changes and payouts are paused; tickets already sold stay valid and refunds still work. Reply to support to find out why and what happens next.`
          : `Thunderstrux support lifted the restriction on ${society.name}. You can publish and sell again, and payouts resume on their usual schedule.`
      });
      return { change: { action: restrict ? "platform.society_restricted" : "platform.society_unrestricted", ...target }, result: {} };
    }
    if (action === "hold_payouts") {
      const asked = input.heldUntil ?? null;
      if (asked && asked <= now) throw new PlatformRefusal("Pick an end date in the future, or leave it empty to hold until released.");
      // PAY-085: a hold already running (such as ownership recovery's 7 days) is only ever
      // lengthened here: the later end wins, and no end beats any date. Ending it early is the release below.
      const current = society.payoutsHeldUntil;
      const running = society.payoutsHeldAt && (!current || current > now);
      const until = !running ? asked : asked && current ? (asked > current ? asked : current) : null;
      await tx.organisation.update({ where: { id: society.id }, data: { payoutsHeldAt: now, payoutsHeldUntil: until, payoutsHeldReason: input.reason.trim() } });
      await history("platform.payouts_held", until ? { until: until.toISOString() } : {});
      return { change: { action: "platform.payouts_held", ...target, metadata: { until: until?.toISOString() ?? null, replaced: Boolean(society.payoutsHeldAt) } }, result: {} };
    }
    if (!society.payoutsHeldAt) throw new PlatformRefusal("Payouts aren't held.");
    await tx.organisation.update({ where: { id: society.id }, data: { payoutsHeldAt: null, payoutsHeldUntil: null, payoutsHeldReason: null } });
    await history("platform.payouts_released");
    return { change: { action: "platform.payouts_released", ...target, metadata: society.payoutsHeldUntil ? { wasUntil: formatDateTime(society.payoutsHeldUntil) } : {} }, result: {} };
  }, now);
}
