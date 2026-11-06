import type { OrganisationStaffRole, Prisma } from "@prisma/client";
import { appUrl } from "@/lib/app-url";
import { enqueueNotification } from "@/lib/email/notification-outbox";

// SEC-046: every active owner, the acting one included, hears when someone gains
// staff access, so a grant made from a stolen session can't go unnoticed. SEC-081: they
// hear of a revocation too, so the send log records it for a restore to re-apply.
export async function notifyOwnersOfStaffGrant(tx: Prisma.TransactionClient, input: {
  organisationId: string; eventKey: string; email: string; role: OrganisationStaffRole; revoked?: boolean;
}) {
  const [organisation, owners] = await Promise.all([
    tx.organisation.findUniqueOrThrow({ where: { id: input.organisationId }, select: { name: true } }),
    tx.organisationStaff.findMany({ where: { organisationId: input.organisationId, role: "owner", status: "active", user: { disabledAt: null } },
      select: { user: { select: { email: true } } } })
  ]);
  const name = organisation.name.replace(/\s+/g, " ").trim();
  const origin = appUrl();
  for (const { user } of owners) {
    await enqueueNotification(tx, { eventKey: input.eventKey, recipient: user.email, template: "business_notice", organisationId: input.organisationId, payload: {
      subject: `Staff access changed for ${name}`.slice(0, 200),
      message: input.revoked
        ? `${input.email} no longer has ${input.role.replace(/_/g, " ")} access to ${name} on Thunderstrux. If nobody on your committee meant to remove it, check the Staff page and contact Thunderstrux.`
        : `${input.email} now has ${input.role.replace(/_/g, " ")} access to ${name} on Thunderstrux. If nobody on your committee meant to give them this access, revoke it on the Staff page and contact Thunderstrux.`,
      ...(origin ? { link: new URL("/dashboard/settings/staff", origin).toString() } : {})
    } });
  }
}
