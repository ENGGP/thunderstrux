import { planMutation, planRead } from "@/lib/memberships/http";
import { createPlan, listPlans, planFieldsSchema } from "@/lib/memberships/plans";

type Context = { params: Promise<{ orgSlug: string }> };

// The society's membership plans, for staff with memberships:manage.
export async function GET(request: Request, context: Context) {
  return planRead(request, (await context.params).orgSlug, listPlans);
}

// Create a draft plan.
export async function POST(request: Request, context: Context) {
  return planMutation(request, (await context.params).orgSlug, planFieldsSchema, "create", createPlan, 201);
}
