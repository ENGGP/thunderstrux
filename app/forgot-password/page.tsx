import type { Metadata } from "next";
import Link from "next/link";
import { PasswordRecoveryForm } from "@/components/auth/password-recovery-form";
import { AuthShell } from "@/components/layout/auth-shell";
import { safeReturnPath } from "@/lib/security/safe-return-path";
import { Card } from "@/components/ui/card";
export const metadata: Metadata = { title: "Forgot password" };
export default async function ForgotPasswordPage({ searchParams }: { searchParams: Promise<{ callbackUrl?: string }> }) {
  const { callbackUrl } = await searchParams;
  const back = safeReturnPath(callbackUrl);
  return (
    <AuthShell title="Forgot password" description="Request a reset link for your email address.">
      <Card><PasswordRecoveryForm mode="request" callbackUrl={back} /></Card>
      {/* Remembered it after all: the way back keeps where they were going. */}
      <Link className="inline-flex min-h-11 w-fit items-center text-sm font-semibold text-brand underline underline-offset-4" href={`/login?callbackUrl=${encodeURIComponent(back)}`}>Back to sign in</Link>
    </AuthShell>
  );
}
