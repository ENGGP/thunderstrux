import type { Metadata } from "next";
import { PasswordRecoveryForm } from "@/components/auth/password-recovery-form";
import { AuthShell } from "@/components/layout/auth-shell";
import { Card } from "@/components/ui/card";
export const metadata: Metadata = { title: "Reset password", referrer: "no-referrer", robots: { index: false, follow: false } };
export default function ResetPasswordPage() {
  return <AuthShell title="Reset password" description="Resetting your password signs out all devices."><Card><PasswordRecoveryForm mode="reset" callbackUrl="/dashboard" /></Card></AuthShell>;
}
