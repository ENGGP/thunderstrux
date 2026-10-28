"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Select, TextInput } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { fetchJson, getClientErrorMessage } from "@/lib/client/api";
import { handoverAcknowledgement } from "@/lib/validators/staff";

export function StaffHandover({ orgSlug, orgName, targets }: { orgSlug: string; orgName: string; targets: { id: string; email: string }[] }) {
  const router = useRouter();
  const [incomingStaffId, setIncoming] = useState("");
  const [outgoingAccess, setOutgoing] = useState("admin");
  const [currentPassword, setPassword] = useState("");
  const [acknowledgement, setAcknowledgement] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const target = targets.find(item => item.id === incomingStaffId);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(null);
    try {
      await fetchJson(`/api/orgs/${orgSlug}/staff/handover`, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ incomingStaffId, outgoingAccess, currentPassword, acknowledgement }) });
      setPassword(""); router.push("/dashboard"); router.refresh();
    } catch (failure) { setPassword(""); setError(getClientErrorMessage(failure, "Could not hand over ownership.")); setBusy(false); }
  }
  return (
    <form onSubmit={submit} className="grid gap-4 rounded-card border border-warning-border bg-surface p-5 sm:p-6">
      <div className="grid gap-1">
        <h2 className="text-lg font-semibold text-ink">Committee handover</h2>
        <p className="text-sm text-ink-soft">
          Make another active staff member with a verified email an owner of {orgName}. Only owners see this.
          Under enforced MFA, both owners need an enrolled authenticator.
        </p>
        <p className="text-sm text-ink-soft">
          Organisation records, event history and the Stripe connection stay with {orgName}. Credentials and
          authenticators stay with each person.
        </p>
      </div>
      {error && <Notice role="alert" tone="danger">{error}</Notice>}
      {!targets.length && <Notice>Invite and verify another staff member first. They must meet the current MFA requirements.</Notice>}
      <div className="grid gap-4 md:grid-cols-2">
        <Select label="Incoming owner" value={incomingStaffId} onChange={event => setIncoming(event.target.value)} required disabled={busy}>
          <option value="">Choose staff member</option>
          {targets.map(item => <option key={item.id} value={item.id}>{item.email}</option>)}
        </Select>
        <Select label="Your access after handover" value={outgoingAccess} onChange={event => setOutgoing(event.target.value)} disabled={busy}>
          <option value="admin">Keep admin access</option><option value="revoked">Revoke my staff access</option>
        </Select>
      </div>
      {target && (
        <Notice role="status">
          {target.email} will become an owner of {orgName}. Your staff access will {outgoingAccess === "admin" ? "change to admin" : "be revoked"}.
        </Notice>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        <TextInput label="Current password for handover" type="password" autoComplete="current-password" required value={currentPassword} onChange={event => setPassword(event.target.value)} disabled={busy} />
        <TextInput label={`Type ${handoverAcknowledgement} to confirm`} required value={acknowledgement} onChange={event => setAcknowledgement(event.target.value)} disabled={busy} />
      </div>
      <p className="text-sm text-ink-soft">If you have an authenticator, verify this sign-in under Account settings, Password and security, before submitting.</p>
      <div>
        <Button busy={busy} busyLabel="Handing over…" type="submit" variant="danger" disabled={!target || !currentPassword || acknowledgement !== handoverAcknowledgement}>Hand over ownership</Button>
      </div>
    </form>
  );
}
