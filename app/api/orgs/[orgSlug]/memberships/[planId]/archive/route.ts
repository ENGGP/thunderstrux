import { planMutation } from "@/lib/memberships/http";
import { archivePlan, planVersionSchema } from "@/lib/memberships/plans";

type Context = { params: Promise<{ orgSlug: string; planId: string }> };

// Body: { expectedVersion }. One way: the plan stops selling; holders keep their terms.
export async function POST(request: Request, context: Context) {
  const { orgSlug, planId } = await context.params;
  return planMutation(request, orgSlug, planVersionSchema, "archive", (actor, organisationId, input) => archivePlan(actor, organisationId, planId, input));
}
