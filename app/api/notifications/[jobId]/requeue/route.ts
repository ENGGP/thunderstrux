import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { AuthenticationRequiredError, OrganisationAccessError, requireAuthenticatedUser, requireCurrentOrganisationAccount, requireOrganisationPermission } from "@/lib/auth/access";
import { conflict, forbidden, internalError, notFound, unauthorized, validationError } from "@/lib/api/errors";
import { NotificationRequeueError, requeueBusinessNotification } from "@/lib/email/notification-outbox";
import { enforceTrustedMutationRequest } from "@/lib/security/request-guard";
import { enforceRateLimit } from "@/lib/security/rate-limit";

export async function POST(request: Request, context: { params: Promise<{ jobId: string }> }) {
  const guard = enforceTrustedMutationRequest(request);
  if (guard) return guard;
  try {
    const organisation = await requireCurrentOrganisationAccount();
    await requireOrganisationPermission(organisation.id, "orders:email_resend");
    const { jobId } = await context.params;
    const job = await prisma.notificationOutbox.findFirst({ where: { id: jobId, organisationId: organisation.id, privacy: "business" }, select: { id: true } });
    if (!job) return notFound("Notification not found");
    const limit = await enforceRateLimit({ policy: "order_resend", request, keyParts: [organisation.id, jobId] });
    if (limit) return limit;
    const body = z.object({ reason: z.string().trim().min(8).max(500) }).strict().safeParse(await request.json().catch(() => null));
    if (!body.success) return validationError([{ path: ["reason"], message: "Provide a review reason between 8 and 500 characters" }]);
    const actor = await requireAuthenticatedUser();
    await requeueBusinessNotification({ jobId, organisationId: organisation.id, actorUserId: actor.id, reason: body.data.reason });
    return NextResponse.json({ queued: true });
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) return unauthorized();
    if (error instanceof OrganisationAccessError) return forbidden(error.message);
    if (error instanceof NotificationRequeueError) return conflict(error.message);
    return internalError();
  }
}
