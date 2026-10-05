import { NextResponse } from "next/server";
import { z } from "zod";
import { accountSecurityMutation, currentPasswordSchema } from "@/lib/auth/account-security-http";
import { cancelEmailChange } from "@/lib/auth/email-change";
const schema = z.object({ currentPassword: currentPasswordSchema }).strict();
export function POST(request: Request) {
  return accountSecurityMutation(request, schema, async (actor, body) => {
    await cancelEmailChange(actor, body.currentPassword);
    return NextResponse.json({ cancelled: true }, { headers: { "Cache-Control": "no-store" } });
  });
}
