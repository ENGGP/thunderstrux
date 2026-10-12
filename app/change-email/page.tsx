import type { Metadata } from "next";
import { EmailChangeConfirmForm } from "@/components/auth/email-change-confirm-form";
import { AuthShell } from "@/components/layout/auth-shell";
import { Card } from "@/components/ui/card";
export const metadata: Metadata = { title: "Confirm email change", referrer: "no-referrer", robots: { index: false, follow: false } };
export default function ChangeEmailPage() {
  return <AuthShell title="Confirm email change" description="Opening this page does not change your email. Confirmation signs out all devices."><Card><EmailChangeConfirmForm /></Card></AuthShell>;
}
