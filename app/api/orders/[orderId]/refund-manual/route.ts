import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, conflict, forbidden, mapRouteError, notFound, routeErrorRule, serviceUnavailable, validationError } from "@/lib/api/errors";
import { authenticationRule } from "@/lib/api/route-rules";
import { OrganisationAccessError, requireAuthenticatedUser, requireCurrentOrganisationAccount, requireOrganisationPermission } from "@/lib/auth/access";
import {
  OrganisationOrderAccessError,
  OrganisationOrderOperationError,
  markOrganisationOrderManuallyRefunded
} from "@/lib/orders/order-detail";
import { requireFreshStaffMfa } from "@/lib/security/fresh-staff-mfa";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { enforceTrustedMutationRequest } from "@/lib/security/request-guard";
import { MfaConfigurationError, MfaInputError, MfaRequiredError } from "@/lib/security/staff-mfa";
import { validateJson } from "@/lib/validators";

type RouteContext = {
  params: Promise<{
    orderId: string;
  }>;
};

// The same reason rule as a refund: it is recorded in the order history and History (UI-018).
const schema = z.object({
  reason: z.string().trim().min(8, "Give a reason of at least 8 characters").max(500),
  mfaCode: z.string().trim().max(20).optional()
}).strict();

// The mark voids the tickets and emails the buyer (payouts still hold the sale
// until its event is over, PAY-016), so unless staff MFA is off it needs a fresh
// authenticator code, as a refund does.
export async function PATCH(request: Request, context: RouteContext) {
  const trustedOriginError = enforceTrustedMutationRequest(request);

  if (trustedOriginError) {
    return trustedOriginError;
  }

  const { orderId } = await context.params;

  try {
    const organisation = await requireCurrentOrganisationAccount();
    await requireOrganisationPermission(organisation.id, "orders:refund_mark");
    const actor = await requireAuthenticatedUser();
    const body = await validateJson(request, schema);
    if (!body.success) return validationError(body.details);
    if (body.data.mfaCode) {
      const codeLimit = await enforceRateLimit({ policy: "staff_mfa_verify", request, keyParts: [actor.id] });
      if (codeLimit) return codeLimit;
    }
    await requireFreshStaffMfa(actor, body.data.mfaCode, "Enter your authenticator code to mark this order as refunded");
    const order = await markOrganisationOrderManuallyRefunded(
      organisation.id,
      orderId,
      actor.id,
      body.data.reason
    );

    return NextResponse.json({ order });
  } catch (error) {
    return mapRouteError(error, {
      operation: "orders.refund_manual",
      request,
      rules: [
        authenticationRule,
        routeErrorRule(OrganisationAccessError, (error) => forbidden(error.message)),
        routeErrorRule(MfaRequiredError, (error) => forbidden(error.message)),
        routeErrorRule(MfaInputError, (error) => badRequest(error.message, [{ path: ["mfaCode"], message: error.message }])),
        routeErrorRule(MfaConfigurationError, () => serviceUnavailable("Staff verification is unavailable")),
        routeErrorRule(OrganisationOrderAccessError, (error) => notFound(error.message)),
        routeErrorRule(OrganisationOrderOperationError, (error) => conflict(error.message))
      ]
    });
  }
}
