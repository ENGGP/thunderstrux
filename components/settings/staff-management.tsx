"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Select, TextInput } from "@/components/ui/input";
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
  canManageOwners
}: {
  canManageOwners: boolean;
  orgSlug: string;
  initialStaff: StaffRow[];
  initialInvites: InviteRow[];
  pastInvites: PastInvite[];
}) {
  const router = useRouter();
  const [staff, setStaff] = useState(initialStaff);
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
  const [pending, setPending] = useState<PendingChange | null>(null);

  async function refreshStaff() {
    const payload = await fetchJson<{
      staff: StaffRow[];
      invites: InviteRow[];
    }>(`/api/orgs/${orgSlug}/staff`);
    setStaff(payload.staff);
    setInvites(payload.invites);
    router.refresh();
  }

  async function inviteStaff(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setResultAt("invite");
    setIsSubmitting(true);
    setInviting(true);

    try {
      await fetchJson<{ invite: InviteRow }>(`/api/orgs/${orgSlug}/staff/invites`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, role })
      });
      setNotice("Invitation email queued. Ask the recipient to sign in with their verified email and accept the link.");
      setEmail("");
      await refreshStaff();
    } catch (inviteError) {
      setError(
        getClientErrorMessage(inviteError, "Could not create staff invite.")
      );
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
        body: JSON.stringify(data)
      });
      setNotice(data.role ? `Role changed to ${roleLabels[data.role]}.` : "Staff access revoked.");
      await refreshStaff();
    } catch (updateError) {
      setError(
        getClientErrorMessage(updateError, "Could not update staff access.")
      );
    } finally {
      setIsSubmitting(false);
      setPending(null);
    }
  }

  async function manageInvite(inviteId: string, action: "resend" | "revoke") {
    setError(null); setNotice(null); setResultAt("invites"); setIsSubmitting(true);
    try {
      await fetchJson(`/api/orgs/${orgSlug}/staff/invites/${inviteId}/${action}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      setNotice(action === "resend" ? "New invitation email queued. The previous link is now invalid." : "Invitation revoked.");
      await refreshStaff();
    } catch (failure) { setError(getClientErrorMessage(failure, "Could not update invitation.")); }
    finally { setIsSubmitting(false); }
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
              onChange={(event) => setRole(event.target.value as StaffRole)}
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
              {staff.map((row) => {
                const lastOwner = row.role === "owner" && row.status === "active" && staff.filter((other) => other.role === "owner" && other.status === "active").length === 1;
                return (
                <tr className="grid gap-2 border-t border-line py-3 align-top first:border-0 md:table-row md:py-0 md:first:border-t" key={row.id}>
                  <td className="md:py-3 md:pr-4">
                    {personName(row) ? <p className="font-semibold text-ink">{personName(row)}</p> : null}
                    <p className="text-sm text-ink-soft [overflow-wrap:anywhere]">{row.user.email}</p>
                  </td>
                  <td className="md:py-3 md:pr-4">
                    <select
                      className="h-9 rounded-control border border-line-strong bg-surface px-2 text-sm text-ink disabled:cursor-not-allowed disabled:bg-surface-subtle"
                      aria-label={`Role for ${row.user.email}`}
                      disabled={isSubmitting || lastOwner || row.status !== "active" || (!canManageOwners && row.role === "owner")}
                      onChange={(event) =>
                        setPending({ row, role: event.target.value as StaffRole })
                      }
                      value={row.role}
                    >
                      {roles.filter(item => canManageOwners || item !== "owner" || row.role === "owner").map((item) => (
                        <option key={item} value={item}>
                          {roleLabels[item]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="md:py-3 md:pr-4">
                    <StatusBadge
                      label={row.status === "invited" ? "Invited" : undefined}
                      status={row.status === "invited" ? "pending" : row.status}
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
                        variant="danger"
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
                    {roleLabels[invite.role]} · expires {formatDate(invite.expiresAt)}
                  </p>
                </div>
                {(canManageOwners || invite.role !== "owner") && (
                  <div className="flex flex-wrap gap-2">
                    <Button disabled={isSubmitting} onClick={() => manageInvite(invite.id, "resend")} size="sm" type="button" variant="secondary">
                      Resend invitation
                    </Button>
                    <Button disabled={isSubmitting} onClick={() => manageInvite(invite.id, "revoke")} size="sm" type="button" variant="danger">
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

      {pastInvites.length > 0 ? (
        <Card>
          <h2 className="text-lg font-semibold text-ink">Past invitations</h2>
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
                    <td className="text-ink-soft md:py-3">{formatDate(invite.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      <ConfirmDialog
        busy={isSubmitting}
        confirmLabel={pending?.role ? "Change role" : "Revoke access"}
        destructive={!pending?.role}
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
          ? "Their permissions change immediately, on every device they are signed in on."
          : "They lose access to this society's dashboard immediately, on every device. Their personal account, tickets and joined societies are not affected. You can invite them again later."}
      </ConfirmDialog>
    </div>
  );
}
