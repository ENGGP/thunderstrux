import type { Metadata } from "next";
import { VerificationForm } from "@/components/auth/verification-form";
import { AuthShell } from "@/components/layout/auth-shell";
import { getLiveSession } from "@/lib/auth/live-session";
import { safeReturnPath } from "@/lib/security/safe-return-path";
import { Card } from "@/components/ui/card";
export const metadata: Metadata = { title: "Verify email", referrer: "no-referrer", robots: { index: false, follow: false } };
export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<{ callbackUrl?: string }> }) {
  const { callbackUrl } = await searchParams;
  const session = await getLiveSession();
  return <AuthShell title="Verify your email" description="You can sign in and edit your profile while waiting. Verify your email to purchase tickets or use society features.">
    <Card><VerificationForm callbackUrl={safeReturnPath(callbackUrl)} defaultEmail={session?.user?.email ?? ""} /></Card>
  </AuthShell>;
}
