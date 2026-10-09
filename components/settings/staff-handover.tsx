"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { TextInput } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
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
  return <form onSubmit={submit} className="grid gap-4 rounded-xl border border-amber-300 bg-white p-6 shadow-sm">
    <h3 className="text-lg font-semibold">Committee handover</h3>
    <p>Give ownership of {orgName} to another active staff member with a verified email. Under enforced MFA, both owners need an enrolled authenticator.</p>
    <p>Organisation records, event history and Stripe connection stay with {orgName}. Credentials and authenticators stay with each person. The legacy shared-login ownership link will be retired.</p>
    {error && <p role="alert" className="text-red-700">{error}</p>}
    <label className="grid gap-1">Incoming owner
      <select aria-label="Incoming owner" className="rounded border border-neutral-300 p-2" value={incomingStaffId} onChange={event => setIncoming(event.target.value)} required disabled={busy}>
        <option value="">Choose staff member</option>
        {targets.map(item => <option key={item.id} value={item.id}>{item.email}</option>)}
      </select>
    </label>
    {!targets.length && <p>Invite and verify another staff member first. They must meet the current MFA requirements.</p>}
    <label className="grid gap-1">Your access after handover
      <select aria-label="Your access after handover" className="rounded border border-neutral-300 p-2" value={outgoingAccess} onChange={event => setOutgoing(event.target.value)} disabled={busy}>
        <option value="admin">Keep admin access</option><option value="revoked">Revoke my staff access</option>
      </select>
    </label>
    {target && <p role="status">{target.email} will become an owner of {orgName}. Your staff access will {outgoingAccess === "admin" ? "change to admin" : "be revoked"}.</p>}
    <TextInput label="Current password for handover" type="password" autoComplete="current-password" required value={currentPassword} onChange={event => setPassword(event.target.value)} disabled={busy} />
    <TextInput label={`Type ${handoverAcknowledgement} to confirm`} required value={acknowledgement} onChange={event => setAcknowledgement(event.target.value)} disabled={busy} />
    <p>If you have an authenticator, verify this login on the Staff MFA page before submitting.</p>
    <Button type="submit" disabled={busy || !target || !currentPassword || acknowledgement !== handoverAcknowledgement}>{busy ? "Handing over..." : "Hand over ownership"}</Button>
  </form>;
}
