import type { Metadata } from "next";
import { VerificationForm } from "@/components/auth/verification-form";
import { safeReturnPath } from "@/lib/security/safe-return-path";
import { Card } from "@/components/ui/card";
export const metadata: Metadata = { title: "Verify email | Thunderstrux", referrer: "no-referrer", robots: { index: false, follow: false } };
export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<{ callbackUrl?: string }> }) {
  const { callbackUrl } = await searchParams;
  return <main className="mx-auto grid max-w-md gap-4 px-4 py-10">
    <h1 className="text-3xl font-semibold">Verify your email</h1>
    <p>You can sign in and edit your profile while waiting. Verify your email to purchase tickets or use society features.</p>
    <Card><VerificationForm callbackUrl={safeReturnPath(callbackUrl)} /></Card>
  </main>;
}
