import { staffEndRoute } from "@/lib/memberships/http";
import { cancelFreeMembership } from "@/lib/memberships/revocation";

type Context = { params: Promise<{ orgSlug: string; grantId: string }> };

// Body: { reason, mfaCode }. Cancels a free membership's order and ends it (orders:refund).
export async function POST(request: Request, context: Context) {
  const { orgSlug, grantId } = await context.params;
  return staffEndRoute(request, orgSlug, "orders:refund", "memberships.free_cancel", (organisationId, actor, { reason }) =>
    cancelFreeMembership({ organisationId, grantId, actor, reason })
  );
}
