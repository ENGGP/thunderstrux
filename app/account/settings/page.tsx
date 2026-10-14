import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { AuthenticationRequiredError, requireAuthenticatedUser } from "@/lib/auth/access";
import { AccountSecurityError } from "@/lib/auth/account-lifecycle";
import { readAccountSettings } from "@/lib/auth/account-settings";
import { MemberProfileForm } from "@/components/account/member-profile-form";
import { ChangePasswordForm } from "@/components/account/change-password-form";
import { CloseAccountForm } from "@/components/account/close-account-form";
import { readAccountClosureEligibility } from "@/lib/auth/account-closure";
import { ChangeEmailForm } from "@/components/account/change-email-form";
import { Card } from "@/components/ui/card";
import { PersonalShell } from "@/components/layout/personal-shell";
import { formatDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Account settings" };

export default async function AccountSettingsPage() {
  let account;
  try { account = await readAccountSettings(await requireAuthenticatedUser()); }
  catch (error) {
    if (error instanceof AuthenticationRequiredError || (error instanceof AccountSecurityError && error.kind === "stale_session")) redirect("/login?callbackUrl=/account/settings");
    throw error;
  }
  const closure = await readAccountClosureEligibility(await requireAuthenticatedUser());
  const mfaRequired = account.mfa.enabled && !account.mfa.verified;
  const heading = "mb-4 text-xl font-semibold text-ink";

  return (
    <PersonalShell accountRole={account.user.accountRole}>
      <h1 className="text-3xl font-semibold text-ink">Account settings</h1>

      <Card>
        <h2 className={heading}>Account</h2>
        <dl className="grid gap-3 text-sm sm:grid-cols-[10rem_1fr]">
          <dt className="font-semibold text-ink">Email</dt>
          <dd className="text-ink-soft [overflow-wrap:anywhere]">
            <p>{account.user.email}</p>
            <p>{account.user.emailVerifiedAt ? "Email verified" : "Email verification pending"}</p>
            {!account.user.emailVerifiedAt && <Link className="text-brand underline" href="/verify-email">Verify email</Link>}
          </dd>
          {/* Derived facts: neither can be edited here. */}
          <dt className="font-semibold text-ink">Account type</dt>
          <dd className="text-ink-soft">
            {account.user.accountRole === "member" ? "Member (personal account)" : "Organisation (society account)"}
          </dd>
        </dl>
      </Card>

      {account.user.accountRole === "member" && (
        <Card>
          <h2 className={heading}>Profile</h2>
          <MemberProfileForm initialProfile={{ firstName: account.user.firstName ?? "", lastName: account.user.lastName ?? "", displayName: account.user.displayName ?? "", phone: account.user.phone ?? "", studentNumber: account.user.studentNumber ?? "" }} />
        </Card>
      )}

      <Card>
        <h2 className={heading}>Password and security</h2>
        <ChangePasswordForm mfaRequired={mfaRequired} />
        <div className="mt-6 border-t border-line pt-5 text-sm">
          <h3 className="font-semibold text-ink">Authenticator</h3>
          <p className="mt-1 text-ink-soft">
            {account.mfa.enabled ? "An authenticator app is enrolled for staff verification." : "No authenticator app is enrolled. Society staff need one to manage a society."}{" "}
            <Link className="text-brand underline" href="/mfa?callbackUrl=/account/settings">
              {account.mfa.enabled ? "Verify authenticator" : "Set up authenticator"}
            </Link>
          </p>
          <h3 className="mt-5 font-semibold text-ink">Recent account security</h3>
          {account.securityEvents.length ? (
            <ul className="mt-2 grid gap-2 text-ink-soft">
              {account.securityEvents.map((event, index) => (
                <li key={index}>
                  {event.type.replaceAll("_", " ")} - <time dateTime={event.createdAt}>{formatDateTime(event.createdAt)}</time>
                </li>
              ))}
            </ul>
          ) : <p className="mt-1 text-ink-soft">No recent security changes.</p>}
        </div>
      </Card>

      <Card>
        <h2 className={heading}>Email address</h2>
        <ChangeEmailForm mfaRequired={mfaRequired} pending={account.pendingEmailChange} />
      </Card>

      <Card className="border-danger">
        <h2 className={heading}>Permanent account closure</h2>
        <CloseAccountForm eligibility={closure} mfaRequired={mfaRequired} />
      </Card>
    </PersonalShell>
  );
}
