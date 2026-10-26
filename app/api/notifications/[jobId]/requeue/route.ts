import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuthenticatedUser, requireCurrentOrganisationAccount, requireOrganisationPermission } from "@/lib/auth/access";
import { conflict, mapRouteError, notFound, routeErrorRule, validationError } from "@/lib/api/errors";
import { authenticationRule, organisationAccessRule } from "@/lib/api/route-rules";
import { NotificationRequeueError, businessNotificationExists, requeueBusinessNotification } from "@/lib/email/notification-outbox";
import { enforceTrustedMutationRequest } from "@/lib/security/request-guard";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { validateJson } from "@/lib/validators";

export async function POST(request: Request, context: { params: Promise<{ jobId: string }> }) {
  const guard = enforceTrustedMutationRequest(request);
  if (guard) return guard;
  try {
    const organisation = await requireCurrentOrganisationAccount();
    await requireOrganisationPermission(organisation.id, "orders:email_resend");
    const { jobId } = await context.params;
    if (!await businessNotificationExists(jobId, organisation.id)) return notFound("Notification not found");
    const limit = await enforceRateLimit({ policy: "order_resend", request, keyParts: [organisation.id, jobId] });
    if (limit) return limit;
    // Bounded like every JSON body (SEC-028).
    const body = await validateJson(request, z.object({ reason: z.string().trim().min(8).max(500) }).strict());
    if (!body.success) return validationError([{ path: ["reason"], message: "Provide a review reason between 8 and 500 characters" }]);
    const actor = await requireAuthenticatedUser();
    await requeueBusinessNotification({ jobId, organisationId: organisation.id, actorUserId: actor.id, reason: body.data.reason });
    return NextResponse.json({ queued: true });
  } catch (error) {
    return mapRouteError(error, { operation: "notifications.requeue", request, rules: [
      authenticationRule, organisationAccessRule,
      routeErrorRule(NotificationRequeueError, failure => conflict(failure.message))
    ] });
  }
}
