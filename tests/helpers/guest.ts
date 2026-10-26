import { prisma } from "@/lib/db";
import { decryptNotification } from "@/lib/email/notification-crypto";
import { readGuestSession, redeemGuestAccess, requestGuestAccess } from "@/lib/guest/guest-access";
import { unique } from "@/tests/helpers/test-data";

// The raw token of the newest link emailed to an address, read from the encrypted outbox.
export async function newestGuestLink(email: string) {
  const job = await prisma.notificationOutbox.findFirstOrThrow({ where: { recipient: email, status: "pending" }, orderBy: { createdAt: "desc" } });
  const { text } = decryptNotification(job.encryptedPayload, job.id) as { text: string };
  return new URLSearchParams(new URL(text.split("\n\n").at(-1)!).hash.slice(1)).get("token")!;
}

// A real emailed link redeemed into a guest checkout session.
export async function guestSession(email = `${unique("guest")}@example.com`) {
  await requestGuestAccess(email);
  const { sessionId } = await redeemGuestAccess(await newestGuestLink(email));
  const session = (await readGuestSession(sessionId))!;
  return { email, sessionId, session, guest: { grantId: session.grantId, guestIdentityId: session.guestIdentityId } };
}
