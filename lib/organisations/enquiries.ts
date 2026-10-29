import { randomUUID } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { enqueueNotification } from "@/lib/email/notification-outbox";
import { logInfo } from "@/lib/ops/logger";

// "Contact {society}" (DEBT-002), as Humanitix's "Contact host": anyone writes
// to a society through a form, the society answers by replying, and the
// addresses it reaches are never shown to the sender.

// With the sender and event lines it stays inside a notice's 2,000 characters.
export const enquiryMessageLimit = 1200;

export const enquirySchema = z
  .object({
    name: z.string().trim().min(1, "Enter your name").max(80),
    email: z.string().trim().toLowerCase().email("Enter an email address").max(320),
    eventId: z.string().trim().min(1).max(100).optional(),
    orderReference: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9]{0,12}$/, "An order reference is letters and numbers, like 7XK2PQ")
      .optional(),
    message: z.string().trim().min(10, "Write at least 10 characters").max(enquiryMessageLimit)
  })
  .strict();
export type EnquiryInput = z.infer<typeof enquirySchema>;

// An unknown society, or an event that isn't one of its published ones.
export class EnquiryTargetError extends Error {}

const live = { disabledAt: null, closedAt: null };

// A published event of the society that an enquiry can be about; cancelled ones too,
// as that's when buyers have questions.
export function enquiryEvent(organisationId: string, eventId: string) {
  return prisma.event.findFirst({ where: { id: eventId, organisationId, status: "published" }, select: { id: true, title: true, visibility: true } });
}

// Humanitix sends enquiries to the host's account email: here the society's
// sign-up account while it still owns the society, otherwise its owners. The
// published contact email gets a copy, in place of Humanitix's added recipients.
async function recipients(organisationId: string, accountUserId: string | null, supportEmail: string) {
  const owners = await prisma.organisationStaff.findMany({
    where: { organisationId, role: "owner", status: "active", user: live },
    orderBy: { createdAt: "asc" },
    select: { userId: true, user: { select: { email: true } } }
  });
  const signUp = owners.find((owner) => owner.userId === accountUserId);
  const addresses = [...(signUp ? [signUp] : owners).map((owner) => owner.user.email), supportEmail];
  return [...new Set(addresses.map((address) => address.trim().toLowerCase()).filter(Boolean))];
}

export async function sendSocietyEnquiry(orgSlug: string, input: EnquiryInput) {
  const organisation = await prisma.organisation.findUnique({
    where: { slug: orgSlug },
    select: { id: true, name: true, accountUserId: true, supportEmail: true }
  });
  if (!organisation) throw new EnquiryTargetError();
  const event = input.eventId ? await enquiryEvent(organisation.id, input.eventId) : null;
  if (input.eventId && !event) throw new EnquiryTargetError();

  const to = await recipients(organisation.id, organisation.accountUserId, organisation.supportEmail);
  // A society always keeps an owner; one with nobody to read it answers as missing.
  if (to.length === 0) throw new EnquiryTargetError();
  const message = [
    `${input.name} (${input.email}) wrote to ${organisation.name} through Thunderstrux.`,
    event ? `About: ${event.title}` : null,
    input.orderReference ? `Order: ${input.orderReference}` : null,
    "",
    input.message,
    "",
    "Reply to this email to answer them."
  ].filter((line) => line !== null).join("\n");
  const enquiryId = randomUUID();
  await prisma.$transaction(async (tx) => {
    for (const recipient of to) {
      await enqueueNotification(tx, {
        eventKey: `enquiry/${enquiryId}`,
        recipient,
        template: "society_enquiry",
        organisationId: organisation.id,
        payload: { message, subject: `${event?.title ?? organisation.name} enquiry from ${input.name}`.slice(0, 200), replyTo: input.email }
      });
    }
  });
  // No names, addresses or words in logs.
  logInfo("society.enquiry.queued", { organisationId: organisation.id, recipients: to.length, aboutEvent: Boolean(event) });
  return { organisationName: organisation.name };
}
