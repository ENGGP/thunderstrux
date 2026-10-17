import { planMutation } from "@/lib/memberships/http";
import { planVersionSchema, publishPlan } from "@/lib/memberships/plans";

type Context = { params: Promise<{ orgSlug: string; planId: string }> };

// Body: { expectedVersion }. Publishing a published plan returns it unchanged.
export async function POST(request: Request, context: Context) {
  const { orgSlug, planId } = await context.params;
  return planMutation(request, orgSlug, planVersionSchema, "publish", (actor, organisationId, input) => publishPlan(actor, organisationId, planId, input));
}
