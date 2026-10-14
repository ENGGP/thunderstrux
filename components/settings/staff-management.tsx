"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { TextInput } from "@/components/ui/input";
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

function staffName(staff: StaffRow) {
  const name = [staff.user.firstName, staff.user.lastName]
    .filter(Boolean)
    .join(" ")
    .trim();

  return name ? `${name} (${staff.user.email})` : staff.user.email;
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
    setIsSubmitting(true);

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
    }
  }

  async function updateStaff(staffId: string, data: { role?: StaffRole; status?: string }) {
    setError(null);
    setIsSubmitting(true);

    try {
      await fetchJson(`/api/orgs/${orgSlug}/staff/${staffId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data)
      });
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
    setError(null); setNotice(null); setIsSubmitting(true);
    try {
      await fetchJson(`/api/orgs/${orgSlug}/staff/invites/${inviteId}/${action}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      setNotice(action === "resend" ? "New invitation email queued. The previous link is now invalid." : "Invitation revoked.");
      await refreshStaff();
    } catch (failure) { setError(getClientErrorMessage(failure, "Could not update invitation.")); }
    finally { setIsSubmitting(false); }
  }

  return (
    <div className="grid gap-6">
      {error ? (
        <Notice role="alert" tone="danger">
          {error}
        </Notice>
      ) : null}

      {notice ? (
        <Notice role="status" tone="success">
          {notice}
        </Notice>
      ) : null}

      <form
        className="grid gap-4 rounded-card border border-line bg-surface p-6"
        onSubmit={inviteStaff}
      >
        <h2 className="text-lg font-semibold text-ink">Invite staff</h2>
        <p className="text-sm text-ink-soft">
          The invitation is emailed privately. The recipient signs in with a
          verified account using this address and accepts it themselves.
        </p>
        <div className="grid gap-4 md:grid-cols-[1fr_220px]">
          <TextInput
            label="Email"
            onChange={(event) => setEmail(event.target.value)}
            required
            type="email"
            value={email}
          />
          <label className="grid content-start gap-1.5 text-sm font-semibold text-ink">
            Role
            <select
              className="h-11 rounded-control border border-line-strong bg-surface px-3 text-base font-normal text-ink"
              onChange={(event) => setRole(event.target.value as StaffRole)}
              value={role}
              aria-label="Invitation role"
            >
              {roles.filter(item => canManageOwners || item !== "owner").map((item) => (
                <option key={item} value={item}>
                  {roleLabels[item]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div>
          <Button disabled={isSubmitting || email.trim().length === 0} type="submit">
            {isSubmitting ? "Creating..." : "Create invite"}
          </Button>
        </div>
      </form>

      <section className="rounded-card border border-line bg-surface p-6">
        <h2 className="text-lg font-semibold text-ink">Staff access (up to 100)</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-line text-ink-muted">
                <th className="py-3 pr-4 font-semibold">User</th>
                <th className="py-3 pr-4 font-semibold">Role</th>
                <th className="py-3 pr-4 font-semibold">Status</th>
                <th className="py-3 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {staff.map((row) => (
                <tr className="border-b border-line last:border-0" key={row.id}>
                  <td className="py-3 pr-4 text-ink-soft">{staffName(row)}</td>
                  <td className="py-3 pr-4">
                    <select
                      className="h-9 rounded-control border border-line-strong bg-surface px-2 text-sm text-ink"
                      aria-label={`Role for ${row.user.email}`}
                      disabled={isSubmitting || row.status !== "active" || (!canManageOwners && row.role === "owner")}
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
                  <td className="py-3 pr-4">
                    <StatusBadge
                      label={row.status === "invited" ? "Invited" : undefined}
                      status={row.status === "invited" ? "pending" : row.status}
                    />
                  </td>
                  <td className="py-3">
                    {row.status === "active" && (canManageOwners || row.role !== "owner") ? (
                      <Button
                        disabled={isSubmitting}
                        onClick={() => setPending({ row })}
                        size="sm"
                        type="button"
                        variant="danger"
                      >
                        Revoke
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {invites.length > 0 ? (
        <section className="rounded-card border border-line bg-surface p-6">
          <h2 className="text-lg font-semibold text-ink">Pending invites (latest 100)</h2>
          <ul className="mt-4 grid gap-3">
            {invites.map((invite) => (
              <li
                className="rounded-control border border-line px-4 py-3 text-sm"
                key={invite.id}
              >
                <span className="font-semibold text-ink">{invite.email}</span>{" "}
                <span className="text-ink-muted">
                  {roleLabels[invite.role]} expires{" "}
                  {formatDate(invite.expiresAt)}
                </span>
                {(canManageOwners || invite.role !== "owner") && <div className="mt-2 flex gap-4">
                  <button type="button" className="text-brand underline disabled:opacity-60" disabled={isSubmitting} onClick={() => manageInvite(invite.id, "resend")}>Resend invitation</button>
                  <button type="button" className="text-danger underline disabled:opacity-60" disabled={isSubmitting} onClick={() => manageInvite(invite.id, "revoke")}>Revoke invitation</button>
                </div>}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {pastInvites.length > 0 ? (
        <section className="rounded-card border border-line bg-surface p-6">
          <h2 className="text-lg font-semibold text-ink">Past invitations (latest 25)</h2>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-line text-ink-muted">
                  <th className="py-3 pr-4 font-semibold">Email</th>
                  <th className="py-3 pr-4 font-semibold">Role</th>
                  <th className="py-3 pr-4 font-semibold">Sent</th>
                  <th className="py-3 font-semibold">Outcome</th>
                </tr>
              </thead>
              <tbody>
                {pastInvites.map((invite) => (
                  <tr className="border-b border-line last:border-0" key={invite.id}>
                    <td className="py-3 pr-4 text-ink-soft [overflow-wrap:anywhere]">{invite.email}</td>
                    <td className="py-3 pr-4 text-ink-soft">{roleLabels[invite.role]}</td>
                    <td className="py-3 pr-4 text-ink-soft">{formatDate(invite.createdAt)}</td>
                    <td className="py-3"><StatusBadge status={invite.state} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
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
