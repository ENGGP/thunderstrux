import type { Metadata } from "next";
import { PasswordRecoveryForm } from "@/components/auth/password-recovery-form";
import { AuthShell } from "@/components/layout/auth-shell";
import { safeReturnPath } from "@/lib/security/safe-return-path";
import { Card } from "@/components/ui/card";
export const metadata: Metadata = { title: "Forgot password" };
export default async function ForgotPasswordPage({ searchParams }: { searchParams: Promise<{ callbackUrl?: string }> }) {
  const { callbackUrl } = await searchParams;
  return <AuthShell title="Forgot password" description="Request a reset link for your email address."><Card><PasswordRecoveryForm mode="request" callbackUrl={safeReturnPath(callbackUrl)} /></Card></AuthShell>;
}
