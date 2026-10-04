import { NextResponse } from "next/server";
import { internalError, validationError } from "@/lib/api/errors";
import { signupAccount } from "@/lib/auth/account-lifecycle";
import { lifecycleIpLimit, lifecycleEmailLimit } from "@/lib/auth/lifecycle-http";
import { enforceTrustedMutationRequest } from "@/lib/security/request-guard";
import { validateJson } from "@/lib/validators";
import { signupSchema } from "@/lib/validators/auth";
export async function POST(request: Request) {
  const guard = enforceTrustedMutationRequest(request); if (guard) return guard;
  const ipLimit = await lifecycleIpLimit(request); if (ipLimit) return ipLimit;
  const body = await validateJson(request, signupSchema); if (!body.success) return validationError(body.details);
  const emailLimit = await lifecycleEmailLimit(request, body.data.email); if (emailLimit) return emailLimit;
  try {
    await signupAccount(body.data);
    return NextResponse.json({ accepted: true }, { status: 202, headers: { "Cache-Control": "no-store" } });
  } catch { return internalError(); }
}
