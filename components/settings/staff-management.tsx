"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { TextInput } from "@/components/ui/input";
import { Select, SelectControl } from "@/components/ui/select";
import { Icon } from "@/components/ui/icon";
import { Notice } from "@/components/ui/notice";
import { StatusBadge } from "@/components/ui/status-badge";
import { fetchJson, getClientErrorMessage } from "@/lib/client/api";
import { formatDate } from "@/lib/format";

type StaffRole =
  | "owner"
  | "admin"
  | "event_manager"
  | "finance_manager"
  | "check_in_staff";

type StaffRow = {
  id: string;
  role: StaffRole;
  status: "invited" | "active" | "revoked";
  revokedAt?: string | Date | null;
  user: {
    email: string;
    firstName: string | null;
    lastName: string | null;
  };
};

type InviteRow = {
  id: string;
  email: string;
  role: StaffRole;
  expiresAt: string | Date;
};

type PastInvite = {
  id: string;
  email: string;
  role: StaffRole;
  createdAt: string | Date;
  state: "accepted" | "revoked" | "expired";
};

// A staff change waiting for the actor to confirm it.
type PendingChange = { row: StaffRow; role?: StaffRole };

const roleLabels: Record<StaffRole, string> = {
  owner: "Owner",
  admin: "Admin",
  event_manager: "Event manager",
  finance_manager: "Finance manager",
  check_in_staff: "Check-in staff"
};

const roles = Object.keys(roleLabels) as StaffRole[];
// How many past staff and past invitations the server sends (listOrganisationStaff, listPastStaffInvites).
const historyShown = 25;

// What each role can do, shown under the invitation role.
const roleHints: Record<StaffRole, string> = {
  owner: "Owner: everything, including other owners and handover",
  admin: "Admin: everything except managing owners",
  event_manager: "Event manager: events, sales figures and check-in",
  finance_manager: "Finance manager: orders, refunds and sales figures",
  check_in_staff: "Check-in staff: checking in attendees only"
};

function personName(staff: StaffRow) {
  return [staff.user.firstName, staff.user.lastName].filter(Boolean).join(" ").trim();
}

