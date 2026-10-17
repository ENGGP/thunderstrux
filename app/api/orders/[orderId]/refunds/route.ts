import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError, badRequest, forbidden, mapRouteError, notFound, routeErrorRule, serviceUnavailable, validationError } from "@/lib/api/errors";
import { authenticationRule, staleSessionRule } from "@/lib/api/route-rules";
import { OrganisationAccessError, requireAuthenticatedUser, requireCurrentOrganisationAccount, requireOrganisationPermission } from "@/lib/auth/access";
import { OrderRefundError, requestOrderRefund } from "@/lib/payments/order-refunds";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { enforceTrustedMutationRequest } from "@/lib/security/request-guard";
import { mfaGrantDigest } from "@/lib/security/csrf";
import { MfaConfigurationError, MfaInputError, MfaRequiredError, mfaEnforcementMode, verifyStaffMfa } from "@/lib/security/staff-mfa";
import { StripeConfigurationError } from "@/lib/stripe";
import { validateJson } from "@/lib/validators";

type RouteContext = { params: Promise<{ orderId: string }> };

const schema = z.object({
  reason: z.string().trim().min(8, "Give a reason of at least 8 characters").max(500),
  confirmation: z.string().trim().min(1).max(20),
  mfaCode: z.string().trim().max(20).optional()
}).strict();

// Refund the whole order through Stripe (T18a): orders:refund, the order's
// short reference typed back, a reason and, unless staff MFA is off, a fresh
// authenticator code. 200 when Stripe confirmed; 202 while it is processing or
// its answer is still being checked.
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
    // Verified here, not in the refund service, which workers load without the auth secret.
    if (mfaEnforcementMode() !== "off") {
      if (!body.data.mfaCode) throw new MfaInputError("Enter your authenticator code to refund this order");
      const digest = mfaGrantDigest(actor.mfaSessionId);
      if (!digest) throw new MfaRequiredError();
      await verifyStaffMfa(actor.id, body.data.mfaCode, digest);
    }
    const { orderId } = await context.params;
    const result = await requestOrderRefund({ organisationId: organisation.id, orderId, actor, reason: body.data.reason, confirmation: body.data.confirmation });
    return NextResponse.json(result, { status: result.status === "succeeded" ? 200 : 202, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return mapRouteError(error, {
      operation: "order.refund.request",
      request,
      rules: [
        authenticationRule,
        staleSessionRule,
        routeErrorRule(OrganisationAccessError, (failure) => forbidden(failure.message)),
        routeErrorRule(MfaRequiredError, (failure) => forbidden(failure.message)),
        routeErrorRule(MfaInputError, (failure) => badRequest(failure.message, [{ path: ["mfaCode"], message: failure.message }])),
        routeErrorRule(MfaConfigurationError, () => serviceUnavailable("Staff verification is unavailable")),
        routeErrorRule(StripeConfigurationError, () => serviceUnavailable("Stripe is not configured.")),
        routeErrorRule(OrderRefundError, (failure) =>
          failure.kind === "not_found"
            ? notFound(failure.message)
            : failure.kind === "confirmation_mismatch"
              ? badRequest(failure.message, [{ path: ["confirmation"], message: failure.message, reason: failure.kind }])
              : apiError("CONFLICT", failure.message, 409, [{ path: ["orderId"], message: failure.message, reason: failure.kind }])
        )
      ]
    });
  }
}
