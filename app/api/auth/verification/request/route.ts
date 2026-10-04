import { NextResponse } from "next/server";
import { z } from "zod";
import { requestVerification } from "@/lib/auth/account-lifecycle";
import { lifecycleIpLimit, lifecycleEmailLimit } from "@/lib/auth/lifecycle-http";
import { enforceTrustedMutationRequest } from "@/lib/security/request-guard";
import { validateJson } from "@/lib/validators";
import { validationError, internalError } from "@/lib/api/errors";
const schema = z.object({ email: z.string().trim().toLowerCase().email().max(320), callbackUrl: z.string().max(1000).optional() }).strict();
export async function POST(request: Request) {
  const guard = enforceTrustedMutationRequest(request); if (guard) return guard;
  const ipLimit = await lifecycleIpLimit(request); if (ipLimit) return ipLimit;
  const body = await validateJson(request, schema); if (!body.success) return validationError(body.details);
  const emailLimit = await lifecycleEmailLimit(request, body.data.email); if (emailLimit) return emailLimit;
  try { await requestVerification(body.data.email, body.data.callbackUrl); return NextResponse.json({ accepted: true }, { status: 202, headers: { "Cache-Control": "no-store" } }); }
  catch { return internalError(); }
}
