import { NextResponse } from "next/server";
import { badRequest, conflict, forbidden, internalError, notFound, unauthorized } from "@/lib/api/errors";
import {
  AuthenticationRequiredError,
  OrganisationAccessError,
  requireAuthenticatedUser,
  requireCurrentOrganisationAccount,
  requireOrganisationPermission
} from "@/lib/auth/access";
import { prisma } from "@/lib/db";
import { EmailRequeueError, requeueFailedTicketEmail } from "@/lib/email/ticket-email-outbox";
import { OrganisationOrderAccessError, OrganisationOrderOperationError, getOrganisationOrderResendTarget } from "@/lib/orders/order-detail";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { enforceTrustedMutationRequest } from "@/lib/security/request-guard";

type RouteContext = { params: Promise<{ orderId: string; jobId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const guard = enforceTrustedMutationRequest(request);
  if (guard) return guard;
  const { orderId, jobId } = await context.params;
  try {
    const organisation = await requireCurrentOrganisationAccount();
    await requireOrganisationPermission(organisation.id, "orders:email_resend");
    await getOrganisationOrderResendTarget(organisation.id, orderId);
    const job = await prisma.emailOutbox.findFirst({
      where: { id: jobId, orderId }, select: { id: true }
    });
    if (!job) return notFound("Email job not found");
    const limit = await enforceRateLimit({
      policy: "order_resend", request, keyParts: [organisation.id, orderId]
    });
    if (limit) return limit;
    const body = await request.json().catch(() => null);
    if (!body || typeof body.reason !== "string") return badRequest("A review reason is required");
    const actor = await requireAuthenticatedUser();
    await requeueFailedTicketEmail({ jobId, actorUserId: actor.id, reason: body.reason });
    return NextResponse.json({ queued: true });
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) return unauthorized();
    if (error instanceof OrganisationAccessError) return forbidden(error.message);
    if (error instanceof OrganisationOrderAccessError) return notFound(error.message);
    if (error instanceof OrganisationOrderOperationError) return conflict(error.message);
    if (error instanceof EmailRequeueError) return conflict(error.message);
    console.error("Failed to requeue ticket email", { orderId, jobId, error });
    return internalError();
  }
}
