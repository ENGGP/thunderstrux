import { redirect } from "next/navigation";
import { getLiveSession } from "@/lib/auth/live-session";
import { CredentialsLoginForm } from "@/components/auth/credentials-login-form";
import { Card } from "@/components/ui/card";
import { safeReturnPath } from "@/lib/security/safe-return-path";

export default async function LoginPage({
  searchParams
}: {
  searchParams: Promise<{ callbackUrl?: string; accountClosed?: string }>;
}) {
  const session = await getLiveSession();
  const { callbackUrl, accountClosed } = await searchParams;
  const safeCallbackUrl = safeReturnPath(callbackUrl);

  if (session?.user) {
    redirect(safeCallbackUrl);
  }

  return (
    <main className="min-h-screen bg-neutral-50 px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto grid max-w-md gap-4">
        <header>
          <h1 className="text-3xl font-semibold text-neutral-950">Sign in</h1>
          <p className="mt-1 text-sm text-neutral-500">
            Use your email and password to access organisation dashboards.
          </p>
        </header>

        <Card>
          {accountClosed === "true" && <p role="status" className="mb-4 text-sm">Closed accounts cannot sign in. A new signup does not recover purchases or records from a closed account.</p>}
          <CredentialsLoginForm callbackUrl={safeCallbackUrl} />
        </Card>
      </div>
    </main>
  );
}
