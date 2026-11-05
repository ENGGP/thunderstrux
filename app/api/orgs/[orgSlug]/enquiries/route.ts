import { NextResponse } from "next/server";
import { mapRouteError, notFound, routeErrorRule, validationError } from "@/lib/api/errors";
import { EnquiryTargetError, enquirySchema, sendSocietyEnquiry } from "@/lib/organisations/enquiries";
import { enforceRateLimit, getRateLimitClientIp } from "@/lib/security/rate-limit";
import { enforceTrustedMutationRequest } from "@/lib/security/request-guard";
import { validateJson } from "@/lib/validators";

type RouteContext = { params: Promise<{ orgSlug: string }> };

// "Contact {society}" (DEBT-002): no session, as anyone may ask before buying.
// Limits fail closed, so nothing is sent while request protection is down.
export async function POST(request: Request, context: RouteContext) {
  const guard = enforceTrustedMutationRequest(request); if (guard) return guard;
  const { orgSlug } = await context.params;
  const ip = getRateLimitClientIp(request);
  const ipLimit = await enforceRateLimit({ policy: "society_enquiry_ip", request, keyParts: [ip], required: true }) ??
    await enforceRateLimit({ policy: "society_enquiry", request, keyParts: [ip, orgSlug], required: true });
  if (ipLimit) return ipLimit;
  const body = await validateJson(request, enquirySchema); if (!body.success) return validationError(body.details);
  // SEC-064: the sender's address is unverified, so its budget is per society: sending in
  // someone's name can use up their enquiries to one society, never to every society.
  const senderLimit = await enforceRateLimit({ policy: "society_enquiry", request, keyParts: [orgSlug, body.data.email], required: true });
  if (senderLimit) return senderLimit;
  try {
    const sent = await sendSocietyEnquiry(orgSlug, body.data);
    return NextResponse.json({ sent: true, organisation: sent.organisationName }, { status: 202, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return mapRouteError(error, {
      operation: "society.enquiry",
      request,
      rules: [routeErrorRule(EnquiryTargetError, () => notFound("We couldn't find that society or event."))]
    });
  }
}
