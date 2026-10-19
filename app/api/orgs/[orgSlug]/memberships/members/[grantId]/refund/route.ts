import { staffEndRoute } from "@/lib/memberships/http";
import { refundMembership } from "@/lib/memberships/revocation";

type Context = { params: Promise<{ orgSlug: string; grantId: string }> };

// Body: { reason, confirmation, mfaCode }. Refunds a paid membership's order through
// Stripe (orders:refund); the membership ends when Stripe confirms. 200 when
// confirmed, 202 while Stripe is processing or its answer is being checked.
export async function POST(request: Request, context: Context) {
  const { orgSlug, grantId } = await context.params;
  return staffEndRoute(
    request, orgSlug, "orders:refund", "refund",
    (organisationId, actor, { reason, confirmation = "" }) => refundMembership({ organisationId, grantId, actor, reason, confirmation }),
    (result) => ((result as { status: string }).status === "succeeded" ? 200 : 202)
  );
}
