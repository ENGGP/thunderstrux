import { NextResponse } from "next/server";
import { z } from "zod";
import {
  badRequest,
  conflict,
  forbidden,
  mapRouteError,
  notFound,
  routeErrorRule,
  serviceUnavailable,
  validationError
} from "@/lib/api/errors";
import { authenticationRule, staleSessionRule } from "@/lib/api/route-rules";
import {
  OrganisationAccessError,
  requireAuthenticatedUser,
  requireCurrentOrganisationAccount,
  requireOrganisationPermission
} from "@/lib/auth/access";
import {
  CompensationRefundConflictError,
  CompensationRefundNotFoundError,
  CompensationRefundVerificationError,
  confirmCompensationRefund
} from "@/lib/payments/compensation-refunds";
import { requireFreshStaffMfa } from "@/lib/security/fresh-staff-mfa";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { enforceTrustedMutationRequest } from "@/lib/security/request-guard";
import { MfaConfigurationError, MfaInputError, MfaRequiredError } from "@/lib/security/staff-mfa";
import { StripeConfigurationError } from "@/lib/stripe";
import { validateJson } from "@/lib/validators";

const confirmationSchema = z.object({
  refundId: z.string().trim().regex(/^re_[A-Za-z0-9_]+$/, "Enter a valid Stripe refund ID"),
  mfaCode: z.string().trim().max(20).optional()
}).strict();

type RouteContext = { params: Promise<{ orderId: string }> };

// Confirming a refund made in Stripe settles a paid order's review, so it needs
// orders:refund and, unless staff MFA is off, a fresh authenticator code, as a
// refund does (SEC-036).
export async function POST(request: Request, context: RouteContext) {
  const trustedOriginError = enforceTrustedMutationRequest(request);
  if (trustedOriginError) return trustedOriginError;

  const validation = await validateJson(request, confirmationSchema);
  if (!validation.success) return validationError(validation.details);
  const { orderId } = await context.params;

  try {
    const organisation = await requireCurrentOrganisationAccount();
    await requireOrganisationPermission(organisation.id, "orders:refund");
    const actor = await requireAuthenticatedUser();
    if (validation.data.mfaCode) {
      const codeLimit = await enforceRateLimit({ policy: "staff_mfa_verify", request, keyParts: [actor.id] });
      if (codeLimit) return codeLimit;
    }
    await requireFreshStaffMfa(actor, validation.data.mfaCode, "Enter your authenticator code to confirm this refund");
    await confirmCompensationRefund(
      organisation.id,
      orderId,
      validation.data.refundId,
      actor.id
    );
    return NextResponse.json({ confirmed: true });
  } catch (error) {
    return mapRouteError(error, {
      operation: "orders.compensation_refund.confirm",
      request,
      rules: [
        authenticationRule,
        staleSessionRule,
        routeErrorRule(OrganisationAccessError, (entry) => forbidden(entry.message)),
        routeErrorRule(MfaRequiredError, (entry) => forbidden(entry.message)),
        routeErrorRule(MfaInputError, (entry) => badRequest(entry.message, [{ path: ["mfaCode"], message: entry.message }])),
        routeErrorRule(MfaConfigurationError, () => serviceUnavailable("Staff verification is unavailable")),
        routeErrorRule(StripeConfigurationError, () => serviceUnavailable("Stripe is not configured.")),
        routeErrorRule(CompensationRefundNotFoundError, (entry) => notFound(entry.message)),
        routeErrorRule(CompensationRefundVerificationError, (entry) => conflict(entry.message)),
        routeErrorRule(CompensationRefundConflictError, (entry) => conflict(entry.message))
      ]
    });
  }
}
