import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getLiveSession } from "@/lib/auth/live-session";
import { SignupForm } from "@/components/auth/signup-form";
import { AuthShell } from "@/components/layout/auth-shell";
import { safeReturnPath } from "@/lib/security/safe-return-path";
import { Card } from "@/components/ui/card";

export const metadata: Metadata = { title: "Create account" };

export default async function SignupPage({
  searchParams
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const session = await getLiveSession();
  const { callbackUrl } = await searchParams;
  const safeCallbackUrl = safeReturnPath(callbackUrl);

  if (session?.user) {
    redirect(safeCallbackUrl);
  }

  return (
    <AuthShell
      description="Create an account with your email and password."
      title="Create account"
    >
      <Card>
        <SignupForm callbackUrl={safeCallbackUrl} />
      </Card>
    </AuthShell>
  );
}
