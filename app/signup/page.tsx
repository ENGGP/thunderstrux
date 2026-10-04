import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { SignupForm } from "@/components/auth/signup-form";
import { safeReturnPath } from "@/lib/security/safe-return-path";
import { Card } from "@/components/ui/card";

export default async function SignupPage({
  searchParams
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const session = await auth();
  const { callbackUrl } = await searchParams;
  const safeCallbackUrl = safeReturnPath(callbackUrl);

  if (session?.user) {
    redirect(safeCallbackUrl);
  }

  return (
    <main className="min-h-screen bg-neutral-50 px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto grid max-w-md gap-4">
        <header>
          <h1 className="text-3xl font-semibold text-neutral-950">
            Create account
          </h1>
          <p className="mt-1 text-sm text-neutral-500">
            Create an account with your email and password.
          </p>
        </header>

        <Card>
          <SignupForm callbackUrl={safeCallbackUrl} />
        </Card>
      </div>
    </main>
  );
}
