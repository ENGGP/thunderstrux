"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { TextArea, TextInput } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { fetchJson, getClientErrorMessage } from "@/lib/client/api";

type Action = "revoke" | "cancel";

// The member page's "Manage this membership" card (T23b): revoke (no refund)
// and, for a free membership, cancel. Each needs a reason and, when staff MFA
// is on, an authenticator code.
export function MembershipActions({
  orgSlug,
  grantId,
  member,
  canRevoke,
  canCancel,
  needsCode
}: {
  orgSlug: string;
  grantId: string;
  member: string;
  canRevoke: boolean;
  // A free membership whose order this staff member may cancel.
  canCancel: boolean;
  needsCode: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<Action | null>(null);
  const [form, setForm] = useState({ reason: "", mfaCode: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function confirm() {
    if (!open) return;
    setBusy(true);
    setError("");
    try {
      await fetchJson(`/api/orgs/${orgSlug}/memberships/members/${grantId}/${open}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: form.reason, ...(needsCode ? { mfaCode: form.mfaCode } : {}) })
      });
      setOpen(null);
      router.refresh();
    } catch (failure) {
      setOpen(null);
      setError(getClientErrorMessage(failure, "Nothing changed. The membership is still active."));
    } finally {
      setBusy(false);
    }
  }

  const fields = (
    <div className="mt-3 grid gap-3">
      <TextArea
        hint="Shown to the member and kept in the history. 8 to 500 characters."
        label="Reason"
        maxLength={500}
        onChange={(event) => setForm({ ...form, reason: event.target.value })}
        rows={3}
        value={form.reason}
      />
      {needsCode ? (
        <TextInput
          autoComplete="one-time-code"
          inputMode="numeric"
          label="Authenticator code"
          onChange={(event) => setForm({ ...form, mfaCode: event.target.value })}
          value={form.mfaCode}
        />
      ) : null}
    </div>
  );

  return (
    <div className="grid gap-4">
      <p className="text-sm text-ink-soft">
        {canCancel
          ? "Nothing was charged for this membership. Cancelling it ends it now; there is nothing to refund."
          : "To give money back, refund the order: that also ends the membership. Revoking ends it now without a refund."}
      </p>
      <div className="flex flex-wrap gap-3">
        {canCancel ? (
          <Button disabled={busy} onClick={() => setOpen("cancel")} type="button" variant="danger">
            Cancel free membership
          </Button>
        ) : null}
        {canRevoke && !canCancel ? (
          <Button disabled={busy} onClick={() => setOpen("revoke")} type="button" variant="danger">
            Revoke membership
          </Button>
        ) : null}
      </div>
      {needsCode ? <p className="text-sm text-ink-soft">You&apos;ll need your authenticator code.</p> : null}
      {error ? (
        <Notice role="alert" title="Not changed" tone="danger">
          <p className="mt-0.5">{error}</p>
        </Notice>
      ) : null}

      <ConfirmDialog
        busy={busy}
        cancelLabel="Keep membership"
        confirmLabel="Revoke membership"
        destructive
        onCancel={() => setOpen(null)}
        onConfirm={confirm}
        open={open === "revoke"}
        title={`Revoke ${member}'s membership?`}
      >
        <ul className="grid list-disc gap-1 pl-5">
          <li>Member prices and members-only events stop for {member} straight away.</li>
          <li>No money is returned. Refund the order instead if they should get it back.</li>
          <li>Tickets they already bought stay valid at the price paid.</li>
          <li>{member} is emailed, and this is recorded in the history.</li>
        </ul>
        {fields}
      </ConfirmDialog>

      <ConfirmDialog
        busy={busy}
        cancelLabel="Keep membership"
        confirmLabel="Cancel membership"
        destructive
        onCancel={() => setOpen(null)}
        onConfirm={confirm}
        open={open === "cancel"}
        title={`Cancel ${member}'s free membership?`}
      >
        <ul className="grid list-disc gap-1 pl-5">
          <li>The membership ends straight away, and {member} is emailed.</li>
          <li>Nothing was charged, so there&apos;s nothing to refund.</li>
        </ul>
        {fields}
      </ConfirmDialog>
    </div>
  );
}
