import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuthenticatedUser, requireCurrentOrganisationAccount, requireOrganisationPermission } from "@/lib/auth/access";
import { mapRouteError, validationError } from "@/lib/api/errors";
import { authenticationRule, organisationAccessRule } from "@/lib/api/route-rules";
import { NotificationRequeueError, businessNotificationExists, requeueBusinessNotification } from "@/lib/email/notification-outbox";
import { enforceTrustedMutationRequest } from "@/lib/security/request-guard";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { validateJson } from "@/lib/validators";

const schema = z.object({
  jobIds: z.array(z.string().trim().min(1).max(64)).min(1).max(25),
  reason: z.string().trim().min(8).max(500)
}).strict();

// Send several failed society emails again with one reason (UI-018). Each goes
// through the same check as one at a time and gets its own audit row; one that
// can't be sent is reported back and the rest still go.
export async function POST(request: Request) {
  const guard = enforceTrustedMutationRequest(request);
  if (guard) return guard;
  try {
    const organisation = await requireCurrentOrganisationAccount();
    await requireOrganisationPermission(organisation.id, "orders:email_resend");
    const limit = await enforceRateLimit({ policy: "order_resend", request, keyParts: [organisation.id, "batch"] });
    if (limit) return limit;
    // Bounded like every JSON body (SEC-028).
    const body = await validateJson(request, schema);
    if (!body.success) return validationError(body.details);
    const actor = await requireAuthenticatedUser();
    const queued: string[] = [];
    const skipped: Array<{ id: string; message: string }> = [];
    for (const jobId of new Set(body.data.jobIds)) {
      if (!(await businessNotificationExists(jobId, organisation.id))) {
        skipped.push({ id: jobId, message: "Notification not found" });
        continue;
      }
      try {
        await requeueBusinessNotification({ jobId, organisationId: organisation.id, actorUserId: actor.id, reason: body.data.reason });
        queued.push(jobId);
      } catch (error) {
        if (!(error instanceof NotificationRequeueError)) throw error;
        skipped.push({ id: jobId, message: error.message });
      }
    }
    return NextResponse.json({ queued, skipped });
  } catch (error) {
    return mapRouteError(error, { operation: "notifications.requeue_batch", request, rules: [authenticationRule, organisationAccessRule] });
  }
}
