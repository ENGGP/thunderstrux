import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError, badRequest, forbidden, mapRouteError, notFound, routeErrorRule, serviceUnavailable, validationError } from "@/lib/api/errors";
import { authenticationRule, staleSessionRule } from "@/lib/api/route-rules";
import { OrganisationAccessError, requireAuthenticatedUser, requireCurrentOrganisationAccount, requireOrganisationPermission } from "@/lib/auth/access";
import { FreeCancellationError, cancelFreePurchase } from "@/lib/payments/free-cancellation";
import { requireFreshStaffMfa } from "@/lib/security/fresh-staff-mfa";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { enforceTrustedMutationRequest } from "@/lib/security/request-guard";
import { MfaConfigurationError, MfaInputError, MfaRequiredError } from "@/lib/security/staff-mfa";
import { validateJson } from "@/lib/validators";

type RouteContext = { params: Promise<{ orderId: string }> };

const schema = z.object({
  reason: z.string().trim().min(8, "Give a reason of at least 8 characters").max(500),
  mfaCode: z.string().trim().max(20).optional()
}).strict();

// Cancel a free purchase (T18c): orders:refund, a reason and, unless staff MFA
// is off, a fresh authenticator code. Repeating it answers the first result.
export async function POST(request: Request, context: RouteContext) {
  const guard = enforceTrustedMutationRequest(request); if (guard) return guard;
  try {
    const organisation = await requireCurrentOrganisationAccount();
    await requireOrganisationPermission(organisation.id, "orders:refund");
    const actor = await requireAuthenticatedUser();
    const body = await validateJson(request, schema);
    if (!body.success) return validationError(body.details);
    if (body.data.mfaCode) {
      const codeLimit = await enforceRateLimit({ policy: "staff_mfa_verify", request, keyParts: [actor.id] });
      if (codeLimit) return codeLimit;
    }
    await requireFreshStaffMfa(actor, body.data.mfaCode, "Enter your authenticator code to cancel this registration");
    const { orderId } = await context.params;
    const result = await cancelFreePurchase({ organisationId: organisation.id, orderId, actor: { id: actor.id }, reason: body.data.reason });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return mapRouteError(error, {
      operation: "order.free_cancel",
      request,
      rules: [
        authenticationRule,
        staleSessionRule,
        routeErrorRule(OrganisationAccessError, (failure) => forbidden(failure.message)),
        routeErrorRule(MfaRequiredError, (failure) => forbidden(failure.message)),
        routeErrorRule(MfaInputError, (failure) => badRequest(failure.message, [{ path: ["mfaCode"], message: failure.message }])),
        routeErrorRule(MfaConfigurationError, () => serviceUnavailable("Staff verification is unavailable")),
        routeErrorRule(FreeCancellationError, (failure) =>
          failure.kind === "not_found"
            ? notFound(failure.message)
            : apiError("CONFLICT", failure.message, 409, [{ path: ["orderId"], message: failure.message, reason: failure.kind }])
        )
      ]
    });
  }
}
