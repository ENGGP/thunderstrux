import { NextResponse } from "next/server";
import { z } from "zod";
import { accountSecurityMutation, currentPasswordSchema } from "@/lib/auth/account-security-http";
import { accountEmailSchema, requestEmailChange } from "@/lib/auth/email-change";
const schema = z.object({ currentPassword: currentPasswordSchema, newEmail: accountEmailSchema }).strict();
export function POST(request: Request) {
  return accountSecurityMutation(request, schema, async (actor, body) => {
    await requestEmailChange(actor, body.currentPassword, body.newEmail);
    return NextResponse.json({ accepted: true }, { status: 202, headers: { "Cache-Control": "no-store" } });
  });
}
