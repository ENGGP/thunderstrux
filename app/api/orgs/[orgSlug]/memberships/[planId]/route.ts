import { planMutation } from "@/lib/memberships/http";
import { updatePlan, updatePlanSchema } from "@/lib/memberships/plans";

type Context = { params: Promise<{ orgSlug: string; planId: string }> };

// Body: the plan's fields and expectedVersion. Once sold, only the description changes.
export async function PATCH(request: Request, context: Context) {
  const { orgSlug, planId } = await context.params;
  return planMutation(request, orgSlug, updatePlanSchema, "update", (actor, organisationId, input) => updatePlan(actor, organisationId, planId, input));
}
