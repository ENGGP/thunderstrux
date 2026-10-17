import { endMembershipRoute } from "@/lib/memberships/http";
import { revokeMembership } from "@/lib/memberships/revocation";

type Context = { params: Promise<{ orgSlug: string; grantId: string }> };

// Body: { reason, mfaCode }. Ends a membership now without a refund (memberships:manage).
export async function POST(request: Request, context: Context) {
  const { orgSlug, grantId } = await context.params;
  return endMembershipRoute(request, orgSlug, "memberships:manage", "revoke", (organisationId, actor, reason) =>
    revokeMembership({ organisationId, grantId, actor, reason })
  );
}
