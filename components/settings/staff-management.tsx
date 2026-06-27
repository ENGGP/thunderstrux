"use client";

import { FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { TextInput } from "@/components/ui/input";
import { fetchJson, getClientErrorMessage } from "@/lib/client/api";

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
  initialInvites
}: {
  orgSlug: string;
  initialStaff: StaffRow[];
  initialInvites: InviteRow[];
}) {
  const [staff, setStaff] = useState(initialStaff);
  const [invites, setInvites] = useState(initialInvites);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<StaffRole>("event_manager");
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function refreshStaff() {
    const payload = await fetchJson<{
      staff: StaffRow[];
      invites: InviteRow[];
    }>(`/api/orgs/${orgSlug}/staff`);
    setStaff(payload.staff);
    setInvites(payload.invites);
  }

  async function inviteStaff(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setInviteToken(null);
    setIsSubmitting(true);

    try {
      const payload = await fetchJson<{
        token: string;
      }>(`/api/orgs/${orgSlug}/staff/invites`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, role })
      });
      setInviteToken(payload.token);
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
    }
  }

  return (
    <div className="grid gap-6">
      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {inviteToken ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Invite token: <span className="break-all font-mono">{inviteToken}</span>
        </div>
      ) : null}

      <form
        className="grid gap-4 rounded-xl border border-neutral-200 bg-white p-6 shadow-sm"
        onSubmit={inviteStaff}
      >
        <h3 className="text-lg font-semibold text-neutral-950">Invite staff</h3>
        <div className="grid gap-4 md:grid-cols-[1fr_220px]">
          <TextInput
            label="Email"
            onChange={(event) => setEmail(event.target.value)}
            required
            type="email"
            value={email}
          />
          <label className="grid gap-1 text-sm font-medium text-neutral-900">
            Role
            <select
              className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900"
              onChange={(event) => setRole(event.target.value as StaffRole)}
              value={role}
            >
              {roles.map((item) => (
                <option key={item} value={item}>
                  {roleLabels[item]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <Button disabled={isSubmitting || email.trim().length === 0} type="submit">
          {isSubmitting ? "Creating..." : "Create invite"}
        </Button>
      </form>

      <section className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
        <h3 className="text-lg font-semibold text-neutral-950">Active staff</h3>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-neutral-200 text-neutral-500">
                <th className="py-3 pr-4 font-medium">User</th>
                <th className="py-3 pr-4 font-medium">Role</th>
                <th className="py-3 pr-4 font-medium">Status</th>
                <th className="py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {staff.map((row) => (
                <tr className="border-b border-neutral-100 last:border-0" key={row.id}>
                  <td className="py-3 pr-4 text-neutral-800">{staffName(row)}</td>
                  <td className="py-3 pr-4">
                    <select
                      className="rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm text-neutral-900"
                      disabled={row.status !== "active"}
                      onChange={(event) =>
                        updateStaff(row.id, { role: event.target.value as StaffRole })
                      }
                      value={row.role}
                    >
                      {roles.map((item) => (
                        <option key={item} value={item}>
                          {roleLabels[item]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-3 pr-4 text-neutral-700">{row.status}</td>
                  <td className="py-3">
                    {row.status === "active" ? (
                      <button
                        className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-800 hover:bg-neutral-50"
                        onClick={() => updateStaff(row.id, { status: "revoked" })}
                        type="button"
                      >
                        Revoke
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {invites.length > 0 ? (
        <section className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
          <h3 className="text-lg font-semibold text-neutral-950">Pending invites</h3>
          <ul className="mt-4 grid gap-3">
            {invites.map((invite) => (
              <li
                className="rounded-lg border border-neutral-200 px-4 py-3 text-sm"
                key={invite.id}
              >
                <span className="font-medium text-neutral-950">{invite.email}</span>{" "}
                <span className="text-neutral-600">
                  {roleLabels[invite.role]} expires{" "}
                  {new Date(invite.expiresAt).toLocaleDateString()}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
