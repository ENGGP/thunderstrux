import { NextResponse } from "next/server";
import { z } from "zod";
import {
  conflict,
  forbidden,
  mapRouteError,
  notFound,
  routeErrorRule,
  unauthorized,
  validationError
} from "@/lib/api/errors";
import {
  AuthenticationRequiredError,
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
import { enforceTrustedMutationRequest } from "@/lib/security/request-guard";
import { validateJson } from "@/lib/validators";

const confirmationSchema = z.object({
  refundId: z.string().trim().regex(/^re_[A-Za-z0-9_]+$/, "Enter a valid Stripe refund ID")
});

type RouteContext = { params: Promise<{ orderId: string }> };

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
        routeErrorRule(AuthenticationRequiredError, () => unauthorized()),
        routeErrorRule(OrganisationAccessError, (entry) => forbidden(entry.message)),
        routeErrorRule(CompensationRefundNotFoundError, (entry) => notFound(entry.message)),
        routeErrorRule(CompensationRefundVerificationError, (entry) => conflict(entry.message)),
        routeErrorRule(CompensationRefundConflictError, (entry) => conflict(entry.message))
      ]
    });
  }
}
