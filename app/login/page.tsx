import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getLiveSession } from "@/lib/auth/live-session";
import { CredentialsLoginForm } from "@/components/auth/credentials-login-form";
import { AuthShell } from "@/components/layout/auth-shell";
import { Card } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { safeReturnPath } from "@/lib/security/safe-return-path";

export const metadata: Metadata = { title: "Sign in" };

// Why the visitor was sent here, so a forced sign-out is never silent.
const reasons = {
  passwordChanged: "Your password was changed. Sign in again with the new password.",
  emailChanged: "Your email address was changed. Sign in again with the new address.",
  accountClosed:
    "Closed accounts cannot sign in. A new signup does not recover purchases or records from a closed account."
};

export default async function LoginPage({
  searchParams
}: {
  searchParams: Promise<{
    callbackUrl?: string;
    accountClosed?: string;
    passwordChanged?: string;
    emailChanged?: string;
  }>;
}) {
  const session = await getLiveSession();
  const params = await searchParams;
  const safeCallbackUrl = safeReturnPath(params.callbackUrl);

  if (session?.user) {
    redirect(safeCallbackUrl);
  }

  const reason = (Object.keys(reasons) as Array<keyof typeof reasons>).find(
    (key) => params[key] === "true"
  );

  return (
    <AuthShell
      description="Use your email and password to reach your tickets, societies and dashboards."
      title="Sign in"
    >
      <Card>
        {reason ? (
          <Notice className="mb-4" role="status">
            {reasons[reason]}
          </Notice>
        ) : null}
        <CredentialsLoginForm callbackUrl={safeCallbackUrl} />
      </Card>
    </AuthShell>
  );
}
