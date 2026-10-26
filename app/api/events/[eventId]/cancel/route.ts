import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, forbidden, mapRouteError, routeErrorRule, serviceUnavailable, validationError } from "@/lib/api/errors";
import { requireAuthenticatedUser, requireCurrentOrganisationAccount, requireOrganisationEventManagementAccess, requireOrganisationPermission } from "@/lib/auth/access";
import { cancelOrganisationEvent } from "@/lib/events/event-cancellation";
import { eventRouteRules } from "@/lib/events/http";
import { requireFreshStaffMfa } from "@/lib/security/fresh-staff-mfa";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { enforceTrustedMutationRequest } from "@/lib/security/request-guard";
import { MfaConfigurationError, MfaInputError, MfaRequiredError } from "@/lib/security/staff-mfa";
import { validateJson } from "@/lib/validators";

type RouteContext = { params: Promise<{ eventId: string }> };

const schema = z.object({
  confirmation: z.string().trim().min(1, "Type the event title to confirm").max(200),
  reason: z.string().trim().min(8, "Tell ticket holders why, in at least 8 characters").max(500),
  mfaCode: z.string().trim().max(20).optional()
}).strict();

// Cancel a published event (EVT-004): events:manage and orders:refund, the
// event title typed back, a reason ticket holders are emailed and, unless staff
// MFA is off, one fresh authenticator code for every refund it queues.
// 200 { status, refundsQueued, freeCancelled, notified, skipped }; a repeat
// answers "already_cancelled".
export async function POST(request: Request, context: RouteContext) {
  const guard = enforceTrustedMutationRequest(request); if (guard) return guard;
  try {
    const organisation = await requireCurrentOrganisationAccount();
    await requireOrganisationEventManagementAccess(organisation.id);
    await requireOrganisationPermission(organisation.id, "orders:refund");
    const actor = await requireAuthenticatedUser();
    const body = await validateJson(request, schema);
    if (!body.success) return validationError(body.details);
    if (body.data.mfaCode) {
      const codeLimit = await enforceRateLimit({ policy: "staff_mfa_verify", request, keyParts: [actor.id] });
      if (codeLimit) return codeLimit;
    }
    await requireFreshStaffMfa(actor, body.data.mfaCode, "Enter your authenticator code to cancel this event");
    const { eventId } = await context.params;
    const result = await cancelOrganisationEvent(organisation.id, eventId, body.data, actor);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return mapRouteError(error, {
      operation: "events.cancel",
      request,
      rules: [
        ...eventRouteRules(["x-org-id"]),
        routeErrorRule(MfaRequiredError, (failure) => forbidden(failure.message)),
        routeErrorRule(MfaInputError, (failure) => badRequest(failure.message, [{ path: ["mfaCode"], message: failure.message }])),
        routeErrorRule(MfaConfigurationError, () => serviceUnavailable("Staff verification is unavailable"))
      ]
    });
  }
}
