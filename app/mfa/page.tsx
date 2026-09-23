import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { StaffMfaForm } from "@/components/auth/staff-mfa-form";
import { getStaffMfaStatus, MfaInputError } from "@/lib/security/staff-mfa";
import { safeReturnPath } from "@/lib/security/safe-return-path";

export default async function MfaPage({ searchParams }: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login?callbackUrl=/mfa");
  let status;
  try {
    status = await getStaffMfaStatus(session.user.id);
  } catch (error) {
    if (error instanceof MfaInputError) redirect("/dashboard");
    throw error;
  }
  const { callbackUrl } = await searchParams;
  const destination = safeReturnPath(callbackUrl);
  return (
    <main className="min-h-screen bg-neutral-50 px-4 py-10">
      <div className="mx-auto max-w-lg rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-semibold text-neutral-950">Staff verification</h1>
        <p className="mt-2 text-sm text-neutral-600">
          Protect organisation management with an authenticator app. Recovery codes are shown once during setup.
        </p>
        <StaffMfaForm enabled={status.enabled} destination={destination}
          requiresNewLogin={!session.user.staffMfaSessionId} />
      </div>
    </main>
  );
}
