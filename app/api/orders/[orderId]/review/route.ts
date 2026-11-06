import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError, forbidden, mapRouteError, notFound, routeErrorRule, validationError } from "@/lib/api/errors";
import { authenticationRule, staleSessionRule } from "@/lib/api/route-rules";
import { OrganisationAccessError, requireAuthenticatedUser, requireCurrentOrganisationAccount, requireOrganisationPermission } from "@/lib/auth/access";
import { PurchaseReviewError, markExternalRefundReviewed, restoreDisputedTickets } from "@/lib/payments/purchase-disputes";
import { enforceTrustedMutationRequest } from "@/lib/security/request-guard";
import { validateJson } from "@/lib/validators";
import { maxTicketsPerOrder } from "@/lib/validators/payments";

type RouteContext = { params: Promise<{ orderId: string }> };

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("restore_tickets"), reason: z.string().trim().min(8, "Give a reason of at least 8 characters").max(500) }).strict(),
  // The tickets the refund made in Stripe covered (DEBT-002); none keeps them all valid.
  z.object({ action: z.literal("mark_reviewed"), ticketIds: z.array(z.string().trim().min(1).max(100)).max(maxTicketsPerOrder).optional() }).strict()
]);

// Staff decisions after Stripe reports a dispute or an outside refund (T18b):
// restore the tickets of a dispute the society won, with a reason, or record
// that a partial refund made in Stripe has been reviewed. Neither moves money.
export async function POST(request: Request, context: RouteContext) {
  const guard = enforceTrustedMutationRequest(request); if (guard) return guard;
  try {
    const organisation = await requireCurrentOrganisationAccount();
    await requireOrganisationPermission(organisation.id, "orders:refund");
    const actor = await requireAuthenticatedUser();
    const body = await validateJson(request, schema);
    if (!body.success) return validationError(body.details);
    const { orderId } = await context.params;
    const input = { organisationId: organisation.id, orderId, actor: { id: actor.id } };
    if (body.data.action === "restore_tickets") await restoreDisputedTickets({ ...input, reason: body.data.reason });
    else await markExternalRefundReviewed({ ...input, ticketIds: body.data.ticketIds });
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return mapRouteError(error, {
      operation: "order.review",
      request,
      rules: [
        authenticationRule,
        staleSessionRule,
        routeErrorRule(OrganisationAccessError, (failure) => forbidden(failure.message)),
        routeErrorRule(PurchaseReviewError, (failure) =>
          failure.kind === "not_found"
            ? notFound(failure.message)
            : apiError("CONFLICT", failure.message, 409, [{ path: ["orderId"], message: failure.message, reason: failure.kind }])
        )
      ]
    });
  }
}
