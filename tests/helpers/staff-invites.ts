import { prisma } from "@/lib/db";
import { decryptNotification } from "@/lib/email/notification-crypto";
// Synthetic test evidence only: production callers never receive raw tokens.
export async function readStaffInviteToken(inviteId: string, version?: number) {
  const job = await prisma.notificationOutbox.findFirstOrThrow({ where: { staffInviteId: inviteId, ...(version ? { staffInviteVersion: version } : {}) }, orderBy: { staffInviteVersion: "desc" } });
  const rendered = decryptNotification(job.encryptedPayload, job.id) as { text: string };
  const link = new URL(rendered.text.split("\n\n").at(-1)!);
  return new URLSearchParams(link.hash.slice(1)).get("token")!;
}
