import type { Metadata } from "next";
import { PasswordRecoveryForm } from "@/components/auth/password-recovery-form";
import { Card } from "@/components/ui/card";
export const metadata: Metadata = { title: "Reset password | Thunderstrux", referrer: "no-referrer", robots: { index: false, follow: false } };
export default function ResetPasswordPage() {
  return <main className="mx-auto grid max-w-md gap-4 px-4 py-10"><h1 className="text-3xl font-semibold">Reset password</h1><p>Resetting your password signs out all devices.</p><Card><PasswordRecoveryForm mode="reset" callbackUrl="/dashboard" /></Card></main>;
}
