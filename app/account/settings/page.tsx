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
import { Icon } from "@/components/ui/icon";
import { StatusBadge } from "@/components/ui/status-badge";
import { PersonalShell } from "@/components/layout/personal-shell";
import { formatDateTime } from "@/lib/format";
import { getStaffMfaStatus, MfaInputError } from "@/lib/security/staff-mfa";

export const metadata: Metadata = { title: "Account settings" };

// The same check /mfa uses: only staff, legacy owners or people already
// enrolled can set up or verify an authenticator.
async function canUseAuthenticator(userId: string) {
  try {
    await getStaffMfaStatus(userId);
    return true;
  } catch (error) {
    if (error instanceof MfaInputError) return false;
    throw error;
  }
}

function eventLabel(type: string) {
  const words = type.replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export default async function AccountSettingsPage() {
  let account;
  try { account = await readAccountSettings(await requireAuthenticatedUser()); }
  catch (error) {
    if (error instanceof AuthenticationRequiredError || (error instanceof AccountSecurityError && error.kind === "stale_session")) redirect("/login?callbackUrl=/account/settings");
    throw error;
  }
  const user = await requireAuthenticatedUser();
  const [closure, authenticator] = await Promise.all([
    readAccountClosureEligibility(user),
    canUseAuthenticator(user.id)
  ]);
  const mfaRequired = account.mfa.enabled && !account.mfa.verified;
  const isMember = account.user.accountRole === "member";
  const sections = [
    ...(isMember ? [{ id: "profile", label: "Profile" }] : []),
    { id: "security", label: "Password and security" },
    { id: "email", label: "Email address" },
    { id: "close", label: "Close account" }
  ];
  const heading = "text-xl font-semibold text-ink";
  const subheading = "text-base font-semibold text-ink";

  return (
    <PersonalShell accountRole={account.user.accountRole}>
      <div className="grid gap-3">
        <h1 className="text-3xl font-semibold text-ink">Account settings</h1>
        <nav aria-label="On this page" className="flex flex-wrap gap-2">
          {sections.map((section) => (
            <a
              className="inline-flex min-h-11 items-center rounded-control border border-line bg-surface px-3 text-sm font-medium text-ink hover:bg-brand-tint"
              href={`#${section.id}`}
              key={section.id}
            >
              {section.label}
            </a>
          ))}
        </nav>
      </div>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="grid min-w-0 gap-0.5">
            <p className="text-sm font-semibold text-ink-soft">Signed in as</p>
            <p className="text-[17px] font-semibold text-ink [overflow-wrap:anywhere]">{account.user.email}</p>
            <p className="text-sm text-ink-soft">
              {isMember ? "Member (personal account)" : "Organisation (society account)"}
            </p>
          </div>
          {account.user.emailVerifiedAt ? (
            <StatusBadge label="Email verified" status="active" />
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <StatusBadge label="Email not verified" status="pending" />
              <Link className="text-sm font-semibold text-brand underline underline-offset-4" href="/verify-email">
                Verify email
              </Link>
            </div>
          )}
        </div>
      </Card>

      {isMember && (
        <Card className="scroll-mt-24">
          <div className="grid gap-4" id="profile">
            <div className="grid gap-0.5">
              <h2 className={heading}>Profile</h2>
              <p className="text-sm text-ink-soft">Used on your tickets and shared with societies you buy from.</p>
            </div>
            <MemberProfileForm initialProfile={{ firstName: account.user.firstName ?? "", lastName: account.user.lastName ?? "", displayName: account.user.displayName ?? "", phone: account.user.phone ?? "", studentNumber: account.user.studentNumber ?? "" }} />
          </div>
        </Card>
      )}

      <Card>
        <div className="grid scroll-mt-24 gap-5" id="security">
          <h2 className={heading}>Password and security</h2>
          <div className="grid gap-3">
            <div className="grid gap-0.5">
              <h3 className={subheading}>Change password</h3>
              <p className="text-sm text-ink-soft">Changing it signs you out everywhere.</p>
            </div>
            <ChangePasswordForm mfaRequired={mfaRequired} />
          </div>
          {authenticator ? (
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line pt-5">
              <Icon className="text-brand" name="shield" size={24} />
              <div className="grid min-w-0 flex-1 gap-0.5">
                <h3 className={subheading}>Authenticator app</h3>
                <p className="text-sm text-ink-soft">
                  {account.mfa.enabled
                    ? account.mfa.verified
                      ? "Enrolled and verified for this sign-in. Society staff use it to manage a society."
                      : "Enrolled. Verify it for this sign-in before changing security settings."
                    : "Not set up. Society staff need one to manage a society."}
                </p>
              </div>
              <Link className="inline-flex min-h-11 items-center text-sm font-semibold text-brand underline underline-offset-4" href="/mfa?callbackUrl=/account/settings">
                {account.mfa.enabled ? "Verify authenticator" : "Set up authenticator"}
              </Link>
            </div>
          ) : null}
          <div className="grid gap-1 border-t border-line pt-5">
            <h3 className={subheading}>Recent security activity</h3>
            {account.securityEvents.length ? (
              <ul className="grid text-sm text-ink-soft">
                {account.securityEvents.map((event, index) => (
                  <li className="flex flex-wrap justify-between gap-x-4 gap-y-0.5 border-t border-line py-2.5 first:border-0" key={index}>
                    <span className="text-ink">{eventLabel(event.type)}</span>
                    <time dateTime={event.createdAt}>{formatDateTime(event.createdAt)}</time>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-ink-soft">No recent security changes.</p>}
          </div>
        </div>
      </Card>

      <Card>
        <div className="grid scroll-mt-24 gap-4" id="email">
          <div className="grid gap-0.5">
            <h2 className={heading}>Email address</h2>
            <p className="text-sm text-ink-soft">
              We send a confirmation link to the new address. Your current email stays in use until you open it.
            </p>
          </div>
          <ChangeEmailForm mfaRequired={mfaRequired} pending={account.pendingEmailChange} />
        </div>
      </Card>

      <div className="grid scroll-mt-24 gap-4 rounded-card border border-danger-border bg-surface p-5 sm:p-6" id="close">
        <h2 className={heading}>Close account</h2>
        <CloseAccountForm eligibility={closure} mfaRequired={mfaRequired} />
      </div>
    </PersonalShell>
  );
}
