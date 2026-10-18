import type { Metadata } from "next";
import { GuestEmailForm } from "@/components/guest/guest-email-form";
import { AuthShell } from "@/components/layout/auth-shell";
import { Card } from "@/components/ui/card";

export const metadata: Metadata = { title: "Find your purchase", robots: { index: false, follow: false } };

export default function GuestRecoverPage() {
  return (
    <AuthShell description="Bought as a guest? Enter the email you used and we'll send a link for each purchase." title="Find your purchase">
      <Card>
        <GuestEmailForm endpoint="/api/guest/recover" submitLabel="Send my links" />
      </Card>
    </AuthShell>
  );
}
