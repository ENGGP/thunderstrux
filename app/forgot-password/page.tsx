import { PasswordRecoveryForm } from "@/components/auth/password-recovery-form";
import { safeReturnPath } from "@/lib/security/safe-return-path";
import { Card } from "@/components/ui/card";
export default async function ForgotPasswordPage({ searchParams }: { searchParams: Promise<{ callbackUrl?: string }> }) {
  const { callbackUrl } = await searchParams;
  return <main className="mx-auto grid max-w-md gap-4 px-4 py-10"><h1 className="text-3xl font-semibold">Forgot password</h1><p>Request a reset link for your email address.</p><Card><PasswordRecoveryForm mode="request" callbackUrl={safeReturnPath(callbackUrl)} /></Card></main>;
}
