import type { Metadata } from "next";
import { GuestAccessForm } from "@/components/guest/guest-access-form";
import { AuthShell } from "@/components/layout/auth-shell";
import { Card } from "@/components/ui/card";

export const metadata: Metadata = { title: "Confirm your email", referrer: "no-referrer", robots: { index: false, follow: false } };

// Opening the link only shows this page; the token is sent by Continue.
export default function GuestAccessPage() {
  return (
    <AuthShell title="Carry on with your order">
      <Card>
        <GuestAccessForm />
      </Card>
    </AuthShell>
  );
}