export function StaffManagement({
  orgSlug,
  initialStaff,
  initialInvites,
  pastInvites,
  canManageOwners,
  timeZone
}: {
  canManageOwners: boolean;
  orgSlug: string;
  initialStaff: StaffRow[];
  initialInvites: InviteRow[];
  pastInvites: PastInvite[];
  timeZone: string;
}) {
  const router = useRouter();
  const [staff, setStaff] = useState(initialStaff);
  // Revoked staff are history, listed apart (the server sends only the most recent).
  const current = staff.filter((row) => row.status !== "revoked");
  const past = staff.filter((row) => row.status === "revoked");
  const [invites, setInvites] = useState(initialInvites);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<StaffRole>("event_manager");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Only the invite form says "Creating…"; a role change or invite action elsewhere just waits.
  const [inviting, setInviting] = useState(false);
  // Which card the last result belongs to: it shows at the end of that card, under the action.
  const [resultAt, setResultAt] = useState<"invite" | "staff" | "invites">("invite");
  // Revoking an invitation kills its emailed link, so it asks first, like revoking staff.
  const [revokingInvite, setRevokingInvite] = useState<{ id: string; email: string } | null>(null);
  const [pending, setPending] = useState<PendingChange | null>(null);
  // SEC-046: giving access (an invitation, a resend, a role change) needs a fresh
  // authenticator code unless staff MFA is off. The server decides; this only
  // chooses whether to show the field, and shows it until the answer arrives.
  const [codeNeeded, setCodeNeeded] = useState(true);
  const [mfaCode, setMfaCode] = useState("");
  const [codeFor, setCodeFor] = useState<{ kind: "invite" } | { kind: "resend"; inviteId: string; email: string } | null>(null);
  const [dialogError, setDialogError] = useState<string>();
  const withCode = () => (mfaCode.trim() ? { mfaCode: mfaCode.trim() } : {});

  useEffect(() => {
    fetchJson<{ mode: string }>("/api/me/mfa/status").then((mfa) => setCodeNeeded(mfa.mode !== "off"), () => undefined);
  }, []);

  function askForCode(action: NonNullable<typeof codeFor>) {
    setMfaCode(""); setDialogError(undefined); setCodeFor(action);
  }

  async function refreshStaff() {
    const payload = await fetchJson<{
      staff: StaffRow[];
      invites: InviteRow[];
    }>(`/api/orgs/${orgSlug}/staff`);
    setStaff(payload.staff);
    setInvites(payload.invites);
    router.refresh();
  }

  function inviteStaff(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (codeNeeded) askForCode({ kind: "invite" });
    else void createInvite();
  }

  async function createInvite() {
    setError(null);
    setNotice(null);
    setResultAt("invite");
    setIsSubmitting(true);
    setInviting(true);

    try {
      await fetchJson<{ invite: InviteRow }>(`/api/orgs/${orgSlug}/staff/invites`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, role, ...withCode() })
      });
      setCodeFor(null);
      setNotice("Invitation email queued. Ask the recipient to sign in with their verified email and accept the link.");
      setEmail("");
      await refreshStaff();
    } catch (inviteError) {
      const message = getClientErrorMessage(inviteError, "Could not create staff invite.");
      if (codeFor) setDialogError(message); else setError(message);
    } finally {
      setIsSubmitting(false);
      setInviting(false);
    }
  }

  async function updateStaff(staffId: string, data: { role?: StaffRole; status?: string }) {
    setError(null);
    setNotice(null);
    setResultAt("staff");
    setIsSubmitting(true);

    try {
      await fetchJson(`/api/orgs/${orgSlug}/staff/${staffId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...data, ...(data.role ? withCode() : {}) })
      });
      setPending(null);
      setNotice(data.role ? `Role changed to ${roleLabels[data.role]}.` : "Staff access revoked.");
      await refreshStaff();
    } catch (updateError) {
      const message = getClientErrorMessage(updateError, "Could not update staff access.");
      // A role change keeps its dialog open, so a mistyped code can be fixed there.
      if (data.role) setDialogError(message);
      else { setError(message); setPending(null); }
    } finally {
      setIsSubmitting(false);
    }
  }

  async function manageInvite(inviteId: string, action: "resend" | "revoke") {
    setError(null); setNotice(null); setResultAt("invites"); setIsSubmitting(true);
    try {
      await fetchJson(`/api/orgs/${orgSlug}/staff/invites/${inviteId}/${action}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(action === "resend" ? withCode() : {}) });
      setCodeFor(null);
      setNotice(action === "resend" ? "New invitation emailed. The link in the earlier email no longer works." : "Invitation revoked. Its link no longer works.");
      await refreshStaff();
    } catch (failure) {
      const message = getClientErrorMessage(failure, "Could not update invitation.");
      if (codeFor) setDialogError(message); else setError(message);
    }
    finally { setIsSubmitting(false); setRevokingInvite(null); }
  }

  const results = (at: typeof resultAt) =>
    resultAt === at ? (
      <>
        {error ? <Notice className="mt-4" reveal role="alert" tone="danger">{error}</Notice> : null}
        {notice ? <Notice className="mt-4" reveal role="status" tone="success">{notice}</Notice> : null}
      </>
    ) : null;

  return (
    <div className="grid grid-cols-1 gap-6">
      <Card>
        <form className="grid gap-4" onSubmit={inviteStaff}>
          <h2 className="text-lg font-semibold text-ink">Invite staff</h2>
          <div className="grid items-start gap-4 md:grid-cols-[minmax(0,1fr)_260px_auto]">
            <TextInput
              label="Email"
              onChange={(event) => setEmail(event.target.value)}
              required
              type="email"
              value={email}
            />
            <Select
              hint={roleHints[role]}
              label="Invitation role"
              onChange={(value) => setRole(value as StaffRole)}
              value={role}
            >
              {roles.filter(item => canManageOwners || item !== "owner").map((item) => (
                <option key={item} value={item}>
                  {roleLabels[item]}
                </option>
              ))}
            </Select>
            <Button busy={inviting} busyLabel="Creating…" className="md:mt-[26px]" disabled={isSubmitting || email.trim().length === 0} type="submit">
              Create invite
            </Button>
          </div>
          <p className="text-sm text-ink-soft">
            The invitation is emailed privately and its link lasts 7 days. The
            recipient signs in with a verified account using this address and
            accepts it themselves.
          </p>
          <details className="group text-sm">
            <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1.5 font-semibold text-brand [&::-webkit-details-marker]:hidden">
              What each role can do
              <Icon className="group-open:rotate-180" name="chevronDown" size={16} />
            </summary>
            <ul className="mt-1 grid gap-1.5 text-ink-soft">
              {roles.filter((item) => canManageOwners || item !== "owner").map((item) => (
                <li key={item}>{roleHints[item]}.</li>
              ))}
            </ul>
          </details>
        </form>
        {results("invite")}
        {/* The last pending invitation was revoked, so its card is gone: say so here. */}
        {invites.length === 0 ? results("invites") : null}
      </Card>

      <Card>
        <h2 className="text-lg font-semibold text-ink">Current staff</h2>
        <div aria-label="Current staff" className="mt-3 overflow-x-auto" role="region" tabIndex={0}>
          <table className="w-full border-collapse text-left text-ui md:min-w-[560px]">
            <thead className="sr-only md:not-sr-only md:table-header-group">
              <tr className="text-caption text-ink-soft">
                <th className="py-2.5 pr-4 font-semibold" scope="col">Person</th>
                <th className="py-2.5 pr-4 font-semibold" scope="col">Role</th>
                <th className="py-2.5 pr-4 font-semibold" scope="col">Status</th>
                <th className="py-2.5 font-semibold" scope="col">Access</th>
              </tr>
            </thead>
            <tbody>
              {current.map((row) => {
                const lastOwner = row.role === "owner" && row.status === "active" && staff.filter((other) => other.role === "owner" && other.status === "active").length === 1;
                return (
                <tr className="grid gap-2 border-t border-line py-3 align-top first:border-0 md:table-row md:py-0 md:first:border-t" key={row.id}>
                  <td className="md:py-3 md:pr-4">
                    {personName(row) ? <p className="font-semibold text-ink">{personName(row)}</p> : null}
                    <p className="text-sm text-ink-soft [overflow-wrap:anywhere]">{row.user.email}</p>
                  </td>
                  <td className="grid gap-1 md:table-cell md:py-3 md:pr-4">
                    {/* Phones show rows as cards, with no column header above the select. */}
                    <span aria-hidden="true" className="text-xs font-semibold text-ink-soft md:hidden">Role</span>
                    <SelectControl
                      className="h-9 min-w-32 rounded-control border border-line-strong bg-surface px-2 text-sm text-ink aria-disabled:border-line aria-disabled:bg-inert aria-disabled:text-ink-soft"
                      aria-label={`Role for ${row.user.email}`}
                      disabled={isSubmitting || lastOwner || row.status !== "active" || (!canManageOwners && row.role === "owner")}
                      onChange={(value) => { setMfaCode(""); setDialogError(undefined); setPending({ row, role: value as StaffRole }); }}
                      value={row.role}
                    >
                      {roles.filter(item => canManageOwners || item !== "owner" || row.role === "owner").map((item) => (
                        <option key={item} value={item}>
                          {roleLabels[item]}
                        </option>
                      ))}
                    </SelectControl>
                  </td>
                  <td className="md:py-3 md:pr-4">
                    <StatusBadge
                      label={row.status === "invited" ? "Invited" : undefined}
                      status={row.status === "invited" ? "pending" : row.status === "active" ? "staff-active" : row.status}
                    />
                  </td>
                  <td className="md:py-3">
                    {lastOwner ? (
                      <p className="text-sm text-ink-soft">The only owner. Hand over first.</p>
                    ) : row.status === "active" && (canManageOwners || row.role !== "owner") ? (
                      <Button
                        aria-label={`Revoke access for ${row.user.email}`}
                        disabled={isSubmitting}
                        onClick={() => setPending({ row })}
                        size="sm"
                        type="button"
                        variant="dangerText"
                      >
                        Revoke access
                      </Button>
                    ) : null}
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {results("staff")}
      </Card>

      {invites.length > 0 ? (
        <Card>
          <h2 className="text-lg font-semibold text-ink">Pending invitations</h2>
          <ul className="mt-2 grid">
            {invites.map((invite) => (
              <li
                className="flex flex-wrap items-center justify-between gap-3 border-t border-line py-3 first:border-0"
                key={invite.id}
              >
                <div className="min-w-0">
                  <p className="font-semibold text-ink [overflow-wrap:anywhere]">{invite.email}</p>
                  <p className="text-sm text-ink-soft">
                    {roleLabels[invite.role]} · expires {formatDate(invite.expiresAt, timeZone)}
                  </p>
                </div>
                {(canManageOwners || invite.role !== "owner") && (
                  <div className="flex flex-wrap gap-2">
                    <Button disabled={isSubmitting} onClick={() => codeNeeded ? askForCode({ kind: "resend", inviteId: invite.id, email: invite.email }) : manageInvite(invite.id, "resend")} size="sm" type="button" variant="secondary">
                      Resend invitation
                    </Button>
                    <Button disabled={isSubmitting} onClick={() => setRevokingInvite({ id: invite.id, email: invite.email })} size="sm" type="button" variant="dangerText">
                      Revoke invitation
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
          {results("invites")}
        </Card>
      ) : null}

      {past.length > 0 ? (
        <Card>
          <h2 className="text-lg font-semibold text-ink">Past staff</h2>
          <p className="mt-1 text-sm text-ink-soft">
            {past.length >= historyShown ? `The ${historyShown} most recently revoked. ` : ""}They no longer have access. To bring someone back, invite them again.
          </p>
          <ul aria-label="Past staff" className="mt-2 grid">
            {past.map((row) => (
              <li className="grid gap-0.5 border-t border-line py-3 first:border-0 sm:flex sm:items-baseline sm:justify-between sm:gap-4" key={row.id}>
                <span className="min-w-0">
                  {personName(row) ? <span className="block font-semibold text-ink">{personName(row)}</span> : null}
                  <span className="block text-sm text-ink-soft [overflow-wrap:anywhere]">{row.user.email}</span>
                </span>
                <span className="shrink-0 text-sm text-ink-soft">
                  {roleLabels[row.role]}{row.revokedAt ? ` · revoked ${formatDate(row.revokedAt, timeZone)}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {pastInvites.length > 0 ? (
        <Card>
          <h2 className="text-lg font-semibold text-ink">Past invitations</h2>
          {pastInvites.length >= historyShown ? <p className="mt-1 text-sm text-ink-soft">The {historyShown} most recent.</p> : null}
          <div aria-label="Past invitations" className="mt-3 overflow-x-auto" role="region" tabIndex={0}>
            <table className="w-full border-collapse text-left text-ui md:min-w-[520px]">
              <thead className="sr-only md:not-sr-only md:table-header-group">
                <tr className="text-caption text-ink-soft">
                  <th className="py-2.5 pr-4 font-semibold" scope="col">Email</th>
                  <th className="py-2.5 pr-4 font-semibold" scope="col">Role</th>
                  <th className="py-2.5 pr-4 font-semibold" scope="col">Outcome</th>
                  <th className="py-2.5 font-semibold" scope="col">Sent</th>
                </tr>
              </thead>
              <tbody>
                {pastInvites.map((invite) => (
                  <tr className="grid gap-1 border-t border-line py-3 first:border-0 md:table-row md:py-0 md:first:border-t" key={invite.id}>
                    <td className="md:py-3 md:pr-4 text-ink [overflow-wrap:anywhere]">{invite.email}</td>
                    <td className="md:py-3 md:pr-4 text-ink-soft">{roleLabels[invite.role]}</td>
                    <td className="md:py-3 md:pr-4"><StatusBadge status={invite.state} /></td>
                    <td className="text-ink-soft md:py-3">{formatDate(invite.createdAt, timeZone)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      <ConfirmDialog
        busy={isSubmitting}
        cancelLabel="Keep invitation"
        confirmLabel="Revoke invitation"
        destructive
        onCancel={() => setRevokingInvite(null)}
        onConfirm={() => revokingInvite && manageInvite(revokingInvite.id, "revoke")}
        open={revokingInvite !== null}
        title={`Revoke the invitation for ${revokingInvite?.email ?? "this person"}?`}
      >
        The link in their email stops working at once. You can invite them again later.
      </ConfirmDialog>

      <ConfirmDialog
        busy={isSubmitting}
        confirmLabel={codeFor?.kind === "resend" ? "Resend invitation" : "Create invite"}
        error={dialogError}
        onCancel={() => setCodeFor(null)}
        onConfirm={() => codeFor?.kind === "resend" ? manageInvite(codeFor.inviteId, "resend") : createInvite()}
        open={codeFor !== null}
        title={codeFor?.kind === "resend" ? `Resend the invitation to ${codeFor.email}?` : `Invite ${email.trim() || "this person"} as ${roleLabels[role]}?`}
      >
        <div className="grid gap-4">
          <p>Giving someone access to this society needs your authenticator code. Every owner is emailed when they accept.</p>
          <TextInput
              autoComplete="one-time-code"
              hint="6 digits from your authenticator app"
              inputMode="numeric"
              label="Authenticator code"
              onChange={(event) => setMfaCode(event.target.value)}
              value={mfaCode}
            />
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        busy={isSubmitting}
        confirmLabel={pending?.role ? "Change role" : "Revoke access"}
        destructive={!pending?.role}
        error={pending?.role ? dialogError : undefined}
        onCancel={() => setPending(null)}
        onConfirm={() =>
          pending &&
          updateStaff(
            pending.row.id,
            pending.role ? { role: pending.role } : { status: "revoked" }
          )
        }
        open={pending !== null}
        title={
          pending?.role
            ? `Change ${pending.row.user.email} to ${roleLabels[pending.role]}?`
            : `Revoke staff access for ${pending?.row.user.email ?? "this person"}?`
        }
      >
        {pending?.role
          ? codeNeeded ? (
            <div className="grid gap-4">
              <p>Their permissions change immediately, on every device they are signed in on. Enter your authenticator code to confirm; every owner is emailed.</p>
              <TextInput
                autoComplete="one-time-code"
                hint="6 digits from your authenticator app"
                inputMode="numeric"
                label="Authenticator code"
                onChange={(event) => setMfaCode(event.target.value)}
                value={mfaCode}
              />
            </div>
          ) : "Their permissions change immediately, on every device they are signed in on."
          : "They lose access to this society's dashboard immediately, on every device. Their personal account, tickets and joined societies are not affected. You can invite them again later."}
      </ConfirmDialog>
    </div>
  );
}
