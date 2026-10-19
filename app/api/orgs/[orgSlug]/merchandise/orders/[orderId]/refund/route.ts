import { staffEndRoute } from "@/lib/memberships/http";
import { refundMerchandiseOrder } from "@/lib/merchandise/after-sale";

type Context = { params: Promise<{ orgSlug: string; orderId: string }> };

// Body: { reason, confirmation, mfaCode } (T28b). Refunds a paid merchandise
// order's whole payment through Stripe (orders:refund). 200 when Stripe has
// confirmed, 202 while it is processing or its answer is being checked.
export async function POST(request: Request, context: Context) {
  const { orgSlug, orderId } = await context.params;
  return staffEndRoute(
    request, orgSlug, "orders:refund", "merchandise_refund",
    (organisationId, actor, { reason, confirmation = "" }) => refundMerchandiseOrder({ organisationId, orderId, actor, reason, confirmation }),
    (result) => ((result as { status: string }).status === "succeeded" ? 200 : 202)
  );
}
