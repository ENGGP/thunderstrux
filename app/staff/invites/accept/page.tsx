import type { Metadata } from "next";
import { StaffInviteAcceptForm } from "@/components/auth/staff-invite-accept-form";
import { AuthShell } from "@/components/layout/auth-shell";
export const metadata: Metadata = { title: "Accept staff invitation", referrer: "no-referrer", robots: { index: false, follow: false } };
export default function StaffInviteAcceptPage() {
  return <AuthShell title="Accept staff invitation" wide><StaffInviteAcceptForm /></AuthShell>;
}
