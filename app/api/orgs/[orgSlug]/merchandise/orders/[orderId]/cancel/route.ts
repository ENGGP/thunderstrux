import { staffEndRoute } from "@/lib/memberships/http";
import { cancelFreeMerchandiseOrder } from "@/lib/merchandise/after-sale";

type Context = { params: Promise<{ orgSlug: string; orderId: string }> };

// Body: { reason, mfaCode } (T28b). Cancels a free merchandise order not yet
// collected (orders:refund); never a refund. A repeat answers the first result.
export async function POST(request: Request, context: Context) {
  const { orgSlug, orderId } = await context.params;
  return staffEndRoute(request, orgSlug, "orders:refund", "merchandise.free_cancel", (organisationId, actor, { reason }) =>
    cancelFreeMerchandiseOrder({ organisationId, orderId, actor, reason })
  );
}
