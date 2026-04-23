import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { CredentialsLoginForm } from "@/components/auth/credentials-login-form";
import { Card } from "@/components/ui/card";

function getSafeCallbackUrl(callbackUrl: string | undefined): string {
  return callbackUrl && callbackUrl.startsWith("/") && !callbackUrl.startsWith("//")
    ? callbackUrl
    : "/dashboard";
}

export default async function LoginPage({
  searchParams
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const session = await auth();
  const { callbackUrl } = await searchParams;
  const safeCallbackUrl = getSafeCallbackUrl(callbackUrl);

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
          <CredentialsLoginForm callbackUrl={safeCallbackUrl} />
        </Card>
      </div>
    </main>
  );
}
