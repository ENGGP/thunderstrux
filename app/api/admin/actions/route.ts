import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, mapRouteError } from "@/lib/api/errors";
import { authenticationRule, platformAccessRules } from "@/lib/api/route-rules";
import { validateJson } from "@/lib/api/request";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { changeAccount } from "@/lib/platform/accounts";
import { platformApiActor } from "@/lib/platform/authority";
import { revokeOperatorFromWeb, runIntegrityAudit, setWorkerPaused } from "@/lib/platform/operations";
import { cancelRecovery, completeRecovery, requestRecovery } from "@/lib/platform/recovery";
import { changeSociety } from "@/lib/platform/societies";

// T55: every change an operator makes in the admin portal. Each needs its
// permission (checked again under lock), a fresh authenticator code and a reason;
// the service writes the change and its PlatformAuditLog row together.
const id = z.string().trim().min(1).max(64);
const base = { targetId: id, reason: z.string().max(600), code: z.string().max(12) };
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.enum(["resend_verification", "send_password_reset", "sign_out_everywhere", "disable_account", "enable_account"]), ...base }).strict(),
  z.object({ action: z.enum(["restrict_society", "lift_restriction", "release_payouts"]), ...base }).strict(),
  z.object({ action: z.literal("hold_payouts"), heldUntil: z.iso.datetime({ offset: true }).nullable().optional(), ...base }).strict(),
  z.object({ action: z.literal("request_mfa_reset"), evidence: z.string().max(1200), ...base }).strict(),
  z.object({ action: z.literal("request_ownership"), userId: id, evidence: z.string().max(1200), ...base }).strict(),
  z.object({ action: z.enum(["complete_recovery", "cancel_recovery", "revoke_operator", "pause_worker", "resume_worker", "run_integrity_audit"]), ...base }).strict()
]);

export async function POST(request: Request): Promise<Response> {
  let operation = "admin.action";
  try {
    // Every write needs at least account_assist; the service checks its own permission under lock.
    const gate = await platformApiActor(request, "platform:account_assist", true);
    if (gate.response) return gate.response;
    const { actor } = gate;
    const body = await validateJson(request, schema);
    if (!body.success) return badRequest("Check the action and try again");
    const input = body.data;
    operation = `admin.${input.action}`;
    let result: object = {};
    switch (input.action) {
      case "resend_verification": case "send_password_reset": case "sign_out_everywhere": case "disable_account": case "enable_account":
        result = await changeAccount(actor, input.action, input.targetId, input); break;
      case "restrict_society": case "lift_restriction": case "release_payouts":
        result = await changeSociety(actor, input.action, input.targetId, input); break;
      case "hold_payouts":
        result = await changeSociety(actor, "hold_payouts", input.targetId, { ...input, heldUntil: input.heldUntil ? new Date(input.heldUntil) : null }); break;
      case "request_mfa_reset":
        result = await requestRecovery(actor, { ...input, kind: "mfa_reset", userId: input.targetId }); break;
      case "request_ownership":
        result = await requestRecovery(actor, { ...input, kind: "ownership", organisationId: input.targetId }); break;
      case "complete_recovery": result = await completeRecovery(actor, input.targetId, input); break;
      case "cancel_recovery": result = await cancelRecovery(actor, input.targetId, input); break;
      case "revoke_operator": result = await revokeOperatorFromWeb(actor, input.targetId, input); break;
      case "pause_worker": case "resume_worker":
        result = await setWorkerPaused(actor, input.targetId, input.action === "pause_worker", input); break;
      case "run_integrity_audit": {
        const limited = await enforceRateLimit({ policy: "platform_integrity_audit", request, keyParts: [actor.user.id], required: true });
        if (limited) return limited;
        result = await runIntegrityAudit(actor, input);
        break;
      }
    }
    return NextResponse.json({ done: true, ...result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return mapRouteError(error, { operation, request, rules: [authenticationRule, ...platformAccessRules] });
  }
}
