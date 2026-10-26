import { NextResponse } from "next/server";
import { z } from "zod";
import { conflict, forbidden, mapRouteError, notFound, routeErrorRule, validationError } from "@/lib/api/errors";
import { authenticationRule } from "@/lib/api/route-rules";
import { OrganisationAccessError, requireAuthenticatedUser, requireCurrentOrganisationAccount, requireOrganisationPermission } from "@/lib/auth/access";
import { EmailRequeueError, requeueFailedTicketEmail, ticketEmailJobExists } from "@/lib/email/ticket-email-outbox";
import { OrganisationOrderAccessError, OrganisationOrderOperationError, getOrganisationOrderResendTarget } from "@/lib/orders/order-detail";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { enforceTrustedMutationRequest } from "@/lib/security/request-guard";
import { validateJson } from "@/lib/validators";

type RouteContext = { params: Promise<{ orderId: string; jobId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const guard = enforceTrustedMutationRequest(request);
  if (guard) return guard;
  const { orderId, jobId } = await context.params;
  try {
    const organisation = await requireCurrentOrganisationAccount();
    await requireOrganisationPermission(organisation.id, "orders:email_resend");
    await getOrganisationOrderResendTarget(organisation.id, orderId);
    if (!(await ticketEmailJobExists(jobId, orderId))) return notFound("Email job not found");
    const limit = await enforceRateLimit({
      policy: "order_resend", request, keyParts: [organisation.id, orderId]
    });
    if (limit) return limit;
    // Bounded like every JSON body, and a missing or short reason is a 400 (SEC-028).
    const body = await validateJson(request, z.object({ reason: z.string().trim().min(8).max(500) }).strict());
    if (!body.success) return validationError([{ path: ["reason"], message: "Provide a review reason between 8 and 500 characters" }]);
    const actor = await requireAuthenticatedUser();
    await requeueFailedTicketEmail({ jobId, actorUserId: actor.id, reason: body.data.reason });
    return NextResponse.json({ queued: true });
  } catch (error) {
    return mapRouteError(error, {
      operation: "orders.email_requeue",
      request,
      rules: [
        authenticationRule,
        routeErrorRule(OrganisationAccessError, (error) => forbidden(error.message)),
        routeErrorRule(OrganisationOrderAccessError, (error) => notFound(error.message)),
        routeErrorRule(OrganisationOrderOperationError, (error) => conflict(error.message)),
        routeErrorRule(EmailRequeueError, (error) => conflict(error.message))
      ]
    });
  }
}
