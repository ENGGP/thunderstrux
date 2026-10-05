import { NextResponse } from "next/server";
import { z } from "zod";
import { accountSecurityMutation, currentPasswordSchema } from "@/lib/auth/account-security-http";
import { confirmEmailChange } from "@/lib/auth/email-change";
const schema = z.object({ currentPassword: currentPasswordSchema, token: z.string().min(1).max(100) }).strict();
export function POST(request: Request) {
  return accountSecurityMutation(request, schema, async (actor, body) => {
    await confirmEmailChange(actor, body.currentPassword, body.token);
    return NextResponse.json({ changed: true, signInRequired: true }, { headers: { "Cache-Control": "no-store" } });
  }, body => body.token);
}
