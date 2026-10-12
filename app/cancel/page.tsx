import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/layout/auth-shell";
import { buttonClasses } from "@/components/ui/button";

export const metadata: Metadata = { title: "Payment cancelled" };

export default function CancelPage() {
  return (
    <AuthShell description="No payment was taken." title="Payment cancelled">
      <div>
        <Link className={buttonClasses({ variant: "secondary" })} href="/">
          Browse events
        </Link>
      </div>
    </AuthShell>
  );
}
