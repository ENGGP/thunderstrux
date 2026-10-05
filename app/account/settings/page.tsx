import { redirect } from "next/navigation";
import Link from "next/link";
import { AuthenticationRequiredError, requireAuthenticatedUser } from "@/lib/auth/access";
import { AccountSecurityError } from "@/lib/auth/account-lifecycle";
import { readAccountSettings } from "@/lib/auth/account-settings";
import { MemberProfileForm } from "@/components/members/member-profile-form";
import { ChangePasswordForm } from "@/components/settings/change-password-form";
import { ChangeEmailForm } from "@/components/settings/change-email-form";
import { Card } from "@/components/ui/card";
export default async function AccountSettingsPage() {
  let account;
  try { account = await readAccountSettings(await requireAuthenticatedUser()); }
  catch (error) {
    if (error instanceof AuthenticationRequiredError || (error instanceof AccountSecurityError && error.kind === "stale_session")) redirect("/login?callbackUrl=/account/settings");
    throw error;
  }
  return <main className="mx-auto grid max-w-3xl gap-6 px-4 py-8">
    <h1 className="text-3xl font-semibold">Account settings</h1>
    <Card><h2 className="mb-3 text-xl font-semibold">Account</h2><p>{account.user.email}</p><p>{account.user.emailVerifiedAt ? "Email verified" : "Email verification pending"}</p>{!account.user.emailVerifiedAt && <Link className="underline" href="/verify-email">Send verification email</Link>}</Card>
    {account.user.accountRole === "member" && <Card><h2 className="mb-4 text-xl font-semibold">Profile</h2><MemberProfileForm initialProfile={{ firstName: account.user.firstName ?? "", lastName: account.user.lastName ?? "", displayName: account.user.displayName ?? "", phone: account.user.phone ?? "", studentNumber: account.user.studentNumber ?? "" }} /></Card>}
    <Card><h2 className="mb-4 text-xl font-semibold">Password</h2><ChangePasswordForm mfaRequired={account.mfa.enabled && !account.mfa.verified} /></Card>
    <Card><h2 className="mb-4 text-xl font-semibold">Email address</h2><ChangeEmailForm mfaRequired={account.mfa.enabled && !account.mfa.verified} pending={account.pendingEmailChange} /></Card>
    <Card><h2 className="mb-3 text-xl font-semibold">Recent account security</h2>{account.securityEvents.length ? <ul className="grid gap-2">{account.securityEvents.map((event, index) => <li key={index}>{event.type.replaceAll("_", " ")} - <time dateTime={event.createdAt}>{event.createdAt}</time></li>)}</ul> : <p>No recent security changes.</p>}</Card>
  </main>;
}
