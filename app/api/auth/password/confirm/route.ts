import { NextResponse } from "next/server";
import { z } from "zod";
import { AccountTokenError, consumePasswordReset } from "@/lib/auth/account-lifecycle";
import { lifecycleRedemptionLimit } from "@/lib/auth/lifecycle-http";
import { enforceTrustedMutationRequest } from "@/lib/security/request-guard";
import { validateJson } from "@/lib/validators";
import { newPasswordSchema } from "@/lib/validators/auth";
import { badRequest, validationError, internalError } from "@/lib/api/errors";
export async function POST(request: Request) {
  const guard = enforceTrustedMutationRequest(request); if (guard) return guard;
  const body = await validateJson(request, z.object({ token: z.string().min(1).max(100), newPassword: newPasswordSchema }).strict());
  if (!body.success) return validationError(body.details);
  const limit = await lifecycleRedemptionLimit(request, body.data.token); if (limit) return limit;
  try { return NextResponse.json(await consumePasswordReset(body.data.token, body.data.newPassword), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return error instanceof AccountTokenError ? badRequest(error.message) : internalError(); }
}
