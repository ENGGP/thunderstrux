import { redirect } from "next/navigation";
import { getLiveSession } from "@/lib/auth/live-session";
import { StaffMfaForm } from "@/components/auth/staff-mfa-form";
import { AuthShell } from "@/components/layout/auth-shell";
import { Card } from "@/components/ui/card";
import { getStaffMfaStatus, MfaInputError } from "@/lib/security/staff-mfa";
import { safeReturnPath } from "@/lib/security/safe-return-path";

export default async function MfaPage({ searchParams }: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const session = await getLiveSession();
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
    <AuthShell
      description="Protect organisation management with an authenticator app. Recovery codes are shown once during setup."
      title="Staff verification"
      wide
    >
      <Card>
        <StaffMfaForm enabled={status.enabled} destination={destination}
          requiresNewLogin={!session.user.staffMfaSessionId} />
      </Card>
    </AuthShell>
  );
}
